import { api } from './api.js';
import { store, SOURCE_NAMES, SOURCE_SHORT } from './store.js';
import { Player } from './player.js';
import { icon, hydrateIcons } from './icons.js';

// ---------- Helfer ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};
const fmtTotal = (ms) => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
};
const primaryArtist = (a = '') => a.split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s)\s*/i)[0].trim();
const isDesktop = () => window.matchMedia('(min-width: 901px)').matches;
const DISPLAY_ORDER = ['spotify', 'youtube', 'deezer'];
const SOURCE_INFO = {
  youtube: 'Komplette Songs im Video-Player',
  spotify: 'Komplett, wenn du im Browser bei Spotify angemeldet bist – sonst Vorschau',
  deezer: '30-Sekunden-Vorschau',
};

const app = $('#app');
const view = $('#view');
const main = $('#main');
const player = new Player();

const ui = {
  status: null,
  route: { name: 'home' },
  lastHash: null,
  lists: new Map(),
  listSeq: 0,
  search: { q: '', full: false, loading: false, data: null, error: null, filter: 'all', seq: 0 },
  home: { genres: null, genre: 0, charts: new Map(), chartError: null },
  panelAutoOpened: false,
  failStreak: 0,
};

// ---------- Bausteine ----------
function registerList(tracks, context = {}) {
  const id = `l${++ui.listSeq}`;
  ui.lists.set(id, { tracks, context });
  return id;
}

