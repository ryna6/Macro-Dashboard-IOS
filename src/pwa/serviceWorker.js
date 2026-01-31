// src/pwa/serviceWorker.js
const CACHE_NAME = 'macro-dashboard-shell-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
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
      await Promise.all(
        keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache Finnhub (tokenized, rate-limited, and you already have localStorage caching)
  if (url.hostname.includes('finnhub.io')) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigation: network-first fallback to cache
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

  // Same-origin assets: cache-first
  if (url.origin === self.location.origin && req.method === 'GET') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(req);
        if (hit) return hit;

        const fresh = await fetch(req);
        // Cache JS/CSS/images/fonts
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
