import { TYPE_INFO } from '../kern/caches.js';
import { esc, haversine } from '../kern/geo.js';
import { routePointAt } from '../kern/route.js';
import { sunElevation } from '../kern/sonne.js';
import { $, S } from './basis.js';
import { drawTalkPos } from './funk.js';
import { drawRays } from './nacht.js';
import { drawTour } from './tour.js';
import { activeRoute, drawRoute, targetCache } from './ziel-routing.js';

/* ---------- Karte (Leaflet) ---------- */
function initMap() {
  if (S.map || !window.L) return;
  const L = window.L;
  S.map = L.map('map', { zoomControl: false }).setView(S.pos ? [S.pos.lat, S.pos.lon] : [48.37, 10.89], 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
  S.L.caches = L.layerGroup().addTo(S.map);
  S.L.zones = L.layerGroup().addTo(S.map);
  S.L.route = L.polyline([], { color: '#3d8bff', weight: 6, opacity: 0.85 }).addTo(S.map);
  S.L.line = L.polyline([], { color: '#ffdc00', weight: 3, dashArray: '6 8' }).addTo(S.map);
  S.L.tour = L.layerGroup().addTo(S.map);
  S.L.talk = L.layerGroup().addTo(S.map);
  S.L.rays = L.layerGroup().addTo(S.map);
  S.L.steer = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#3d8bff', fillOpacity: 1, interactive: false });
  S.L.acc = L.circle([0, 0], { radius: 1, weight: 1, color: '#39cccc', fillOpacity: 0.1 }).addTo(S.map);
  S.L.me = L.marker([0, 0], { icon: L.divIcon({ className: 'me', html: '<div class="meArrow"></div>', iconSize: [34, 34] }), interactive: false }).addTo(S.map);
  S.map.on('dragstart', () => { S.follow = false; $('#bFollow').hidden = false; });
  S.map.on('zoomstart', () => { if (!S.progZoom) S.zoomPause = performance.now() + 20000; });
  S.map.on('zoomend', () => { S.progZoom = false; });
  drawCacheMarkers(); drawRoute(); drawTour(); drawTalkPos(); drawRays();
}
function drawCacheMarkers() {
  if (!S.map) return;
  const L = window.L; S.L.caches.clearLayers(); S.L.zones.clearLayers();
  const ref = S.pos || (S.target ? { lat: S.target.lat, lon: S.target.lon } : null);
  let list = [...S.caches.values()];
  if (ref) list = list.filter(c => haversine(ref.lat, ref.lon, c.lat, c.lon) < 8000);
  for (const c of list.slice(0, 1500)) {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other, isT = S.target && S.target.geocode === c.geocode;
    const m = L.circleMarker([c.lat, c.lon], { radius: isT ? 11 : 7, color: isT ? '#ffdc00' : '#111', weight: isT ? 3 : 1, fillColor: ti[1], fillOpacity: c.found ? 0.35 : 0.9 });
    const box = document.createElement('div');
    box.innerHTML = `<b>${esc(c.name)}</b><br>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}<br><button class="pbtn">Als Ziel</button>`;
    box.querySelector('button').onclick = () => { targetCache(c.geocode); S.map.closePopup(); };
    m.bindPopup(box); m.addTo(S.L.caches);
    if (isT) for (const w of (c.wpts || []).filter(x => x.lat != null)) L.circleMarker([w.lat, w.lon], { radius: 5, color: '#ffdc00', weight: 2, fillColor: '#fff', fillOpacity: 0.8 }).bindPopup(esc(w.prefix + ' ' + w.name)).addTo(S.L.caches);
  }
  const ai = S.target && S.ai.get(S.target.geocode);
  for (const z of (ai && ai.zones) || []) if (z.lat != null) {
    L.circle([z.lat, z.lon], { radius: z.r || 5, color: '#ff4136', weight: 2, fillOpacity: z.ring ? 0 : 0.15, dashArray: z.ring ? '4 4' : null }).bindPopup(esc(z.label)).addTo(S.L.zones);
  }
}
function updateMap(dist, heading) {
  if (!S.map || !S.pos) return;
  const ll = [S.pos.lat, S.pos.lon];
  S.L.me.setLatLng(ll); S.L.acc.setLatLng(ll).setRadius(S.pos.acc || 1);
  const a = S.L.me.getElement && S.L.me.getElement();
  if (a && heading != null) a.firstChild.style.transform = `rotate(${heading}deg)`;
  const R = activeRoute();
  if (R && S.L.route.getLatLngs().length !== R.pts.length) drawRoute();
  if (!R && S.L.route.getLatLngs().length) drawRoute();
  // gelb gestrichelt: Luftlinie – mit Route nur das Reststück vom Wegende zum Ziel
  const tl = S.target ? [S.target.lat, S.target.lon] : null;
  S.L.line.setLatLngs(!tl ? [] : R ? (R.gap > 3 ? [R.pts[R.pts.length - 1], tl] : []) : [ll, tl]);
  if (S.steer) S.L.steer.setLatLng([S.steer.lat, S.steer.lon]).addTo(S.map); else S.L.steer.remove();
  if (S.follow) { if (!autoZoom(ll)) S.map.panTo(ll, { animate: false }); }
}
/* Autozoom: ich in der Mitte, das nächste Wichtige noch im Bild – mit Route die nächste Abbiegung, sonst das Ziel */
function autoZoom(ll) {
  const now = performance.now();
  if (!S.set.autoZoom || !S.target || now < (S.zoomPause || 0) || now - (S.lastZoom || 0) < 2500) return false;
  const R = activeRoute();
  let pt = [S.target.lat, S.target.lon];
  if (R && R.loc && !R.final && R.next && R.next.d < 400) pt = routePointAt(R.pts, R.cum, R.loc.along + R.next.d);
  const d = haversine(ll[0], ll[1], pt[0], pt[1]);
  const mirror = [2 * ll[0] - pt[0], 2 * ll[1] - pt[1]];            // gespiegelt, damit ich in der Mitte bleibe
  let z = d < 25 ? 19 : S.map.getBoundsZoom(window.L.latLngBounds([pt, mirror]).pad(0.25), false);
  const fast = S.pos && S.pos.speed > 6;                               // Rad/Auto: weiter raus
  z = Math.max(13, Math.min(fast ? 17 : 19, Math.floor(z)));
  if (z === S.map.getZoom()) return false;
  S.progZoom = true; S.lastZoom = now;
  S.map.setView(ll, z, { animate: true });
  return true;
}
function applyMapDark() {
  const m = S.set.mapDark, p = S.pos || S.target || { lat: 48.37, lon: 10.89 };
  const on = m === 'on' || (m === 'auto' && sunElevation(p.lat, p.lon, new Date()) < -2);
  document.body.classList.toggle('mapdark', on);
}

export { initMap, drawCacheMarkers, updateMap, autoZoom, applyMapDark };
