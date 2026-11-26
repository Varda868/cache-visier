import { missingGear, toolsOf } from '../kern/ausruestung.js';
import { TYPE_INFO } from '../kern/caches.js';
import { compassName, esc, fmtCoord, fmtDist, haversine } from '../kern/geo.js';
import { decodePolyline, routeCum, routeLocate, routePointAt } from '../kern/route.js';
import { $, S, closeSheet, idbPut, run, saveSettings, toast } from './basis.js';
import { updateButtons } from './kamera.js';
import { autoZoom, drawCacheMarkers } from './karte.js';
import { renderStage } from './multi.js';
import { cacheCode, talkSubscribe } from './talk.js';
import { tourPos } from './tour.js';

/* ---------- Ziel ---------- */
function setTarget(t) {
  S.target = t; idbPut('meta', t, 'target').catch(() => {});
  S.route = null; S.steer = null;
  renderTop(); drawCacheMarkers(); closeSheet(); renderStage();
  if (S.set.routing) routeSoon();
  if (S.set.talkOn && S.talk.pool && S.talk.chanCode !== cacheCode()) { S.talk.chanCode = cacheCode(); run(talkSubscribe); }
}
/* schnelles Durchklicken von Zielen löst nur eine Anfrage aus (Rücksicht auf den öffentlichen Valhalla-Server) */
let _routeTimer;
function routeSoon() { clearTimeout(_routeTimer); _routeTimer = setTimeout(() => requestRoute('user'), 1500); }

