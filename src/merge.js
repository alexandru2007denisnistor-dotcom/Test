/**
 * Zusammenführen von Suchergebnissen aus mehreren Diensten.
 *
 * Jeder Dienst liefert "Provider-Tracks" in einem gemeinsamen Format:
 *   { provider, title, artist, album, artwork, durationMs, isrc, explicit, source: {...} }
 *
 * Daraus werden "vereinte Tracks", bei denen ein Song alle Dienste kennt,
 * auf denen er gefunden wurde:
 *   { id, title, artist, album, artwork, durationMs, isrc, explicit, sources: { deezer, spotify, youtube } }
 */

export const PROVIDERS = ['spotify', 'deezer', 'youtube'];

// Klammerzusätze, die nur "Verpackung" sind und nichts über die Version aussagen.
const NOISE_WORDS =
  /\b(feat|ft|featuring|official|offizielles?|video|audio|lyrics?|lyric|visuali[sz]er|hd|hq|4k|mv|m\/v|music|musikvideo|clip|explicit|clean|remaster(ed)?|\d{4} remaster(ed)?|single version|album version|original mix|prod)\b/i;

const VERSION_SUFFIX = /\s+[-–—]\s+(.*\b(remaster(ed)?|version|mono|stereo|bonus|deluxe|edit|single|mix)\b.*)$/i;

/** Kleinbuchstaben, ohne Akzente, nur Buchstaben/Ziffern (auch nicht-lateinische Schriften). */
export function normalize(str = '') {
  return str
    .toString()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC') // z. B. koreanische Silben wieder zusammensetzen
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Entfernt Zusätze wie "(Official Video)", "[Lyrics]", "- Remastered 2011", "feat. X". */
export function cleanTitle(title = '') {
  let t = title.toString();
  // Klammern mit Füllwörtern entfernen, echte Versionen (Remix, Live, Acoustic) bleiben.
  t = t.replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (whole, inner) => (NOISE_WORDS.test(inner) && !/\b(remix|live|acoustic|akustik|instrumental|cover)\b/i.test(inner) ? ' ' : whole));
  t = t.replace(VERSION_SUFFIX, (whole, inner) => (/\b(remix|live|acoustic|instrumental)\b/i.test(inner) ? whole : ''));
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
  t = t.replace(/\s*\|\s*.*$/, ''); // "Titel | Offizielles Video"
  return t.replace(/\s+/g, ' ').trim();
}

/** Erster/Hauptkünstler aus "A, B & C feat. D". */
export function primaryArtist(artist = '') {
  return artist
    .toString()
    .split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bund\b|\band\b|\bwith\b|\bvs\.?)\s*/i)[0]
    .trim();
}

/** Stabiler Schlüssel für "gleicher Song". */
export function trackKey(t) {
  return `${normalize(primaryArtist(t.artist))}|${normalize(cleanTitle(t.title))}`;
}

