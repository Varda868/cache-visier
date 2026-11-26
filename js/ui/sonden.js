/* CacheVisier · ui/sonden: Wettersonden-Suche (zuschaltbar) mit Daten von SondeHub (CC BY-SA 2.0).
   Abfrage nur beim Öffnen, per ↻ und alle 3 min, solange eine Sonde das Ziel ist – SondeHub bittet, nicht dauernd abzufragen. */
import { esc, fmtCoord, fmtDist, haversine } from '../kern/geo.js';
import { fundMeldungen, landepunkte, sondenListe, vorZeit } from '../kern/sonden.js';
import { $, S, openSheet, run, toast } from './basis.js';
import { setTarget } from './ziel-routing.js';

const API = 'https://api.v2.sondehub.org';
const SO = () => S.sonden || (S.sonden = { liste: [], lande: new Map(), funde: new Map(), sites: null, ts: 0, laden: null });

async function holJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`SondeHub antwortet ${r.status}` + (r.status === 429 ? ' (zu viele Abfragen – kurz warten)' : ''));
  return r.json();
}
function wo() { return S.pos || (S.target ? { lat: S.target.lat, lon: S.target.lon } : null); }

async function sondenLaden() {
  const o = SO(); if (o.laden) return o.laden;
  const p = wo(); if (!p) throw new Error('Noch keine Position');
  const km = Math.min(300, Math.max(10, +S.set.sondenKm || 100)), q = `lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&distance=${km * 1000}`;
  o.laden = (async () => {
    const roh = await holJson(`${API}/sondes?${q}&last=43200`);
    o.liste = sondenListe(roh, p.lat, p.lon); o.ts = Date.now();
    const ser = o.liste.map(s => s.serial).slice(0, 30);
    const [pr, rc, si] = await Promise.allSettled([
      ser.length ? holJson(`${API}/predictions?vehicles=${ser.map(encodeURIComponent).join(',')}`) : [],
      holJson(`${API}/recovered?${q}&last=3`),
      o.sites ? o.sites : holJson(`${API}/sites`)]);
    if (pr.status === 'fulfilled') o.lande = landepunkte(pr.value);
    if (rc.status === 'fulfilled') o.funde = fundMeldungen(rc.value);
    if (si.status === 'fulfilled' && !o.sites) o.sites = si.value;
    drawSonden(); zielNachziehen();
  })().finally(() => { o.laden = null; });
  return o.laden;
}

/* nächste Startplätze (aus /sites) */
function startorte(p, n = 3) {
  const s = SO().sites; if (!s || !p) return [];
  return Object.values(s).filter(x => x && Array.isArray(x.position) && Array.isArray(x.times) && x.times.length)
    .map(x => ({ name: String(x.station_name || '').replace(/\s*\(.*\)$/, '').slice(0, 30), d: haversine(p.lat, p.lon, x.position[1], x.position[0]) }))
    .sort((a, b) => a.d - b.d).slice(0, n);
}

const PFEIL = { steigt: '↑', faellt: '↓', unten: '📍' };
function zeile(s) {
  const o = SO(), l = o.lande.get(s.serial), f = o.funde.get(s.serial);
  const lage = s.status === 'unten' ? `zuletzt gehört in ${s.alt} m` : `${PFEIL[s.status]} ${String(Math.abs(s.vz)).replace('.', ',')} m/s · ${s.alt} m`;
  const fund = f ? (f.gefunden ? `<div class="so-f ok">✅ gefunden${f.von ? ' von ' + esc(f.von) : ''} · ${vorZeit(f.ts)}</div>` : `<div class="so-f">🔎 Suche gemeldet${f.von ? ' von ' + esc(f.von) : ''}${f.text ? ': ' + esc(f.text.slice(0, 80)) : ''}</div>`) : '';
  const lp = l ? `<div class="so-l">✖ Landepunkt berechnet${S.pos ? ' · ' + fmtDist(haversine(S.pos.lat, S.pos.lon, l.lat, l.lon)) + ' von dir' : ''}</div>` : '';
  return `<li class="so"><div><b>🎈 ${esc(s.typ || 'Sonde')} ${esc(s.serial)}</b></div>
    <div class="sub">${fmtDist(s.dist)} ${s.richtung} · ${lage} · ${vorZeit(s.ts)}${s.freq ? ' · ' + String(s.freq).replace('.', ',') + ' MHz' : ''}</div>${lp}${fund}
    <div class="so-b">${l ? `<button data-l="${esc(s.serial)}">🎯 Landepunkt</button>` : ''}<button data-p="${esc(s.serial)}">🎯 Zuletzt gehört</button><a class="btn" href="https://sondehub.org/${encodeURIComponent(s.serial)}" target="_blank" rel="noopener">🗺️ SondeHub</a></div></li>`;
}
function zielSonde(serial, landen) {
  const o = SO(), s = o.liste.find(x => x.serial === serial); if (!s) return;
  const l = landen && o.lande.get(serial), z = l || s;
  setTarget({ kind: 'sonde', geocode: '', serial, landen: !!l, lat: z.lat, lon: z.lon, label: `${serial} ${l ? 'Landepunkt' : 'zuletzt gehört'}`, name: `Wettersonde ${serial}` });
  toast(`🎈 Ziel: ${serial} ${l ? '(Landepunkt, berechnet)' : `(zuletzt in ${s.alt} m gehört)`}`, 4000);
}
/* Ziel ist eine Sonde: neue Daten → Ziel mitziehen, wenn es sich deutlich bewegt hat */
function zielNachziehen() {
  const t = S.target; if (!t || t.kind !== 'sonde') return;
  const o = SO(), z = (t.landen && o.lande.get(t.serial)) || o.liste.find(x => x.serial === t.serial); if (!z) return;
  if (haversine(t.lat, t.lon, z.lat, z.lon) > 30) { setTarget({ ...t, lat: z.lat, lon: z.lon }); toast(`🎈 ${t.serial}: Position aktualisiert`); }
}
setInterval(() => { if (S.set.sonden && S.target && S.target.kind === 'sonde' && !document.hidden) run(sondenLaden); }, 180000);

