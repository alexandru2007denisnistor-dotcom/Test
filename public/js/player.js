/**
 * Ein Player für drei Dienste.
 *
 * Jeder Dienst hat einen "Adapter" mit derselben Schnittstelle:
 *   load(track) · play() · pause() · seek(sek) · setVolume(0..1) · stop()
 * und meldet Zeit/Zustand/Ende/Fehler an den Player zurück.
 *
 *   YouTube  → offizieller IFrame-Player (komplette Songs)
 *   Spotify  → offizieller Embed-Player (komplett, wenn im Browser bei Spotify angemeldet, sonst Vorschau)
 *   Deezer   → 30-Sekunden-Vorschau als normales <audio>
 */
import { api } from './api.js';
import { store, SOURCES } from './store.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Skript konnte nicht geladen werden'));
    document.head.append(s);
  });
}

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

// ---------- Deezer (Audio-Element) ----------
class DeezerAdapter {
  name = 'deezer';
  supportsVolume = true;

  constructor(host) {
    this.host = host;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    const a = this.audio;
    a.addEventListener('timeupdate', () => host.onTime(this, a.currentTime, a.duration || 30));
    a.addEventListener('playing', () => host.onState(this, true));
    a.addEventListener('pause', () => host.onState(this, false));
    a.addEventListener('waiting', () => host.onBuffering(this, true));
    a.addEventListener('ended', () => host.onEnded(this));
    a.addEventListener('error', () => {
      if (a.getAttribute('src')) host.onError(this, new Error('Vorschau nicht abspielbar'));
    });
  }

  async load(track) {
    const src = track.sources.deezer;
    let preview = src.preview;
    try {
      // Vorschau-Links sind zeitlich signiert → frisch holen
      const fresh = await api.deezerTrack(src.id);
      if (fresh?.source?.preview) preview = fresh.source.preview;
    } catch {
      /* alter Link als Rückfall */
    }
    if (!preview) throw new Error('Keine Vorschau verfügbar');
    this.audio.src = preview;
    this.audio.volume = this.host.volume;
    try {
      await this.audio.play();
    } catch (err) {
      // Autoplay blockiert → geladen, aber pausiert; der Nutzer kann selbst starten
      if (err?.name !== 'NotAllowedError') throw err;
      this.host.hint('Zum Abspielen auf ▶ tippen.');
    }
  }
  play() {
    return this.audio.play().catch(() => {});
  }
  pause() {
    this.audio.pause();
  }
  seek(sec) {
    if (Number.isFinite(sec)) this.audio.currentTime = sec;
  }
  setVolume(v) {
    this.audio.volume = v;
  }
  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}

// ---------- YouTube (IFrame Player API) ----------
class YouTubeAdapter {
  name = 'youtube';
  supportsVolume = true;

  constructor(host) {
    this.host = host;
    this.yt = null;
    this.ready = null;
    this.timer = null;
  }

  ensureApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (!this.ready) {
      this.ready = withTimeout(
        new Promise((resolve, reject) => {
          const prev = window.onYouTubeIframeAPIReady;
          window.onYouTubeIframeAPIReady = () => {
            prev?.();
            resolve();
          };
          loadScript('https://www.youtube.com/iframe_api').catch(reject);
        }),
        12000,
        'YouTube-Player lädt nicht',
      ).catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    return this.ready;
  }

  async load(track) {
    await this.ensureApi();
    const id = track.sources.youtube.id;
    if (!this.yt) {
      await withTimeout(
        new Promise((resolve) => {
          this.yt = new window.YT.Player('yt-target', {
            width: '100%',
            height: '100%',
            videoId: id,
            playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
            events: {
              onReady: (e) => {
                e.target.setVolume(Math.round(this.host.volume * 100));
                e.target.playVideo();
                resolve();
              },
              onStateChange: (e) => this.onStateChange(e.data),
              onError: (e) => this.host.onError(this, new Error(YouTubeAdapter.errorText(e.data))),
            },
          });
        }),
        12000,
        'YouTube-Player antwortet nicht',
      );
    } else {
      this.yt.loadVideoById(id);
      this.yt.setVolume(Math.round(this.host.volume * 100));
    }
  }

  static errorText(code) {
    if (code === 101 || code === 150) return 'Video darf nicht eingebettet werden';
    if (code === 100) return 'Video nicht gefunden';
    return 'Video nicht abspielbar';
  }