/** FNV-1a – kurze, stabile IDs aus dem Schlüssel. */
export function hashId(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Dice-Koeffizient über Wörter (0..1). */
export function similarity(a, b) {
  const A = normalize(a).split(' ').filter(Boolean);
  const B = normalize(b).split(' ').filter(Boolean);
  if (!A.length || !B.length) return 0;
  const counts = new Map();
  for (const w of A) counts.set(w, (counts.get(w) || 0) + 1);
  let common = 0;
  for (const w of B) {
    const c = counts.get(w);
    if (c) {
      common++;
      counts.set(w, c - 1);
    }
  }
  return (2 * common) / (A.length + B.length);
}

function contains(haystack, needle) {
  const h = ` ${normalize(haystack)} `;
  const n = normalize(needle);
  return n.length > 0 && h.includes(` ${n} `);
}

/**
 * Wie gut passt `candidate` (z. B. ein YouTube-Video) zu `target` (ein bekannter Song)? 0..1
 * `candidate.rawTitle` darf den unveränderten Videotitel enthalten.
 */
export function matchScore(candidate, target) {
  const tTitle = cleanTitle(target.title);
  const tArtist = primaryArtist(target.artist);
  const cTitle = cleanTitle(candidate.title);
  const cArtist = candidate.artist || '';

  let titleSim = similarity(cTitle, tTitle);
  let artistSim = Math.max(similarity(primaryArtist(cArtist), tArtist), similarity(cArtist, target.artist || ''));

  // Videotitel wie "Künstler - Titel (Official Video)" oder Kanal "Künstler - Topic"
  const raw = candidate.rawTitle || '';
  if (raw) {
    if (contains(raw, tTitle)) titleSim = Math.max(titleSim, 0.9);
    if (contains(raw, tArtist)) artistSim = Math.max(artistSim, 0.9);
  }
  if (candidate.channel && contains(candidate.channel, tArtist)) artistSim = Math.max(artistSim, 0.9);

  // Versionen nicht verwechseln: "Remix"/"Live" nur mit "Remix"/"Live"
  const versionWords = /\b(remix|live|acoustic|akustik|instrumental|cover|karaoke|sped up|slowed|nightcore)\b/gi;
  const vt = new Set((normalize(target.title).match(versionWords) || []).map((s) => s.toLowerCase()));
  const vc = new Set((normalize(raw || candidate.title).match(versionWords) || []).map((s) => s.toLowerCase()));
  const versionMismatch = [...vc].some((v) => !vt.has(v)) || [...vt].some((v) => !vc.has(v));

  let score = titleSim * 0.6 + artistSim * 0.4;
  if (versionMismatch) score *= 0.5;

  const d1 = candidate.durationMs;
  const d2 = target.durationMs;
  if (d1 > 0 && d2 > 0) {
    const diff = Math.abs(d1 - d2);
    // Musikvideos haben oft Intros/Outros → großzügiger sein
    const isVideo = /\b(video|clip|mv|musikvideo)\b/i.test(raw);
    if (isVideo) {
      if (diff > 150000) score *= 0.6;
    } else if (diff > 30000) score *= 0.5;
    else if (diff > 10000) score *= 0.85;
  }
  return score;
}

function emptyUnified(pt) {
  return {
    id: '',
    title: pt.title,
    artist: pt.artist,
    album: pt.album || '',
    artwork: pt.artwork || '',
    durationMs: pt.durationMs || 0,
    isrc: pt.isrc || '',
    explicit: !!pt.explicit,
    sources: {},
    _score: 0,
  };
}

/** Metadaten auffüllen; strukturierte Quellen (Spotify/Deezer) haben Vorrang vor YouTube. */
function absorb(u, pt) {
  const better = pt.provider !== 'youtube';
  const onlyYoutube = Object.keys(u.sources).every((p) => p === 'youtube');
  if (better && onlyYoutube) {
    u.title = pt.title;
    u.artist = pt.artist;
  }
  if (!u.album && pt.album) u.album = pt.album;
  if (pt.artwork && (!u.artwork || (better && onlyYoutube))) u.artwork = pt.artwork;
  if (!u.durationMs && pt.durationMs) u.durationMs = pt.durationMs;
  if (!u.isrc && pt.isrc) u.isrc = pt.isrc;
  u.explicit = u.explicit || !!pt.explicit;
  u.sources[pt.provider] = pt.source;
}

/**
 * @param {Record<string, Array>} lists  z. B. { spotify: [...], deezer: [...], youtube: [...] }
 * @returns {Array} vereinte Tracks, nach Relevanz sortiert
 */
export function mergeResults(lists) {
  const unified = [];
  const byKey = new Map();
  const byIsrc = new Map();

  const relevance = (index, total) => 1 - index / Math.max(total, 1);

  // 1) Strukturierte Kataloge zuerst (Spotify, Deezer): ISRC oder Künstler+Titel
  for (const provider of ['spotify', 'deezer']) {
    const list = lists[provider] || [];
    list.forEach((pt, index) => {
      const key = trackKey(pt);
      let u = (pt.isrc && byIsrc.get(pt.isrc)) || null;
      if (!u) {
        const sameKey = byKey.get(key) || [];
        u = sameKey.find(
          (c) => !c.sources[provider] && (!c.durationMs || !pt.durationMs || Math.abs(c.durationMs - pt.durationMs) <= 7000),
        );
      }
      if (u && u.sources[provider]) u = null; // gleicher Dienst doppelt → eigener Eintrag
      if (!u) {
        u = emptyUnified(pt);
        u.id = hashId(key);
        unified.push(u);
        byKey.set(key, [...(byKey.get(key) || []), u]);
      }
      absorb(u, pt);
      if (pt.isrc) byIsrc.set(pt.isrc, u);
      u._score = Math.max(u._score, relevance(index, list.length));
    });
  }

  // 2) YouTube-Videos den bekannten Songs zuordnen (unscharfer Vergleich)
  const yt = lists.youtube || [];
  yt.forEach((pt, index) => {
    let best = null;
    let bestScore = 0;
    for (const u of unified) {
      if (u.sources.youtube) continue;
      const s = matchScore(pt, u);
      if (s > bestScore) {
        bestScore = s;
        best = u;
      }
    }
    let u = bestScore >= 0.78 ? best : null;
    if (!u) {
      const key = trackKey(pt);
      u = emptyUnified(pt);
      u.id = hashId(`yt:${pt.source.id}`);
      unified.push(u);
      byKey.set(key, [...(byKey.get(key) || []), u]);
    }
    absorb(u, pt);
    u._score = Math.max(u._score, relevance(index, yt.length) * 0.95);
  });

  // 3) Doppelte IDs (z. B. Live- und Studioversion mit gleichem Namen) eindeutig machen
  const seen = new Map();
  for (const u of unified) {
    const n = seen.get(u.id) || 0;
    seen.set(u.id, n + 1);
    if (n > 0) u.id = `${u.id}-${n}`;
  }

  // 4) Songs, die auf mehreren Diensten existieren, leicht bevorzugen
  for (const u of unified) {
    u._score += 0.12 * (Object.keys(u.sources).length - 1);
  }
  unified.sort((a, b) => b._score - a._score);
  return unified.map(({ _score, ...u }) => u);
}

/** Bester Treffer für `target` in einer Kandidatenliste (für die Nachauflösung beim Abspielen). */
export function bestMatch(candidates, target, threshold = 0.72) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (target.isrc && c.isrc && c.isrc === target.isrc) return c;
    const s = matchScore(c, target);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= threshold ? best : null;
}
