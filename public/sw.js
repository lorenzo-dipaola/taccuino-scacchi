// Offline cache: network-first for the app shell, cache-first for the engine.
const CACHE = 'taccuino-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isEngine = url.pathname.includes('/engine/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isEngine) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request)) || (await cache.match('./index.html')) || Response.error();
    }
  })());
});