  onStateChange(state) {
    const S = window.YT.PlayerState;
    if (state === S.PLAYING) {
      this.host.onState(this, true);
      this.startPolling();
    } else if (state === S.PAUSED) {
      this.host.onState(this, false);
      this.stopPolling();
    } else if (state === S.BUFFERING) {
      this.host.onBuffering(this, true);
    } else if (state === S.ENDED) {
      this.stopPolling();
      this.host.onEnded(this);
    }
  }

  startPolling() {
    this.stopPolling();
    const tick = () => {
      try {
        this.host.onTime(this, this.yt.getCurrentTime(), this.yt.getDuration());
      } catch {
        /* Player wird gerade neu geladen */
      }
    };
    tick();
    this.timer = setInterval(tick, 500);
  }
  stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
  }

  play() {
    this.yt?.playVideo();
  }
  pause() {
    this.yt?.pauseVideo();
  }
  seek(sec) {
    this.yt?.seekTo(sec, true);
  }
  setVolume(v) {
    this.yt?.setVolume?.(Math.round(v * 100));
  }
  stop() {
    this.stopPolling();
    try {
      this.yt?.stopVideo();
    } catch {
      /* egal */
    }
  }
}

// ---------- Spotify (Embed iFrame API) ----------
class SpotifyAdapter {
  name = 'spotify';
  supportsVolume = false; // Lautstärke regelt der Spotify-Player selbst

  constructor(host) {
    this.host = host;
    this.ctrl = null;
    this.apiPromise = null;
    this.readyWaiters = [];
    this.last = null;
    this.startedAt = 0;
  }

  ensureApi() {
    if (!this.apiPromise) {
      this.apiPromise = withTimeout(
        new Promise((resolve, reject) => {
          window.onSpotifyIframeApiReady = (IFrameAPI) => resolve(IFrameAPI);
          loadScript('https://open.spotify.com/embed/iframe-api/v1').catch(reject);
        }),
        12000,
        'Spotify-Player lädt nicht',
      ).catch((err) => {
        this.apiPromise = null;
        throw err;
      });
    }
    return this.apiPromise;
  }

  waitReady(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.readyWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async load(track) {
    const src = track.sources.spotify;
    const uri = src.uri || `spotify:track:${src.id}`;
    const IFrameAPI = await this.ensureApi();
    this.last = null;
    this.playedOnce = false;
    if (!this.ctrl) {
      await withTimeout(
        new Promise((resolve) => {
          IFrameAPI.createController(document.getElementById('sp-target'), { uri, width: '100%', height: 152 }, (ctrl) => {
            this.ctrl = ctrl;
            ctrl.addListener('ready', () => {
              const w = this.readyWaiters.splice(0);
              w.forEach((fn) => fn());
              resolve();
            });
            ctrl.addListener('playback_update', (e) => this.onUpdate(e.data || {}));
          });
        }),
        12000,
        'Spotify-Player antwortet nicht',
      );
    } else {
      this.ctrl.loadUri(uri);
      await this.waitReady(2500);
    }
    this.ctrl.play();
    this.startedAt = Date.now();
    // Manche Browser blockieren den Autostart im fremden iframe
    setTimeout(() => {
      if (this.host.adapter === this && !this.playedOnce) this.host.hint('Tippe im Spotify-Player auf ▶, um die Wiedergabe zu starten.');
    }, 5000);
  }

  onUpdate(d) {
    const pos = (d.position || 0) / 1000;
    const dur = (d.duration || 0) / 1000;
    const prev = this.last;
    this.last = { pos, dur, paused: !!d.isPaused };
    if (!d.isPaused) this.playedOnce = true;
    this.host.onTime(this, pos, dur);
    this.host.onState(this, !d.isPaused);
    // Ende erkennen: war kurz vor Schluss, jetzt pausiert (oder zurück auf 0)
    if (prev && !prev.paused && d.isPaused && prev.dur > 0 && prev.pos >= prev.dur - 2.5) {
      this.host.onEnded(this);
    }
  }

  play() {
    if (!this.ctrl) return;
    if (typeof this.ctrl.resume === 'function') this.ctrl.resume();
    else this.ctrl.togglePlay();
  }
  pause() {
    this.ctrl?.pause();
  }
  seek(sec) {
    this.ctrl?.seek(sec);
  }
  setVolume() {}
  stop() {
    try {
      this.ctrl?.pause();
    } catch {
      /* egal */
    }
  }
}

// ---------- Player ----------
const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const copy = (t) => ({ ...t, sources: { ...(t.sources || {}) } });

export class Player extends EventTarget {
  constructor() {
    super();
    this.queue = [];
    this.original = null; // Reihenfolge vor dem Mischen
    this.index = -1;
    this.repeat = 'off'; // off | all | one
    this.shuffle = false;
    this.adapter = null;
    this.activeSource = null;
    this.playing = false;
    this.loading = false;
    this.position = 0;
    this.duration = 0;
    this.volume = store.settings.volume ?? 0.8;
    this.configured = { deezer: true, spotify: false, youtube: false };
    this.seq = 0;
    this.adapters = {
      deezer: new DeezerAdapter(this),
      youtube: new YouTubeAdapter(this),
      spotify: new SpotifyAdapter(this),
    };
    this.setupMediaSession();
  }

