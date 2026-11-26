/* CacheVisier · kern/team: Team-Suche – Sektoren rund ums Ziel verteilen, abgesuchte Felder als Raster */
import { D2R, bearing, compassName } from './geo.js';

const ZELLE = 3; // Meter je Rasterfeld (GPS ist ohnehin nur auf ein paar Meter genau)
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const r1 = x => Math.round(x * 10) / 10;

/* leute: [{pk, n, lat?, lon?}] → [{pk, n, von, bis, name}]  (bis kann über 360 gehen, z. B. 270–450 = Nord)
   Gleich große Tortenstücke; die Teilung wird so gedreht, dass jeder mit Position möglichst mittig in seinem Stück steht (kürzester Weg). */
function teileSektoren(lat0, lon0, leute) {
  const L = [...new Map((leute || []).filter(p => p && p.pk).map(p => [p.pk, p])).values()].sort((a, b) => (a.pk < b.pk ? -1 : 1));
  const n = L.length; if (!n) return [];
  const w = 360 / n, brg = L.map(p => (p.lat == null || p.lon == null ? null : bearing(lat0, lon0, p.lat, p.lon)));
  const verteile = off => {
    const sek = Array.from({ length: n }, (_, i) => ({ von: off + i * w, mitte: off + (i + 0.5) * w })), paare = [];
    brg.forEach((b, i) => { if (b != null) sek.forEach((s, j) => paare.push([angDiff(b, s.mitte), i, j])); });
    paare.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const wo = new Array(n).fill(-1), frei = new Array(n).fill(true); let kosten = 0;
    for (const [d, i, j] of paare) if (wo[i] < 0 && frei[j]) { wo[i] = j; frei[j] = false; kosten += d; }
    L.forEach((p, i) => { if (wo[i] < 0) { const j = frei.indexOf(true); wo[i] = j; frei[j] = false; } });
    return { sek, wo, kosten };
  };
  const kand = n > 1 && brg.some(b => b != null) ? [...Array.from({ length: Math.ceil(w / 5) }, (_, k) => k * 5), ...brg.filter(b => b != null).map(b => (((b - w / 2) % w) + w) % w)] : [0];
  let best = null;
  for (const off of kand) { const r = verteile(off); if (!best || r.kosten < best.kosten - 1e-6) best = r; }
  return L.map((p, i) => { const s = best.sek[best.wo[i]], von = r1(((s.von % 360) + 360) % 360); return { pk: p.pk, n: String(p.n || p.pk.slice(0, 6)).slice(0, 12), von, bis: r1(von + w), name: n === 1 ? 'rundum' : compassName(s.mitte) }; });
}
function inSektor(brg, s) { const w = s.bis - s.von; if (w >= 360) return true; return ((((brg - s.von) % 360) + 360) % 360) < w; }

/* Rasterfeld relativ zum Ziel: "i,j" (Nord, Ost) */
function zelle(lat0, lon0, lat, lon, m = ZELLE) {
  const dy = (lat - lat0) * 110540, dx = (lon - lon0) * 111320 * Math.cos(lat0 * D2R);
  return Math.round(dy / m) + ',' + Math.round(dx / m);
}
function zellMitte(lat0, lon0, key, m = ZELLE) {
  const [i, j] = String(key).split(',').map(Number);
  return { lat: lat0 + i * m / 110540, lon: lon0 + j * m / (111320 * Math.cos(lat0 * D2R)) };
}
const zellOk = k => typeof k === 'string' && /^-?\d{1,3},-?\d{1,3}$/.test(k);

/* Anteil abgesuchter Felder in einem Sektor (0…1); zellen: Set oder Map mit "i,j" */
function sektorAnteil(s, r, zellen, m = ZELLE) {
  let ges = 0, ab = 0; const k = Math.ceil(r / m);
  for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
    const dy = i * m, dx = j * m, d = Math.hypot(dx, dy); if (d > r) continue;
    const b = d < 0.01 ? s.von : (Math.atan2(dx, dy) / D2R + 360) % 360;
    if (!inSektor(b, s)) continue;
    ges++; if (zellen && zellen.has(i + ',' + j)) ab++;
  }
  return ges ? ab / ges : 0;
}

/* Plan aus einer Nachricht prüfen und zurechtstutzen (kommt von fremden Handys) */
function planPruefen(p) {
  if (!p || typeof p !== 'object' || p.v !== 1 || typeof p.gc !== 'string' || !isFinite(p.ts)) return null;
  const gc = p.gc.slice(0, 12), ts = +p.ts;
  if (p.ende) return { v: 1, gc, ts, ende: true };
  if (!isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || !Array.isArray(p.s)) return null;
  const s = p.s.slice(0, 12).filter(x => x && typeof x.pk === 'string' && /^[0-9a-f]{64}$/.test(x.pk) && isFinite(x.von) && isFinite(x.bis))
    .map(x => ({ pk: x.pk, n: String(x.n || '').slice(0, 12), von: +x.von, bis: +x.bis, name: String(x.name || '').slice(0, 7) }));
  if (!s.length) return null;
  return { v: 1, gc, ts, lat: +p.lat, lon: +p.lon, r: Math.min(60, Math.max(5, +p.r || 20)), s };
}
export { ZELLE, teileSektoren, inSektor, zelle, zellMitte, zellOk, sektorAnteil, planPruefen };
