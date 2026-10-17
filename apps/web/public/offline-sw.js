// Only the dedicated offline register assets are cached. Never cache API traffic or authenticated pages.
const CACHE = 'pharmacore-offline-register-v1';
const ASSETS = ['/offline-register.html', '/offline-register.js', '/offline-core.mjs'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
