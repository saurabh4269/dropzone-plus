// DropZone+ service worker: offline app shell. Ring/API calls always go to the network.
const VERSION = 'dz-app-v4';
const SHELL = [
  './', './index.html', './app.css', './main.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  '../core/zone.js', '../core/engine.js', '../core/advisory.js', '../core/alexa.js', '../core/petdoor.js', '../core/changes.js',
  '../scene.js', '../detector.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || /\/(api|auth|webhooks)\//.test(url.pathname)) return; // network only
  // stale-while-revalidate for the shell
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./#/home'))));
});
