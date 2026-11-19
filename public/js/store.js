/**
 * Lokale Bibliothek: Lieblingssongs, Playlists, Verlauf und Einstellungen.
 * Alles liegt im localStorage dieses Browsers – kein Konto nötig.
 */
const KEY = 'klangwerk:v1';
export const SOURCES = ['youtube', 'spotify', 'deezer'];
export const SOURCE_NAMES = { spotify: 'Spotify', youtube: 'YouTube Music', deezer: 'Deezer' };
export const SOURCE_SHORT = { spotify: 'Spotify', youtube: 'YouTube', deezer: 'Deezer' };

const DEFAULTS = () => ({
  settings: {
    // Reihenfolge, in der beim Abspielen eine Quelle gewählt wird
    priority: ['youtube', 'spotify', 'deezer'],
    // Fehlt die bevorzugte Quelle, wird der Song dort automatisch gesucht
    autoResolve: true,
    volume: 0.8,
    theme: 'auto',
  },
  liked: [],
  playlists: [],
  history: [],
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    const data = JSON.parse(raw);
    const d = DEFAULTS();
    return {
      settings: { ...d.settings, ...(data.settings || {}) },
      liked: Array.isArray(data.liked) ? data.liked : [],
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      history: Array.isArray(data.history) ? data.history : [],
    };
  } catch {
    return DEFAULTS();
  }
}

/** Nur die Felder speichern, die wir brauchen (keine Laufzeit-Hilfsfelder). */
export function snapshot(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album || '',
    artwork: t.artwork || '',
    durationMs: t.durationMs || 0,
    isrc: t.isrc || '',
    explicit: !!t.explicit,
    sources: { ...(t.sources || {}) },
  };
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

class Store extends EventTarget {
  constructor() {
    super();
    this.state = load();
    // Fehlende Quellen in alter Prioritätsliste ergänzen
    const p = this.state.settings.priority.filter((x) => SOURCES.includes(x));
    for (const s of SOURCES) if (!p.includes(s)) p.push(s);
    this.state.settings.priority = p;
  }

  save(reason = 'change') {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* Speicher voll oder gesperrt – App läuft trotzdem weiter */
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }

  get settings() {
    return this.state.settings;
  }
  setSetting(key, value) {
    this.state.settings[key] = value;
    this.save('settings');
  }

  // --- Lieblingssongs ---
  isLiked(id) {
    return this.state.liked.some((t) => t.id === id);
  }
  toggleLike(track) {
    if (this.isLiked(track.id)) {
      this.state.liked = this.state.liked.filter((t) => t.id !== track.id);
      this.save('liked');
      return false;
    }
    this.state.liked.unshift(snapshot(track));
    this.save('liked');
    return true;
  }

  // --- Playlists ---
  playlist(id) {
    return this.state.playlists.find((p) => p.id === id);
  }
  createPlaylist(name) {
    const p = { id: uid(), name: name.trim() || 'Neue Playlist', tracks: [], created: Date.now() };
    this.state.playlists.unshift(p);
    this.save('playlists');
    return p;
  }
  renamePlaylist(id, name) {
    const p = this.playlist(id);
    if (p && name.trim()) {
      p.name = name.trim();
      this.save('playlists');
    }
  }
  deletePlaylist(id) {
    this.state.playlists = this.state.playlists.filter((p) => p.id !== id);
    this.save('playlists');
  }
  addToPlaylist(id, track) {
    const p = this.playlist(id);
    if (!p) return false;
    if (p.tracks.some((t) => t.id === track.id)) return false;
    p.tracks.push(snapshot(track));
    this.save('playlists');
    return true;
  }
  removeFromPlaylist(id, index) {
    const p = this.playlist(id);
    if (!p) return;
    p.tracks.splice(index, 1);
    this.save('playlists');
  }
  moveInPlaylist(id, from, to) {
    const p = this.playlist(id);
    if (!p || to < 0 || to >= p.tracks.length) return;
    const [t] = p.tracks.splice(from, 1);
    p.tracks.splice(to, 0, t);
    this.save('playlists');
  }

  // --- Verlauf ---
  addHistory(track) {
    this.state.history = [snapshot(track), ...this.state.history.filter((t) => t.id !== track.id)].slice(0, 50);
    this.save('history');
  }
  clearHistory() {
    this.state.history = [];
    this.save('history');
  }

  /** Nachträglich gefundene Quellen (z. B. YouTube-ID) überall dort ergänzen, wo der Song gespeichert ist. */
  mergeSources(track) {
    let changed = false;
    const apply = (t) => {
      if (t.id !== track.id) return;
      for (const [k, v] of Object.entries(track.sources || {})) {
        if (!t.sources[k]) {
          t.sources[k] = v;
          changed = true;
        }
      }
      if (!t.isrc && track.isrc) t.isrc = track.isrc;
    };
    this.state.liked.forEach(apply);
    this.state.history.forEach(apply);
    this.state.playlists.forEach((p) => p.tracks.forEach(apply));
    if (changed) this.save('sources');
  }

  // --- Export / Import ---
  exportData() {
    return JSON.stringify({ app: 'klangwerk', version: 1, exported: new Date().toISOString(), ...this.state }, null, 2);
  }
  importData(text) {
    const data = JSON.parse(text);
    if (!data || (data.app && data.app !== 'klangwerk')) throw new Error('Keine Klangwerk-Datei');
    const valid = (t) => t && typeof t.id === 'string' && typeof t.title === 'string' && t.sources && typeof t.sources === 'object';
    const liked = (data.liked || []).filter(valid).map(snapshot);
    const playlists = (data.playlists || [])
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.tracks))
      .map((p) => ({ id: uid(), name: p.name, created: p.created || Date.now(), tracks: p.tracks.filter(valid).map(snapshot) }));
    // Zusammenführen statt überschreiben
    const likedIds = new Set(this.state.liked.map((t) => t.id));
    this.state.liked.push(...liked.filter((t) => !likedIds.has(t.id)));
    this.state.playlists.push(...playlists);
    this.save('import');
    return { liked: liked.length, playlists: playlists.length };
  }
}

export const store = new Store();
