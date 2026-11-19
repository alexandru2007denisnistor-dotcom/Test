import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';
import { ProviderError } from '../src/http.js';
import { parseEnv, loadConfig } from '../src/config.js';

const track = (provider, title, artist, id, extra = {}) => ({
  provider,
  title,
  artist,
  album: '',
  artwork: '',
  durationMs: 200000,
  isrc: extra.isrc || '',
  explicit: false,
  source: { id, url: `https://example.com/${id}`, ...(provider === 'deezer' ? { preview: 'https://cdn/p.mp3' } : {}) },
});

let calls;
const providers = {
  deezer: {
    configured: true,
    search: async (q) => (calls.push(['deezer', q]), [track('deezer', 'Roller', 'Apache 207', '1', { isrc: 'DE1' })]),
    chart: async () => [track('deezer', 'Chart Hit', 'Someone', '2')],
    genres: async () => [{ id: 0, name: 'Alle' }],
    track: async (id) => ({ ...track('deezer', 'Roller', 'Apache 207', id), isrc: 'DE1' }),
    find: async () => null,
  },
  spotify: {
    configured: true,
    search: async (q) => (calls.push(['spotify', q]), [track('spotify', 'Roller', 'Apache 207', 'sp1', { isrc: 'DE1' })]),
    find: async () => track('spotify', 'Roller', 'Apache 207', 'sp1'),
  },
  youtube: {
    configured: true,
    search: async () => {
      throw new ProviderError('youtube', 'Tageskontingent der YouTube-API aufgebraucht', { status: 429, code: 'quota' });
    },
    find: async () => (calls.push(['youtube-find']), track('youtube', 'Roller', 'Apache 207', 'yt1')),
  },
};

let server;
let base;
before(async () => {
  server = createAppServer({ config: loadConfig({}), providers });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const getJson = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test('GET /api/status meldet eingerichtete Dienste', async () => {
  calls = [];
  const { body } = await getJson('/api/status');
  assert.deepEqual(body.providers, { spotify: { configured: true }, deezer: { configured: true }, youtube: { configured: true } });
});

test('GET /api/search führt zusammen und meldet Fehler einzelner Dienste', async () => {
  calls = [];
  const { status, body } = await getJson('/api/search?q=Roller');
  assert.equal(status, 200);
  assert.equal(body.tracks.length, 1, 'Spotify+Deezer per ISRC vereint');
  assert.ok(body.tracks[0].sources.spotify && body.tracks[0].sources.deezer);
  assert.equal(body.providers.youtube.ok, false);
  assert.match(body.providers.youtube.error, /kontingent/i);
  assert.equal(body.providers.spotify.ok, true);
});

test('GET /api/search nutzt den Cache und respektiert "sources"', async () => {
  calls = [];
  await getJson('/api/search?q=Cache%20Test');
  await getJson('/api/search?q=cache test'); // gleiche Suche, andere Schreibweise
  assert.equal(calls.filter(([p]) => p === 'deezer').length, 1);

  calls = [];
  const { body } = await getJson('/api/search?q=nur%20deezer&sources=deezer');
  assert.deepEqual(calls.map(([p]) => p), ['deezer']);
  assert.equal(body.providers.spotify.used, false);
});

test('GET /api/search ohne q → 400', async () => {
  const { status, body } = await getJson('/api/search');
  assert.equal(status, 400);
  assert.match(body.error, /fehlt/);
});

test('GET /api/charts und /api/genres', async () => {
  const charts = await getJson('/api/charts?genre=0');
  assert.equal(charts.body.tracks[0].title, 'Chart Hit');
  const genres = await getJson('/api/genres');
  assert.equal(genres.body.genres[0].name, 'Alle');
});

test('GET /api/resolve findet Songs nachträglich und cacht das Ergebnis', async () => {
  calls = [];
  const a = await getJson('/api/resolve?provider=youtube&title=Roller&artist=Apache%20207');
  const b = await getJson('/api/resolve?provider=youtube&title=Roller&artist=Apache%20207');
  assert.equal(a.body.found, true);
  assert.equal(a.body.source.id, 'yt1');
  assert.deepEqual(b.body, a.body);
  assert.equal(calls.length, 1, 'zweiter Aufruf aus dem Cache');

  const bad = await getJson('/api/resolve?provider=napster&title=x');
  assert.equal(bad.status, 400);
});

test('GET /api/deezer/track/:id prüft die ID', async () => {
  const ok = await getJson('/api/deezer/track/123');
  assert.equal(ok.body.source.preview, 'https://cdn/p.mp3');
  const bad = await getJson('/api/deezer/track/abc');
  assert.equal(bad.status, 400);
});

test('Statische Dateien werden ausgeliefert, Ausbrechen aus /public nicht', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Klangwerk/);
  const js = await fetch(`${base}/js/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  const evil = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(evil.status, 404);
  const evil2 = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`);
  assert.equal(evil2.status, 404);
});

test('parseEnv liest .env-Dateien', () => {
  const env = parseEnv('# Kommentar\nA=1\nB = "zwei"\n\nC=\'drei\'\nKAPUTT\n');
  assert.deepEqual(env, { A: '1', B: 'zwei', C: 'drei' });
  const cfg = loadConfig({ SPOTIFY_CLIENT_ID: 'x', PORT: '4000' });
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.spotify.clientId, 'x');
  assert.equal(cfg.spotify.market, 'DE');
});
