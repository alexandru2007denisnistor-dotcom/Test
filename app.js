/* ==========================================================
   GlassGym – Trainingsplan, Übungen, Ernährung & Kalender
   ========================================================== */
(() => {
'use strict';

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const wIdx = (d) => (d.getDay() + 6) % 7; // 0 = Montag
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return addDays(x, -wIdx(x)); };
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n);
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAYS_S = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const GROUPS = window.MUSCLE_GROUPS;
const G = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
const LIB = window.EXERCISES;
const findEx = (name) => {
  for (const gid in LIB) { const e = LIB[gid].find((x) => x.name === name); if (e) return { ...e, group: gid }; }
  return null;
};

/* ---------- State ---------- */
const STORE = 'glassgym.v1';
const defaultTheme = () => ({ bg: '#000000', accent: 'violet', refraction: true, animatedBg: false });
const defaults = () => ({
  plan: [null, null, null, null, null, null, null],
  visits: {},
  nutrition: {},
  goals: { kcal: 2600, protein: 160, carbs: 300, fat: 80, water: 3000, caffeine: 400 },
  settings: { name: '', notify: false, notifyTime: '08:00', trainTime: '18:00', lastNotified: '', seeded: false, theme: defaultTheme() },
});
function hydrate(raw) {
  const d = defaults();
  if (!raw) return d;
  const settings = { ...d.settings, ...raw.settings };
  settings.theme = { ...defaultTheme(), ...(raw.settings && raw.settings.theme) };
  return { ...d, ...raw, goals: { ...d.goals, ...raw.goals }, settings };
}
let state;
try { state = hydrate(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch (_) { state = defaults(); }

const ui = { tab: 'home', nutDate: dkey(new Date()), calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), exGroup: 'brust', exQuery: '' };

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  syncServiceWorker();
}

/* ==========================================================
   Optionaler animierter Hintergrund (nur wenn eingeschaltet)
   ========================================================== */
const Bg = (() => {
  const cv = $('#bg');
  const ctx = cv.getContext('2d');
  const SCALE = 0.18; // klein rendern → weich hochskaliert = Blur gratis
  const palettes = {
    home:      [[139, 123, 255], [255, 95, 162], [77, 225, 255], [255, 181, 71]],
    plan:      [[124, 108, 255], [77, 160, 255], [255, 95, 162], [62, 230, 168]],
    exercises: [[255, 95, 120], [255, 160, 70], [160, 110, 255], [255, 95, 200]],
    nutrition: [[62, 230, 168], [34, 184, 255], [195, 247, 90], [139, 123, 255]],
    calendar:  [[77, 225, 255], [139, 123, 255], [255, 95, 162], [62, 230, 168]],
  };
  const blobs = Array.from({ length: 5 }, (_, i) => ({
    r: 0.35 + Math.random() * 0.25,
    sx: 0.00007 + Math.random() * 0.00012, sy: 0.00006 + Math.random() * 0.0001,
    ph: Math.random() * 10, col: [...palettes.home[i % 4]], target: palettes.home[i % 4],
  }));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, running = false, raf = 0, kick = 0, base = '#000000';

  function resize() {
    w = cv.width = Math.max(40, Math.round(innerWidth * SCALE));
    h = cv.height = Math.max(40, Math.round(innerHeight * SCALE));
  }
  addEventListener('resize', () => { if (running) resize(); });

  function frame(t) {
    kick *= 0.95;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach((b, i) => {
      for (let c = 0; c < 3; c++) b.col[c] += (b.target[c] - b.col[c]) * 0.03;
      const x = 0.5 + Math.sin(t * b.sx + b.ph) * 0.42;
      const y = 0.5 + Math.cos(t * b.sy + b.ph * 1.3) * 0.42;
      const r = (b.r + Math.sin(t * 0.0006 + i) * 0.05 + kick * 0.15) * Math.max(w, h);
      const [cr, cg, cb] = b.col.map(Math.round);
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0.42)`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.16)`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    if (running) raf = requestAnimationFrame(frame);
  }

  return {
    setEnabled(on, color) {
      base = color || base;
      if (on && !running) { running = true; resize(); raf = requestAnimationFrame(frame); if (reduce) running = false; }
      else if (!on && running) { running = false; cancelAnimationFrame(raf); }
    },
    setTheme(name) {
      const p = palettes[name] || palettes.home;
      blobs.forEach((b, i) => { b.target = p[(i + 1) % 4]; });
    },
    pulse() { kick = 1; },
  };
})();

/* ==========================================================
   Liquid Glass – in Echtzeit gerendertes Glas mit Lichtbrechung
   Für jedes Glas-Element wird eine Displacement-Map berechnet:
   Am Rand (Bezel) wird der Hintergrund wie durch eine gewölbte
   Glaskante gebrochen, inkl. leichter chromatischer Aberration.
   Läuft als SVG-backdrop-filter auf der GPU (Chromium / Android).
   ========================================================== */
const LiquidGlass = (() => {
  const ua = navigator.userAgent;
  const supported = /Chrome\/\d+/.test(ua) && !/Firefox\//.test(ua);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);

  const items = [];
  const mapCache = new Map();
  let enabled = false, seq = 0;

  // Displacement-Map: R/G = Verschiebung in x/y (128 = keine). Nur im Bezel am Rand.
  function displacementMap(w, h, r, bezel, openBottom) {
    const key = `${w}|${h}|${r}|${bezel}|${openBottom}`;
    if (mapCache.has(key)) return mapCache.get(key);
    // große Flächen in halber Auflösung berechnen – die Map ist weich, das fällt nicht auf
    const k = w * h > 90000 ? 0.5 : 1;
    const W = Math.max(2, Math.round(w * k)), Hh = Math.max(2, Math.round(h * k));
    const R = r * k, B = bezel * k;
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, Hh), d = img.data;
    const boxH = openBottom ? Hh + B * 4 : Hh; // offene Unterkante (Sheet) → dort keine Brechung
    const hw = W / 2, hh = boxH / 2, rr = Math.min(R, hw, hh);
    for (let y = 0; y < Hh; y++) {
      const py = y + 0.5 - hh, qy = Math.abs(py) - (hh - rr);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const px = x + 0.5 - hw, qx = Math.abs(px) - (hw - rr);
        let e, nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { const L = Math.hypot(qx, qy) || 1; e = rr - L; nx = (qx / L) * Math.sign(px); ny = (qy / L) * Math.sign(py); }
        else if (qx > qy) { e = rr - qx; nx = Math.sign(px); }
        else { e = rr - qy; ny = Math.sign(py); }
        let dx = 0, dy = 0;
        if (e > 0 && e < B) {
          const t = 1 - e / B;            // 1 = Glaskante, 0 = flaches Inneres
          const m = Math.pow(t, 1.8);     // gewölbter Rand: Brechung nimmt zur Kante stark zu
          dx = -nx * m; dy = -ny * m;     // nach innen sampeln → Inhalt wird an der Kante „gezogen“
        }
        d[i] = 128 + dx * 127; d[i + 1] = 128 + dy * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    if (mapCache.size > 24) mapCache.clear();
    mapCache.set(key, url);
    return url;
  }

  function build(item) {
    const { el, o } = item;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h || (w === item.w && h === item.h)) return;
    item.w = w; item.h = h;
    const r = o.radius != null ? o.radius : parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const map = displacementMap(w, h, Math.round(r), o.bezel, !!o.openBottom);
    const s = o.strength;
    const disp = (scale, out) => `<feDisplacementMap in="blur" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="${out}"/>`;
    const body = o.chroma
      ? `${disp(s, 'dR')}<feColorMatrix in="dR" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="cR"/>
         ${disp(s * 0.9, 'dG')}<feColorMatrix in="dG" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="cG"/>
         ${disp(s * 0.8, 'dB')}<feColorMatrix in="dB" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="cB"/>
         <feBlend in="cR" in2="cG" mode="screen" result="cRG"/><feBlend in="cRG" in2="cB" mode="screen" result="disp"/>`
      : disp(s, 'disp');
    item.filter.setAttribute('width', w);
    item.filter.setAttribute('height', h);
    item.filter.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="${o.blur}" result="blur"/>
      <feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      ${body}<feColorMatrix in="disp" type="saturate" values="${o.saturate || 1.6}"/>`;
    apply(item);
  }
  function apply(item) {
    const v = enabled && item.w ? `url(#${item.id})` : '';
    item.el.style.backdropFilter = v;
    item.el.style.webkitBackdropFilter = v;
  }

  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => requestAnimationFrame(() => entries.forEach((en) => {
        const it = items.find((x) => x.el === en.target);
        if (it && enabled) build(it);
      })))
    : null;

  function register(el, o) {
    if (!el) return;
    const id = `lg${++seq}`;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    defs.appendChild(filter);
    const item = { el, o: { bezel: 18, strength: 30, blur: 1.5, chroma: true, ...o }, id, filter, w: 0, h: 0 };
    items.push(item);
    if (ro) ro.observe(el);
    if (enabled) build(item);
  }

  // Glanzlicht folgt der Neigung des Handys
  let la = 160, queued = false;
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    const target = 160 + Math.max(-40, Math.min(40, e.gamma)) * 1.3;
    if (queued || Math.abs(target - la) < 2.5) return;
    la = target; queued = true;
    requestAnimationFrame(() => { queued = false; items.forEach((it) => it.el.style.setProperty('--la', `${la.toFixed(0)}deg`)); });
  }, { passive: true });

  return {
    supported,
    register,
    refresh() { items.forEach((it) => { it.w = 0; if (enabled) build(it); }); },
    setEnabled(on) {
      const next = !!on && supported;
      if (next === enabled && this.ready) return;
      this.ready = true;
      enabled = next;
      document.documentElement.classList.toggle('lg', enabled);
      items.forEach((it) => { if (enabled) { it.w = 0; build(it); } else apply(it); });
    },
  };
})();

