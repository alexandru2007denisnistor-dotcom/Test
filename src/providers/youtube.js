import { fetchJson, ProviderError } from '../http.js';
import { bestMatch } from '../merge.js';

const API = 'https://www.googleapis.com/youtube/v3';

/** "PT1H2M3S" → Millisekunden */
export function parseIsoDuration(iso = '') {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d = 0, h = 0, min = 0, s = 0] = m.map((x) => Number(x) || 0);
  return (((d * 24 + h) * 60 + min) * 60 + s) * 1000;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
export function decodeEntities(str = '') {
  return str.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** "Künstler - Topic", "KünstlerVEVO", "Künstler Official" → "Künstler" */
export function cleanChannel(channel = '') {
  return channel
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(official|offiziell)(\s+(channel|kanal|music))?$/i, '')
    .trim();
}

/** Zerlegt Videotitel der Form "Künstler - Titel (Official Video)". */
export function parseVideoTitle(rawTitle, channel) {
  const title = decodeEntities(rawTitle);
  const m = /^(.+?)\s+[-–—|:]\s+(.+)$/.exec(title);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: cleanChannel(decodeEntities(channel)), title: title.trim() };
}

/**
 * YouTube (Musik) – offizielle YouTube Data API v3, Kategorie "Musik".
 * Achtung: Standard-Kontingent 10.000 Einheiten/Tag, eine Suche kostet 100 → ca. 100 Suchen/Tag.
 * Deshalb wird im Server großzügig zwischengespeichert.
 */
export function createYouTube({ apiKey, region = 'DE', fetchImpl } = {}) {
  const configured = !!apiKey;
  let blockedUntil = 0;

  async function call(endpoint, params) {
    if (!configured) throw new ProviderError('youtube', 'Nicht eingerichtet', { status: 503, code: 'not_configured' });
    if (Date.now() < blockedUntil) {
      throw new ProviderError('youtube', 'Tageskontingent der YouTube-API aufgebraucht', { status: 429, code: 'quota' });
    }
    const qs = new URLSearchParams({ ...params, key: apiKey });
    const { ok, status, body } = await fetchJson(`${API}/${endpoint}?${qs}`, { fetchImpl, provider: 'youtube' });
    if (!ok) {
      const reason = body?.error?.errors?.[0]?.reason || '';
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        blockedUntil = Date.now() + 60 * 60 * 1000; // eine Stunde Pause, dann erneut probieren
        throw new ProviderError('youtube', 'Tageskontingent der YouTube-API aufgebraucht', { status: 429, code: 'quota' });
      }
      if (reason === 'keyInvalid' || status === 400) {
        throw new ProviderError('youtube', 'API-Schlüssel ungültig', { status: 502, code: 'auth' });
      }
      throw new ProviderError('youtube', body?.error?.message || `HTTP ${status}`, { status: 502 });
    }
    return body;
  }

  async function searchVideos(q, limit) {
    const body = await call('search', {
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10', // Musik
      videoEmbeddable: 'true',
      maxResults: String(Math.min(limit, 50)),
      regionCode: region,
      q,
    });
    const items = (body?.items || []).filter((i) => i?.id?.videoId);
    if (!items.length) return [];

    // Laufzeiten nachladen (kostet nur 1 Einheit)
    const durations = new Map();
    try {
      const details = await call('videos', { part: 'contentDetails', id: items.map((i) => i.id.videoId).join(',') });
      for (const v of details?.items || []) durations.set(v.id, parseIsoDuration(v.contentDetails?.duration));
    } catch {
      /* ohne Laufzeit geht es auch */
    }

    return items.map((i) => {
      const s = i.snippet || {};
      const parsed = parseVideoTitle(s.title || '', s.channelTitle || '');
      const id = i.id.videoId;
      return {
        provider: 'youtube',
        title: parsed.title,
        artist: parsed.artist,
        rawTitle: decodeEntities(s.title || ''),
        channel: decodeEntities(s.channelTitle || ''),
        album: '',
        artwork: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || s.thumbnails?.default?.url || '',
        durationMs: durations.get(id) || 0,
        isrc: '',
        explicit: false,
        source: {
          id,
          url: `https://music.youtube.com/watch?v=${id}`,
          channel: decodeEntities(s.channelTitle || ''),
        },
      };
    });
  }

  return {
    name: 'youtube',
    configured,

    search(q, { limit = 15 } = {}) {
      return searchVideos(q, limit);
    },

    async find({ title, artist, durationMs }) {
      const candidates = await searchVideos(`${artist} - ${title}`, 6);
      return bestMatch(candidates, { title, artist, durationMs }, 0.7);
    },
  };
}
