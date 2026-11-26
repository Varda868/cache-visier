/* CacheVisier · ui/zonen-ar: KI-Suchzonen als Ringe auf dem Boden im Kamerabild, Bezugsobjekt (z. B. Bank) als Stecknadel.
   Die Kreise werden aus Punkten am Boden (Handyhöhe tiefer) einzeln projiziert, dadurch erscheinen sie perspektivisch als Ellipse. */
import { D2R, bearing, destPoint, haversine, projectToScreen } from '../kern/geo.js';
import { ZELLE, zellMitte } from '../kern/team.js';
import { $, S } from './basis.js';
import { curCache } from './ziel-routing.js';

const FARBE = { hoch: '46,204,64', mittel: '255,220,0', niedrig: '255,159,26' };
let _cv, _g;
function leinwand() {
  if (!_cv) { _cv = $('#zonen'); _g = _cv && _cv.getContext('2d'); }
  const W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1;
  if (_cv && (_cv.width !== Math.round(W * dpr) || _cv.height !== Math.round(H * dpr))) { _cv.width = Math.round(W * dpr); _cv.height = Math.round(H * dpr); }
  if (_g) _g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}
function leeren() { if (_g && _cv) { const { W, H } = leinwand(); _g.clearRect(0, 0, W, H); } S.zonenAR = 0; }

/* Punkt (lat, lon) am Boden → Bildschirm; null, wenn hinter der Kamera */
function amBoden(sc, p, lat, lon, fov, W, H, hoehe = 0) {
  const d = haversine(p.lat, p.lon, lat, lon), b = (bearing(p.lat, p.lon, lat, lon) - S.set.compassOffset) * D2R;
  const pr = projectToScreen(sc, [d * Math.sin(b), d * Math.cos(b), hoehe - S.set.phoneH], fov, W, H);
  return pr.behind || pr.fwd < 0.4 ? null : pr; // zu dicht vor der Linse: Projektion läuft aus dem Ruder
}
function kreis(lat, lon, r, n = 28) {
  const out = [], k = 111320 * Math.cos(lat * D2R);
  for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI; out.push([lat + r * Math.cos(a) / 110540, lon + r * Math.sin(a) / k]); }
  return out;
}

