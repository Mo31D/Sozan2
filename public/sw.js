const CACHE = 'sozan2-shell-v2';
const CORE = ['/manifest.webmanifest', '/icon.svg'];

async function cacheProductionShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error('SHELL_FETCH_FAILED');
  const html = await response.clone().text();
  await cache.put('/', response.clone());
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/gu)].map((match) => match[1]);
  for (const path of [...new Set(assets)]) {
    try {
      const asset = await fetch(path, { cache: 'no-store' });
      if (asset.ok) await cache.put(path, asset);
    } catch {
      // A non-critical asset can refresh on the next online navigation.
    }
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(cacheProductionShell());
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
          event.waitUntil(cacheProductionShell().catch(() => undefined));
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
