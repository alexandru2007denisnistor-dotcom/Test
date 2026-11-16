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
const defaults = () => ({
  plan: [null, null, null, null, null, null, null],
  visits: {},
  nutrition: {},
  goals: { kcal: 2600, protein: 160, carbs: 300, fat: 80, water: 3000, caffeine: 400 },
  settings: { name: '', notify: false, notifyTime: '08:00', trainTime: '18:00', lastNotified: '' },
});
let state;
try {
  const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
  const d = defaults();
  state = raw ? { ...d, ...raw, goals: { ...d.goals, ...raw.goals }, settings: { ...d.settings, ...raw.settings } } : d;
} catch (_) { state = defaults(); }

const ui = { tab: 'home', nutDate: dkey(new Date()), calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), exGroup: 'brust', exQuery: '' };

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  syncServiceWorker();
}

/* ==========================================================
   Echtzeit Liquid-Hintergrund (Canvas, 60 fps)
   ========================================================== */
const Bg = (() => {
  const cv = $('#bg');
  const ctx = cv.getContext('2d');
  const SCALE = 0.18; // klein rendern → weich hochskaliert = flüssiger Blur gratis
  const palettes = {
    home:      [[139, 123, 255], [255, 95, 162], [77, 225, 255], [255, 181, 71]],
    plan:      [[124, 108, 255], [77, 160, 255], [255, 95, 162], [62, 230, 168]],
    exercises: [[255, 95, 120], [255, 160, 70], [160, 110, 255], [255, 95, 200]],
    nutrition: [[62, 230, 168], [34, 184, 255], [195, 247, 90], [139, 123, 255]],
    calendar:  [[77, 225, 255], [139, 123, 255], [255, 95, 162], [62, 230, 168]],
  };
  const blobs = Array.from({ length: 6 }, (_, i) => ({
    x: Math.random(), y: Math.random(), r: 0.35 + Math.random() * 0.25,
    sx: 0.00007 + Math.random() * 0.00012, sy: 0.00006 + Math.random() * 0.0001,
    ph: Math.random() * 10, col: [...palettes.home[i % 4]], target: palettes.home[i % 4],
  }));
  const pointer = { x: 0.5, y: 0.3, tx: 0.5, ty: 0.3 };
  let w, h, tilt = { x: 0, y: 0 };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    w = cv.width = Math.max(40, Math.round(innerWidth * SCALE));
    h = cv.height = Math.max(40, Math.round(innerHeight * SCALE));
  }
  addEventListener('resize', resize);
  resize();
  addEventListener('pointermove', (e) => { pointer.tx = e.clientX / innerWidth; pointer.ty = e.clientY / innerHeight; }, { passive: true });
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    tilt.x = Math.max(-1, Math.min(1, e.gamma / 45));
    tilt.y = Math.max(-1, Math.min(1, (e.beta - 45) / 45));
  });

  let kick = 0;
  function frame(t) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    kick *= 0.95;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0b0820';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    blobs.forEach((b, i) => {
      for (let c = 0; c < 3; c++) b.col[c] += (b.target[c] - b.col[c]) * 0.03;
      let x = 0.5 + Math.sin(t * b.sx + b.ph) * 0.42 + tilt.x * 0.08;
      let y = 0.5 + Math.cos(t * b.sy + b.ph * 1.3) * 0.42 + tilt.y * 0.08;
      if (i === 0) { x = x * 0.45 + pointer.x * 0.55; y = y * 0.45 + pointer.y * 0.55; }
      const r = (b.r + Math.sin(t * 0.0006 + i) * 0.05 + kick * 0.15) * Math.max(w, h);
      const [cr, cg, cb] = b.col.map(Math.round);
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0.45)`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.18)`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setTheme(name) {
      const p = palettes[name] || palettes.home;
      blobs.forEach((b, i) => { b.target = p[(i + 1) % 4]; });
    },
    pulse() { kick = 1; },
  };
})();

/* ---------- Spiegelungen auf Glas folgen dem Finger ---------- */
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest && e.target.closest('.glass');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/* ==========================================================
   Konfetti
   ========================================================== */