/* ==========================================================
   Darstellung: Hintergrund- & Akzentfarbe
   ========================================================== */
const BG_PRESETS = [
  { name: 'Schwarz', color: '#000000' },
  { name: 'Graphit', color: '#141416' },
  { name: 'Nacht', color: '#0a1020' },
  { name: 'Aubergine', color: '#160c22' },
  { name: 'Tanne', color: '#08160f' },
  { name: 'Espresso', color: '#18110c' },
  { name: 'Bordeaux', color: '#1c080d' },
];
const ACCENTS = [
  { id: 'violet', name: 'Violett', a: '#9d8cff', b: '#ff6fb0', ink: '#ffffff' },
  { id: 'ocean', name: 'Ozean', a: '#4de1ff', b: '#5a7bff', ink: '#ffffff' },
  { id: 'mint', name: 'Minze', a: '#3ee6a8', b: '#22b8ff', ink: '#04131a' },
  { id: 'sunset', name: 'Sunset', a: '#ffb547', b: '#ff5f6d', ink: '#1a0a00' },
  { id: 'rose', name: 'Rosé', a: '#ffa3d1', b: '#ff5f8a', ink: '#2a0614' },
  { id: 'lime', name: 'Lime', a: '#d4ff5a', b: '#3ee6a8', ink: '#0d1a00' },
  { id: 'mono', name: 'Silber', a: '#f2f2f7', b: '#9a9aa5', ink: '#000000' },
];
const hexToRgb = (h) => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, p) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(...x.map((v, i) => v + (y[i] - v) * p)); };
// Eigene Hintergrundfarben werden abgedunkelt, damit Text immer lesbar bleibt
function darkEnough(hex) {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (l <= 0.14) return rgbToHex(r * 255, g * 255, b * 255);
  const k = 0.14 / l;
  return rgbToHex(r * 255 * k, g * 255 * k, b * 255 * k);
}
function applyTheme() {
  const t = state.settings.theme;
  const bg = darkEnough(t.bg || '#000000');
  const a = ACCENTS.find((x) => x.id === t.accent) || ACCENTS[0];
  const s = document.documentElement.style;
  s.setProperty('--bg', bg);
  s.setProperty('--surface', mixHex(bg, '#ffffff', 0.075));
  s.setProperty('--surface-2', mixHex(bg, '#ffffff', 0.13));
  s.setProperty('--acc1', a.a);
  s.setProperty('--acc2', a.b);
  s.setProperty('--on-acc', a.ink);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
  document.documentElement.classList.toggle('anim-bg', !!t.animatedBg);
  Bg.setEnabled(!!t.animatedBg, bg);
  LiquidGlass.setEnabled(t.refraction !== false);
}

/* ==========================================================
   Konfetti (zeitbasiert → gleich schnell bei 60 und 120 Hz)
   ========================================================== */
const Confetti = (() => {
  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  let parts = [], running = false, last = 0;
  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    return [cs.getPropertyValue('--acc1').trim() || '#9d8cff', cs.getPropertyValue('--acc2').trim() || '#ff6fb0', '#3ee6a8', '#4de1ff', '#ffb547', '#ffffff'];
  };
  function size() { const d = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * d; cv.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  function burst(x = innerWidth / 2, y = innerHeight / 2, n = 110) {
    const cols = colors();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 8, c: cols[i % cols.length], life: 1, round: Math.random() < 0.3 });
    }
    if (!running) { running = true; size(); cv.classList.add('on'); last = performance.now(); requestAnimationFrame(tick); }
  }
  function tick(now) {
    const k = Math.min(3, Math.max(0.25, (now - last) / 16.667)); last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.32 * k; p.vx *= Math.pow(0.985, k); p.x += p.vx * k; p.y += p.vy * k; p.rot += p.vr * k; p.life -= 0.009 * k;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); cv.classList.remove('on'); }
  }
  return { burst };
})();

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Zahlen hochzählen ---------- */
function countUp(root = document) {
  $$('[data-count]', root).forEach((el) => {
    const to = num(el.dataset.count), dur = 900, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = round(to * e).toLocaleString('de-DE');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ==========================================================
   Sheet (Bottom Sheet Modal)
   ========================================================== */
const sheet = $('#sheet'), sheetContent = $('#sheet-content'), backdrop = $('#sheet-backdrop');
let sheetRender = null;
function openSheet(render) {
  sheetRender = render;
  sheetContent.innerHTML = render();
  sheetContent.scrollTop = 0;
  sheet.classList.add('open'); backdrop.classList.add('open');
  haptic();
}
function rerenderSheet() {
  if (!sheetRender) return;
  const st = sheetContent.scrollTop;
  sheetContent.innerHTML = sheetRender();
  sheetContent.scrollTop = st;
}
function closeSheet() {
  sheet.classList.remove('open'); backdrop.classList.remove('open');
  sheetRender = null; sheetActions = {};
}
backdrop.addEventListener('click', closeSheet);
// Wischen nach unten schließt das Sheet
(() => {
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => { if (sheetContent.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translate(-50%, ${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    sheet.style.transition = ''; sheet.style.transform = '';
    if (y0 != null && dy > 110) closeSheet();
    y0 = null;
  });
})();

let sheetActions = {};
sheetContent.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && sheetActions[el.dataset.act]) { haptic(); sheetActions[el.dataset.act](el, e); }
});
sheetContent.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]');
  if (el && sheetActions['in:' + el.dataset.in]) sheetActions['in:' + el.dataset.in](el, e);
});
sheetContent.addEventListener('change', (e) => {
  const el = e.target.closest('[data-ch]');
  if (el && sheetActions['ch:' + el.dataset.ch]) sheetActions['ch:' + el.dataset.ch](el, e);
});

/* ==========================================================
   Navigation
   ========================================================== */
const view = $('#view');
const titles = { home: 'Heute', plan: 'Trainingsplan', exercises: 'Übungen', nutrition: 'Ernährung', calendar: 'Kalender' };
let viewActions = {};

function moveBlob() {
  const btn = $(`.tabbar button[data-tab="${ui.tab}"]`);
  const blob = $('#tab-blob');
  blob.style.width = btn.offsetWidth + 'px';
  blob.style.transform = `translateX(${btn.offsetLeft - 7}px)`;
  blob.classList.remove('squish'); void blob.offsetWidth; blob.classList.add('squish');
}
function go(tab) {
  ui.tab = tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  moveBlob();
  Bg.setTheme(tab);
  render(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b && b.dataset.tab !== ui.tab) { haptic(); go(b.dataset.tab); }
});
addEventListener('resize', moveBlob);