  get current() {
    return this.queue[this.index] || null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  changed() {
    this.emit('change');
  }
  hint(message) {
    this.emit('hint', message);
  }

  // ----- Rückmeldungen der Adapter -----
  onTime(adapter, pos, dur) {
    if (adapter !== this.adapter) return;
    this.position = pos || 0;
    if (dur > 0 && Number.isFinite(dur)) this.duration = dur;
    this.emit('time');
  }
  onState(adapter, playing) {
    if (adapter !== this.adapter) return;
    const was = this.playing;
    this.playing = playing;
    if (playing) this.loading = false;
    if (was !== playing || this.loading) this.changed();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
  onBuffering(adapter, on) {
    if (adapter !== this.adapter) return;
    if (this.loading !== on) {
      this.loading = on;
      this.changed();
    }
  }
  onEnded(adapter) {
    if (adapter !== this.adapter) return;
    this.playing = false;
    this.next({ auto: true });
  }
  onError(adapter, err) {
    if (adapter !== this.adapter) return;
    const track = this.current;
    if (!track) return;
    this.hint(`${adapter.name === 'youtube' ? 'YouTube' : adapter.name === 'spotify' ? 'Spotify' : 'Deezer'}: ${err.message} – versuche andere Quelle …`);
    this.playIndex(this.index, { exclude: [...(this._excluded || []), adapter.name] });
  }

  // ----- Quellenwahl -----
  sourceOrder(forced, exclude = []) {
    const prio = store.settings.priority.filter((s) => SOURCES.includes(s));
    const order = forced ? [forced, ...prio.filter((s) => s !== forced)] : prio;
    return order.filter((s) => !exclude.includes(s));
  }

  async ensureSource(track, src, forced) {
    if (track.sources[src]) return true;
    const allowed = this.configured[src] && (store.settings.autoResolve || forced === src);
    if (!allowed || track._missing?.[src]) return false;
    try {
      const r = await api.resolve(src, track);
      if (r.found) {
        track.sources[src] = r.source;
        if (!track.isrc && r.isrc) track.isrc = r.isrc;
        store.mergeSources(track);
        return true;
      }
    } catch {
      /* Dienst gerade nicht verfügbar */
    }
    track._missing = { ...(track._missing || {}), [src]: true };
    return false;
  }

  stopAll(except) {
    for (const a of Object.values(this.adapters)) if (a !== except) a.stop();
  }

  async playIndex(i, { forced, exclude = [] } = {}) {
    const track = this.queue[i];
    if (!track) return;
    const seq = ++this.seq;
    // Ereignisse des alten Titels ab jetzt ignorieren
    this.stopAll();
    this.adapter = null;
    this.index = i;
    this._excluded = exclude;
    this.loading = true;
    this.playing = false;
    this.position = 0;
    this.duration = (track.durationMs || 0) / 1000;
    this.changed();
    this.updateMediaSession(track);

    const failures = [];
    for (const src of this.sourceOrder(forced, exclude)) {
      if (!(await this.ensureSource(track, src, forced))) continue;
      if (seq !== this.seq) return;
      const adapter = this.adapters[src];
      this.stopAll(adapter);
      this.adapter = adapter;
      this.activeSource = src;
      this.changed();
      try {
        await withTimeout(adapter.load(track), 15000, 'Zeitüberschreitung');
        if (seq !== this.seq) return;
        store.addHistory(track);
        this.changed();
        return;
      } catch (err) {
        if (seq !== this.seq) return;
        failures.push(`${src}: ${err.message}`);
        adapter.stop();
      }
    }
    if (seq !== this.seq) return;
    this.stopAll();
    this.adapter = null;
    this.activeSource = null;
    this.loading = false;
    this.playing = false;
    this.changed();
    this.emit('failed', { track, failures });
  }

  // ----- Steuerung -----
  playList(tracks, startIndex = 0, { forced, shuffle } = {}) {
    if (!tracks.length) return;
    const list = tracks.map(copy);
    const start = list[startIndex] || list[0];
    if (shuffle !== undefined) this.shuffle = shuffle;
    if (this.shuffle) {
      this.original = list;
      const rest = shuffled(list.filter((t) => t !== start));
      this.queue = [start, ...rest];
      this.playIndex(0, { forced });
    } else {
      this.original = null;
      this.queue = list;
      this.playIndex(list.indexOf(start), { forced });
    }
  }

  toggle() {
    if (!this.adapter) {
      if (this.queue.length) this.playIndex(Math.max(0, this.index));
      return;
    }
    if (this.playing) this.adapter.pause();
    else this.adapter.play();
  }

  next({ auto = false } = {}) {
    if (!this.queue.length) return;
    if (auto && this.repeat === 'one') return this.playIndex(this.index);
    if (this.index < this.queue.length - 1) return this.playIndex(this.index + 1);
    if (this.repeat === 'all') return this.playIndex(0);
    // Ende der Warteschlange
    this.playing = false;
    this.changed();
  }

  prev() {
    if (this.position > 3 || this.index <= 0) return this.seekTo(0);
    this.playIndex(this.index - 1);
  }

  seekTo(sec) {
    if (!this.adapter) return;
    this.adapter.seek(Math.max(0, sec));
    this.position = sec;
    this.emit('time');
  }

  seekFraction(f) {
    if (this.duration > 0) this.seekTo(f * this.duration);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    for (const a of Object.values(this.adapters)) a.setVolume(this.volume);
    store.state.settings.volume = this.volume;
    clearTimeout(this._volSave);
    this._volSave = setTimeout(() => store.save('volume'), 400);
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const cur = this.current;
    if (this.shuffle) {
      this.original = this.queue.slice();
      const rest = shuffled(this.queue.filter((t) => t !== cur));
      this.queue = cur ? [cur, ...rest] : rest;
      this.index = cur ? 0 : -1;
    } else if (this.original) {
      // neu hinzugefügte Titel behalten
      const extra = this.queue.filter((t) => !this.original.includes(t));
      this.queue = [...this.original, ...extra];
      this.index = cur ? this.queue.indexOf(cur) : -1;
      this.original = null;
    }
    this.changed();
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.changed();
  }

  addToQueue(track) {
    const t = copy(track);
    this.queue.push(t);
    this.original?.push(t);
    if (this.index === -1) this.playIndex(this.queue.length - 1);
    else this.changed();
  }

  playNext(track) {
    const t = copy(track);
    this.queue.splice(this.index + 1, 0, t);
    this.original?.push(t);
    if (this.index === -1) this.playIndex(0);
    else this.changed();
  }

  removeFromQueue(i) {
    if (i === this.index) return;
    const [t] = this.queue.splice(i, 1);
    if (this.original) this.original = this.original.filter((x) => x !== t);
    if (i < this.index) this.index--;
    this.changed();
  }

  clearUpcoming() {
    const cur = this.current;
    this.queue = cur ? [cur] : [];
    this.original = null;
    this.index = cur ? 0 : -1;
    this.changed();
  }

  // ----- Sperrbildschirm / Medientasten -----
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* nicht unterstützt */
      }
    };
    set('play', () => this.toggle());
    set('pause', () => this.toggle());
    set('nexttrack', () => this.next());
    set('previoustrack', () => this.prev());
    set('seekto', (d) => this.seekTo(d.seekTime));
  }

  updateMediaSession(t) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album || '',
      artwork: t.artwork ? [{ src: t.artwork, sizes: '512x512' }] : [],
    });
  }
}
