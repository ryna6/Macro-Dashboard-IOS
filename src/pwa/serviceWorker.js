const CACHE_NAME = 'macro-dashboard-shell-v2'; // bump version

const PRECACHE_URLS = [
  '/',
  '/index.html',
  // '/manifest.json',  // <- remove this
  '/icons/Icon-192x192.png',
  '/icons/Icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // never cache Finnhub
  if (url.hostname.includes('finnhub.io')) {
    event.respondWith(fetch(req));
    return;
  }

  // ✅ Always fetch manifest fresh (fallback to cache only if offline)
  if (url.origin === self.location.origin && url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(req)) || Response.error();
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch (_) {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('/index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  if (url.origin === self.location.origin && req.method === 'GET') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(req);
        if (hit) return hit;

        const fresh = await fetch(req);
        const ct = fresh.headers.get('content-type') || '';
        if (
          ct.includes('text/css') ||
          ct.includes('javascript') ||
          ct.includes('image/') ||
          ct.includes('font/')
        ) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      })()
    );
  }
});