function artHtml(t, cls = 'art') {
  const u = safeUrl(t?.artwork);
  if (u) return `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  return `<div class="${cls} ph">${esc((t?.title || '?').trim().charAt(0).toUpperCase() || '♪')}</div>`;
}

function coverHtml(tracks, cls, fallbackIcon = 'library') {
  const arts = [...new Set(tracks.map((t) => safeUrl(t.artwork)).filter(Boolean))].slice(0, 4);
  if (arts.length >= 4) {
    return `<div class="${cls} mosaic">${arts.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`).join('')}</div>`;
  }
  if (arts.length) return `<img class="${cls}" src="${esc(arts[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  return `<div class="${cls} ph">${icon(fallbackIcon)}</div>`;
}

function badgesHtml(t) {
  return DISPLAY_ORDER.filter((s) => t.sources?.[s])
    .map(
      (s) =>
        `<button class="src ${s}" data-action="source" data-src="${s}" title="Über ${SOURCE_NAMES[s]} abspielen"><span class="dot ${s}"></span><span class="label">${SOURCE_SHORT[s]}</span></button>`,
    )
    .join('');
}

function trackRow(t, i, listId) {
  const liked = store.isLiked(t.id);
  const playing = player.current?.id === t.id;
  return `
  <div class="track${playing ? ' playing' : ''}" data-list="${listId}" data-index="${i}" data-id="${esc(t.id)}">
    <div class="t-num"><span class="num">${i + 1}</span><button class="play" data-action="play" aria-label="${esc(t.title)} abspielen">${icon('play')}</button></div>
    ${artHtml(t)}
    <div class="t-main" data-action="play">
      <div class="t-title"><span class="txt">${esc(t.title)}</span>${t.explicit ? '<span class="explicit" title="Expliziter Inhalt">E</span>' : ''}</div>
      <div class="t-artist"><a href="#/search?q=${encodeURIComponent(primaryArtist(t.artist))}" data-action="artist">${esc(t.artist)}</a></div>
    </div>
    <div class="t-album">${esc(t.album)}</div>
    <div class="sources">${badgesHtml(t)}</div>
    <div class="t-dur">${t.durationMs ? fmt(t.durationMs / 1000) : ''}</div>
    <button class="icon-btn like-btn${liked ? ' liked' : ''}" data-action="like" aria-label="${liked ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs'}">${icon(liked ? 'heartFill' : 'heart')}</button>
    <button class="icon-btn" data-action="more" aria-label="Weitere Aktionen">${icon('more')}</button>
  </div>`;
}

function tracksHtml(tracks, context = {}, emptyHtml = '') {
  if (!tracks.length) return emptyHtml || '<div class="empty"><strong>Keine Songs</strong></div>';
  const id = registerList(tracks, context);
  return `<div class="tracks">${tracks.map((t, i) => trackRow(t, i, id)).join('')}</div>`;
}

function skeletonHtml(n = 8) {
  const row = (i) => `
    <div class="track"><div class="t-num"></div><div class="art sk" style="height:44px"></div>
      <div class="t-main"><div class="sk" style="width:${45 + ((i * 37) % 40)}%"></div><div class="sk" style="width:${22 + ((i * 23) % 30)}%;margin-top:8px;height:10px"></div></div>
      <div class="t-album"><div class="sk" style="width:${40 + ((i * 17) % 40)}%"></div></div><div></div><div></div><div></div><div></div></div>`;
  return `<div class="tracks skeleton" aria-busy="true">${Array.from({ length: n }, (_, i) => row(i)).join('')}</div>`;
}

function servicesHtml() {
  if (!ui.status) return '';
  const card = (s, on, text) => `
    <a class="service${on ? '' : ' off'}" href="#/settings">
      <span class="name"><span class="dot ${s}"></span>${SOURCE_NAMES[s]}</span>
      <span class="state">${esc(text)}</span>
    </a>`;
  const st = ui.status;
  return `<div class="services">
    ${card('spotify', st.spotify.configured, st.spotify.configured ? 'Aktiv · Katalogsuche' : 'Nicht eingerichtet – hier einrichten')}
    ${card('youtube', st.youtube.configured, st.youtube.configured ? 'Aktiv · komplette Songs' : 'Nicht eingerichtet – hier einrichten')}
    ${card('deezer', true, 'Aktiv · Charts & Vorschauen')}
  </div>`;
}

// ---------- Ansichten ----------
function recentHtml() {
  const h = store.state.history.slice(0, 20);
  if (!h.length) return '';
  const id = registerList(h, { type: 'history' });
  return `<h2>Zuletzt gehört</h2>
    <div class="cards">${h
      .map(
        (t, i) => `<button class="card" data-list="${id}" data-index="${i}" data-action="play" title="${esc(t.title)} – ${esc(t.artist)}">
          ${artHtml(t, 'card-art')}
          <span class="card-title">${esc(t.title)}</span>
          <span class="card-sub">${esc(t.artist)}</span>
        </button>`,
      )
      .join('')}</div>`;
}

function genreChipsHtml() {
  const genres = ui.home.genres || [{ id: 0, name: 'Alle' }];
  return genres
    .map(
      (g) =>
        `<button class="chip${g.id === ui.home.genre ? ' active' : ''}" data-action="genre" data-genre="${Number(g.id)}">${esc(g.id === 0 ? 'Alle' : g.name)}</button>`,
    )
    .join('');
}

function renderHome() {
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  view.innerHTML = `
    <h1>${greet}</h1>
    <p class="sub">Spotify, YouTube Music und Deezer – durchsucht wie ein einziger riesiger Katalog.</p>
    <div id="home-services">${servicesHtml()}</div>
    <section id="home-recent">${recentHtml()}</section>
    <div class="row"><h2>Charts</h2><span class="muted" style="margin-top:18px">von Deezer</span></div>
    <div class="chips" id="genre-chips">${genreChipsHtml()}</div>
    <div id="chart-list">${skeletonHtml(10)}</div>`;
  loadGenres();
  loadChart(ui.home.genre);
}

async function loadGenres() {
  if (ui.home.genres) return;
  try {
    const { genres } = await api.genres();
    ui.home.genres = genres.length ? genres : [{ id: 0, name: 'Alle' }];
    const el = $('#genre-chips');
    if (el) el.innerHTML = genreChipsHtml();
  } catch {
    /* ohne Genres geht's auch */
  }
}

async function loadChart(genre) {
  const el = () => (ui.route.name === 'home' ? $('#chart-list') : null);
  const show = (tracks) => {
    const target = el();
    if (!target || ui.home.genre !== genre) return;
    target.innerHTML = tracksHtml(tracks, { type: 'chart' });
    hydrateIcons(target);
  };
  if (ui.home.charts.has(genre)) return show(ui.home.charts.get(genre));
  const target = el();
  if (target) target.innerHTML = skeletonHtml(10);
  try {
    const { tracks } = await api.charts(genre);
    ui.home.charts.set(genre, tracks);
    show(tracks);
  } catch (err) {
    const t = el();
    if (t && ui.home.genre === genre) {
      t.innerHTML = `<div class="notice warn"><div><strong>Charts konnten nicht geladen werden.</strong><br>${esc(err.message)}</div><span class="spacer"></span><button class="btn small" data-action="retry-chart">Erneut versuchen</button></div>`;
    }
  }
}

const SUGGESTIONS = ['Deutschrap', 'Lo-Fi Beats', 'Daft Punk', 'Neue Musik', 'Klassik zum Entspannen', '80er Hits', 'Afrobeats', 'K-Pop'];

function renderSearch() {
  const s = ui.search;
  const input = $('#search-input');
  if (document.activeElement !== input && input.value !== s.q) input.value = s.q;

  if (!s.q) {
    view.innerHTML = `
      <h1>Suche</h1>
      <p class="sub">Ein Suchfeld, drei Kataloge: Treffer von Spotify, YouTube Music und Deezer werden zusammengeführt – gleiche Songs erscheinen nur einmal.</p>
      ${servicesHtml()}
      <h2>Ideen</h2>
      <div class="chips" style="flex-wrap:wrap">${SUGGESTIONS.map((q) => `<button class="chip" data-action="suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
    return;
  }

  const data = s.data && s.data.query === s.q ? s.data : null;
  let body;
  if (!data && s.loading) body = skeletonHtml(10);
  else if (!data && s.error) body = `<div class="notice warn"><strong>Suche fehlgeschlagen:</strong>&nbsp;${esc(s.error)}</div>`;
  else if (!data) body = skeletonHtml(10);
  else {
    const all = data.tracks;
    const count = (p) => all.filter((t) => t.sources[p]).length;
    const multi = all.filter((t) => Object.keys(t.sources).length > 1);
    const filtered =
      s.filter === 'all' ? all : s.filter === 'multi' ? multi : all.filter((t) => t.sources[s.filter]);
    const chip = (key, label, n, dot = '') =>
      `<button class="chip${s.filter === key ? ' active' : ''}" data-action="filter" data-filter="${key}">${dot ? `<span class="dot ${dot}"></span>` : ''}${label} <span class="count">${n}</span></button>`;
    const chips = [chip('all', 'Alle', all.length)];
    for (const p of DISPLAY_ORDER) if (data.providers[p]?.ok) chips.push(chip(p, SOURCE_SHORT[p], count(p), p));
    if (multi.length) chips.push(chip('multi', 'Auf mehreren Diensten', multi.length));

    const notes = [];
    for (const p of DISPLAY_ORDER) {
      const info = data.providers[p] || {};
      if (info.used && info.ok === false) {
        notes.push(`<div class="notice warn"><span class="dot ${p}" style="margin-top:7px"></span><div><strong>${SOURCE_NAMES[p]}:</strong> ${esc(info.error || 'Fehler')}</div></div>`);
      }
    }
    const yt = data.providers.youtube || {};
    if (yt.configured && !yt.used) {
      notes.push(`<div class="notice"><span class="dot youtube" style="margin-top:7px"></span><div><strong>Noch mehr Treffer?</strong> Drück <code>Enter</code>, um zusätzlich YouTube Music zu durchsuchen.</div><span class="spacer"></span><button class="btn small" data-action="search-full">YouTube durchsuchen</button></div>`);
    } else if (s.loading && s.full) {
      notes.push(`<div class="notice"><span class="dot youtube" style="margin-top:7px"></span><div>Durchsuche auch YouTube Music …</div></div>`);
    }
    const missing = DISPLAY_ORDER.filter((p) => data.providers[p] && !data.providers[p].configured);
    if (missing.length) {
      notes.push(`<div class="notice"><div>${missing.map((p) => SOURCE_NAMES[p]).join(' und ')} ${missing.length > 1 ? 'sind' : 'ist'} nicht eingerichtet – mit ${missing.length > 1 ? 'ihnen' : 'Schlüssel'} wird die Auswahl deutlich größer. <a href="#/settings" style="text-decoration:underline">Einrichten</a></div></div>`);
    }

    body = `
      <div class="chips">${chips.join('')}</div>
      ${notes.join('')}
      ${tracksHtml(filtered, { type: 'search' }, `<div class="empty"><strong>Nichts gefunden</strong>Versuch es mit einer anderen Schreibweise oder einem Künstlernamen.</div>`)}`;
  }

  view.innerHTML = `<h1 style="font-size:28px">Ergebnisse für „${esc(s.q)}“</h1>${body}`;
}

function renderLibrary() {
  const { liked, playlists } = store.state;
  view.innerHTML = `
    <div class="row"><h1>Bibliothek</h1><span class="spacer"></span><button class="btn" data-action="new-pl">${icon('plus')} Neue Playlist</button></div>
    <p class="sub">Deine Songs aus allen Diensten an einem Ort – gespeichert in diesem Browser.</p>
    <div class="cards grid" style="margin-top:18px">
      <a class="card" href="#/liked">
        <div class="card-art ph">${icon('heartFill')}</div>
        <span class="card-title">Lieblingssongs</span>
        <span class="card-sub">${liked.length} ${liked.length === 1 ? 'Song' : 'Songs'}</span>
      </a>
      ${playlists
        .map(
          (p) => `<a class="card" href="#/playlist/${encodeURIComponent(p.id)}">
            ${coverHtml(p.tracks, 'card-art')}
            <span class="card-title">${esc(p.name)}</span>
            <span class="card-sub">${p.tracks.length} ${p.tracks.length === 1 ? 'Song' : 'Songs'}</span>
          </a>`,
        )
        .join('')}
    </div>
    ${playlists.length ? '' : '<p class="muted" style="margin-top:18px">Tipp: Über das ⋯-Menü bei jedem Song kannst du ihn einer Playlist hinzufügen.</p>'}`;
}

function collectionHero({ kicker, title, tracks, cover, actions = '' }) {
  const total = tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  const listId = registerList(tracks, {});
  return `
    <div class="hero">
      ${cover}
      <div>
        <div class="kicker">${esc(kicker)}</div>
        <h1>${esc(title)}</h1>
        <div class="muted">${tracks.length} ${tracks.length === 1 ? 'Song' : 'Songs'}${total ? ` · ${fmtTotal(total)}` : ''}</div>
      </div>
    </div>
    <div class="actions" data-list="${listId}">
      <button class="btn primary" data-action="play-all" ${tracks.length ? '' : 'disabled'}>${icon('play')} Abspielen</button>
      <button class="btn" data-action="shuffle-all" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Zufällig</button>
      ${actions}
    </div>`;
}

function renderLiked() {
  const tracks = store.state.liked;
  view.innerHTML = `
    ${collectionHero({ kicker: 'Playlist', title: 'Lieblingssongs', tracks, cover: `<div class="cover card-art ph">${icon('heartFill')}</div>` })}
    ${tracksHtml(tracks, { type: 'liked' }, '<div class="empty"><strong>Noch keine Lieblingssongs</strong>Tippe bei einem Song auf das Herz.</div>')}`;
}

function renderPlaylist(id) {
  const p = store.playlist(id);
  if (!p) {
    view.innerHTML = '<div class="empty"><strong>Playlist nicht gefunden</strong><a href="#/library">Zur Bibliothek</a></div>';
    return;
  }
  view.innerHTML = `
    ${collectionHero({
      kicker: 'Playlist',
      title: p.name,
      tracks: p.tracks,
      cover: coverHtml(p.tracks, 'cover card-art'),
      actions: `<span class="spacer"></span>
        <button class="btn small" data-action="rename-pl" data-id="${esc(p.id)}">${icon('edit')} Umbenennen</button>
        <button class="btn small danger" data-action="delete-pl" data-id="${esc(p.id)}">${icon('trash')} Löschen</button>`,
    })}
    ${tracksHtml(p.tracks, { type: 'playlist', id: p.id }, '<div class="empty"><strong>Diese Playlist ist leer</strong>Füge Songs über das ⋯-Menü hinzu – egal ob von Spotify, YouTube oder Deezer.</div>')}`;
}

function renderSettings() {
  const st = ui.status || { spotify: {}, youtube: {}, deezer: { configured: true } };
  const set = store.settings;
  const service = (s, on, desc) => `
    <div class="setting">
      <div class="label"><strong style="display:flex;align-items:center;gap:8px"><span class="dot ${s}"></span>${SOURCE_NAMES[s]}</strong><small>${desc}</small></div>
      <span class="status${on ? ' on' : ''}">${on ? 'Aktiv' : 'Nicht eingerichtet'}</span>
    </div>`;
  view.innerHTML = `
    <h1>Einstellungen</h1>

    <h2>Dienste</h2>
    <div class="settings-group">
      ${service('spotify', st.spotify.configured, 'Suche im Spotify-Katalog. Schlüssel: <code>SPOTIFY_CLIENT_ID</code> und <code>SPOTIFY_CLIENT_SECRET</code> (developer.spotify.com).')}
      ${service('youtube', st.youtube.configured, 'Suche in der Musik-Kategorie von YouTube, komplette Songs. Schlüssel: <code>YOUTUBE_API_KEY</code> (Google Cloud, „YouTube Data API v3“).')}
      ${service('deezer', true, 'Funktioniert ohne Schlüssel: Suche, Charts und 30-Sekunden-Vorschauen.')}
    </div>
    <div class="notice"><div>Schlüssel trägst du in die Datei <code>.env</code> im Projektordner ein (Vorlage: <code>.env.example</code>) und startest den Server neu. Die Schlüssel bleiben auf dem Server und landen nie im Browser.</div></div>

    <h2>Wiedergabe</h2>
    <div class="settings-group">
      <div class="setting" style="border-bottom:0;padding-bottom:0"><div class="label">Bevorzugte Quelle<small>Beim Abspielen wird die erste Quelle genutzt, auf der es den Song gibt. Auf ein Abzeichen (z. B. „Deezer“) bei einem Song tippen, um gezielt diese Quelle zu nutzen.</small></div></div>
      <ol class="priority">
        ${set.priority
          .map(
            (s, i) => `<li>
              <span class="rank">${i + 1}.</span>
              <span class="pname"><span class="dot ${s}"></span><span>${SOURCE_NAMES[s]}<br><small class="muted" style="font-weight:400">${SOURCE_INFO[s]}</small></span></span>
              <button class="icon-btn small" data-action="prio-up" data-src="${s}" ${i === 0 ? 'disabled' : ''} aria-label="${SOURCE_NAMES[s]} nach oben">${icon('up')}</button>
              <button class="icon-btn small" data-action="prio-down" data-src="${s}" ${i === set.priority.length - 1 ? 'disabled' : ''} aria-label="${SOURCE_NAMES[s]} nach unten">${icon('down')}</button>
            </li>`,
          )
          .join('')}
      </ol>
      <div class="setting">
        <div class="label">Fehlende Quellen automatisch suchen<small>Gibt es einen Song (z. B. aus den Deezer-Charts) nicht auf deiner bevorzugten Quelle, wird er dort beim Abspielen gesucht. Hinweis: Jede YouTube-Suche verbraucht Kontingent – ca. 100 Suchen pro Tag mit einem Standard-Schlüssel.</small></div>
        <label class="switch"><input type="checkbox" data-setting="autoResolve" ${set.autoResolve ? 'checked' : ''} aria-label="Fehlende Quellen automatisch suchen" /><span></span></label>
      </div>
    </div>

    <h2>Darstellung</h2>
    <div class="settings-group">
      <div class="setting">
        <div class="label">Farbschema</div>
        <select class="select" data-setting="theme" aria-label="Farbschema">
          <option value="auto" ${set.theme === 'auto' ? 'selected' : ''}>Wie System</option>
          <option value="dark" ${set.theme === 'dark' ? 'selected' : ''}>Dunkel</option>
          <option value="light" ${set.theme === 'light' ? 'selected' : ''}>Hell</option>
        </select>
      </div>
    </div>

    <h2>Deine Daten</h2>
    <div class="settings-group">
      <div class="setting">
        <div class="label">Bibliothek sichern<small>Lieblingssongs und Playlists als Datei exportieren oder auf einem anderen Gerät importieren.</small></div>
        <button class="btn small" data-action="export">${icon('download')} Export</button>
        <button class="btn small" data-action="import">${icon('upload')} Import</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden />
      </div>
      <div class="setting">
        <div class="label">Verlauf<small>${store.state.history.length} zuletzt gehörte Songs</small></div>
        <button class="btn small" data-action="clear-history" ${store.state.history.length ? '' : 'disabled'}>Löschen</button>
      </div>
    </div>
    <p class="muted">Klangwerk speichert alles nur lokal in diesem Browser. Es werden keine Konten oder Passwörter von Spotify, YouTube oder Deezer benötigt.</p>`;
}

// ---------- Router ----------
function parseRoute() {
  const h = location.hash.slice(1) || '/';
  const [path, qs = ''] = h.split('?');
  const params = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);
  switch (parts[0]) {
    case 'search':
      return { name: 'search', q: (params.get('q') || '').trim() };
    case 'library':
      return { name: 'library' };
    case 'liked':
      return { name: 'liked' };
    case 'playlist':
      return parts[1] ? { name: 'playlist', id: decodeURIComponent(parts[1]) } : { name: 'library' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

function highlightNav() {
  const r = ui.route;
  const navName = r.name === 'liked' || r.name === 'playlist' ? 'library' : r.name;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navName));
  $$('#sidebar-playlists a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === location.hash));
}

function render() {
  ui.lists.clear();
  const r = ui.route;
  if (r.name === 'home') renderHome();
  else if (r.name === 'search') renderSearch();
  else if (r.name === 'library') renderLibrary();
  else if (r.name === 'liked') renderLiked();
  else if (r.name === 'playlist') renderPlaylist(r.id);
  else if (r.name === 'settings') renderSettings();
  hydrateIcons(view);
}

function onRoute() {
  if (location.hash === ui.lastHash) return;
  ui.lastHash = location.hash;
  ui.route = parseRoute();
  closeMenu();
  if (!isDesktop()) setPanel(false);
  highlightNav();
  if (ui.route.name === 'search' && ui.route.q !== ui.search.q) {
    runSearch(ui.route.q, { full: true });
  } else {
    render();
  }
  main.scrollTop = 0;
}

// ---------- Suche ----------
function goSearch(q, { full, replace }) {
  q = q.trim();
  const hash = `#/search${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const wasSearch = ui.route.name === 'search';
  if (location.hash !== hash) history[replace && wasSearch ? 'replaceState' : 'pushState'](null, '', hash);
  ui.lastHash = location.hash;
  if (!wasSearch) {
    ui.route = parseRoute();
    highlightNav();
    main.scrollTop = 0;
  }
  runSearch(q, { full });
}

async function runSearch(q, { full }) {
  const s = ui.search;
  s.q = q;
  if (s.data?.query !== q) s.filter = 'all';
  if (!q) {
    s.loading = false;
    if (ui.route.name === 'search') render();
    return;
  }
  const seq = ++s.seq;
  s.loading = true;
  s.full = full;
  s.error = null;
  if (ui.route.name === 'search') render();
  try {
    // Beim Tippen ohne YouTube (spart Kontingent), mit Enter überall
    const data = await api.search(q, full ? undefined : ['spotify', 'deezer']);
    if (seq !== s.seq) return;
    s.data = data;
  } catch (err) {
    if (seq !== s.seq) return;
    s.error = err.message;
  }
  s.loading = false;
  if (ui.route.name === 'search') render();
}

let typingTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(typingTimer);
  const q = e.target.value;
  typingTimer = setTimeout(() => goSearch(q, { full: false, replace: true }), 450);
});
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(typingTimer);
  const input = $('#search-input');
  goSearch(input.value, { full: true, replace: true });
  if (!isDesktop()) input.blur();
});

