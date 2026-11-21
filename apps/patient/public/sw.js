// Minimal service worker so the app can be installed. It always goes to the network,
// so the live queue and bookings are never stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