async function showSonden() {
  openSheet('🎈 Wettersonden', '<p class="sub">Lade Daten von SondeHub …</p>');
  try { await sondenLaden(); } catch (e) { $('#sheetBody').innerHTML = `<p class="sub">⚠️ ${esc(e.message)}</p>`; return; }
  renderSonden();
}
function renderSonden() {
  if ($('#sheetTitle').textContent !== '🎈 Wettersonden' || $('#sheet').hidden) return;
  const o = SO(), p = wo(), st = startorte(p);
  openSheet('🎈 Wettersonden', `
    <p class="sub">Umkreis ${Math.round(+S.set.sondenKm || 100)} km · letzte 12 h · Stand ${new Date(o.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} <button id="soNeu">↻</button></p>
    ${st.length ? `<p class="sub">Startorte: ${st.map(x => esc(x.name) + ' ' + fmtDist(x.d)).join(' · ')}</p>` : ''}
    <ul class="solist">${o.liste.length ? o.liste.map(zeile).join('') : '<li class="sub">Gerade keine Sonde im Umkreis. Gestartet wird meist um 0 und 12 Uhr UTC.</li>'}</ul>
    <p class="sub">⚠️ Ballon kann noch Wasserstoff enthalten – kein Feuer. Schnüre an Stromleitungen: Finger weg. Im Baum: nicht klettern. Die Sonde hat eine Batterie → Sondermüll oder an den Wetterdienst zurück.</p>
    <p class="sub so-q">Daten: <a href="https://sondehub.org" target="_blank" rel="noopener">SondeHub</a> (CC BY-SA 2.0), dort lässt sich ein Fund auch melden. Der Landepunkt ist eine Rechnung, oft einige hundert Meter daneben.</p>`, b => {
    b.querySelector('#soNeu').onclick = () => run(async () => { await sondenLaden(); renderSonden(); });
    b.querySelectorAll('[data-l]').forEach(x => { x.onclick = () => zielSonde(x.dataset.l, true); });
    b.querySelectorAll('[data-p]').forEach(x => { x.onclick = () => zielSonde(x.dataset.p, false); });
  });
}

/* Karte: letzte Position 🎈, Landepunkt ✖, gestrichelt verbunden */
function drawSonden() {
  if (!S.map || !S.L.sonden) return;
  const L = window.L, o = SO(); S.L.sonden.clearLayers();
  if (!S.set.sonden) return;
  for (const s of o.liste) {
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'sondeM', html: `🎈 ${esc(s.serial)} <small>${s.alt} m</small>`, iconSize: null }) })
      .bindPopup(`${esc(s.typ)} ${esc(s.serial)}<br>${s.alt} m · ${vorZeit(s.ts)}`).addTo(S.L.sonden);
    const l = o.lande.get(s.serial);
    if (l) {
      L.polyline([[s.lat, s.lon], [l.lat, l.lon]], { color: '#ff9f1a', weight: 2, dashArray: '4 6', interactive: false }).addTo(S.L.sonden);
      L.marker([l.lat, l.lon], { icon: L.divIcon({ className: 'sondeL', html: '✖', iconSize: null }) }).bindPopup(`Landepunkt ${esc(s.serial)} (berechnet)<br>${esc(fmtCoord(l.lat, l.lon))}`).addTo(S.L.sonden);
    }
  }
}
window.CVSonden = { sondenLaden, zielSonde }; // für Tests
export { sondenLaden, showSonden, drawSonden, zielSonde };