function render(animate = false) {
  $('#view-title').textContent = titles[ui.tab];
  $('#navbar-title').textContent = titles[ui.tab];
  const d = new Date();
  $('#today-label').textContent = `${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  viewActions = {};
  const html = { home: renderHome, plan: renderPlan, exercises: renderExercises, nutrition: renderNutrition, calendar: renderCalendar }[ui.tab]();
  view.innerHTML = html;
  [...view.children].forEach((c, i) => c.style.setProperty('--i', i));
  if (animate) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('[data-offset]', view).forEach((el) => el.style.strokeDashoffset = el.dataset.offset);
    $$('[data-scale]', view).forEach((el) => el.style.transform = `scaleX(${el.dataset.scale})`);
  }));
  countUp(view);
}
view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && viewActions[el.dataset.act]) { haptic(); viewActions[el.dataset.act](el, e); }
});
view.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]');
  if (el && viewActions['in:' + el.dataset.in]) viewActions['in:' + el.dataset.in](el, e);
});

/* ---------- Shared UI-Bausteine ---------- */
const groupChips = (ids = [], tiny = true) => ids.map((id) => G[id]
  ? `<span class="chip on ${tiny ? 'tiny' : ''}" style="--c:${G[id].color}">${G[id].emoji} ${G[id].name}</span>` : '').join('');

function ring(value, goal, color, label, unit = '', warnOver = false) {
  const R = 30, C = 2 * Math.PI * R;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const over = warnOver && value > goal;
  const col = over ? '#ff4d6d' : color;
  return `<div class="ring" style="--rc:${col}">
    <div class="ring-wrap">
      <svg viewBox="0 0 74 74"><defs><linearGradient id="g${label.replace(/\W/g, '')}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${col}" stop-opacity=".55"/></linearGradient></defs>
        <circle class="track" cx="37" cy="37" r="${R}" fill="none" stroke-width="8"/>
        <circle class="bar" cx="37" cy="37" r="${R}" fill="none" stroke="url(#g${label.replace(/\W/g, '')})" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C}" data-offset="${C * (1 - pct)}"/>
      </svg>
      <div class="ring-val"><span data-count="${value}">0</span></div>
    </div>
    <div class="lbl">${label}<br><span class="muted">/ ${goal.toLocaleString('de-DE')}${unit}</span></div>
  </div>`;
}

function dayTotals(key) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, water: 0, caffeine: 0, entries: [] };
  const list = (state.nutrition[key] && state.nutrition[key].entries) || [];
  list.forEach((e) => {
    t.kcal += num(e.kcal); t.protein += num(e.protein); t.carbs += num(e.carbs); t.fat += num(e.fat);
    t.water += num(e.ml); t.caffeine += num(e.caffeine);
  });
  t.entries = list;
  return t;
}

function planFor(date) { return state.plan[wIdx(date)]; }
const plannedCount = () => state.plan.filter(Boolean).length;
function weekVisits(date = new Date()) {
  const s = startOfWeek(date);
  let n = 0; for (let i = 0; i < 7; i++) if (state.visits[dkey(addDays(s, i))]) n++;
  return n;
}
function weekStreak() {
  let streak = 0, w = startOfWeek(new Date());
  if (!weekVisits(w)) w = addDays(w, -7); // laufende Woche zählt erst, wenn trainiert
  while (weekVisits(w) > 0) { streak++; w = addDays(w, -7); }
  return streak;
}

/* ==========================================================
   VIEW: Heute
   ========================================================== */
function renderHome() {
  const today = new Date(), key = dkey(today), plan = planFor(today), done = state.visits[key];
  const tot = dayTotals(key), g = state.goals;
  const hasPlan = plannedCount() > 0;
  const name = state.settings.name ? `, ${esc(state.settings.name)}` : '';
  const hour = today.getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hey' : 'Guten Abend';

  viewActions = {
    done: (el) => {
      const r = el.getBoundingClientRect();
      if (state.visits[key]) { delete state.visits[key]; toast('Training zurückgesetzt'); }
      else {
        state.visits[key] = { workout: plan ? plan.name : 'Freies Training', note: '' };
        Confetti.burst(r.left + r.width / 2, r.top); Bg.pulse(); haptic(30);
        toast('🔥 Stark! Training eingetragen');
      }
      save(); render();
    },
    goPlan: () => go('plan'),
    goNut: () => go('nutrition'),
    showDay: (el) => openDayPreview(+el.dataset.day),
    water: () => quickAdd({ kind: 'drink', name: 'Wasser', emoji: '💧', ml: 250 }),
    shake: () => quickAdd({ kind: 'drink', name: 'Protein Shake', emoji: '🥤', ml: 400, kcal: 120, protein: 25, carbs: 3, fat: 2 }),
    coffee: () => quickAdd({ kind: 'drink', name: 'Kaffee', emoji: '☕', ml: 200, caffeine: 80, kcal: 5 }),
    pre: () => openEntrySheet('supp', SUPP_PRESETS[0]),
    notify: () => enableNotifications(),
  };

  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(startOfWeek(today), i), k = dkey(d);
    const cls = [state.visits[k] ? 'done' : '', state.plan[i] ? 'planned' : '', k === key ? 'today' : ''].join(' ');
    return `<div class="wday ${cls}"><span>${DAYS_S[i]}</span><span class="dot">${state.visits[k] ? '✓' : d.getDate()}</span></div>`;
  }).join('');

  const upcoming = [1, 2, 3].map((n, i) => {
    const d = addDays(today, n), p = planFor(d);
    const label = n === 1 ? 'Morgen' : DAYS[wIdx(d)];
    return `<div class="item" data-act="showDay" data-day="${wIdx(d)}" style="--i:${i};--c:${p ? 'var(--acc1)' : '#555'}">
      <div class="emo">${p ? '🏋️' : '😴'}</div>
      <div class="grow"><div class="title">${label} · ${p ? esc(p.name) : 'Ruhetag'}</div>
      <div class="sub">${p ? (p.groups || []).map((x) => G[x]?.name).filter(Boolean).join(', ') + ` · ${p.exercises.length} Übungen` : 'Regeneration ist Teil des Trainings'}</div></div>
      <span class="muted">›</span></div>`;
  }).join('');

  const preTaken = tot.entries.find((e) => /pre.?workout/i.test(e.name));

  return `
  <div class="hero surface">
    <div class="glow"></div>
    <p class="muted small" style="margin:0 0 8px">${hello}${name} 👋</p>
    ${hasPlan ? `
      <div class="row wrap">
        <span class="badge">${plan ? '🏋️ Heute dran' : '🛌 Ruhetag'}</span>
        ${done ? '<span class="badge done"><span class="pulse-dot"></span>Erledigt</span>' : ''}
      </div>
      <div class="day-name">${plan ? esc(plan.name) : 'Erholung'}</div>
      ${plan ? `<div class="chips" style="margin-bottom:12px">${groupChips(plan.groups)}</div>
        <div class="list" style="gap:6px;margin-bottom:16px">${plan.exercises.slice(0, 4).map((x) =>
          `<div class="small"><b>${esc(x.name)}</b>${exMeta(x) ? ` <span class="muted">· ${esc(exMeta(x))}</span>` : ''}${prBadge(x)}</div>`).join('')}
          ${plan.exercises.length > 4 ? `<div class="small muted">+ ${plan.exercises.length - 4} weitere</div>` : ''}</div>` : '<p class="muted" style="margin-top:0">Gönn deinen Muskeln Pause – sie wachsen in der Regeneration.</p>'}
      <div class="row">
        <button class="btn ${done ? 'ghost' : 'green'} grow" data-act="done">${done ? '↺ Rückgängig' : '✓ Im Gym gewesen'}</button>
        <button class="btn ghost" data-act="goPlan">Plan</button>
      </div>` : `
      <div class="day-name">Los geht’s! 🚀</div>
      <p class="muted" style="margin-top:0">Erstelle deinen Trainingsplan – mit fertigen Splits oder komplett individuell.</p>
      <button class="btn primary block" data-act="goPlan">Trainingsplan erstellen</button>`}
  </div>

  <div class="card surface">
    <div class="card-head"><h2>Diese Woche</h2><span class="badge">${weekVisits()} / ${plannedCount() || '–'} Trainings</span></div>
    <div class="week-strip">${strip}</div>
  </div>

  <div class="card surface">
    <div class="card-head"><h2>Ernährung heute</h2><button class="btn sm ghost" data-act="goNut">Details ›</button></div>
    <div class="rings">
      ${ring(round(tot.kcal), g.kcal, '#ff6fb0', 'kcal')}
      ${ring(round(tot.protein), g.protein, '#a796ff', 'Protein', ' g')}
      ${ring(round(tot.water), g.water, '#4de1ff', 'Wasser', ' ml')}
      ${ring(round(tot.caffeine), g.caffeine, '#ffb547', 'Koffein', ' mg', true)}
    </div>
    ${preTaken ? `<p class="small" style="margin:14px 0 0">⚡ Pre-Workout um <b>${esc(preTaken.time)}</b>${preTaken.caffeine ? ` · ${esc(preTaken.caffeine)} mg Koffein` : ''}</p>` : ''}
    <div class="chips scroll" style="margin-top:14px">
      <button class="chip" data-act="water">💧 +250 ml</button>
      <button class="chip" data-act="pre">⚡ Pre-Workout</button>
      <button class="chip" data-act="shake">🥤 Shake</button>
      <button class="chip" data-act="coffee">☕ Kaffee</button>
    </div>
  </div>

  ${hasPlan ? `<p class="section-label">Die nächsten Tage</p><div class="list">${upcoming}</div>` : ''}

  ${!state.settings.notify ? `<div class="card surface row">
    <div style="font-size:30px">🔔</div>
    <div class="grow"><h3>Erinnerungen</h3><div class="small muted">Lass dir täglich zeigen, was ansteht.</div></div>
    <button class="btn sm primary" data-act="notify">Aktivieren</button>
  </div>` : ''}
  `;
}

function quickAdd(entry) {
  const key = dkey(new Date());
  addEntry(key, entry);
  toast(`${entry.emoji || '✓'} ${entry.name} hinzugefügt`);
  render();
}
function addEntry(key, entry) {
  state.nutrition[key] = state.nutrition[key] || { entries: [] };
  const e = { id: uid(), time: nowTime(), ...entry };
  state.nutrition[key].entries.push(e);
  save();
  Bg.pulse();
  const t = dayTotals(key);
  if (num(e.caffeine) > 0 && t.caffeine > state.goals.caffeine) setTimeout(() => toast(`⚠️ ${round(t.caffeine)} mg Koffein – über deinem Limit`), 2500);
}

function openDayPreview(i) {
  const p = state.plan[i];
  sheetActions = { edit: () => { closeSheet(); setTimeout(() => openDayEditor(i), 250); } };
  openSheet(() => `
    <div class="sheet-title"><h2>${DAYS[i]}</h2><button class="btn sm ghost" data-act="edit">Bearbeiten</button></div>
    ${p ? `<h3 style="font-size:22px;margin-bottom:10px">${esc(p.name)}</h3>
      <div class="chips" style="margin-bottom:14px">${groupChips(p.groups)}</div>
      <div class="list">${p.exercises.map((x, k) => `<div class="item" style="--i:${k}">
        <div class="emo" style="--c:${G[x.group]?.color || 'var(--acc1)'}">${G[x.group]?.emoji || '🏋️'}</div>
        <div class="grow"><div class="title">${esc(x.name)}${prBadge(x)}</div>${exMeta(x) ? `<div class="sub">${esc(exMeta(x))}</div>` : ''}${x.note && !/^pr$/i.test(x.note.trim()) ? `<div class="note">📝 ${esc(x.note)}</div>` : ''}</div></div>`).join('')
        || '<div class="empty">Noch keine Übungen</div>'}</div>`
      : '<div class="empty"><span class="big">😴</span>Ruhetag</div>'}
  `);
}

/* ==========================================================
   VIEW: Trainingsplan
   ========================================================== */
function renderPlan() {
  const ti = wIdx(new Date());
  viewActions = {
    edit: (el) => openDayEditor(+el.dataset.day),
    tpl: (el) => applyTemplate(el.dataset.tpl),
    clear: () => {
      if (!confirm('Kompletten Plan löschen?')) return;
      state.plan = [null, null, null, null, null, null, null]; save(); render(true); toast('Plan geleert');
    },
    ics: () => exportICS(),
  };
  const days = state.plan.map((p, i) => `
    <div class="day-card surface ${p ? '' : 'rest'} ${i === ti ? 'today' : ''}" data-act="edit" data-day="${i}">
      <div class="dn">${DAYS_S[i]}</div>
      <div class="grow">
        <div class="title" style="font-weight:800;font-size:17px">${p ? esc(p.name) : 'Ruhetag'}</div>
        ${p ? `<div class="chips" style="margin-top:6px">${groupChips(p.groups)}</div>
          <div class="sub small muted" style="margin-top:6px">${p.exercises.length} Übungen${p.exercises.some((x) => num(x.sets)) ? ` · ${p.exercises.reduce((a, x) => a + num(x.sets), 0)} Sätze` : ''}</div>`
          : '<div class="sub small muted">Tippen zum Planen</div>'}
      </div>
      <span class="muted" style="font-size:20px">›</span>
    </div>`).join('');

  return `
    <p class="section-label">Vorlagen</p>
    <div class="chips scroll">
      ${window.PLAN_TEMPLATES.map((t) => `<button class="card surface tpl-card ${t.id === 'mine' ? 'mine' : ''}" data-act="tpl" data-tpl="${t.id}">
        <div style="font-weight:800">${esc(t.name)}</div><div class="small muted" style="margin-top:4px">${esc(t.desc)}</div></button>`).join('')}
    </div>
    ${days}
    <div class="row">
      <button class="btn ghost grow" data-act="ics">📆 In Kalender-App</button>
      <button class="btn danger" data-act="clear">Leeren</button>
    </div>
  `;
}

function pickExercises(groups, perGroup = 2, offset = 0, exclude = []) {
  const out = [];
  groups.forEach((gid) => {
    const pool = (LIB[gid] || []).filter((e) => !exclude.includes(e.name));
    for (let k = 0; k < Math.min(perGroup, pool.length); k++) {
      const e = pool[(k + offset * perGroup) % pool.length];
      if (!out.find((o) => o.name === e.name)) out.push(toPlanEx(e, gid));
    }
  });
  return out;
}
const toPlanEx = (e, gid) => ({ id: uid(), name: e.name, group: gid, sets: e.sets ?? '', reps: e.reps ?? '', weight: e.weight ?? '', note: e.note ?? '' });
const fmtKg = (w) => String(w).replace(/\./g, ',');
function exMeta(x) {
  const parts = [];
  if (x.sets && x.reps) parts.push(`${x.sets} × ${x.reps}`);
  else if (x.reps) parts.push(`${x.reps} Wdh.`);
  else if (x.sets) parts.push(`${x.sets} Sätze`);
  if (x.weight) parts.push(`${fmtKg(x.weight)} kg`);
  return parts.join(' · ');
}
const isPR = (x) => /\bpr\b/i.test(x.note || '');
const prBadge = (x) => (isPR(x) ? ' <span class="badge pr">PR</span>' : '');

function templatePlan(t) {
  const seen = {};
  return t.days.map((d) => {
    if (!d) return null;
    seen[d.name] = (seen[d.name] || 0);
    const occ = seen[d.name]++;
    if (d.exercises) return { name: d.name, groups: [...d.groups], exercises: d.exercises.map((x) => toPlanEx(x, x.group)) };
    return { name: d.name, groups: [...d.groups], exercises: pickExercises(d.groups, d.groups.length > 3 ? 1 : 2, occ) };
  });
}
function applyTemplate(id) {
  const t = window.PLAN_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  if (plannedCount() && !confirm(`Aktuellen Plan durch „${t.name}“ ersetzen?`)) return;
  state.plan = templatePlan(t);
  save(); render(true);
  Confetti.burst(innerWidth / 2, innerHeight / 3, 80);
  toast(`✨ ${t.name} übernommen`);
}

function openDayEditor(i) {
  const orig = state.plan[i];
  const draft = orig ? JSON.parse(JSON.stringify(orig)) : { name: '', groups: [], exercises: [] };
  let rest = !orig, shuffle = 0;

  const suggestions = () => {
    const have = draft.exercises.map((x) => x.name);
    const out = [];
    draft.groups.forEach((gid) => {
      const pool = (LIB[gid] || []).filter((e) => !have.includes(e.name));
      for (let k = 0; k < Math.min(3, pool.length); k++) out.push({ ...pool[(k + shuffle * 3) % pool.length], group: gid });
    });
    return out.filter((e, idx, arr) => arr.findIndex((o) => o.name === e.name) === idx);
  };

  sheetActions = {
    'ch:rest': (el) => { rest = !el.checked; rerenderSheet(); },
    'in:name': (el) => { draft.name = el.value; draft._auto = false; },
    group: (el) => {
      const id = el.dataset.g;
      draft.groups = draft.groups.includes(id) ? draft.groups.filter((x) => x !== id) : [...draft.groups, id];
      if (!draft.name.trim() || draft._auto) { draft.name = draft.groups.map((x) => G[x].name).join(' & '); draft._auto = true; }
      rerenderSheet();
    },
    add: (el) => {
      const e = suggestions().find((x) => x.name === el.dataset.name);
      if (e) { draft.exercises.push(toPlanEx(e, e.group)); rerenderSheet(); }
    },
    remove: (el) => {
      const row = el.closest('.ex-row');
      row.classList.add('removing');
      setTimeout(() => { draft.exercises = draft.exercises.filter((x) => x.id !== el.dataset.id); rerenderSheet(); }, 300);
    },
    up: (el) => {
      const k = draft.exercises.findIndex((x) => x.id === el.dataset.id);
      if (k > 0) { [draft.exercises[k - 1], draft.exercises[k]] = [draft.exercises[k], draft.exercises[k - 1]]; rerenderSheet(); }
    },
    'in:ex': (el) => {
      const x = draft.exercises.find((e) => e.id === el.dataset.id);
      if (x) x[el.dataset.f] = el.value;
    },
    shuffle: () => { shuffle++; rerenderSheet(); },
    auto: () => {
      if (!draft.groups.length) return toast('Wähle zuerst Muskelgruppen');
      draft.exercises.push(...pickExercises(draft.groups, 2, shuffle, draft.exercises.map((x) => x.name)));
      rerenderSheet(); toast('✨ Übungen vorgeschlagen');
    },
    custom: () => {
      const n = prompt('Name der Übung:');
      if (n && n.trim()) { draft.exercises.push({ id: uid(), name: n.trim(), group: draft.groups[0] || '', sets: 3, reps: '10', weight: '', note: '' }); rerenderSheet(); }
    },
    save: () => {
      if (rest) state.plan[i] = null;
      else {
        delete draft._auto;
        if (!draft.name.trim()) draft.name = draft.groups.map((x) => G[x].name).join(' & ') || 'Training';
        state.plan[i] = draft;
      }
      save(); closeSheet(); render(); toast(`💾 ${DAYS[i]} gespeichert`);
    },
  };

  openSheet(() => {
    const sug = suggestions();
    return `
    <div class="sheet-title"><h2>${DAYS[i]}</h2><button class="btn sm primary" data-act="save">Speichern</button></div>
    <div class="form">
      <label class="row setting-row">
        <span class="grow" style="font-weight:700">Trainingstag</span>
        <span class="switch"><input type="checkbox" data-ch="rest" ${rest ? '' : 'checked'}><span></span></span>
      </label>
      ${rest ? '<div class="empty"><span class="big">😴</span>Ruhetag – aktiviere den Schalter, um zu planen.</div>' : `
      <label class="field"><span>Name</span><input data-in="name" value="${esc(draft.name)}" placeholder="z. B. Push Day"></label>
      <div class="field"><span>Muskelgruppen</span>
        <div class="chips">${GROUPS.map((g) => `<button class="chip ${draft.groups.includes(g.id) ? 'on' : ''}" style="--c:${g.color}" data-act="group" data-g="${g.id}">${g.emoji} ${g.name}</button>`).join('')}</div>
      </div>

      <div class="field"><span>Übungen (${draft.exercises.length})</span>
        <div class="list">
        ${draft.exercises.map((x, k) => `<div class="ex-row" style="--i:${k}">
          <div class="ex-top">
            <span style="font-size:18px">${G[x.group]?.emoji || '🏋️'}</span>
            <span class="ex-name">${esc(x.name)}</span>
            ${k > 0 ? `<button class="x-btn" data-act="up" data-id="${x.id}" aria-label="Nach oben">↑</button>` : ''}
            <button class="x-btn" data-act="remove" data-id="${x.id}" aria-label="Entfernen">✕</button>
          </div>
          <div class="ex-fields">
            <label>Sätze<input inputmode="numeric" data-in="ex" data-f="sets" data-id="${x.id}" value="${esc(x.sets)}"></label>
            <label>Wdh.<input data-in="ex" data-f="reps" data-id="${x.id}" value="${esc(x.reps)}"></label>
            <label>kg<input inputmode="decimal" data-in="ex" data-f="weight" data-id="${x.id}" value="${esc(x.weight)}" placeholder="–"></label>
          </div>
          <input class="ex-note" data-in="ex" data-f="note" data-id="${x.id}" value="${esc(x.note || '')}" placeholder="Notiz, z. B. PR oder Arbeitsgewicht">
        </div>`).join('') || '<div class="empty small">Noch keine Übungen – nutze die Vorschläge unten 👇</div>'}
        </div>
        <button class="btn ghost sm" data-act="custom" style="align-self:flex-start">＋ Eigene Übung</button>
      </div>

      <div class="field">
        <div class="row"><span class="grow" style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em">💡 Vorschläge</span>
          <button class="btn sm ghost" data-act="shuffle">🔀 Andere</button>
          <button class="btn sm primary" data-act="auto">✨ Auto</button></div>
        ${draft.groups.length ? `<div class="list">${sug.map((e, k) => `<div class="item" style="--i:${k};--c:${G[e.group].color}">
          <div class="emo">${G[e.group].emoji}</div>
          <div class="grow"><div class="title">${esc(e.name)}</div><div class="sub">${esc(e.equip)} · ${e.sets}×${esc(e.reps)} <span class="lvl">${'★'.repeat(e.level)}</span></div></div>
          <button class="add-btn" data-act="add" data-name="${esc(e.name)}" aria-label="Hinzufügen">+</button></div>`).join('')
          || '<div class="empty small">Alle Übungen dieser Gruppen sind schon drin 💪</div>'}</div>`
          : '<div class="empty small">Wähle Muskelgruppen, um passende Übungen vorgeschlagen zu bekommen.</div>'}
      </div>`}
    </div>`;
  });
}

/* ==========================================================
   VIEW: Übungen
   ========================================================== */
function renderExercises() {
  viewActions = {
    g: (el) => { ui.exGroup = el.dataset.g; render(); },
    'in:q': (el) => {
      ui.exQuery = el.value;
      $('#ex-list').innerHTML = exerciseList();
    },
    tip: (el) => { const t = el.querySelector('.tip'); if (t) t.hidden = !t.hidden; },
    add: (el, e) => { e.stopPropagation(); openAddToDay(el.dataset.name, el.dataset.g); },
  };
  return `
    <div class="search"><input data-in="q" placeholder="Übung suchen…" value="${esc(ui.exQuery)}"></div>
    <div class="chips scroll">
      ${GROUPS.map((g) => `<button class="chip ${ui.exGroup === g.id ? 'on' : ''}" style="--c:${g.color}" data-act="g" data-g="${g.id}">${g.emoji} ${g.name}</button>`).join('')}
    </div>
    <div class="list" id="ex-list">${exerciseList()}</div>
  `;
}
function exerciseList() {
  const q = ui.exQuery.trim().toLowerCase();
  const items = q
    ? Object.entries(LIB).flatMap(([gid, arr]) => arr.map((e) => ({ ...e, group: gid }))).filter((e) => (e.name + ' ' + e.equip).toLowerCase().includes(q))
    : (LIB[ui.exGroup] || []).map((e) => ({ ...e, group: ui.exGroup }));
  if (!items.length) return '<div class="empty"><span class="big">🤷</span>Keine Übung gefunden</div>';
  return items.map((e, k) => `
    <div class="item surface" style="--i:${k};--c:${G[e.group].color};align-items:flex-start" data-act="tip">
      <div class="emo">${G[e.group].emoji}</div>
      <div class="grow">
        <div class="title">${esc(e.name)}</div>
        <div class="sub">${esc(e.equip)} · ${e.sets}×${esc(e.reps)} · <span class="lvl">${'★'.repeat(e.level)}${'☆'.repeat(3 - e.level)}</span></div>
        <div class="tip" hidden>💡 ${esc(e.tip)}</div>
      </div>
      <button class="add-btn" data-act="add" data-name="${esc(e.name)}" data-g="${e.group}" aria-label="Zum Plan hinzufügen">+</button>
    </div>`).join('');
}
function openAddToDay(name, gid) {
  const e = findEx(name);
  sheetActions = {
    day: (el) => {
      const i = +el.dataset.day;
      if (!state.plan[i]) state.plan[i] = { name: G[gid].name, groups: [gid], exercises: [] };
      const p = state.plan[i];
      if (p.exercises.some((x) => x.name === name)) return toast('Ist schon in diesem Tag');
      p.exercises.push(toPlanEx(e, gid));
      if (!p.groups.includes(gid)) p.groups.push(gid);
      save(); closeSheet();
      const r = el.getBoundingClientRect(); Confetti.burst(r.left + r.width / 2, r.top, 50);
      toast(`✓ ${name} → ${DAYS[i]}`);
    },
  };
  openSheet(() => `
    <div class="sheet-title"><h2>Zu welchem Tag?</h2></div>
    <p class="muted" style="margin-top:-8px">${esc(name)}</p>
    <div class="list">${state.plan.map((p, i) => `<button class="item" style="--i:${i};text-align:left" data-act="day" data-day="${i}">
      <div class="emo" style="--c:${p ? 'var(--acc1)' : '#555'}">${DAYS_S[i]}</div>
      <div class="grow"><div class="title">${DAYS[i]}</div><div class="sub">${p ? esc(p.name) + ` · ${p.exercises.length} Übungen` : 'Ruhetag → wird zum Trainingstag'}</div></div>
      <span class="muted">＋</span></button>`).join('')}</div>`);
}

/* ==========================================================
   VIEW: Ernährung
   ========================================================== */
const MEAL_PRESETS = [
  { name: 'Hähnchen mit Reis', emoji: '🍗', kcal: 650, protein: 50, carbs: 80, fat: 12 },
  { name: 'Haferflocken + Whey', emoji: '🥣', kcal: 480, protein: 35, carbs: 60, fat: 9 },
  { name: 'Magerquark (500 g)', emoji: '🥛', kcal: 335, protein: 60, carbs: 20, fat: 1 },
  { name: '3 Eier', emoji: '🍳', kcal: 230, protein: 19, carbs: 1, fat: 16 },
  { name: 'Lachs & Kartoffeln', emoji: '🐟', kcal: 620, protein: 40, carbs: 55, fat: 24 },
  { name: 'Banane', emoji: '🍌', kcal: 105, protein: 1, carbs: 27, fat: 0 },
  { name: 'Proteinriegel', emoji: '🍫', kcal: 200, protein: 20, carbs: 18, fat: 7 },
];
const DRINK_PRESETS = [
  { name: 'Wasser', emoji: '💧', ml: 500 },
  { name: 'Kaffee', emoji: '☕', ml: 200, caffeine: 80, kcal: 5 },
  { name: 'Espresso', emoji: '☕', ml: 30, caffeine: 65, kcal: 2 },
  { name: 'Energy Drink', emoji: '⚡', ml: 250, caffeine: 80, kcal: 115, carbs: 28 },
  { name: 'Energy Zero', emoji: '⚡', ml: 500, caffeine: 160, kcal: 5 },
  { name: 'Protein Shake', emoji: '🥤', ml: 400, kcal: 120, protein: 25, carbs: 3, fat: 2 },
  { name: 'Grüner Tee', emoji: '🍵', ml: 300, caffeine: 30 },
  { name: 'Milch', emoji: '🥛', ml: 300, kcal: 192, protein: 10, carbs: 14, fat: 11 },
];
const SUPP_PRESETS = [
  { name: 'Pre-Workout', emoji: '⚡', dose: '1 Scoop', caffeine: 200, kcal: 10 },
  { name: 'Kreatin', emoji: '🧪', dose: '5 g' },
  { name: 'Whey Protein', emoji: '🥛', dose: '30 g', kcal: 120, protein: 24, carbs: 3, fat: 2 },
  { name: 'Koffeintablette', emoji: '💊', dose: '1 Tablette', caffeine: 200 },
  { name: 'EAA / BCAA', emoji: '💧', dose: '10 g', kcal: 40, protein: 10 },
  { name: 'Omega-3', emoji: '🐟', dose: '2 Kapseln', kcal: 18, fat: 2 },
  { name: 'Vitamin D3', emoji: '☀️', dose: '2000 IE' },
  { name: 'Magnesium', emoji: '🌙', dose: '400 mg' },
];

function renderNutrition() {
  const key = ui.nutDate, d = fromKey(key), tot = dayTotals(key), g = state.goals;
  const isToday = key === dkey(new Date());
  viewActions = {
    prev: () => { ui.nutDate = dkey(addDays(d, -1)); render(true); },
    next: () => { ui.nutDate = dkey(addDays(d, 1)); render(true); },
    today: () => { ui.nutDate = dkey(new Date()); render(true); },
    add: (el) => openEntrySheet(el.dataset.kind),
    del: (el, e) => {
      e.stopPropagation();
      const row = el.closest('.item'); row.classList.add('removing');
      setTimeout(() => {
        state.nutrition[key].entries = state.nutrition[key].entries.filter((x) => x.id !== el.dataset.id);
        save(); render();
      }, 300);
    },
    edit: (el) => {
      const ent = tot.entries.find((x) => x.id === el.dataset.id);
      if (ent) openEntrySheet(ent.kind, ent, true);
    },
  };
  const bar = (label, val, goal, c1, c2) => `<div class="macro">
    <div class="mtop"><span>${label}</span><span><span data-count="${round(val)}">0</span> <span class="muted">/ ${goal} g</span></span></div>
    <div class="bar-track"><div class="bar-fill" style="--c1:${c1};--c2:${c2}" data-scale="${Math.min(1, goal ? val / goal : 0)}"></div></div></div>`;
  const kinds = { meal: '🍽️ Mahlzeit', drink: '🥤 Getränk', supp: '💊 Supplement' };
  const sorted = [...tot.entries].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const pre = tot.entries.filter((e) => /pre.?workout/i.test(e.name));

  return `
    <div class="row">
      <button class="icon-btn surface" data-act="prev" aria-label="Vorheriger Tag">‹</button>
      <button class="btn ghost grow" data-act="today">${isToday ? 'Heute' : `${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`}</button>
      <button class="icon-btn surface" data-act="next" aria-label="Nächster Tag">›</button>
    </div>
    <div class="card surface">
      <div class="rings">
        ${ring(round(tot.kcal), g.kcal, '#ff6fb0', 'kcal')}
        ${ring(round(tot.protein), g.protein, '#a796ff', 'Protein', ' g')}
        ${ring(round(tot.water), g.water, '#4de1ff', 'Flüssigkeit', ' ml')}
        ${ring(round(tot.caffeine), g.caffeine, '#ffb547', 'Koffein', ' mg', true)}
      </div>
    </div>
    <div class="card surface form" style="gap:12px">
      ${bar('🥩 Protein', tot.protein, g.protein, '#9d8cff', '#ff6fb0')}
      ${bar('🍚 Kohlenhydrate', tot.carbs, g.carbs, '#ffb547', '#ff7a59')}
      ${bar('🥑 Fett', tot.fat, g.fat, '#3ee6a8', '#22b8ff')}
    </div>
    ${pre.length ? `<div class="card surface row" style="--i:0">
      <div style="font-size:30px">⚡</div>
      <div class="grow"><h3>Pre-Workout genommen</h3>
        <div class="small muted">${pre.map((p) => `${esc(p.time)} Uhr${p.caffeine ? ` · ${esc(p.caffeine)} mg Koffein` : ''}`).join(' | ')}</div></div>
    </div>` : ''}
    <div class="grid-3">
      ${Object.entries(kinds).map(([k, l]) => `<button class="btn ghost" style="flex-direction:column;gap:4px;padding:14px 6px" data-act="add" data-kind="${k}">
        <span style="font-size:24px">${l.split(' ')[0]}</span><span class="small">${l.split(' ')[1]}</span></button>`).join('')}
    </div>
    <p class="section-label">Einträge (${sorted.length})</p>
    <div class="list">
      ${sorted.map((e, k) => `<div class="item surface" style="--i:${k};--c:${e.kind === 'meal' ? '#ff6fb0' : e.kind === 'drink' ? '#4de1ff' : '#ffb547'}" data-act="edit" data-id="${e.id}">
        <div class="emo">${esc(e.emoji || (e.kind === 'meal' ? '🍽️' : e.kind === 'drink' ? '🥤' : '💊'))}</div>
        <div class="grow"><div class="title">${esc(e.name)}</div>
          <div class="sub">${esc(e.time)}${entryInfo(e)}</div></div>
        <button class="x-btn" data-act="del" data-id="${e.id}" aria-label="Löschen">✕</button>
      </div>`).join('') || '<div class="empty"><span class="big">🍽️</span>Noch nichts eingetragen</div>'}
    </div>
  `;
}
function entryInfo(e) {
  const p = [];
  if (e.dose) p.push(esc(e.dose));
  if (num(e.ml)) p.push(`${num(e.ml)} ml`);
  if (num(e.kcal)) p.push(`${num(e.kcal)} kcal`);
  if (num(e.protein)) p.push(`${num(e.protein)} g P`);
  if (num(e.carbs)) p.push(`${num(e.carbs)} g KH`);
  if (num(e.fat)) p.push(`${num(e.fat)} g F`);
  if (num(e.caffeine)) p.push(`⚡ ${num(e.caffeine)} mg`);
  return p.length ? ' · ' + p.join(' · ') : '';
}

function openEntrySheet(kind, preset = null, editing = false) {
  const presets = { meal: MEAL_PRESETS, drink: DRINK_PRESETS, supp: SUPP_PRESETS }[kind];
  const titles = { meal: 'Mahlzeit', drink: 'Getränk', supp: 'Supplement' };
  const blank = { kind, name: '', emoji: '', time: nowTime(), kcal: '', protein: '', carbs: '', fat: '', ml: '', caffeine: '', dose: '' };
  const f = { ...blank, ...(preset || {}), kind };
  const key = ui.tab === 'nutrition' ? ui.nutDate : dkey(new Date());

  const fields = {
    meal: ['kcal', 'protein', 'carbs', 'fat'],
    drink: ['ml', 'caffeine', 'kcal', 'protein', 'carbs'],
    supp: ['dose', 'caffeine', 'kcal', 'protein'],
  }[kind];
  const labels = { kcal: 'Kalorien (kcal)', protein: 'Protein (g)', carbs: 'Kohlenhydrate (g)', fat: 'Fett (g)', ml: 'Menge (ml)', caffeine: 'Koffein (mg)', dose: 'Dosis' };

  sheetActions = {
    preset: (el) => {
      const p = presets[+el.dataset.i];
      Object.assign(f, blank, p, { kind, time: f.time, id: f.id });
      rerenderSheet();
    },
    'in:f': (el) => { f[el.dataset.f] = el.value; },
    calc: () => {
      f.kcal = round(num(f.protein) * 4 + num(f.carbs) * 4 + num(f.fat) * 9);
      rerenderSheet();
    },
    save: (el) => {
      if (!f.name.trim()) return toast('Bitte einen Namen eingeben');
      const clean = { ...f };
      ['kcal', 'protein', 'carbs', 'fat', 'ml', 'caffeine'].forEach((k) => { clean[k] = clean[k] === '' ? '' : num(clean[k]); });
      if (editing) {
        const list = state.nutrition[key].entries;
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list[i] = clean;
        save();
      } else {
        delete clean.id;
        const { time, ...rest } = clean;
        addEntry(key, rest);
        state.nutrition[key].entries[state.nutrition[key].entries.length - 1].time = time || nowTime();
        save();
        const r = el.getBoundingClientRect(); Confetti.burst(r.left + r.width / 2, r.top, 40);
      }
      closeSheet(); render(); toast(`${clean.emoji || '✓'} ${clean.name} gespeichert`);
    },
  };

  openSheet(() => `
    <div class="sheet-title"><h2>${editing ? 'Bearbeiten' : titles[kind]}</h2><button class="btn sm primary" data-act="save">Speichern</button></div>
    <div class="form">
      ${editing ? '' : `<div class="chips scroll">${presets.map((p, i) => `<button class="chip ${f.name === p.name ? 'on' : ''}" data-act="preset" data-i="${i}">${p.emoji} ${esc(p.name)}</button>`).join('')}</div>`}
      <div class="grid-2" style="grid-template-columns:2fr 1fr">
        <label class="field"><span>Name</span><input data-in="f" data-f="name" value="${esc(f.name)}" placeholder="${kind === 'supp' ? 'z. B. Pre-Workout' : kind === 'drink' ? 'z. B. Wasser' : 'z. B. Pasta'}"></label>
        <label class="field"><span>Uhrzeit</span><input type="time" data-in="f" data-f="time" value="${esc(f.time)}"></label>
      </div>
      <div class="grid-2">
        ${fields.map((k) => `<label class="field"><span>${labels[k]}</span>
          <input ${k === 'dose' ? '' : 'inputmode="decimal"'} data-in="f" data-f="${k}" value="${esc(f[k])}" placeholder="0"></label>`).join('')}
      </div>
      ${kind === 'meal' ? '<button class="btn ghost sm" data-act="calc" style="align-self:flex-start">🧮 kcal aus Makros berechnen</button>' : ''}
      ${kind !== 'meal' && /pre.?workout|koffein|energy|kaffee|espresso/i.test(f.name) ? `<p class="small muted" style="margin:0">💡 Empfehlung: max. ${state.goals.caffeine} mg Koffein pro Tag, Pre-Workout ca. 30–45 min vor dem Training.</p>` : ''}
    </div>`);
}

/* ==========================================================
   VIEW: Kalender
   ========================================================== */
function renderCalendar() {
  const m = ui.calMonth, today = dkey(new Date());
  viewActions = {
    prev: () => { ui.calMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(true); },
    next: () => { ui.calMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(true); },
    day: (el) => openCalendarDay(el.dataset.key),
  };
  const first = startOfWeek(m);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i), k = dkey(d);
    if (i >= 35 && d.getMonth() !== m.getMonth()) break;
    const cls = [d.getMonth() !== m.getMonth() ? 'other' : '', state.visits[k] ? 'visited' : '', state.plan[wIdx(d)] ? 'planned' : '', k === today ? 'today' : ''].join(' ');
    cells.push(`<button class="cal-day ${cls}" style="--i:${i}" data-act="day" data-key="${k}">${d.getDate()}<span class="mini ${state.visits[k] || (state.plan[wIdx(d)] && k >= today) ? '' : 'off'}"></span></button>`);
  }
  const monthVisits = Object.keys(state.visits).filter((k) => { const d = fromKey(k); return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); }).sort();

  return `
    <div class="stats">
      <div class="stat surface"><div class="num" data-count="${weekVisits()}">0</div><div class="lbl">Diese Woche</div></div>
      <div class="stat surface"><div class="num" data-count="${monthVisits.length}">0</div><div class="lbl">${MONTHS[m.getMonth()]}</div></div>
      <div class="stat surface"><div class="num"><span data-count="${weekStreak()}">0</span>🔥</div><div class="lbl">Wochen-Streak</div></div>
    </div>
    <div class="card surface">
      <div class="card-head">
        <button class="icon-btn" data-act="prev" aria-label="Vorheriger Monat">‹</button>
        <h2>${MONTHS[m.getMonth()]} ${m.getFullYear()}</h2>
        <button class="icon-btn" data-act="next" aria-label="Nächster Monat">›</button>
      </div>
      <div class="cal-grid">
        ${DAYS_S.map((d) => `<div class="cal-wd">${d}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="row small muted" style="margin-top:14px;gap:16px;justify-content:center">
        <span>🟢 Im Gym</span><span style="color:#b9adff">◻︎ Geplant</span><span>⚪ Heute</span>
      </div>
    </div>
    <p class="section-label">Trainings im ${MONTHS[m.getMonth()]}</p>
    <div class="list">
      ${monthVisits.reverse().map((k, i) => { const d = fromKey(k), v = state.visits[k]; return `<div class="item surface" style="--i:${i};--c:#3ee6a8" data-act="day" data-key="${k}">
        <div class="emo">✅</div><div class="grow"><div class="title">${esc(v.workout || 'Training')}</div>
        <div class="sub">${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${v.note ? ' · ' + esc(v.note) : ''}</div></div></div>`; }).join('')
        || '<div class="empty"><span class="big">📅</span>Tippe auf einen Tag, um dein Training einzutragen.</div>'}
    </div>
  `;
}

function openCalendarDay(key) {
  const d = fromKey(key), p = planFor(d);
  const v = state.visits[key] ? { ...state.visits[key] } : { workout: p ? p.name : '', note: '' };
  let went = !!state.visits[key];
  const options = [...new Set([...state.plan.filter(Boolean).map((x) => x.name), 'Freies Training', 'Cardio', v.workout].filter(Boolean))];
  const tot = dayTotals(key);

  sheetActions = {
    'ch:went': (el) => { went = el.checked; if (went) Confetti.burst(innerWidth / 2, innerHeight * 0.6, 60); },
    'ch:wo': (el) => { v.workout = el.value; },
    'in:note': (el) => { v.note = el.value; },
    save: () => {
      if (went) state.visits[key] = { workout: v.workout || 'Training', note: v.note || '' };
      else delete state.visits[key];
      save(); closeSheet(); render(); toast(went ? '✅ Training gespeichert' : 'Tag aktualisiert');
    },
    nut: () => { ui.nutDate = key; closeSheet(); go('nutrition'); },
  };
  openSheet(() => `
    <div class="sheet-title"><h2>${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}</h2><button class="btn sm primary" data-act="save">Speichern</button></div>
    <div class="form">
      ${p ? `<div class="card" style="background:rgba(255,255,255,.06);border-radius:18px;padding:14px">
        <div class="small muted">Geplant</div><div style="font-weight:800;font-size:18px;margin:2px 0 8px">${esc(p.name)}</div>
        <div class="chips">${groupChips(p.groups)}</div></div>` : '<p class="muted" style="margin:0">Laut Plan ein Ruhetag 😴</p>'}
      <label class="row setting-row">
        <span class="grow" style="font-weight:700">🏋️ Im Gym gewesen</span>
        <span class="switch"><input type="checkbox" data-ch="went" ${went ? 'checked' : ''}><span></span></span>
      </label>
      <label class="field"><span>Training</span>
        <select data-ch="wo">${options.map((o) => `<option ${o === v.workout ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="field"><span>Notiz</span><textarea rows="3" data-in="note" placeholder="z. B. neuer PR beim Bankdrücken 🎉">${esc(v.note)}</textarea></label>
      <button class="btn ghost" data-act="nut">🥗 Ernährung an diesem Tag · ${round(tot.kcal)} kcal · ${round(tot.protein)} g Protein</button>
    </div>`);
}

/* ==========================================================
   Einstellungen
   ========================================================== */
function setTheme(patch, rerender = true) {
  Object.assign(state.settings.theme, patch);
  applyTheme();
  save();
  haptic();
  if (rerender) rerenderSheet();
}
function appearanceHTML() {
  const t = state.settings.theme;
  const cur = String(t.bg || '').toLowerCase();
  const custom = !BG_PRESETS.some((b) => b.color === cur);
  return `
    <div class="field"><span>Hintergrund</span>
      <div class="swatches">
        ${BG_PRESETS.map((b) => `<button class="swatch ${cur === b.color ? 'on' : ''}" data-act="bg" data-c="${b.color}"><i style="background:${b.color}"></i>${b.name}</button>`).join('')}
        <label class="swatch ${custom ? 'on' : ''}"><i style="background:${custom ? esc(darkEnough(cur)) : 'conic-gradient(#ff5f6d,#ffb547,#d4ff5a,#3ee6a8,#4de1ff,#9d8cff,#ff6fb0,#ff5f6d)'}"></i>Eigene
          <input type="color" data-in="bgc" data-ch="bgc" value="${esc(custom ? cur : '#1a1a2e')}"></label>
      </div>
    </div>
    <div class="field"><span>Akzentfarbe</span>
      <div class="swatches">
        ${ACCENTS.map((a) => `<button class="swatch ${t.accent === a.id ? 'on' : ''}" data-act="acc" data-id="${a.id}"><i style="background:linear-gradient(135deg,${a.a},${a.b})"></i>${a.name}</button>`).join('')}
      </div>
    </div>
    <label class="row setting-row">
      <span class="grow"><b>Liquid Glass</b><br><span class="small muted">${LiquidGlass.supported ? 'Echtzeit-Lichtbrechung an den Glaskanten der Menüs' : 'Auf diesem Browser nur als Milchglas verfügbar'}</span></span>
      <span class="switch"><input type="checkbox" data-ch="refr" ${t.refraction !== false && LiquidGlass.supported ? 'checked' : ''} ${LiquidGlass.supported ? '' : 'disabled'}><span></span></span>
    </label>
    <label class="row setting-row">
      <span class="grow"><b>Animierter Hintergrund</b><br><span class="small muted">Farbverlauf in Bewegung · braucht mehr Akku</span></span>
      <span class="switch"><input type="checkbox" data-ch="anim" ${t.animatedBg ? 'checked' : ''}><span></span></span>
    </label>`;
}
function openSettings() {
  const g = { ...state.goals }, s = { ...state.settings };
  sheetActions = {
    'in:g': (el) => { g[el.dataset.f] = num(el.value); },
    'in:s': (el) => { s[el.dataset.f] = el.value; },
    'ch:notify': async (el) => {
      if (el.checked) { const ok = await enableNotifications(true); s.notify = ok; el.checked = ok; }
      else { s.notify = false; }
    },
    bg: (el) => setTheme({ bg: el.dataset.c }),
    acc: (el) => setTheme({ accent: el.dataset.id }),
    'in:bgc': (el) => setTheme({ bg: el.value }, false),
    'ch:bgc': () => rerenderSheet(),
    'ch:refr': (el) => setTheme({ refraction: el.checked }, false),
    'ch:anim': (el) => setTheme({ animatedBg: el.checked }, false),
    test: () => sendReminder(true),
    ics: () => exportICS(),
    export: () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      download(blob, `glassgym-backup-${dkey(new Date())}.json`);
    },
    import: () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const data = JSON.parse(await inp.files[0].text());
          if (!data.plan) throw new Error();
          state = hydrate(data); applyTheme(); save(); closeSheet(); render(true); toast('✅ Backup geladen');
        } catch (_) { toast('❌ Ungültige Datei'); }
      };
      inp.click();
    },
    reset: () => {
      if (!confirm('Wirklich ALLE Daten löschen?')) return;
      state = defaults(); applyTheme(); save(); closeSheet(); render(true); toast('Alles zurückgesetzt');
    },
    save: () => {
      state.goals = g;
      const { theme: _theme, ...rest } = s; // Darstellung wird live gespeichert
      state.settings = { ...state.settings, ...rest, notify: state.settings.notify || s.notify };
      if (!s.notify) state.settings.notify = false;
      save(); closeSheet(); render(); toast('💾 Gespeichert');
      checkReminder();
    },
  };
  openSheet(() => `
    <div class="sheet-title"><h2>Einstellungen</h2><button class="btn sm primary" data-act="save">Fertig</button></div>
    <div class="form">
      <label class="field"><span>Dein Name</span><input data-in="s" data-f="name" value="${esc(s.name)}" placeholder="optional"></label>

      <p class="section-label" style="margin:6px 0 0">🎨 Darstellung</p>
      ${appearanceHTML()}

      <p class="section-label" style="margin:6px 0 0">🎯 Tagesziele</p>
      <div class="grid-2">
        <label class="field"><span>Kalorien</span><input inputmode="numeric" data-in="g" data-f="kcal" value="${g.kcal}"></label>
        <label class="field"><span>Protein (g)</span><input inputmode="numeric" data-in="g" data-f="protein" value="${g.protein}"></label>
        <label class="field"><span>Kohlenhydrate (g)</span><input inputmode="numeric" data-in="g" data-f="carbs" value="${g.carbs}"></label>
        <label class="field"><span>Fett (g)</span><input inputmode="numeric" data-in="g" data-f="fat" value="${g.fat}"></label>
        <label class="field"><span>Flüssigkeit (ml)</span><input inputmode="numeric" data-in="g" data-f="water" value="${g.water}"></label>
        <label class="field"><span>Koffein max (mg)</span><input inputmode="numeric" data-in="g" data-f="caffeine" value="${g.caffeine}"></label>
      </div>

      <p class="section-label" style="margin:6px 0 0">🔔 Erinnerungen</p>
      <label class="row setting-row">
        <span class="grow"><b>Push-Benachrichtigungen</b><br><span class="small muted">Täglich: was heute & die nächsten Tage ansteht</span></span>
        <span class="switch"><input type="checkbox" data-ch="notify" ${state.settings.notify ? 'checked' : ''}><span></span></span>
      </label>
      <div class="grid-2">
        <label class="field"><span>Erinnerung um</span><input type="time" data-in="s" data-f="notifyTime" value="${esc(s.notifyTime)}"></label>
        <label class="field"><span>Trainingszeit</span><input type="time" data-in="s" data-f="trainTime" value="${esc(s.trainTime)}"></label>
      </div>
      <button class="btn ghost" data-act="test">🔔 Test-Benachrichtigung senden</button>
      <button class="btn ghost" data-act="ics">📆 Plan in Kalender-App exportieren (.ics)</button>
      <p class="small muted" style="margin:0">Tipp: Der Kalender-Export legt wöchentliche Termine mit Erinnerungen (1 Tag & 2 Std. vorher) an – das funktioniert auch, wenn die App geschlossen ist.</p>

      <p class="section-label" style="margin:6px 0 0">💾 Daten</p>
      <div class="grid-2">
        <button class="btn ghost" data-act="export">⬇️ Backup</button>
        <button class="btn ghost" data-act="import">⬆️ Import</button>
      </div>
      <button class="btn danger" data-act="reset">Alle Daten löschen</button>
      <p class="small muted" style="text-align:center;margin:4px 0 0">Alle Daten bleiben lokal auf deinem Gerät.</p>
    </div>`);
}
$('#settings-btn').addEventListener('click', openSettings);

/* ==========================================================
   Benachrichtigungen & Service Worker
   ========================================================== */
let swReg = null;
const NATIVE = window.GGNative || null; // gesetzt in der Android-App (Capacitor)
function reminderText(base = new Date()) {
  const lines = [];
  for (let n = 0; n < 3; n++) {
    const d = addDays(base, n), p = planFor(d);
    const label = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : DAYS[wIdx(d)];
    lines.push(`${label}: ${p ? `${p.name} (${(p.groups || []).map((x) => G[x]?.name).filter(Boolean).join(', ')})` : 'Ruhetag 😴'}`);
  }
  return lines.join('\n');
}
const reminderTitle = (d = new Date()) => { const p = planFor(d); return p ? `🏋️ Heute: ${p.name}` : '😴 Heute ist Ruhetag'; };

/* --- Android: echte, vom System geplante Benachrichtigungen (auch bei geschlossener App) --- */
const NATIVE_IDS = Array.from({ length: 14 }, (_, n) => 100 + n);
async function nativePermission(ask) {
  const LN = NATIVE.LocalNotifications;
  let p = await LN.checkPermissions();
  if (p.display !== 'granted' && ask) p = await LN.requestPermissions();
  if (p.display !== 'granted') return false;
  try {
    await LN.createChannel({ id: 'training', name: 'Training-Erinnerungen', description: 'Welches Training ansteht', importance: 4, vibration: true, lights: true, lightColor: '#8B7BFF' });
  } catch (_) {}
  return true;
}
async function scheduleNative() {
  if (!NATIVE) return;
  const LN = NATIVE.LocalNotifications;
  try {
    await LN.cancel({ notifications: NATIVE_IDS.map((id) => ({ id })) });
    if (!state.settings.notify || !(await nativePermission(false))) return;
    const [hh, mm] = (state.settings.notifyTime || '08:00').split(':').map(Number);
    const now = Date.now(), notifications = [];
    NATIVE_IDS.forEach((id, n) => {
      const at = addDays(new Date(), n); at.setHours(hh, mm, 0, 0);
      if (at.getTime() <= now + 30 * 1000) return;
      notifications.push({ id, channelId: 'training', title: reminderTitle(at), body: reminderText(at), largeBody: reminderText(at), schedule: { at, allowWhileIdle: true } });
    });
    if (notifications.length) await LN.schedule({ notifications });
  } catch (err) { console.warn('Erinnerungen konnten nicht geplant werden', err); }
}
let nativeTimer;
const scheduleNativeSoon = () => { if (NATIVE) { clearTimeout(nativeTimer); nativeTimer = setTimeout(scheduleNative, 800); } };

async function showNotification(title, body) {
  if (NATIVE) return NATIVE.LocalNotifications.schedule({ notifications: [{ id: 99, channelId: 'training', title, body, largeBody: body }] });
  const opts = { body, icon: 'icon.svg', badge: 'icon.svg', tag: 'glassgym-daily', renotify: true, vibrate: [60, 40, 60] };
  if (swReg && swReg.showNotification) return swReg.showNotification(title, opts);
  return new Notification(title, opts);
}
async function sendReminder(test = false) {
  if (NATIVE) {
    if (!(await nativePermission(true))) return toast('Benachrichtigungen sind in den Android-Einstellungen blockiert');
  } else {
    if (!('Notification' in window)) return toast('Benachrichtigungen werden hier nicht unterstützt');
    if (Notification.permission !== 'granted') {
      const ok = await enableNotifications(true);
      if (!ok) return;
    }
  }
  await showNotification(reminderTitle(), reminderText());
  if (test) toast('🔔 Benachrichtigung gesendet');
}
async function enableNotifications(silent = false) {
  if (NATIVE) {
    if (!(await nativePermission(true))) { toast('Benachrichtigungen sind in den Android-Einstellungen blockiert'); return false; }
  } else {
    if (!('Notification' in window)) {
      toast('📱 Zum Homescreen hinzufügen, um Mitteilungen zu erhalten');
      return false;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Benachrichtigungen wurden blockiert'); return false; }
  }
  state.settings.notify = true;
  save();
  try {
    if (swReg && 'periodicSync' in swReg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (st.state === 'granted') await swReg.periodicSync.register('glassgym-reminder', { minInterval: 4 * 60 * 60 * 1000 });
    }
  } catch (_) {}
  if (!silent) { toast('🔔 Erinnerungen aktiviert'); render(); }
  return true;
}
function checkReminder() {
  const s = state.settings;
  if (NATIVE) return; // Android plant die Benachrichtigungen selbst (scheduleNative)
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const key = dkey(new Date());
  if (s.lastNotified === key) return;
  if (nowTime() < s.notifyTime) return;
  s.lastNotified = key; save();
  sendReminder();
}
function syncServiceWorker() {
  scheduleNativeSoon();
  const target = (swReg && swReg.active) || (navigator.serviceWorker && navigator.serviceWorker.controller);
  if (target) target.postMessage({ type: 'state', state: { plan: state.plan, settings: state.settings, groups: Object.fromEntries(GROUPS.map((g) => [g.id, g.name])) } });
}
if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    swReg = reg;
    return navigator.serviceWorker.ready;
  }).then((reg) => { swReg = reg; syncServiceWorker(); checkReminder(); }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'notified') { state.settings.lastNotified = e.data.key; save(); }
  });
}
setInterval(checkReminder, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminder(); scheduleNativeSoon(); if (ui.tab === 'home') render(); } });

/* Android: Zurück-Taste schließt erst das Sheet, dann geht es zu „Heute“, dann raus */
if (NATIVE) {
  NATIVE.App.addListener('backButton', () => {
    if (sheet.classList.contains('open')) closeSheet();
    else if (ui.tab !== 'home') go('home');
    else NATIVE.App.exitApp();
  });
}

/* ---------- Dateien speichern / teilen ---------- */
async function download(blob, name) {
  if (NATIVE) {
    try {
      const { Filesystem, Directory, Encoding, Share } = NATIVE;
      const res = await Filesystem.writeFile({ path: name, data: await blob.text(), directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: name, url: res.uri, dialogTitle: 'Öffnen oder teilen mit …' });
    } catch (err) {
      if (!/cancel/i.test(String(err && err.message))) toast('❌ Datei konnte nicht geteilt werden');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportICS() {
  if (!plannedCount()) return toast('Erstelle zuerst einen Plan');
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const [hh, mm] = (state.settings.trainTime || '18:00').split(':');
  const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GlassGym//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:GlassGym Training'];
  state.plan.forEach((p, i) => {
    if (!p) return;
    let d = new Date(); d.setHours(0, 0, 0, 0);
    while (wIdx(d) !== i) d = addDays(d, 1);
    const ds = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${hh}${mm}00`;
    const desc = p.exercises.map((x) => `• ${x.name}${exMeta(x) ? ` – ${exMeta(x)}` : ''}${x.note ? ` (${x.note})` : ''}`).join('\n');
    lines.push('BEGIN:VEVENT', `UID:glassgym-${i}-${uid()}@glassgym`, `DTSTAMP:${stamp}`, `DTSTART:${ds}`, 'DURATION:PT1H30M',
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[i]}`, `SUMMARY:${icsEsc('🏋️ ' + p.name)}`, `DESCRIPTION:${icsEsc(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('Morgen: ' + p.name)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('In 2 Std.: ' + p.name)}`, 'TRIGGER:-PT2H', 'END:VALARM',
      'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), 'glassgym-trainingsplan.ics');
  toast('📆 Kalenderdatei erstellt');
}

/* ---------- Start ---------- */
// Beim ersten Start mit leerem Plan: deinen eigenen Plan übernehmen
if (!state.settings.seeded) {
  const mine = window.PLAN_TEMPLATES.find((t) => t.id === 'mine');
  if (mine && plannedCount() === 0) state.plan = templatePlan(mine);
  state.settings.seeded = true;
  save();
}

// Liquid Glass nur auf den Menüs
LiquidGlass.register($('#tabbar'), { bezel: 18, strength: 24, blur: 3, saturate: 1.8, chroma: true });
LiquidGlass.register($('#settings-btn'), { bezel: 16, strength: 26, blur: 0.8, chroma: true });
LiquidGlass.register($('#navbar'), { bezel: 14, strength: 22, blur: 3, chroma: true });
LiquidGlass.register($('#toast'), { bezel: 14, strength: 24, blur: 4, chroma: true });
LiquidGlass.register(sheet, { bezel: 26, strength: 44, blur: 18, saturate: 1.5, chroma: false, openBottom: true });
applyTheme();

// Glas-Kopfzeile erscheint beim Scrollen
(() => {
  const nav = $('#navbar');
  let shown = false, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const s = scrollY > 72;
      if (s !== shown) { shown = s; nav.classList.toggle('show', s); }
    });
  }, { passive: true });
  nav.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

// Tab-Leiste: Glas gibt beim Berühren federnd nach
(() => {
  const bar = $('#tabbar');
  const up = () => bar.classList.remove('pressed');
  bar.addEventListener('pointerdown', () => bar.classList.add('pressed'));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => bar.addEventListener(ev, up));
})();

render(true);
requestAnimationFrame(moveBlob);
checkReminder();
scheduleNativeSoon();
})();
