import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeezer } from '../src/providers/deezer.js';
import { createSpotify } from '../src/providers/spotify.js';
import { createYouTube, parseIsoDuration, parseVideoTitle, decodeEntities, cleanChannel } from '../src/providers/youtube.js';

/** Baut ein fetch, das je nach URL eine vorbereitete Antwort liefert und alle Aufrufe mitschreibt. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [pattern, handler] of routes) {
      if (pattern.test(String(url))) {
        const out = typeof handler === 'function' ? handler(String(url), init) : handler;
        const status = out.status ?? 200;
        return new Response(JSON.stringify(out.body ?? out), {
          status,
          headers: { 'content-type': 'application/json', ...(out.headers || {}) },
        });
      }
    }
    return new Response('{}', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

// ---------- Deezer ----------
const dzTrack = {
  id: 3135556,
  type: 'track',
  title: 'Harder, Better, Faster, Stronger',
  duration: 224,
  preview: 'https://cdnt-preview.dzcdn.net/p.mp3',
  link: 'https://www.deezer.com/track/3135556',
  explicit_lyrics: false,
  artist: { id: 27, name: 'Daft Punk' },
  album: { id: 302127, title: 'Discovery', cover_medium: 'https://e-cdns-images.dzcdn.net/m.jpg', cover_big: 'https://e-cdns-images.dzcdn.net/b.jpg' },
};

test('Deezer: Suche wird ins gemeinsame Format übersetzt', async () => {
  const fetchImpl = fakeFetch([[/api\.deezer\.com\/search/, { data: [dzTrack], total: 1 }]]);
  const dz = createDeezer({ fetchImpl });
  const [t] = await dz.search('daft punk');
  assert.equal(t.provider, 'deezer');
  assert.equal(t.title, 'Harder, Better, Faster, Stronger');
  assert.equal(t.artist, 'Daft Punk');
  assert.equal(t.album, 'Discovery');
  assert.equal(t.durationMs, 224000);
  assert.equal(t.artwork, 'https://e-cdns-images.dzcdn.net/b.jpg');
  assert.equal(t.source.id, '3135556');
  assert.equal(t.source.preview, 'https://cdnt-preview.dzcdn.net/p.mp3');
  assert.match(fetchImpl.calls[0].url, /q=daft%20punk/);
});

test('Deezer: Fehler im JSON (trotz HTTP 200) werden erkannt', async () => {
  const fetchImpl = fakeFetch([[/deezer/, { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }]]);
  const dz = createDeezer({ fetchImpl });
  await assert.rejects(dz.search('x'), (err) => err.status === 429 && err.code === 'rate_limited');
});

test('Deezer: Charts und Genres', async () => {
  const fetchImpl = fakeFetch([
    [/\/chart\/116\/tracks/, { data: [dzTrack] }],
    [/\/genre$/, { data: [{ id: 0, name: 'Alle', picture_medium: '' }, { id: 116, name: 'Rap/Hip Hop' }] }],
  ]);
  const dz = createDeezer({ fetchImpl });
  assert.equal((await dz.chart(116)).length, 1);
  assert.deepEqual((await dz.genres()).map((g) => g.id), [0, 116]);
});

test('Deezer: find nutzt die erweiterte Suche', async () => {
  const fetchImpl = fakeFetch([[/search/, { data: [dzTrack] }]]);
  const dz = createDeezer({ fetchImpl });
  const hit = await dz.find({ title: 'Harder Better Faster Stronger', artist: 'Daft Punk' });
  assert.equal(hit.source.id, '3135556');
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /artist:"Daft Punk" track:"Harder Better Faster Stronger"/);
});

// ---------- Spotify ----------
const spTrack = (id, name = 'Get Lucky') => ({
  id,
  name,
  uri: `spotify:track:${id}`,
  duration_ms: 248413,
  explicit: false,
  external_ids: { isrc: 'USQX91300108' },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  artists: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }],
  album: {
    name: 'Random Access Memories',
    images: [
      { url: 'https://i.scdn.co/640.jpg', width: 640, height: 640 },
      { url: 'https://i.scdn.co/300.jpg', width: 300, height: 300 },
    ],
  },
});

test('Spotify: nicht eingerichtet → configured=false', () => {
  assert.equal(createSpotify({}).configured, false);
});

test('Spotify: Token wird geholt, zwischengespeichert und die Suche paginiert (max. 10 pro Anfrage)', async () => {
  let tokenCalls = 0;
  const fetchImpl = fakeFetch([
    [/accounts\.spotify\.com/, () => (tokenCalls++, { access_token: 'tok', expires_in: 3600 })],
    [/\/v1\/search.*offset=0/, { tracks: { items: [spTrack('a'), spTrack('b')] } }],
    [/\/v1\/search.*offset=10/, { tracks: { items: [spTrack('b'), spTrack('c')] } }],
  ]);
  const spotify = createSpotify({ clientId: 'id', clientSecret: 'secret', market: 'DE', fetchImpl });
  const results = await spotify.search('get lucky');
  assert.deepEqual(results.map((t) => t.source.id), ['a', 'b', 'c'], 'Duplikate zwischen Seiten entfernt');
  await spotify.search('noch was');
  assert.equal(tokenCalls, 1, 'Token wird wiederverwendet');

  const searchCall = fetchImpl.calls.find((c) => c.url.includes('/v1/search'));
  assert.match(searchCall.url, /limit=10/);
  assert.match(searchCall.url, /market=DE/);
  assert.equal(searchCall.init.headers.Authorization, 'Bearer tok');
  const tokenCall = fetchImpl.calls.find((c) => c.url.includes('accounts.spotify.com'));
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);

  const t = results[0];
  assert.equal(t.artist, 'Daft Punk, Pharrell Williams');
  assert.equal(t.isrc, 'USQX91300108');
  assert.equal(t.artwork, 'https://i.scdn.co/640.jpg');
  assert.equal(t.source.uri, 'spotify:track:a');
});

test('Spotify: abgelaufener Token wird einmal erneuert', async () => {
  let n = 0;
  const fetchImpl = fakeFetch([
    [/accounts\.spotify\.com/, { access_token: 'tok', expires_in: 3600 }],
    [/\/v1\/search/, () => (n++ === 0 ? { status: 401, body: { error: { message: 'expired' } } } : { tracks: { items: [spTrack('x')] } })],
  ]);
  const spotify = createSpotify({ clientId: 'id', clientSecret: 's', pages: 1, fetchImpl });
  const r = await spotify.search('x');
  assert.equal(r.length, 1);
});

test('Spotify: falsche Zugangsdaten ergeben eine verständliche Meldung', async () => {
  const fetchImpl = fakeFetch([[/accounts\.spotify\.com/, { status: 400, body: { error: 'invalid_client' } }]]);
  const spotify = createSpotify({ clientId: 'id', clientSecret: 'falsch', fetchImpl });
  await assert.rejects(spotify.search('x'), /ungültig/);
});

test('Spotify: find sucht zuerst per ISRC', async () => {
  const fetchImpl = fakeFetch([
    [/accounts/, { access_token: 'tok', expires_in: 3600 }],
    [/isrc%3AUSQX91300108/, { tracks: { items: [spTrack('isrc-hit')] } }],
  ]);
  const spotify = createSpotify({ clientId: 'id', clientSecret: 's', fetchImpl });
  const hit = await spotify.find({ title: 'Get Lucky', artist: 'Daft Punk', isrc: 'USQX91300108' });
  assert.equal(hit.source.id, 'isrc-hit');
});

// ---------- YouTube ----------
test('YouTube: Hilfsfunktionen', () => {
  assert.equal(parseIsoDuration('PT3M45S'), 225000);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723000);
  assert.equal(parseIsoDuration('PT59S'), 59000);
  assert.equal(parseIsoDuration('kaputt'), 0);
  assert.equal(decodeEntities('Rock &amp; Roll &#39;n&quot; &#x41;'), 'Rock & Roll \'n" A');
  assert.equal(cleanChannel('Apache 207 - Topic'), 'Apache 207');
  assert.equal(cleanChannel('TheWeekndVEVO'), 'TheWeeknd');
  assert.deepEqual(parseVideoTitle('Daft Punk - Get Lucky (Official Audio)', 'Daft Punk'), { artist: 'Daft Punk', title: 'Get Lucky (Official Audio)' });
  assert.deepEqual(parseVideoTitle('Roller', 'Apache 207 - Topic'), { artist: 'Apache 207', title: 'Roller' });
});

test('YouTube: Suche nutzt die Musik-Kategorie und lädt Laufzeiten nach', async () => {
  const fetchImpl = fakeFetch([
    [
      /youtube\/v3\/search/,
      {
        items: [
          { id: { videoId: 'abc123' }, snippet: { title: 'Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers', channelTitle: 'Daft Punk', thumbnails: { high: { url: 'https://i.ytimg.com/vi/abc123/hq.jpg' } } } },
        ],
      },
    ],
    [/youtube\/v3\/videos/, { items: [{ id: 'abc123', contentDetails: { duration: 'PT4M9S' } }] }],
  ]);
  const yt = createYouTube({ apiKey: 'KEY', region: 'DE', fetchImpl });
  const [t] = await yt.search('get lucky');
  assert.equal(t.artist, 'Daft Punk');
  assert.equal(t.durationMs, 249000);
  assert.equal(t.source.id, 'abc123');
  assert.equal(t.source.url, 'https://music.youtube.com/watch?v=abc123');
  const searchUrl = fetchImpl.calls[0].url;
  assert.match(searchUrl, /videoCategoryId=10/);
  assert.match(searchUrl, /videoEmbeddable=true/);
  assert.match(searchUrl, /regionCode=DE/);
});

test('YouTube: erschöpftes Kontingent pausiert weitere Anfragen', async () => {
  const fetchImpl = fakeFetch([[/youtube/, { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }]]);
  const yt = createYouTube({ apiKey: 'KEY', fetchImpl });
  await assert.rejects(yt.search('x'), (err) => err.code === 'quota');
  const before = fetchImpl.calls.length;
  await assert.rejects(yt.search('y'), (err) => err.code === 'quota');
  assert.equal(fetchImpl.calls.length, before, 'keine weitere Anfrage an YouTube');
});
