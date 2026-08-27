/* ============================================================
   Service Worker — cache offline + aggiornamenti automatici.
   VERSIONE va incrementata ad ogni modifica per forzare
   l'aggiornamento su tutti i dispositivi.
   ============================================================ */

const VERSIONE = 'v1.6.1';

/* Solo file locali + librerie essenziali (il resto viene scaricato
   a runtime e cachato automaticamente) */
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://unpkg.com/topojson-client@3/dist/topojson-client.min.js',
  'https://unpkg.com/globe.gl/dist/globe.gl.min.js',
  'https://unpkg.com/world-atlas@2.0.2/countries-50m.json',
  'https://cdn.jsdelivr.net/npm/world-countries@5/dist/countries-unescaped.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSIONE);
    await Promise.allSettled(SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (err) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const chiavi = await caches.keys();
    await Promise.all(chiavi.filter(k => k !== VERSIONE).map(k => caches.delete(k)));
    await self.clients.claim();
    try {
      const clients = await self.clients.matchAll();
      for (const c of clients) {
        if (c.type === 'window') {
          try { await c.navigate(c.url); } catch (err) {}
        }
      }
    } catch (err) {}
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
      throw err;
    }
  })());
});
