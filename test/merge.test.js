import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, cleanTitle, primaryArtist, trackKey, matchScore, mergeResults, bestMatch, similarity } from '../src/merge.js';

const sp = (title, artist, extra = {}) => ({
  provider: 'spotify',
  title,
  artist,
  album: extra.album || '',
  artwork: extra.artwork || 'https://i.scdn.co/x.jpg',
  durationMs: extra.durationMs ?? 200000,
  isrc: extra.isrc || '',
  explicit: false,
  source: { id: extra.id || `sp-${title}`, uri: `spotify:track:${extra.id || title}`, url: 'https://open.spotify.com/track/x' },
});
const dz = (title, artist, extra = {}) => ({
  provider: 'deezer',
  title,
  artist,
  album: extra.album || '',
  artwork: 'https://e-cdns-images.dzcdn.net/x.jpg',
  durationMs: extra.durationMs ?? 200000,
  isrc: extra.isrc || '',
  explicit: false,
  source: { id: extra.id || `dz-${title}`, url: 'https://www.deezer.com/track/1', preview: 'https://cdn/p.mp3' },
});
const yt = (rawTitle, channel, extra = {}) => {
  const m = /^(.+?)\s+-\s+(.+)$/.exec(rawTitle);
  return {
    provider: 'youtube',
    title: m ? m[2] : rawTitle,
    artist: m ? m[1] : channel,
    rawTitle,
    channel,
    album: '',
    artwork: 'https://i.ytimg.com/x.jpg',
    durationMs: extra.durationMs ?? 0,
    isrc: '',
    explicit: false,
    source: { id: extra.id || `yt-${rawTitle}`, url: 'https://music.youtube.com/watch?v=x', channel },
  };
};

test('normalize entfernt Akzente, Satzzeichen und Groß-/Kleinschreibung', () => {
  assert.equal(normalize('Beyoncé – Halo!'), 'beyonce halo');
  assert.equal(normalize('AC/DC'), 'ac dc');
  assert.equal(normalize('Simon & Garfunkel'), 'simon and garfunkel');
  // Nicht-lateinische Schriften bleiben erhalten
  assert.equal(normalize('방탄소년단 Dynamite'), '방탄소년단 dynamite');
});

test('cleanTitle entfernt Verpackung, behält echte Versionen', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Get Lucky (feat. Pharrell Williams)'), 'Get Lucky');
  assert.equal(cleanTitle('Blinding Lights (Official Video)'), 'Blinding Lights');
  assert.equal(cleanTitle('Song [Official Music Video]'), 'Song');
  assert.equal(cleanTitle('Titel | Offizielles Video'), 'Titel');
  assert.equal(cleanTitle('One More Time (Live)'), 'One More Time (Live)');
  assert.equal(cleanTitle('Strobe (Club Remix)'), 'Strobe (Club Remix)');
  assert.equal(cleanTitle('Hello ft. Someone'), 'Hello');
});

test('primaryArtist nimmt den Hauptkünstler', () => {
  assert.equal(primaryArtist('Daft Punk, Pharrell Williams'), 'Daft Punk');
  assert.equal(primaryArtist('Calvin Harris & Dua Lipa'), 'Calvin Harris');
  assert.equal(primaryArtist('Drake feat. Rihanna'), 'Drake');
  assert.equal(primaryArtist('Apache 207'), 'Apache 207');
});

test('trackKey ist für gleiche Songs aus verschiedenen Diensten gleich', () => {
  assert.equal(
    trackKey({ title: 'Get Lucky (feat. Pharrell Williams & Nile Rodgers)', artist: 'Daft Punk, Pharrell Williams' }),
    trackKey({ title: 'Get Lucky', artist: 'Daft Punk' }),
  );
});

test('similarity: identisch = 1, nichts gemeinsam = 0', () => {
  assert.equal(similarity('a b c', 'a b c'), 1);
  assert.equal(similarity('a b', 'c d'), 0);
});

