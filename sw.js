/* CacheVisier Service Worker: offline-fähige App-Hülle samt eigener Bibliotheken, Kartenkacheln im Cache, Datei-Empfang über „Teilen“ */
const V = 'cv-shell-v8';
// App-Module (js/), Liste wie im Ordner
const MODULE = ['./js/kern/ausruestung.js', './js/kern/caches.js', './js/kern/formeln.js', './js/kern/geo.js', './js/kern/index.js', './js/kern/reflektor.js', './js/kern/route.js', './js/kern/sonne.js', './js/main.js', './js/ui/ansagen.js', './js/ui/anzeige.js', './js/ui/basis.js', './js/ui/blaetter.js', './js/ui/einstellungen.js', './js/ui/funk.js', './js/ui/import.js', './js/ui/kamera.js', './js/ui/karte.js', './js/ui/ki-auswertung.js', './js/ui/log.js', './js/ui/multi.js', './js/ui/nacht.js', './js/ui/offline.js', './js/ui/peilung.js', './js/ui/sensoren.js', './js/ui/talk.js', './js/ui/tour.js', './js/ui/ziel-routing.js'];
const SHELL = ['./', './index.html', './style.css', './nostr.js', './ki.js', './bcon/codec2.js', './bcon/sprechfunk.js', './bcon/netz.js', './bcon/secp256k1.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...MODULE];
// Bibliotheken liefert die App selbst aus (vendor/, beim Bauen über GitHub Actions); fehlen sie lokal, bricht die Installation nicht ab
const VENDOR = ['./vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/sqljs/sql-wasm.js', './vendor/sqljs/sql-wasm.wasm'];
const CDN = 'cv-cdn-v1', TILES = 'cv-tiles-v1', INBOX = 'cv-inbox', MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).then(() => Promise.allSettled(VENDOR.map(u => c.add(u))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![V, CDN, TILES, INBOX].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const ks = await c.keys();
  for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]);
}
async function cacheFirst(req, name, trim) {
  const c = await caches.open(name); const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (trim && Math.random() < 0.05) trimTiles(); }
  return res;
}
async function networkFirst(req) {
  const c = await caches.open(V);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (e) {
    return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('./index.html') : Response.error());
  }
}
async function shareTarget(req) {
  try {
    const fd = await req.formData(); const c = await caches.open(INBOX);
    for (const f of fd.getAll('files')) {
      if (!f || typeof f === 'string') continue;
      await c.put(new Request('./inbox/' + Date.now() + '_' + encodeURIComponent(f.name || 'datei')), new Response(f));
    }
  } catch (e) { /* nichts zu tun */ }
  return Response.redirect('./?share=1', 303);
}

self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method === 'POST' && u.origin === location.origin && u.pathname.endsWith('/share-target')) return e.respondWith(shareTarget(req));
  if (req.method !== 'GET') return;
  if (/(^|\.)tile\.openstreetmap\.org$/.test(u.hostname)) return e.respondWith(cacheFirst(req, TILES, true));
  if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'cdnjs.cloudflare.com') return e.respondWith(cacheFirst(req, CDN, false));
  if (u.origin === location.origin && !u.pathname.includes('/api/')) return e.respondWith(networkFirst(req));
  /* alles andere (OSM-API, OKAPI, KI-Skript) direkt ins Netz */
});
