// Keeps the counter app shell available without internet. API calls always go to the network;
// the app itself saves the queue and pending actions on the device.
const CACHE = 'counter-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.add('/agent/'))); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/agent')) return;
  // Network first, cached copy when offline.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/agent/' : e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request.mode === 'navigate' ? '/agent/' : e.request).then((m) => m || Response.error())));
});