test('mergeResults fasst Spotify und Deezer per ISRC zusammen', () => {
  const merged = mergeResults({
    spotify: [sp('Shape of You', 'Ed Sheeran', { isrc: 'GBAHS1600463' })],
    deezer: [dz('Shape of You (Acoustic-free title)', 'Ed Sheeran', { isrc: 'GBAHS1600463' })],
  });
  assert.equal(merged.length, 1);
  assert.deepEqual(Object.keys(merged[0].sources).sort(), ['deezer', 'spotify']);
});

test('mergeResults fasst ohne ISRC per Künstler+Titel zusammen', () => {
  const merged = mergeResults({
    spotify: [sp('Bohemian Rhapsody - Remastered 2011', 'Queen', { durationMs: 354000 })],
    deezer: [dz('Bohemian Rhapsody (Remastered 2011)', 'Queen', { durationMs: 355000 })],
  });
  assert.equal(merged.length, 1);
  assert.ok(merged[0].sources.spotify && merged[0].sources.deezer);
});

test('mergeResults hält stark abweichende Längen (z. B. Live) getrennt', () => {
  const merged = mergeResults({
    spotify: [sp('Song', 'Band', { durationMs: 200000 })],
    deezer: [dz('Song', 'Band', { durationMs: 420000 })],
  });
  assert.equal(merged.length, 2);
  assert.notEqual(merged[0].id, merged[1].id, 'IDs müssen eindeutig sein');
});

test('mergeResults ordnet YouTube-Videos bekannten Songs zu', () => {
  const merged = mergeResults({
    spotify: [sp('Blinding Lights', 'The Weeknd', { durationMs: 200040 })],
    youtube: [yt('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO', { durationMs: 263000 })],
  });
  // Musikvideo ist länger (Intro), wird aber trotzdem zugeordnet
  assert.equal(merged.length, 1);
  assert.ok(merged[0].sources.youtube);
  assert.equal(merged[0].title, 'Blinding Lights', 'Metadaten von Spotify haben Vorrang');
});

test('YouTube: "Künstler - Topic"-Kanäle werden erkannt', () => {
  const merged = mergeResults({
    deezer: [dz('Roller', 'Apache 207', { durationMs: 183000 })],
    youtube: [yt('Roller', 'Apache 207 - Topic', { durationMs: 183000 })],
  });
  assert.equal(merged.length, 1);
  assert.ok(merged[0].sources.youtube && merged[0].sources.deezer);
});

test('YouTube: Remix wird nicht mit dem Original verwechselt', () => {
  const merged = mergeResults({
    spotify: [sp('Levels', 'Avicii', { durationMs: 200000 })],
    youtube: [yt('Avicii - Levels (Skrillex Remix)', 'Skrillex')],
  });
  assert.equal(merged.length, 2);
});

test('Songs auf mehreren Diensten werden höher gerankt', () => {
  const merged = mergeResults({
    spotify: [sp('Only Spotify', 'A'), sp('Both', 'B')],
    deezer: [dz('Both', 'B')],
  });
  assert.equal(merged[0].title, 'Both');
});

test('Gleicher Dienst doppelt erzeugt zwei Einträge statt Überschreiben', () => {
  const merged = mergeResults({
    spotify: [sp('Same', 'Artist', { id: 'a' }), sp('Same', 'Artist', { id: 'b' })],
  });
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((t) => t.id)).size, 2);
});

test('matchScore und bestMatch', () => {
  const target = { title: 'Get Lucky', artist: 'Daft Punk', durationMs: 248000 };
  const good = yt('Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers', 'Daft Punk', { durationMs: 248000 });
  const bad = yt('Random Artist - Other Song', 'Random');
  assert.ok(matchScore(good, target) > 0.8);
  assert.ok(matchScore(bad, target) < 0.3);
  assert.equal(bestMatch([bad, good], target), good);
  assert.equal(bestMatch([bad], target), null);
  // ISRC schlägt alles
  const byIsrc = { ...sp('Anders geschrieben', 'X'), isrc: 'ISRC1' };
  assert.equal(bestMatch([byIsrc], { title: 'Song', artist: 'Y', isrc: 'ISRC1' }), byIsrc);
});
