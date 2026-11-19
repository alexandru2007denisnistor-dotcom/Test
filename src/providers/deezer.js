import { fetchJson, ProviderError } from '../http.js';
import { bestMatch } from '../merge.js';

const API = 'https://api.deezer.com';

/**
 * Deezer – öffentliche API, kein Schlüssel nötig.
 * Liefert 30-Sekunden-Vorschauen (MP3) und Charts.
 */
export function createDeezer({ fetchImpl } = {}) {
  async function call(pathAndQuery) {
    const { ok, status, body } = await fetchJson(`${API}${pathAndQuery}`, {
      fetchImpl,
      provider: 'deezer',
      headers: { 'Accept-Language': 'de' }, // deutsche Genre-Namen
    });
    if (!ok) throw new ProviderError('deezer', `HTTP ${status}`, { status: 502 });
    // Deezer meldet Fehler mit HTTP 200 und { error: {...} }
    if (body?.error) {
      const quota = body.error.code === 4;
      throw new ProviderError('deezer', quota ? 'Zu viele Anfragen – kurz warten' : body.error.message || 'Fehler', {
        status: quota ? 429 : 502,
        code: quota ? 'rate_limited' : 'provider_error',
      });
    }
    return body;
  }

  function mapTrack(t) {
    return {
      provider: 'deezer',
      title: t.title || t.title_short || '',
      artist: t.artist?.name || '',
      album: t.album?.title || '',
      artwork: t.album?.cover_big || t.album?.cover_medium || t.artist?.picture_medium || '',
      durationMs: (Number(t.duration) || 0) * 1000,
      isrc: t.isrc || '',
      explicit: !!t.explicit_lyrics,
      source: {
        id: String(t.id),
        url: t.link || `https://www.deezer.com/track/${t.id}`,
        preview: t.preview || '',
      },
    };
  }

  const tracksOnly = (list) => (list || []).filter((t) => t && (t.type === undefined || t.type === 'track')).map(mapTrack);

  return {
    name: 'deezer',
    configured: true,

    async search(q, { limit = 25 } = {}) {
      const body = await call(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
      return tracksOnly(body.data);
    },

    async chart(genreId = 0, { limit = 50 } = {}) {
      const body = await call(`/chart/${Number(genreId) || 0}/tracks?limit=${limit}`);
      return tracksOnly(body.data);
    },

    async genres() {
      const body = await call('/genre');
      return (body.data || [])
        .filter((g) => g && g.id !== undefined)
        .map((g) => ({ id: g.id, name: g.name, picture: g.picture_medium || '' }));
    },

    /** Frische Daten zu einem Titel (Vorschau-Links von Deezer laufen nach einiger Zeit ab). */
    async track(id) {
      return mapTrack(await call(`/track/${encodeURIComponent(id)}`));
    },

    async find({ title, artist, durationMs }) {
      const target = { title, artist, durationMs };
      const strict = await call(
        `/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=5`,
      ).catch(() => ({ data: [] }));
      let hit = bestMatch(tracksOnly(strict.data), target);
      if (!hit) {
        const loose = await call(`/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=8`);
        hit = bestMatch(tracksOnly(loose.data), target);
      }
      return hit;
    },
  };
}
