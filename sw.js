/* GlassGym Service Worker – Offline-Cache & Erinnerungen */
const CACHE = 'glassgym-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'exercises.js', 'manifest.json', 'icon.svg'];
const STATE_URL = './__glassgym_state';
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network-first, damit Updates sofort ankommen; offline aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// App schickt Plan + Einstellungen, damit Erinnerungen auch im Hintergrund möglich sind
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'state') {
    e.waitUntil(caches.open(CACHE).then((c) => c.put(STATE_URL, new Response(JSON.stringify(e.data.state)))));
  }
});

const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const wIdx = (d) => (d.getDay() + 6) % 7;

async function backgroundReminder() {
  const c = await caches.open(CACHE);
  const res = await c.match(STATE_URL);
  if (!res) return;
  const st = await res.json();
  const s = st.settings || {};
  if (!s.notify) return;
  const now = new Date(), key = dkey(now);
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (s.lastNotified === key || t < (s.notifyTime || '08:00')) return;
  const lines = [];
  for (let n = 0; n < 3; n++) {
    const d = new Date(now); d.setDate(d.getDate() + n);
    const p = st.plan[wIdx(d)];
    const label = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : DAYS[wIdx(d)];
    lines.push(`${label}: ${p ? `${p.name} (${(p.groups || []).map((g) => (st.groups || {})[g] || g).join(', ')})` : 'Ruhetag 😴'}`);
  }
  const p = st.plan[wIdx(now)];
  await self.registration.showNotification(p ? `🏋️ Heute: ${p.name}` : '😴 Heute ist Ruhetag', {
    body: lines.join('\n'), icon: 'icon.svg', badge: 'icon.svg', tag: 'glassgym-daily',
  });
  s.lastNotified = key;
  await c.put(STATE_URL, new Response(JSON.stringify(st)));
  const clients = await self.clients.matchAll();
  clients.forEach((cl) => cl.postMessage({ type: 'notified', key }));
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'glassgym-reminder') e.waitUntil(backgroundReminder());
});

// Echte Web-Push-Nachrichten (falls später ein Push-Server angebunden wird)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(data.title
    ? self.registration.showNotification(data.title, { body: data.body || '', icon: 'icon.svg' })
    : backgroundReminder());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
