/* Service worker de VFR Chile: app disponible sin conexión + caché de teselas de mapa vistas. */
const VERSION = 'vfrchile-v1.0.4';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'data/aerodromos.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
const CDN = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];
const TILES = 'vfrchile-tiles', TILE_MAX = 3000;
const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.opentopomap.org', 'server.arcgisonline.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - TILE_MAX; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Teselas: caché primero (quedan disponibles sin conexión)
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith((async () => {
      const c = await caches.open(TILES); const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok && r.type === 'cors') { c.put(req, r.clone()); if (Math.random() < 0.02) trimTiles(); }
        return r;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  // Meteorología: siempre red (la app guarda la última consulta por su cuenta)
  if (/aviationweather\.gov|open-meteo\.com/.test(url.hostname)) return;

  // App y librerías: caché con actualización en segundo plano
  if (url.origin === location.origin || CDN.includes(req.url)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const r = await net;
      if (r) return r;
      if (req.mode === 'navigate') return (await c.match('index.html')) || new Response('Sin conexión', { status: 503 });
      return new Response('', { status: 504 });
    })());
  }
});
