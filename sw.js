/* CacheVisier Service Worker: offline-fähige App-Hülle, CDN- und Kartenkacheln im Cache, Datei-Empfang über „Teilen“ */
const V = 'cv-shell-v2';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const CDN = 'cv-cdn-v1', TILES = 'cv-tiles-v1', INBOX = 'cv-inbox', MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
