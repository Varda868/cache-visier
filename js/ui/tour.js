import { missingGear, planTour, toolsOf } from '../kern/ausruestung.js';
import { TYPE_INFO } from '../kern/caches.js';
import { esc, fmtDist, haversine } from '../kern/geo.js';
import { start } from '../main.js';
import { buzz, say, sayDist } from './ansagen.js';
import { S, closeSheet, idbDel, idbPut, openSheet, saveSettings, toast } from './basis.js';
import { drawCacheMarkers } from './karte.js';
import { gearBadge, renderTop, targetCache } from './ziel-routing.js';

/* ---------- Gefunden & weiter ---------- */
function tourCandidate(c, exclude) {
  if (c.found || c.disabled || c.archived || c.geocode === exclude) return false;
  if (c.type === 'mystery' && !c.corrected) return false;                          // ungelöstes Rätsel
  if (S.set.skipGear && missingGear(c, S.set, S.ai.get(c.geocode), true).length) return false; // Ausrüstung fehlt (hart)
  return true;
}
function makeTour(exclude) {
  const p = S.pos || S.target; if (!p) return null;
  let list = [...S.caches.values()].filter(c => tourCandidate(c, exclude) && haversine(p.lat, p.lon, c.lat, c.lon) <= S.set.tourRadius);
  list = list.sort((a, b) => haversine(p.lat, p.lon, a.lat, a.lon) - haversine(p.lat, p.lon, b.lat, b.lon)).slice(0, 40);
  const order = planTour({ lat: p.lat, lon: p.lon }, list, S.set.tourLoop);
  S.tour = { ids: order.map(i => list[i].geocode), start: { lat: p.lat, lon: p.lon }, loop: S.set.tourLoop, ts: Date.now() };
  idbPut('meta', S.tour, 'tour').catch(() => {});
  drawTour();
  return S.tour;
}
function tourNext(exclude) {
  if (!S.tour || !S.tour.ids.some(g => S.caches.has(g) && tourCandidate(S.caches.get(g), exclude))) makeTour(exclude);
  const g = S.tour && S.tour.ids.find(id => S.caches.has(id) && tourCandidate(S.caches.get(id), exclude));
  return g ? S.caches.get(g) : null;
}
function tourPos(g) { return S.tour ? S.tour.ids.indexOf(g) : -1; }
function drawTour() {
  if (!S.map || !S.L.tour) return;
  S.L.tour.clearLayers();
  if (!S.tour) return;
  const pts = S.tour.ids.map(g => S.caches.get(g)).filter(Boolean);
  const line = [[S.tour.start.lat, S.tour.start.lon]].concat(pts.map(c => [c.lat, c.lon]));
  if (S.tour.loop) line.push(line[0]);
  window.L.polyline(line, { color: '#b10dc9', weight: 3, opacity: 0.8, dashArray: '2 8' }).addTo(S.L.tour);
  pts.forEach((c, i) => window.L.marker([c.lat, c.lon], { interactive: false, icon: window.L.divIcon({ className: 'tourNr' + (c.found ? ' done' : ''), html: String(i + 1), iconSize: [20, 20], iconAnchor: [-6, 22] }) }).addTo(S.L.tour));
}
function showTour() {
  const p = S.pos || S.target;
  if (!S.tour) makeTour();
  if (!S.tour) return toast('Erst GPS oder ein Ziel');
  const pts = S.tour.ids.map(g => S.caches.get(g)).filter(Boolean);
  let prev = S.tour.start, sum = 0;
  const rows = pts.map((c, i) => {
    const d = haversine(prev.lat, prev.lon, c.lat, c.lon); sum += d; prev = c;
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    return `<li class="row${c.found ? ' found' : ''}" data-g="${esc(c.geocode)}"><span class="tnr">${i + 1}</span><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${gearBadge(c)}</small></div><span class="dd">+${fmtDist(d)}<br><small>${fmtDist(sum)}</small></span></li>`;
  }).join('');
  if (S.tour.loop && pts.length) sum += haversine(prev.lat, prev.lon, S.tour.start.lat, S.tour.start.lon);
  const pack = new Map();
  pts.forEach(c => toolsOf(c, S.ai.get(c.geocode)).forEach(a => { const e = pack.get(a.key) || { icon: a.icon, label: a.label.replace(' (aus Text)', ''), n: 0 }; e.n++; pack.set(a.key, e); }));
  const packHtml = pack.size ? `<p class="sub">🎒 Einpacken: ${[...pack.entries()].map(([k, e]) => `${e.icon} ${esc(e.label)} (${e.n})${S.set['gear_' + k] === false ? ' ✗' : ''}`).join(' · ')}</p>` : '';
  openSheet(`🗺️ Tour (${pts.length})`, `${packHtml}
    <p class="sub">Reihenfolge ohne Hin und Her (Luftlinie, Kreuzungen entfernt). Gesamt ca. ${fmtDist(sum)} Luftlinie${S.tour.loop ? ', zurück zum Start' : ''} – zu Fuß wird es mehr.</p>
    <div class="two"><label class="f"><span>Umkreis</span><select id="tR"><option value="1000">1 km</option><option value="2000">2 km</option><option value="3000">3 km</option><option value="5000">5 km</option></select></label>
      <label class="f c"><input type="checkbox" id="tL" ${S.set.tourLoop ? 'checked' : ''}><span>Rundtour</span></label></div>
    <div class="tools"><button id="tNew">🔄 Neu planen ab hier</button><button id="tGo">▶ Erster Cache als Ziel</button><button id="tOff">✕ Tour beenden</button></div>
    <ul class="list">${rows || '<li class="empty">Keine passenden Caches im Umkreis.</li>'}</ul>`, b => {
    b.querySelector('#tR').value = String(S.set.tourRadius);
    b.querySelector('#tR').onchange = e => { S.set.tourRadius = +e.target.value; saveSettings(); makeTour(); showTour(); };
    b.querySelector('#tL').onchange = e => { S.set.tourLoop = e.target.checked; saveSettings(); makeTour(); showTour(); };
    b.querySelector('#tNew').onclick = () => { makeTour(); showTour(); };
    b.querySelector('#tGo').onclick = () => { const c = tourNext(); if (c) targetCache(c.geocode); };
    b.querySelector('#tOff').onclick = () => { S.tour = null; idbDel('meta', 'tour').catch(() => {}); drawTour(); renderTop(); closeSheet(); toast('Tour beendet'); };
    b.querySelectorAll('li.row').forEach(li => { li.onclick = () => targetCache(li.dataset.g); });
  });
}
async function foundAndNext(c, text, photoIds) {
  await idbPut('mylogs', { geocode: c.geocode, name: c.name, type: 'found', text, ts: Date.now(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon, photoIds });
  c.found = true; await idbPut('caches', c); S.caches.set(c.geocode, c);
  buzz([60, 60, 200]);
  const nx = tourNext(c.geocode);
  drawTour();
  if (!nx) { closeSheet(); drawCacheMarkers(); return toast('✅ Gefunden gespeichert – kein weiterer passender Cache im Umkreis'); }
  targetCache(nx.geocode);
  const ti = (TYPE_INFO[nx.type] || TYPE_INFO.other)[0], d = S.pos ? haversine(S.pos.lat, S.pos.lon, nx.lat, nx.lon) : 0;
  const k = tourPos(nx.geocode) + 1, n = S.tour ? S.tour.ids.length : 0;
  toast(`✅ Gefunden gespeichert · Tour ${k}/${n}: ${nx.name} (${ti}, ${fmtDist(d)})`, 5000);
  say(`Weiter zu ${nx.name}, ${ti}, ${sayDist(Math.round(d / 10) * 10)}`);
}

export { tourCandidate, makeTour, tourNext, tourPos, drawTour, showTour, foundAndNext };