function drawZonesAR(sc, p, fov) {
  const c = curCache(), a = c && S.ai.get(c.geocode);
  if (!sc || !p) { if (S.zonenAR) leeren(); return; }
  const zonen = S.set.zonenAR === false || !a ? [] : (a.zones || []).filter(z => !z.unresolved && z.lat != null && haversine(p.lat, p.lon, z.lat, z.lon) < 150).slice(0, 6);
  const tp = S.team && S.team.plan, team = tp && haversine(p.lat, p.lon, tp.lat, tp.lon) < 150 ? tp : null;
  if (!zonen.length && !team) { if (S.zonenAR) leeren(); return; }
  const { W, H } = leinwand(), g = _g; if (!g) return;
  g.clearRect(0, 0, W, H); let gezeichnet = 0;
  if (team) gezeichnet += teamAR(g, sc, p, fov, W, H, team);
  zonen.forEach((z, i) => {
    const col = FARBE[z.sicherheit] || FARBE.mittel, r = Math.max(1.5, z.r || 4);
    const pts = kreis(z.lat, z.lon, r).map(([la, lo]) => amBoden(sc, p, la, lo, fov, W, H));
    g.beginPath(); let auf = false, sicht = false;
    for (const q of pts) {
      if (!q) { auf = false; continue; }
      if (q.inView) sicht = true;
      if (!auf) { g.moveTo(q.x, q.y); auf = true; } else g.lineTo(q.x, q.y);
    }
    if (!sicht) return;
    gezeichnet++;
    if (!z.ring && pts.every(Boolean)) { g.fillStyle = `rgba(${col},.18)`; g.fill(); }
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    g.lineWidth = 3; g.setLineDash(z.ring ? [10, 8] : []); g.strokeStyle = `rgba(${col},.95)`; g.stroke(); g.setLineDash([]);
    const m = amBoden(sc, p, z.lat, z.lon, fov, W, H), sichtbar = pts.filter(q => q && q.inView);
    if (m && sichtbar.length) { // Beschriftung unter den Ring, damit sie nicht unter der Zielmarkierung verschwindet
      const ly = Math.min(H - 150, Math.max(...sichtbar.map(q => q.y)) + 18);
      const txt = `${i + 1}. ${z.label}`.slice(0, 42);
      g.font = 'bold 14px system-ui'; g.textAlign = 'center';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(txt, m.x, ly);
      g.fillStyle = `rgb(${col})`; g.fillText(txt, m.x, ly);
    }
    if (z.alat != null) { // Bezugsobjekt: Stecknadel vom Boden 1,5 m hoch
      const u = amBoden(sc, p, z.alat, z.alon, fov, W, H), o = amBoden(sc, p, z.alat, z.alon, fov, W, H, 1.5);
      if (u && o && (u.inView || o.inView)) {
        g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.moveTo(u.x, u.y); g.lineTo(o.x, o.y); g.stroke();
        g.fillStyle = `rgb(${col})`; g.beginPath(); g.arc(o.x, o.y, 7, 0, 7); g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
        if (z.anker) { g.font = '600 13px system-ui'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText('📍 ' + z.anker, o.x, o.y - 12); g.fillStyle = '#fff'; g.fillText('📍 ' + z.anker, o.x, o.y - 12); }
      }
    }
  });
  S.zonenAR = gezeichnet;
}
/* Team-Suche: abgesuchte Felder grün auf dem Boden, eigenes Tortenstück gelb umrandet */
function teamAR(g, sc, p, fov, W, H, plan) {
  let n = 0; const m = ZELLE / 2;
  for (const k of plan && S.team.zellen ? S.team.zellen.keys() : []) {
    const c = zellMitte(plan.lat, plan.lon, k), d = haversine(p.lat, p.lon, c.lat, c.lon); if (d > 35 || d < 3.5) continue; // das Feld, auf dem man steht, nicht
    const kx = 111320 * Math.cos(c.lat * D2R), ecken = [[m, m], [m, -m], [-m, -m], [-m, m]].map(([dy, dx]) => amBoden(sc, p, c.lat + dy / 110540, c.lon + dx / kx, fov, W, H));
    if (ecken.some(q => !q) || !ecken.some(q => q.inView)) continue;
    g.beginPath(); ecken.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
    g.fillStyle = 'rgba(46,204,64,.28)'; g.fill(); n++;
  }
  const me = plan.s.find(x => x.pk === S.talk.pk);
  if (me && me.bis - me.von < 360) {
    const rand = [[plan.lat, plan.lon]];
    for (let a = me.von; a <= me.bis + 0.01; a += Math.max(3, (me.bis - me.von) / 30)) { const q = destPoint(plan.lat, plan.lon, plan.r, Math.min(a, me.bis)); rand.push([q.lat, q.lon]); }
    rand.push([plan.lat, plan.lon]);
    const pts = rand.map(([la, lo]) => amBoden(sc, p, la, lo, fov, W, H));
    g.beginPath(); let auf = false, sicht = false;
    for (const q of pts) { if (!q) { auf = false; continue; } if (q.inView) sicht = true; if (!auf) { g.moveTo(q.x, q.y); auf = true; } else g.lineTo(q.x, q.y); }
    if (sicht) { g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.5)'; g.stroke(); g.lineWidth = 3; g.setLineDash([14, 8]); g.strokeStyle = 'rgba(255,220,0,.95)'; g.stroke(); g.setLineDash([]); n++; }
  }
  return n;
}
export { drawZonesAR, leeren as clearZonesAR };
