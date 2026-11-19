async function get(path, params = {}, { signal } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const res = await fetch(`${path}${qs.toString() ? `?${qs}` : ''}`, { signal });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* leer */
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  status: () => get('/api/status'),
  search: (q, sources, opts) => get('/api/search', { q, sources: sources?.join(',') }, opts),
  charts: (genre = 0) => get('/api/charts', { genre }),
  genres: () => get('/api/genres'),
  resolve: (provider, t) =>
    get('/api/resolve', { provider, title: t.title, artist: t.artist, isrc: t.isrc, durationMs: t.durationMs || '' }),
  deezerTrack: (id) => get(`/api/deezer/track/${encodeURIComponent(id)}`),
};
