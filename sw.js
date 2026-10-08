// FoxyMind Phone service worker: keeps the app shell for offline starts, shows push notifications,
// and opens the right session when one is tapped. The Mac's API (another origin) is never touched.
const VERSION = 'fm-phone-v6c';
const SHELL = [
  './',
  './index.html',
  './app.css?v=6',
  './app.js?v=6',
  './md.js?v=6',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './badge-72.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // one missing file must not stop the install
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fm-phone-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network first (revalidated, so an update lands on the next open), the cache when offline.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the Mac's API, ntfy: straight to the network
  if (url.pathname.includes('/phone/api/')) return; // (the dev mock serves both from one origin)
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      const hit = req.mode === 'navigate'
        ? (await cache.match('./index.html')) || (await cache.match('./'))
        : await cache.match(req, { ignoreSearch: false }) || await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw e;
    }
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'FoxyMind';
  const tag = d.tag || (d.sessionId ? `s:${d.sessionId}` : 'foxymind');
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'A session is waiting for you',
    tag,
    renotify: true,
    icon: './icon-192.png',
    badge: './badge-72.png',
    timestamp: Date.now(),
    data: { sessionId: d.sessionId || null, color: d.color || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.sessionId;
  const target = new URL(id ? `./#/s/${encodeURIComponent(id)}` : './#/', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try { await c.focus(); } catch (e) { /* not allowed: fine */ }
      c.postMessage({ type: 'open', sessionId: id || null });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
