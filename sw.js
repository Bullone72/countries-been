/* ============================================================
   Service Worker — aggiornamento garantito.
   Strategia "network-first" per i file dell'app: ogni volta che
   apri (o riapri) l'app, scarica SEMPRE l'ultima versione da
   GitHub. Solo le librerie statiche sono in cache per non
   scaricarle di nuovo. Chiudere e riaprire = aggiornata.
   ============================================================ */

const VERSIONE = 'v1.13.2';

/* librerie esterne pesanti: messe in cache (non ri-scaricate ad ogni avvio) */
const STATICHE = [
  'https://unpkg.com/topojson-client@3/dist/topojson-client.min.js',
  'https://unpkg.com/d3-array@3/dist/d3-array.min.js',
  'https://unpkg.com/d3-geo@3/dist/d3-geo.min.js',
  'https://unpkg.com/world-atlas@2.0.2/countries-110m.json',
  'https://cdn.jsdelivr.net/npm/world-countries@5/dist/countries-unescaped.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open('stat-cache');
    await Promise.allSettled(STATICHE.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (err) {}
    }));
    self.skipWaiting();   // prende subito il controllo della pagina
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
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
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  /* librerie statiche: dalla cache (offline-friendly, non cambiano) */
  if (STATICHE.includes(url)) {
    e.respondWith((async () => {
      const cache = await caches.open('stat-cache');
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(url, res.clone());
      return res;
    })());
    return;
  }

  /* file dell'app (html, css, js, icone): NETWORK-FIRST -> sempre l'ultima
     versione da GitHub; la cache serve solo se sei offline */
  e.respondWith((async () => {
    const cache = await caches.open('app-live');
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res && res.ok) {
        cache.put(url, res.clone());
        return res;
      }
    } catch (err) {}
    const hit = await cache.match(url);
    if (hit) return hit;
    return fetch(req);
  })());
});
