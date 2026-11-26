import { D2R, esc, haversine } from '../kern/geo.js';
import { S, openSheet, run, toast } from './basis.js';
import { loadSqlJs } from './import.js';
import { drawCacheMarkers } from './karte.js';
import { aiAnalyze } from './ki-auswertung.js';
import { aiMulti, getMulti, renderStage } from './multi.js';

/* ---------- Offline vorbereiten ---------- */
function tileXY(lat, lon, z) {
  const n = Math.pow(2, z), x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * n);
  return [x, y];
}
async function tileCoverage(c, r) {
  if (!('caches' in window)) return null;
  const have = new Set((await (await caches.open('cv-tiles-v1')).keys()).map(k => k.url.replace(/^https:\/\/[a-c]?\.?tile/, 'https://tile')));
  const dLa = r / 111320, dLo = r / (111320 * Math.cos(c.lat * D2R)), out = [];
  for (const z of [15, 16, 17]) {
    const [x0, y0] = tileXY(c.lat + dLa, c.lon - dLo, z), [x1, y1] = tileXY(c.lat - dLa, c.lon + dLo, z);
    let n = 0, h = 0;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { n++; if (have.has(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`)) h++; }
    out.push({ z, n, h });
  }
  return out;
}
async function showOffline() {
  const ref = S.pos || S.target || (S.map ? { lat: S.map.getCenter().lat, lon: S.map.getCenter().lng } : null);
  if (!ref) return toast('Erst GPS oder ein Ziel');
  const cov = await tileCoverage(ref, 1000);
  openSheet('📦 Offline vorbereiten', `
    <p class="sub">Um ${S.pos ? 'deinen Standort' : 'das Ziel'}: Caches, KI-Auswertung und Stationen landen im Handy. Routing und neue KI-Fragen brauchen weiter Netz.</p>
    <label class="f"><span>Umkreis</span><select id="oR"><option value="1000">1 km</option><option value="2000" selected>2 km</option><option value="5000">5 km</option></select></label>
    <label class="f c"><input type="checkbox" id="oKi" checked><span>🤖 Logs der ungefundenen Caches auswerten (noch nicht ausgewertete)</span></label>
    <label class="f c"><input type="checkbox" id="oMu"><span>🧩 Stationen der Multis aus dem Listing lesen</span></label>
    <div class="tools"><button id="oGo">📦 Vorbereiten</button></div><div id="oOut" class="sub"></div>
    <h4>Karte</h4>
    <p class="sub">${cov ? cov.map(x => `Zoom ${x.z}: ${x.h} von ${x.n} Kacheln da`).join(' · ') + ' (1 km Umkreis)' : ''}</p>
    <p class="sub">Die Kacheln von openstreetmap.org dürfen laut Nutzungsregeln nicht vorab im Paket geladen werden. Offline da ist, was du dir einmal angesehen hast: das Gebiet vorher auf der Karte in den Zoomstufen anschauen. Ein eigener Kachelserver (später SSD-Server) würde das lösen.</p>`, b => {
    b.querySelector('#oGo').onclick = () => run(async () => {
      const r = +b.querySelector('#oR').value, out = b.querySelector('#oOut'), log = t => { out.innerHTML += esc(t) + '<br>'; };
      out.innerHTML = '';
      const libs = await Promise.allSettled([loadSqlJs(), fetch('vendor/leaflet/leaflet.js'), fetch('vendor/leaflet/leaflet.css')]);
      log(`App-Bausteine: ${libs.filter(x => x.status === 'fulfilled').length}/3 im Speicher`);
      const list = [...S.caches.values()].filter(c => !c.found && haversine(ref.lat, ref.lon, c.lat, c.lon) <= r);
      log(`${list.length} ungefundene Caches im Umkreis, davon ${list.filter(c => (c.logs || []).length).length} mit Logs`);
      if (b.querySelector('#oKi').checked) {
        const todo = list.filter(c => (c.logs || []).length && (!S.ai.has(c.geocode) || !S.ai.get(c.geocode).suchhilfe));
        let ok = 0, err = 0;
        for (const c of todo) { try { await aiAnalyze(c); ok++; } catch (e) { err++; } out.lastChild && (out.innerHTML = out.innerHTML.replace(/🤖[^<]*<br>$/, '')); log(`🤖 ausgewertet ${ok + err}/${todo.length}${err ? ` (${err} Fehler)` : ''}`); }
        if (!todo.length) log('🤖 alles schon ausgewertet');
      }
      if (b.querySelector('#oMu').checked) {
        const todo = [];
        for (const c of list) if (['multi', 'wherigo'].includes(c.type) && c.desc && !(await getMulti(c.geocode))) todo.push(c);
        let ok = 0;
        for (const c of todo) { try { await aiMulti(c); ok++; } catch (e) { /* weiter */ } }
        log(`🧩 Stationen gelesen: ${ok}/${todo.length}`);
      }
      drawCacheMarkers(); renderStage();
      log('✅ fertig – Flugmodus-Test lohnt sich');
    });
  });
}

export { tileXY, tileCoverage, showOffline };
