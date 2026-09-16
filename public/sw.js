const CACHE = 'sozan2-shell-v1';
const CORE = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put('/', fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) {
      event.waitUntil(fetch(request, { cache: 'no-store' }).then((fresh) => {
        if (fresh.ok) return cache.put(request, fresh.clone());
        return undefined;
      }).catch(() => undefined));
      return cached;
    }
    try {
      const fresh = await fetch(request, { cache: 'no-store' });
      if (fresh.ok) await cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