const Confetti = (() => {
  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  let parts = [], running = false;
  const colors = ['#9d8cff', '#ff6fb0', '#3ee6a8', '#4de1ff', '#ffb547', '#ffffff'];
  function size() { const d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  addEventListener('resize', size); size();
  function burst(x = innerWidth / 2, y = innerHeight / 2, n = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 8, c: colors[i % colors.length], life: 1, round: Math.random() < 0.3 });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.009;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
    if (parts.length) requestAnimationFrame(tick); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
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
  const d = new Date();
  $('#today-label').textContent = `${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  viewActions = {};
  const html = { home: renderHome, plan: renderPlan, exercises: renderExercises, nutrition: renderNutrition, calendar: renderCalendar }[ui.tab]();
  view.innerHTML = html;
  [...view.children].forEach((c, i) => c.style.setProperty('--i', i));
  if (animate) { view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter'); }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('[data-offset]', view).forEach((el) => el.style.strokeDashoffset = el.dataset.offset);
    $$('[data-width]', view).forEach((el) => el.style.width = el.dataset.width);
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
    return `<div class="item" data-act="showDay" data-day="${wIdx(d)}" style="--i:${i};--c:${p ? '#9d8cff' : '#555'}">
      <div class="emo">${p ? '🏋️' : '😴'}</div>
      <div class="grow"><div class="title">${label} · ${p ? esc(p.name) : 'Ruhetag'}</div>
      <div class="sub">${p ? (p.groups || []).map((x) => G[x]?.name).filter(Boolean).join(', ') + ` · ${p.exercises.length} Übungen` : 'Regeneration ist Teil des Trainings'}</div></div>
      <span class="muted">›</span></div>`;
  }).join('');

  const preTaken = tot.entries.find((e) => /pre.?workout/i.test(e.name));

  return `
  <div class="hero glass">
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
          `<div class="small"><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.sets)}×${esc(x.reps)}${x.weight ? ` · ${esc(x.weight)} kg` : ''}</span></div>`).join('')}
          ${plan.exercises.length > 4 ? `<div class="small muted">+ ${plan.exercises.length - 4} weitere</div>` : ''}</div>` : '<p class="muted" style="margin-top:0">Gönn deinen Muskeln Pause – sie wachsen in der Regeneration.</p>'}
      <div class="row">
        <button class="btn ${done ? 'ghost' : 'green'} grow" data-act="done">${done ? '↺ Rückgängig' : '✓ Im Gym gewesen'}</button>
        <button class="btn ghost" data-act="goPlan">Plan</button>
      </div>` : `
      <div class="day-name">Los geht’s! 🚀</div>
      <p class="muted" style="margin-top:0">Erstelle deinen Trainingsplan – mit fertigen Splits oder komplett individuell.</p>
      <button class="btn primary block" data-act="goPlan">Trainingsplan erstellen</button>`}
  </div>

  <div class="card glass">
    <div class="card-head"><h2>Diese Woche</h2><span class="badge">${weekVisits()} / ${plannedCount() || '–'} Trainings</span></div>
    <div class="week-strip">${strip}</div>
  </div>

  <div class="card glass">
    <div class="card-head"><h2>Ernährung heute</h2><button class="btn sm ghost" data-act="goNut">Details ›</button></div>
    <div class="rings">
      ${ring(round(tot.kcal), g.kcal, '#ff6fb0', 'kcal')}
      ${ring(round(tot.protein), g.protein, '#9d8cff', 'Protein', ' g')}
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

  ${!state.settings.notify ? `<div class="card glass row">
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
        <div class="emo" style="--c:${G[x.group]?.color || '#9d8cff'}">${G[x.group]?.emoji || '🏋️'}</div>
        <div class="grow"><div class="title">${esc(x.name)}</div><div class="sub">${esc(x.sets)} Sätze × ${esc(x.reps)}${x.weight ? ` · ${esc(x.weight)} kg` : ''}</div></div></div>`).join('')
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
    <div class="day-card glass ${p ? '' : 'rest'} ${i === ti ? 'today' : ''}" data-act="edit" data-day="${i}">
      <div class="dn">${DAYS_S[i]}</div>
      <div class="grow">
        <div class="title" style="font-weight:800;font-size:17px">${p ? esc(p.name) : 'Ruhetag'}</div>
        ${p ? `<div class="chips" style="margin-top:6px">${groupChips(p.groups)}</div>
          <div class="sub small muted" style="margin-top:6px">${p.exercises.length} Übungen · ${p.exercises.reduce((a, x) => a + num(x.sets), 0)} Sätze</div>`
          : '<div class="sub small muted">Tippen zum Planen</div>'}
      </div>
      <span class="muted" style="font-size:20px">›</span>
    </div>`).join('');

  return `
    <p class="section-label">Vorlagen</p>
    <div class="chips scroll">
      ${window.PLAN_TEMPLATES.map((t) => `<button class="card glass" data-act="tpl" data-tpl="${t.id}" style="min-width:200px;text-align:left;border-radius:22px">
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
const toPlanEx = (e, gid) => ({ id: uid(), name: e.name, group: gid, sets: e.sets, reps: e.reps, weight: '' });

function applyTemplate(id) {
  const t = window.PLAN_TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  if (plannedCount() && !confirm(`Aktuellen Plan durch „${t.name}“ ersetzen?`)) return;
  const seen = {};
  state.plan = t.days.map((d) => {
    if (!d) return null;
    seen[d.name] = (seen[d.name] || 0);
    const occ = seen[d.name]++;
    return { name: d.name, groups: [...d.groups], exercises: pickExercises(d.groups, d.groups.length > 3 ? 1 : 2, occ) };
  });
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
      if (n && n.trim()) { draft.exercises.push({ id: uid(), name: n.trim(), group: draft.groups[0] || '', sets: 3, reps: '10', weight: '' }); rerenderSheet(); }
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
      <label class="row card" style="background:rgba(255,255,255,.06);padding:12px 14px;border-radius:18px">
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
        ${draft.exercises.map((x, k) => `<div class="ex-row" style="animation-delay:${k * 30}ms">
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
    <div class="item glass" style="--i:${k};--c:${G[e.group].color};align-items:flex-start" data-act="tip">
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
      <div class="emo" style="--c:${p ? '#9d8cff' : '#555'}">${DAYS_S[i]}</div>
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
    <div class="bar-track"><div class="bar-fill" style="--c1:${c1};--c2:${c2}" data-width="${Math.min(100, goal ? val / goal * 100 : 0)}%"></div></div></div>`;
  const kinds = { meal: '🍽️ Mahlzeit', drink: '🥤 Getränk', supp: '💊 Supplement' };
  const sorted = [...tot.entries].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const pre = tot.entries.filter((e) => /pre.?workout/i.test(e.name));

  return `
    <div class="row">
      <button class="icon-btn glass" data-act="prev" aria-label="Vorheriger Tag">‹</button>
      <button class="btn ghost grow" data-act="today">${isToday ? 'Heute' : `${DAYS[wIdx(d)]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`}</button>
      <button class="icon-btn glass" data-act="next" aria-label="Nächster Tag">›</button>
    </div>
    <div class="card glass">
      <div class="rings">
        ${ring(round(tot.kcal), g.kcal, '#ff6fb0', 'kcal')}
        ${ring(round(tot.protein), g.protein, '#9d8cff', 'Protein', ' g')}
        ${ring(round(tot.water), g.water, '#4de1ff', 'Flüssigkeit', ' ml')}
        ${ring(round(tot.caffeine), g.caffeine, '#ffb547', 'Koffein', ' mg', true)}
      </div>
    </div>
    <div class="card glass form" style="gap:12px">
      ${bar('🥩 Protein', tot.protein, g.protein, '#9d8cff', '#ff6fb0')}
      ${bar('🍚 Kohlenhydrate', tot.carbs, g.carbs, '#ffb547', '#ff7a59')}
      ${bar('🥑 Fett', tot.fat, g.fat, '#3ee6a8', '#22b8ff')}
    </div>
    ${pre.length ? `<div class="card glass row" style="--i:0">
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
      ${sorted.map((e, k) => `<div class="item glass" style="--i:${k};--c:${e.kind === 'meal' ? '#ff6fb0' : e.kind === 'drink' ? '#4de1ff' : '#ffb547'}" data-act="edit" data-id="${e.id}">
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
      <div class="stat glass"><div class="num" data-count="${weekVisits()}">0</div><div class="lbl">Diese Woche</div></div>
      <div class="stat glass"><div class="num" data-count="${monthVisits.length}">0</div><div class="lbl">${MONTHS[m.getMonth()]}</div></div>
      <div class="stat glass"><div class="num"><span data-count="${weekStreak()}">0</span>🔥</div><div class="lbl">Wochen-Streak</div></div>
    </div>
    <div class="card glass">
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
      ${monthVisits.reverse().map((k, i) => { const d = fromKey(k), v = state.visits[k]; return `<div class="item glass" style="--i:${i};--c:#3ee6a8" data-act="day" data-key="${k}">
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
      <label class="row card" style="background:rgba(255,255,255,.06);padding:12px 14px;border-radius:18px">
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
function openSettings() {
  const g = { ...state.goals }, s = { ...state.settings };
  sheetActions = {
    'in:g': (el) => { g[el.dataset.f] = num(el.value); },
    'in:s': (el) => { s[el.dataset.f] = el.value; },
    'ch:notify': async (el) => {
      if (el.checked) { const ok = await enableNotifications(true); s.notify = ok; el.checked = ok; }
      else { s.notify = false; }
    },
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
          state = { ...defaults(), ...data }; save(); closeSheet(); render(true); toast('✅ Backup geladen');
        } catch (_) { toast('❌ Ungültige Datei'); }
      };
      inp.click();
    },
    reset: () => {
      if (!confirm('Wirklich ALLE Daten löschen?')) return;
      state = defaults(); save(); closeSheet(); render(true); toast('Alles zurückgesetzt');
    },
    save: () => {
      state.goals = g;
      state.settings = { ...state.settings, ...s, notify: state.settings.notify || s.notify };
      if (!s.notify) state.settings.notify = false;
      save(); closeSheet(); render(); toast('💾 Gespeichert');
      checkReminder();
    },
  };
  openSheet(() => `
    <div class="sheet-title"><h2>Einstellungen</h2><button class="btn sm primary" data-act="save">Fertig</button></div>
    <div class="form">
      <label class="field"><span>Dein Name</span><input data-in="s" data-f="name" value="${esc(s.name)}" placeholder="optional"></label>

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
      <label class="row card" style="background:rgba(255,255,255,.06);padding:12px 14px;border-radius:18px">
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
    const desc = p.exercises.map((x) => `• ${x.name} – ${x.sets}×${x.reps}${x.weight ? ` @ ${x.weight} kg` : ''}`).join('\n');
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
render(true);
requestAnimationFrame(moveBlob);
checkReminder();
scheduleNativeSoon();
})();