/* ---------- Routing (Valhalla) ---------- */
const FOSSGIS = 'https://valhalla1.openstreetmap.de';
function targetKey(t) { return t ? t.lat.toFixed(6) + ',' + t.lon.toFixed(6) : ''; }
function activeRoute() { return S.set.routing && S.route && S.target && S.route.key === targetKey(S.target) ? S.route : null; }
async function requestRoute(reason) {
  const t = S.target, p = S.pos;
  if (!S.set.routing || !t || S.routeBusy) return;
  if (!p) { if (reason !== 'auto') toast('Route folgt, sobald GPS da ist'); return; }
  S.routeBusy = true; S.routeTs = Date.now();
  const req = { locations: [{ lat: p.lat, lon: p.lon, type: 'break' }, { lat: t.lat, lon: t.lon, type: 'break' }],
    costing: S.set.routeCosting, directions_options: { units: 'kilometers', language: 'de-DE' } };
  const direct = base => fetch(base.replace(/\/+$/, '') + '/route?json=' + encodeURIComponent(JSON.stringify(req)));
  try {
    // Routing direkt beim öffentlichen FOSSGIS-Valhalla (gedrosselt: höchstens alle 20 s neu, 1,5 s nach Zielwechsel)
    const via = 'direkt', r = await direct(FOSSGIS), j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.trip) throw new Error(j && (j.error || j.error_code) ? `${j.error || ''}${j.error_code ? ' (' + j.error_code + ')' : ''}` : 'HTTP ' + r.status);
    if (targetKey(S.target) !== targetKey(t)) return; // Ziel inzwischen gewechselt
    const leg = j.trip.legs[0], pts = decodePolyline(leg.shape, 6), last = pts[pts.length - 1];
    S.route = {
      key: targetKey(t), pts, cum: routeCum(pts), len: j.trip.summary.length * 1000, time: j.trip.summary.time,
      man: (leg.maneuvers || []).map(m => ({ txt: m.instruction || '', i: m.begin_shape_index })),
      gap: haversine(last[0], last[1], t.lat, t.lon), fit: true, via
    };
    S.offCount = 0; onPosRoute(); drawRoute();
    if (reason !== 'auto') toast(`🧭 ${fmtDist(S.route.len)} Weg · ca. ${Math.max(1, Math.round(S.route.time / 60))} min (${via})`);
  } catch (e) {
    if (reason !== 'auto') toast('Routing: ' + e.message, 6000);
  } finally { S.routeBusy = false; }
}
function onPosRoute() {
  const p = S.pos, t = S.target;
  if (S.set.routing && t && p && !S.route && !S.routeBusy && Date.now() - S.routeTs > 30000) { requestRoute('auto'); return; }
  const R = activeRoute();
  if (!R || !p) { S.steer = null; return; }
  const loc = R.loc = routeLocate(R.pts, R.cum, p.lat, p.lon);
  const total = R.cum[R.cum.length - 1];
  R.rest = Math.max(0, total - loc.along) + R.gap;
  R.offLim = Math.max(30, (p.acc || 10) * 1.5);
  if (loc.off > R.offLim) { if (++S.offCount >= 2 && Date.now() - S.routeTs > 20000) requestRoute('auto'); } else S.offCount = 0;
  // letzte Meter: Luftlinie zum Ziel (die Route endet am nächsten Weg)
  R.final = total - loc.along < 30 || haversine(p.lat, p.lon, t.lat, t.lon) < 40;
  if (R.final) S.steer = null;
  else { const q = routePointAt(R.pts, R.cum, loc.along + S.set.lookahead); S.steer = { lat: q[0], lon: q[1] }; }
  R.next = null;
  for (const m of R.man) if (m.i > loc.i) { R.next = { txt: m.txt, d: Math.max(0, R.cum[m.i] - loc.along), i: m.i }; break; }
}
function routeText(R, dist, brg) {
  if (R.loc && R.loc.off > R.offLim) return `⚠️ ${fmtDist(R.loc.off)} neben der Route – berechne neu …`;
  if (R.final) return `Letztes Stück Luftlinie: ${compassName(brg)} ${Math.round(brg)}°, ${fmtDist(dist)}`;
  if (R.next) return (R.next.d < 15 ? 'Jetzt: ' : `In ${fmtDist(R.next.d)}: `) + R.next.txt;
  return 'Der Route folgen';
}
function toggleRouting() {
  S.set.routing = !S.set.routing; saveSettings(); updateButtons();
  if (S.set.routing) { if (!S.target) toast('🧭 Routing an – erst ein Ziel wählen'); else routeSoon(); }
  else { S.route = null; S.steer = null; drawRoute(); toast('Routing aus – Luftlinie'); }
}
function drawRoute() {
  if (!S.map) return;
  const R = activeRoute();
  S.L.route.setLatLngs(R ? R.pts : []);
  if (R && R.fit && S.set.autoZoom && S.follow) R.fit = false; // Autozoom übernimmt
  if (R && R.fit) { R.fit = false; S.map.fitBounds(window.L.latLngBounds(R.pts.concat([[S.target.lat, S.target.lon]])), { padding: [40, 40], maxZoom: 18 }); S.follow = false; $('#bFollow').hidden = false; }
}
function targetCache(geocode) {
  const c = S.caches.get(geocode); if (!c) return;
  setTarget({ kind: 'cache', geocode, lat: c.lat, lon: c.lon, name: c.name });
  const miss = missingGear(c, S.set, S.ai.get(c.geocode), true), night = (c.attrs || []).some(a => a.yes && (a.key === 'night' || a.key === 'night_rec'));
  if (miss.length) toast('❗ Ausrüstung: ' + miss.map(a => a.icon + ' ' + a.label).join(', '), 5000);
  else if (night && !S.set.night) toast('🌙 Nachtcache – Nachtmodus mit 🌙 oben', 4000);
}
function curCache() { return S.target ? S.caches.get(S.target.geocode) : null; }
/* Ausrüstung: Symbole der nötigen Werkzeuge, ❗ wenn dir etwas fehlt */
function gearBadge(c) {
  const ai = S.ai.get(c.geocode), t = toolsOf(c, ai); if (!t.length) return '';
  return ' · ' + t.map(a => a.icon).join('') + (missingGear(c, S.set, ai, true).length ? ' ❗' : missingGear(c, S.set, ai).length ? ' 🎒' : '');
}
function renderTop() {
  const t = S.target, c = curCache();
  if (!t) { $('#tName').textContent = 'Kein Ziel – ☰ Liste öffnen'; $('#tSub').textContent = ''; return; }
  let name = c ? c.name : t.name;
  if (t.kind === 'wpt') name = '📍 ' + t.label;
  if (t.kind === 'zone') name = '🎯 ' + t.label;
  $('#tName').textContent = name;
  if (c) {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    $('#tSub').innerHTML = `<span class="dot" style="background:${ti[1]}"></span>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${c.disabled ? ' · ⛔ deaktiviert' : ''}${gearBadge(c)}${tourPos(c.geocode) >= 0 ? ` · 🗺️ ${tourPos(c.geocode) + 1}/${S.tour.ids.length}` : ''}`;
  } else $('#tSub').textContent = fmtCoord(t.lat, t.lon);
}

export { setTarget, _routeTimer, routeSoon, FOSSGIS, targetKey, activeRoute, requestRoute, onPosRoute, routeText, toggleRouting, drawRoute, targetCache, curCache, gearBadge, renderTop };