// ---------- Menü ----------
const menu = $('#menu');
let menuHandler = null;
let menuAnchor = null;

function openMenu(anchor, html, handler) {
  menuAnchor = anchor;
  menu.innerHTML = html;
  hydrateIcons(menu);
  menu.hidden = false;
  menuHandler = handler;
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  left = Math.max(8, left);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('button, a')?.focus({ preventScroll: true });
}

function closeMenu() {
  menu.hidden = true;
  menuHandler = null;
  menuAnchor = null;
}

menu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-m]');
  if (!item) return;
  if (item.tagName === 'A') {
    closeMenu();
    return;
  }
  const h = menuHandler;
  closeMenu();
  h?.(item.dataset.m, item.dataset);
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-action="more"]')) closeMenu();
});
main.addEventListener('scroll', () => !menu.hidden && closeMenu(), { passive: true });

function openTrackMenu(anchor, track, context = {}, index = 0) {
  const liked = store.isLiked(track.id);
  const links = DISPLAY_ORDER.filter((s) => safeUrl(track.sources?.[s]?.url))
    .map((s) => `<a data-m="link" href="${esc(safeUrl(track.sources[s].url))}" target="_blank" rel="noopener noreferrer">${icon('external')} ${SOURCE_NAMES[s]}</a>`)
    .join('');
  const pls = store.state.playlists
    .filter((p) => p.id !== context.id)
    .map((p) => `<button data-m="add" data-id="${esc(p.id)}">${icon('library')} ${esc(p.name)}</button>`)
    .join('');
  const inPlaylist = context.type === 'playlist';
  const html = `
    <button data-m="next">${icon('nextUp')} Als Nächstes spielen</button>
    <button data-m="queue">${icon('listPlus')} Zur Warteschlange</button>
    <button data-m="like">${icon(liked ? 'heartFill' : 'heart')} ${liked ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs'}</button>
    <hr /><div class="menu-label">Zur Playlist hinzufügen</div>
    <button data-m="new">${icon('plus')} Neue Playlist …</button>
    ${pls}
    ${links ? `<hr /><div class="menu-label">Öffnen in</div>${links}` : ''}
    ${
      inPlaylist
        ? `<hr />
      <button data-m="up">${icon('up')} Nach oben</button>
      <button data-m="down">${icon('down')} Nach unten</button>
      <button data-m="remove">${icon('trash')} Aus Playlist entfernen</button>`
        : ''
    }`;
  openMenu(anchor, html, (action, data) => {
    if (action === 'next') {
      player.playNext(track);
      toast('Wird als Nächstes gespielt');
    } else if (action === 'queue') {
      player.addToQueue(track);
      toast('Zur Warteschlange hinzugefügt');
    } else if (action === 'like') {
      toast(store.toggleLike(track) ? 'Zu Lieblingssongs hinzugefügt' : 'Aus Lieblingssongs entfernt');
    } else if (action === 'new') {
      const name = prompt('Name der neuen Playlist:', track.artist ? `Mix: ${primaryArtist(track.artist)}` : 'Neue Playlist');
      if (name === null) return;
      const p = store.createPlaylist(name);
      store.addToPlaylist(p.id, track);
      toast(`Zu „${p.name}“ hinzugefügt`);
    } else if (action === 'add') {
      const p = store.playlist(data.id);
      toast(store.addToPlaylist(data.id, track) ? `Zu „${p.name}“ hinzugefügt` : `Schon in „${p.name}“`);
    } else if (action === 'up') {
      store.moveInPlaylist(context.id, index, index - 1);
    } else if (action === 'down') {
      store.moveInPlaylist(context.id, index, index + 1);
    } else if (action === 'remove') {
      store.removeFromPlaylist(context.id, index);
      toast('Aus Playlist entfernt');
    }
  });
}

