import { fetchJson, ProviderError } from '../http.js';
import { bestMatch } from '../merge.js';

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Seit 2026 liefert /search im Development Mode höchstens 10 Treffer pro Anfrage.
const PAGE_SIZE = 10;

/**
 * Spotify – Katalogsuche über den Client-Credentials-Flow (serverseitig, Secret bleibt geheim).
 * Abgespielt wird im Browser über den offiziellen Spotify-Embed-Player.
 */
export function createSpotify({ clientId, clientSecret, market = 'DE', pages = 2, fetchImpl } = {}) {
  const configured = !!(clientId && clientSecret);
  let token = null;
  let tokenExpires = 0;
  let tokenPromise = null;

  async function getToken(force = false) {
    if (!force && token && Date.now() < tokenExpires) return token;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const { ok, status, body } = await fetchJson(TOKEN_URL, {
        fetchImpl,
        provider: 'spotify',
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!ok || !body?.access_token) {
        throw new ProviderError('spotify', status === 400 || status === 401 ? 'Client-ID/Secret ungültig' : `Anmeldung fehlgeschlagen (HTTP ${status})`, {
          status: 502,
          code: 'auth',
        });
      }
      token = body.access_token;
      tokenExpires = Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60_000;
      return token;
    })();
    try {
      return await tokenPromise;
    } finally {
      tokenPromise = null;
    }
  }

  async function call(pathAndQuery, retried = false) {
    if (!configured) throw new ProviderError('spotify', 'Nicht eingerichtet', { status: 503, code: 'not_configured' });
    const t = await getToken(retried);
    const { ok, status, headers, body } = await fetchJson(`${API}${pathAndQuery}`, {
      fetchImpl,
      provider: 'spotify',
      headers: { Authorization: `Bearer ${t}` },
    });
    if (status === 401 && !retried) return call(pathAndQuery, true);
    if (status === 429) {
      const wait = headers?.get?.('retry-after');
      throw new ProviderError('spotify', `Zu viele Anfragen${wait ? ` – in ${wait}s erneut versuchen` : ''}`, {
        status: 429,
        code: 'rate_limited',
      });
    }
    if (!ok) throw new ProviderError('spotify', body?.error?.message || `HTTP ${status}`, { status: 502 });
    return body;
  }

  function pickImage(images = []) {
    // Spotify liefert absteigend sortiert (640, 300, 64) – 300px reicht für die Liste
    if (!images.length) return '';
    const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
    return (sorted.find((i) => (i.width || 0) <= 640) || sorted[0]).url;
  }

  function mapTrack(t) {
    return {
      provider: 'spotify',
      title: t.name || '',
      artist: (t.artists || []).map((a) => a.name).join(', '),
      album: t.album?.name || '',
      artwork: pickImage(t.album?.images),
      durationMs: Number(t.duration_ms) || 0,
      isrc: t.external_ids?.isrc || '',
      explicit: !!t.explicit,
      source: {
        id: t.id,
        uri: t.uri || `spotify:track:${t.id}`,
        url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
      },
    };
  }

  async function searchTracks(q, limit, offset = 0) {
    const params = new URLSearchParams({ q, type: 'track', limit: String(Math.min(limit, PAGE_SIZE)), offset: String(offset) });
    if (market) params.set('market', market);
    const body = await call(`/search?${params}`);
    return (body?.tracks?.items || []).filter(Boolean).map(mapTrack);
  }

  return {
    name: 'spotify',
    configured,

    async search(q, { limit = PAGE_SIZE * pages } = {}) {
      const n = Math.max(1, Math.ceil(limit / PAGE_SIZE));
      const results = await Promise.allSettled(
        Array.from({ length: n }, (_, i) => searchTracks(q, PAGE_SIZE, i * PAGE_SIZE)),
      );
      if (results[0].status === 'rejected') throw results[0].reason;
      const seen = new Set();
      return results
        .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .filter((t) => !seen.has(t.source.id) && seen.add(t.source.id));
    },

    async find({ title, artist, isrc, durationMs }) {
      const target = { title, artist, isrc, durationMs };
      if (isrc) {
        const [hit] = await searchTracks(`isrc:${isrc}`, 1);
        if (hit) return hit;
      }
      const strict = await searchTracks(`track:${title} artist:${artist}`, 5);
      return bestMatch(strict, target) || bestMatch(await searchTracks(`${artist} ${title}`, 8), target);
    },
  };
}
