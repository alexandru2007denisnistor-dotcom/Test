import { TtlCache } from './cache.js';
import { mergeResults, normalize, PROVIDERS } from './merge.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// YouTube ist teuer (Kontingent) → länger zwischenspeichern
const SEARCH_TTL = { spotify: 30 * MIN, deezer: 30 * MIN, youtube: 12 * HOUR };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Erzeugt die API-Routen. `providers` = { spotify, deezer, youtube }, jeweils mit
 * { configured, search(q), find({title, artist, isrc, durationMs}) } – Deezer zusätzlich chart/genres/track.
 */
export function createApi({ providers, cache = new TtlCache({ max: 1000 }) }) {
  const status = () =>
    Object.fromEntries(PROVIDERS.map((p) => [p, { configured: !!providers[p]?.configured }]));

  async function search(params) {
    const q = (params.get('q') || '').trim().slice(0, 200);
    if (!q) throw new HttpError(400, 'Parameter "q" fehlt');
    const wanted = (params.get('sources') || PROVIDERS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => PROVIDERS.includes(s));

    const report = {};
    const lists = {};
    await Promise.all(
      PROVIDERS.map(async (name) => {
        const p = providers[name];
        if (!wanted.includes(name)) {
          report[name] = { used: false, configured: !!p?.configured };
          return;
        }
        if (!p?.configured) {
          report[name] = { used: false, configured: false };
          return;
        }
        try {
          lists[name] = await cache.wrap(`search:${name}:${normalize(q)}`, SEARCH_TTL[name], () => p.search(q));
          report[name] = { used: true, configured: true, ok: true, count: lists[name].length };
        } catch (err) {
          report[name] = { used: true, configured: true, ok: false, error: err.message, code: err.code };
        }
      }),
    );

    return { query: q, tracks: mergeResults(lists), providers: report };
  }

  async function charts(params) {
    const genre = Number(params.get('genre') || 0) || 0;
    const list = await cache.wrap(`chart:${genre}`, 30 * MIN, () => providers.deezer.chart(genre));
    return { genre, tracks: mergeResults({ deezer: list }) };
  }

  async function genres() {
    return { genres: await cache.wrap('genres', 24 * HOUR, () => providers.deezer.genres()) };
  }

  /** Findet einen Song nachträglich auf einem bestimmten Dienst (z. B. für Vollversion über YouTube). */
  async function resolve(params) {
    const provider = params.get('provider');
    const title = (params.get('title') || '').trim().slice(0, 200);
    const artist = (params.get('artist') || '').trim().slice(0, 200);
    const isrc = (params.get('isrc') || '').trim().slice(0, 20);
    const durationMs = Number(params.get('durationMs')) || 0;
    if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Unbekannter Dienst');
    if (!title) throw new HttpError(400, 'Parameter "title" fehlt');
    const p = providers[provider];
    if (!p?.configured) throw new HttpError(503, `${provider} ist nicht eingerichtet`);

    const key = `resolve:${provider}:${isrc || ''}:${normalize(artist)}|${normalize(title)}`;
    const hit = await cache.wrap(key, provider === 'youtube' ? 24 * HOUR : 6 * HOUR, async () => {
      const found = await p.find({ title, artist, isrc, durationMs });
      return found ? { found: true, source: found.source, isrc: found.isrc || '' } : { found: false };
    });
    return { provider, ...hit };
  }

  async function deezerTrack(id) {
    if (!/^\d+$/.test(id)) throw new HttpError(400, 'Ungültige ID');
    // Vorschau-Links sind signiert und laufen ab → nur kurz cachen
    const t = await cache.wrap(`dz-track:${id}`, 10 * MIN, () => providers.deezer.track(id));
    return { source: t.source, isrc: t.isrc };
  }

  /** Router: gibt { status, body } zurück oder null, wenn die Route nicht existiert. */
  return async function handle(method, pathname, params) {
    if (method !== 'GET') return null;
    try {
      if (pathname === '/api/status') return { status: 200, body: { providers: status() } };
      if (pathname === '/api/search') return { status: 200, body: await search(params) };
      if (pathname === '/api/charts') return { status: 200, body: await charts(params) };
      if (pathname === '/api/genres') return { status: 200, body: await genres() };
      if (pathname === '/api/resolve') return { status: 200, body: await resolve(params) };
      const m = /^\/api\/deezer\/track\/([^/]+)$/.exec(pathname);
      if (m) return { status: 200, body: await deezerTrack(decodeURIComponent(m[1])) };
      return null;
    } catch (err) {
      const code = err instanceof HttpError ? err.status : err.status || 500;
      return { status: code, body: { error: err.message || 'Interner Fehler', code: err.code } };
    }
  };
}