// ---------- Klicks in Ansichten ----------
function newPlaylist() {
  const name = prompt('Name der neuen Playlist:', 'Neue Playlist');
  if (name === null) return;
  const p = store.createPlaylist(name);
  location.hash = `#/playlist/${encodeURIComponent(p.id)}`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || menu.contains(el)) return;
  const action = el.dataset.action;
  const holder = el.closest('[data-list]');
  const list = holder ? ui.lists.get(holder.dataset.list) : null;
  const index = Number(holder?.dataset.index ?? 0);
  const track = list?.tracks[index];

  switch (action) {
    case 'artist':
      return; // normaler Link
    case 'play':
      if (list) player.playList(list.tracks, index);
      return;
    case 'source':
      e.stopPropagation();
      if (list) player.playList(list.tracks, index, { forced: el.dataset.src });
      return;
    case 'like':
      if (track) toast(store.toggleLike(track) ? 'Zu Lieblingssongs hinzugefügt' : 'Aus Lieblingssongs entfernt');
      return;
    case 'more':
      if (!menu.hidden && menuAnchor === el) return closeMenu();
      if (track) openTrackMenu(el, track, list.context, index);
      return;
    case 'play-all':
      if (list?.tracks.length) player.playList(list.tracks, 0, { shuffle: false });
      return;
    case 'shuffle-all':
      if (list?.tracks.length) player.playList(list.tracks, Math.floor(Math.random() * list.tracks.length), { shuffle: true });
      return;
    case 'filter':
      ui.search.filter = el.dataset.filter;
      render();
      return;
    case 'search-full':
      goSearch(ui.search.q, { full: true, replace: true });
      return;
    case 'suggest':
      $('#search-input').value = el.dataset.q;
      goSearch(el.dataset.q, { full: true, replace: true });
      return;
    case 'genre': {
      ui.home.genre = Number(el.dataset.genre) || 0;
      $$('#genre-chips .chip').forEach((c) => c.classList.toggle('active', c === el));
      loadChart(ui.home.genre);
      return;
    }
    case 'retry-chart':
      loadChart(ui.home.genre);
      return;
    case 'new-pl':
      newPlaylist();
      return;
    case 'rename-pl': {
      const p = store.playlist(el.dataset.id);
      const name = p && prompt('Neuer Name:', p.name);
      if (name) store.renamePlaylist(p.id, name);
      return;
    }
    case 'delete-pl': {
      const p = store.playlist(el.dataset.id);
      if (p && confirm(`Playlist „${p.name}“ wirklich löschen?`)) {
        store.deletePlaylist(p.id);
        location.hash = '#/library';
      }
      return;
    }
    case 'prio-up':
    case 'prio-down': {
      const prio = [...store.settings.priority];
      const i = prio.indexOf(el.dataset.src);
      const j = action === 'prio-up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= prio.length) return;
      [prio[i], prio[j]] = [prio[j], prio[i]];
      store.setSetting('priority', prio);
      return;
    }
    case 'export': {
      const blob = new Blob([store.exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `klangwerk-bibliothek-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    case 'import':
      $('#import-file')?.click();
      return;
    case 'clear-history':
      store.clearHistory();
      toast('Verlauf gelöscht');
      return;
    case 'queue-jump':
      player.playIndex(Number(el.dataset.qi));
      return;
    case 'queue-remove':
      e.stopPropagation();
      player.removeFromQueue(Number(el.dataset.qi));
      return;
    case 'like-current':
      if (player.current) toast(store.toggleLike(player.current) ? 'Zu Lieblingssongs hinzugefügt' : 'Aus Lieblingssongs entfernt');
      return;
  }
});

view.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.track[data-list]');
  if (!row || e.target.closest('button, a')) return;
  const list = ui.lists.get(row.dataset.list);
  if (list) player.playList(list.tracks, Number(row.dataset.index));
});

view.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.setting === 'autoResolve') store.setSetting('autoResolve', el.checked);
  if (el.dataset.setting === 'theme') store.setSetting('theme', el.value);
  if (el.id === 'import-file' && el.files?.[0]) {
    try {
      const res = store.importData(await el.files[0].text());
      toast(`Importiert: ${res.liked} Lieblingssongs, ${res.playlists} Playlists`);
    } catch (err) {
      toast(`Import fehlgeschlagen: ${err.message}`);
    }
    el.value = '';
  }
});

// ---------- Seitenleiste ----------
function renderSidebar() {
  const ul = $('#sidebar-playlists');
  const items = [
    `<li><a href="#/liked">♥ Lieblingssongs</a></li>`,
    ...store.state.playlists.map((p) => `<li><a href="#/playlist/${encodeURIComponent(p.id)}">${esc(p.name)}</a></li>`),
  ];
  ul.innerHTML = items.join('');
  highlightNav();
}
$('#new-playlist').addEventListener('click', newPlaylist);

// ---------- Player-Leiste & Panel ----------
const seek = $('#seek');
const volume = $('#volume');
let seeking = false;

function setRange(input, fraction) {
  input.style.setProperty('--p', `${Math.max(0, Math.min(1, fraction)) * 100}%`);
}

function updateProgress() {
  const dur = player.duration || 0;
  if (!seeking) {
    const f = dur ? player.position / dur : 0;
    seek.value = Math.round(f * 1000);
    setRange(seek, f);
    $('#time-pos').textContent = fmt(player.position);
  }
  $('#time-dur').textContent = fmt(dur);
}

function setPanel(open) {
  app.classList.toggle('panel-open', open);
  updateEmbedClasses();
  if (open) renderPanel();
}

function updateEmbedClasses() {
  const src = player.activeSource;
  const embed = src === 'youtube' || src === 'spotify';
  app.classList.toggle('embed-active', embed);
  app.classList.toggle('embed-youtube', src === 'youtube');
  app.classList.toggle('embed-spotify', src === 'spotify');
  app.classList.toggle('dock-floating', embed && !app.classList.contains('panel-open'));
}

function renderPanel() {
  if (!app.classList.contains('panel-open')) return;
  const t = player.current;
  const now = $('#panel-now');
  if (!t) {
    now.innerHTML = '<p class="muted">Noch nichts in der Warteschlange.</p>';
  } else {
    const links = DISPLAY_ORDER.filter((s) => safeUrl(t.sources?.[s]?.url))
      .map((s) => `<a class="src ${s}" href="${esc(safeUrl(t.sources[s].url))}" target="_blank" rel="noopener noreferrer"><span class="dot ${s}"></span>${SOURCE_SHORT[s]} ${icon('external')}</a>`)
      .join('');
    now.innerHTML = `
      ${artHtml(t, 'big-art')}
      <div class="title">${esc(t.title)}</div>
      <div class="artist">${esc(t.artist)}</div>
      ${links ? `<div class="links">${links}</div>` : ''}`;
    $$('.links svg', now).forEach((s) => s.setAttribute('style', 'width:12px;height:12px'));
  }
  const ol = $('#queue-list');
  ol.innerHTML = player.queue
    .map(
      (q, i) => `<li class="${i === player.index ? 'current' : ''}" data-action="queue-jump" data-qi="${i}">
        ${artHtml(q)}
        <div class="q-meta"><div class="q-title">${esc(q.title)}</div><div class="q-artist">${esc(q.artist)}</div></div>
        ${i === player.index ? '' : `<button class="icon-btn small" data-action="queue-remove" data-qi="${i}" aria-label="Entfernen">${icon('close')}</button>`}
      </li>`,
    )
    .join('');
  ol.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}

function markPlaying() {
  const id = player.current?.id;
  $$('.track[data-id]').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
}

function updateLikeButtons() {
  $$('.track[data-id]').forEach((row) => {
    const b = row.querySelector('.like-btn');
    if (!b) return;
    const liked = store.isLiked(row.dataset.id);
    b.classList.toggle('liked', liked);
    b.innerHTML = icon(liked ? 'heartFill' : 'heart');
    b.setAttribute('aria-label', liked ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs');
  });
}

function renderPlayerBar() {
  const t = player.current;
  const box = $('#pb-track');
  if (t) {
    const liked = store.isLiked(t.id);
    box.innerHTML = `
      ${artHtml(t)}
      <div class="meta">
        <div class="title" title="${esc(t.title)}">${esc(t.title)}</div>
        <div class="artist">${esc(t.artist)}</div>
      </div>
      <button class="icon-btn${liked ? ' liked' : ''}" data-action="like-current" aria-label="${liked ? 'Aus Lieblingssongs entfernen' : 'Zu Lieblingssongs'}">${icon(liked ? 'heartFill' : 'heart')}</button>`;
  } else {
    box.innerHTML = '<span class="hint">Wähle einen Song – egal von welchem Dienst.</span>';
  }

  const play = $('#btn-play');
  play.classList.toggle('loading', player.loading && !player.playing);
  play.innerHTML = icon(player.loading && !player.playing ? 'loader' : player.playing ? 'pause' : 'play');
  play.setAttribute('aria-label', player.playing ? 'Pause' : 'Abspielen');

  const has = player.queue.length > 0;
  $('#btn-prev').disabled = !has;
  $('#btn-next').disabled = !has;
  const sh = $('#btn-shuffle');
  sh.classList.toggle('on', player.shuffle);
  sh.setAttribute('aria-pressed', String(player.shuffle));
  const rep = $('#btn-repeat');
  rep.classList.toggle('on', player.repeat !== 'off');
  rep.innerHTML = icon(player.repeat === 'one' ? 'repeatOne' : 'repeat');
  rep.setAttribute('aria-label', { off: 'Wiederholen: aus', all: 'Wiederholen: alle', one: 'Wiederholen: einen' }[player.repeat]);

  const src = player.activeSource;
  $('#pb-source').innerHTML = src
    ? `<span class="dot ${src}"></span>${SOURCE_SHORT[src]}${src === 'deezer' ? ' · Vorschau' : ''}`
    : '';
  const volOk = !player.adapter || player.adapter.supportsVolume;
  volume.disabled = !volOk;
  volume.title = volOk ? '' : 'Lautstärke im Spotify-Player regeln';

  // Eingebettete Player einblenden; beim ersten Mal das Panel öffnen (Desktop)
  const embed = src === 'youtube' || src === 'spotify';
  if (embed && !ui.panelAutoOpened && isDesktop()) {
    ui.panelAutoOpened = true;
    app.classList.add('panel-open');
  }
  updateEmbedClasses();
  renderPanel();
  markPlaying();
  updateProgress();
  document.title = t ? `${t.title} · ${t.artist} – Klangwerk` : 'Klangwerk';
}

$('#btn-play').addEventListener('click', () => player.toggle());
$('#btn-next').addEventListener('click', () => player.next());
$('#btn-prev').addEventListener('click', () => player.prev());
$('#btn-shuffle').addEventListener('click', () => player.toggleShuffle());
$('#btn-repeat').addEventListener('click', () => player.cycleRepeat());
const togglePanel = () => {
  ui.panelAutoOpened = true; // Nutzer entscheidet ab jetzt selbst
  setPanel(!app.classList.contains('panel-open'));
};
$('#btn-queue').addEventListener('click', togglePanel);
$('#btn-queue-m').addEventListener('click', togglePanel);
$('#panel-close').addEventListener('click', () => {
  ui.panelAutoOpened = true;
  setPanel(false);
});
$('#queue-clear').addEventListener('click', () => player.clearUpcoming());

seek.addEventListener('input', () => {
  seeking = true;
  const f = seek.value / 1000;
  setRange(seek, f);
  $('#time-pos').textContent = fmt(f * (player.duration || 0));
});
seek.addEventListener('change', () => {
  player.seekFraction(seek.value / 1000);
  seeking = false;
});
volume.value = Math.round(player.volume * 100);
setRange(volume, player.volume);
volume.addEventListener('input', () => {
  player.setVolume(volume.value / 100);
  setRange(volume, volume.value / 100);
});

player.addEventListener('change', () => {
  renderPlayerBar();
  if (player.playing) ui.failStreak = 0;
});
player.addEventListener('time', updateProgress);
player.addEventListener('hint', (e) => toast(e.detail));
player.addEventListener('failed', (e) => {
  const { track } = e.detail;
  ui.failStreak++;
  const more = player.index < player.queue.length - 1;
  toast(`„${track.title}“ ist gerade auf keinem Dienst abspielbar${more && ui.failStreak < 3 ? ' – nächster Song' : ''}`);
  if (more && ui.failStreak < 3) setTimeout(() => player.next(), 1200);
});

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---------- Tastatur ----------
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
  if (e.key === 'Escape') closeMenu();
  if (typing) return;
  if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') {
    e.preventDefault();
    player.toggle();
  } else if (e.key === '/') {
    e.preventDefault();
    $('#search-input').focus();
  } else if (e.shiftKey && e.key === 'ArrowRight') {
    player.next();
  } else if (e.shiftKey && e.key === 'ArrowLeft') {
    player.prev();
  }
});

// ---------- Farbschema ----------
function applyTheme() {
  const t = store.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- Reaktion auf Änderungen in der Bibliothek ----------
store.addEventListener('change', (e) => {
  const reason = e.detail.reason;
  if (reason === 'volume') return;
  const name = ui.route.name;
  if (reason === 'playlists' || reason === 'import') renderSidebar();
  if (reason === 'settings') applyTheme();
  if (reason === 'liked') {
    updateLikeButtons();
    renderPlayerBar();
  }
  const keepScroll = main.scrollTop;
  if ((reason === 'liked' || reason === 'import') && (name === 'liked' || name === 'library')) render();
  else if ((reason === 'playlists' || reason === 'import') && (name === 'library' || name === 'playlist')) render();
  else if (reason === 'settings' && name === 'settings') render();
  else if (reason === 'history' && name === 'settings') render();
  else if (reason === 'history' && name === 'home') {
    const el = $('#home-recent');
    if (el) {
      el.innerHTML = recentHtml();
      hydrateIcons(el);
    }
    return;
  } else return;
  main.scrollTop = keepScroll;
});

// ---------- Start ----------
async function loadStatus() {
  try {
    const { providers } = await api.status();
    ui.status = providers;
    for (const p of Object.keys(providers)) player.configured[p] = !!providers[p].configured;
    const el = $('#home-services');
    if (el) el.innerHTML = servicesHtml();
    if (ui.route.name === 'settings' || (ui.route.name === 'search' && !ui.search.q)) render();
  } catch {
    toast('Server nicht erreichbar – läuft „npm start“?');
  }
}

applyTheme();
hydrateIcons(document);
renderSidebar();
renderPlayerBar();
window.addEventListener('hashchange', onRoute);
window.addEventListener('popstate', onRoute);
onRoute();
loadStatus();
