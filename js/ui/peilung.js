import { evalExpr, parseCoord } from '../kern/formeln.js';
import { D2R, camVec, compassName, destPoint, esc, fmtCoord, fmtDist, haversine, vecElev, viewHeading } from '../kern/geo.js';
import { start } from '../main.js';
import { $, S, closeSheet, idbPut, openSheet, run, toast } from './basis.js';
import { drawCacheMarkers } from './karte.js';
import { drawRays } from './nacht.js';
import { curCache, setTarget } from './ziel-routing.js';

/* ---------- Peilung / Projektion (auch Letterbox: Schritte, Kompasswert) ---------- */
function startPeilMessen() { closeSheet(); S.peil = { deg: null, dist: null }; $('#peilbar').hidden = false; if (S.mode !== 'cam') toast('Handy senkrecht halten und das Ziel anvisieren'); }
function updatePeilbar(sc) {
  const el = $('#peilbar');
  if (!sc) { el.innerHTML = '<b>📐 Peilen</b> – Kompass fehlt'; return; }
  const deg = (viewHeading(sc) + S.set.compassOffset + 360) % 360, pitch = vecElev(camVec(sc));
  const dist = pitch < -1.5 ? S.set.phoneH / Math.tan(-pitch * D2R) : null;
  S.peil.deg = deg; S.peil.dist = dist && dist < 300 ? dist : null;
  if (!el.dataset.ready) {
    el.innerHTML = `<div><b>📐 Peilen</b> <span id="pbVal"></span></div><small>Fadenkreuz auf das Ziel. Für die Entfernung auf den Fuß des Ziels zielen (Handyhöhe ${String(S.set.phoneH).replace('.', ',')} m).</small>
      <div class="tools"><button id="pbDeg">Richtung übernehmen</button><button id="pbBoth">Richtung + Entfernung</button><button id="pbX">✕</button></div>`;
    el.dataset.ready = '1';
    const done = withDist => { const p = S.peil; S.peil = null; el.hidden = true; delete el.dataset.ready; showPeilung({ deg: Math.round(p.deg), dist: withDist && p.dist ? Math.round(p.dist) : null }); };
    el.querySelector('#pbDeg').onclick = () => done(false);
    el.querySelector('#pbBoth').onclick = () => done(true);
    el.querySelector('#pbX').onclick = () => { S.peil = null; el.hidden = true; delete el.dataset.ready; };
  }
  el.querySelector('#pbVal').textContent = `${Math.round(deg)}° ${compassName(deg)} · ${S.peil.dist ? 'ca. ' + Math.round(S.peil.dist) + ' m' : 'Entfernung: auf den Fuß zielen'}`;
}
function showPeilung(pre) {
  pre = pre || {};
  const c = curCache(), last = S.peilForm || {};
  openSheet('📐 Peilung / Projektion', `
    <label class="f"><span>Von</span><select id="pFrom"><option value="me">meinem Standort</option><option value="target">dem aktuellen Ziel</option><option value="coord">Koordinaten …</option></select></label>
    <input id="pCoord" type="text" placeholder="N 48° 22.123 E 010° 53.456" hidden>
    <div class="two"><label class="f"><span>Entfernung</span><input id="pDist" inputmode="decimal" value="${esc(pre.dist != null ? pre.dist : last.dist || '')}"></label>
      <label class="f"><span>Einheit</span><select id="pUnit"><option value="m">Meter</option><option value="steps">Schritte (${String(S.set.stepLen).replace('.', ',')} m)</option><option value="km">km</option><option value="ft">Fuß</option></select></label></div>
    <div class="two"><label class="f"><span>Richtung (°)</span><input id="pDeg" inputmode="decimal" value="${esc(pre.deg != null ? pre.deg : last.deg || '')}"></label>
      <label class="f c"><input type="checkbox" id="pMag" ${last.mag && pre.deg == null ? 'checked' : ''}><span>Kompasswert (missweisend, +${String(S.set.declination).replace('.', ',')}°)</span></label></div>
    <div class="tools"><button id="pMeasure">📷 Mit der Kamera peilen</button><button id="pCalc">➜ Berechnen</button>${(S.rays || []).length ? `<button id="pRays">✕ ${S.rays.length} Peilstrahl${S.rays.length > 1 ? 'en' : ''} löschen</button>` : ''}</div>
    <div id="pRes"></div>`, b => {
    const $b = q => b.querySelector(q);
    $b('#pFrom').value = last.from || 'me'; $b('#pUnit').value = last.unit || 'm'; $b('#pCoord').value = last.coord || '';
    $b('#pCoord').hidden = $b('#pFrom').value !== 'coord';
    $b('#pFrom').onchange = () => { $b('#pCoord').hidden = $b('#pFrom').value !== 'coord'; };
    $b('#pMeasure').onclick = startPeilMessen;
    if ($b('#pRays')) $b('#pRays').onclick = () => { S.rays = []; drawRays(); $b('#pRays').remove(); toast('Peilstrahlen gelöscht'); };
    const calc = () => {
      const f = { from: $b('#pFrom').value, coord: $b('#pCoord').value, dist: $b('#pDist').value, unit: $b('#pUnit').value, deg: $b('#pDeg').value, mag: $b('#pMag').checked };
      S.peilForm = f;
      const start = f.from === 'me' ? S.pos : f.from === 'target' ? S.target : parseCoord(f.coord);
      const dv = evalExpr(f.dist, {}).value, gv = evalExpr(f.deg, {}).value;
      if (!start) return toast(f.from === 'me' ? 'Noch keine GPS-Position' : f.from === 'target' ? 'Kein Ziel' : 'Koordinaten nicht lesbar');
      if (dv == null || gv == null) return toast('Entfernung und Richtung eintragen');
      const m = dv * ({ m: 1, steps: S.set.stepLen, km: 1000, ft: 0.3048 }[f.unit] || 1), brg = ((gv + (f.mag ? S.set.declination : 0)) % 360 + 360) % 360;
      const q = destPoint(start.lat, start.lon, m, brg), txt = fmtCoord(q.lat, q.lon);
      $b('#pRes').innerHTML = `<div class="stn final"><div class="coord big">${txt}</div><small>${Math.round(m)} m in ${Math.round(brg)}° ${compassName(brg)}${f.mag ? ' (geografisch)' : ''}${S.pos ? ' · ' + fmtDist(haversine(S.pos.lat, S.pos.lon, q.lat, q.lon)) + ' von dir' : ''}</small>
        <div class="tools"><button id="pGo">🎯 Als Ziel</button><button id="pCopy">📋 Kopieren</button>${c ? '<button id="pSave">💾 Als Wegpunkt</button>' : ''}</div></div>`;
      $b('#pGo').onclick = () => setTarget({ kind: 'wpt', geocode: c ? c.geocode : '', lat: q.lat, lon: q.lon, label: `Peilung ${Math.round(m)} m / ${Math.round(brg)}°`, name: c ? c.name : 'Peilung' });
      $b('#pCopy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('📋 ' + txt));
      const sv = $b('#pSave');
      if (sv) sv.onclick = () => run(async () => {
        c.wpts = c.wpts || []; const n = c.wpts.filter(w => w.type === 'peilung').length + 1;
        c.wpts.push({ name: `Peilung ${n}: ${f.dist} ${f.unit === 'steps' ? 'Schritte' : f.unit} / ${f.deg}°${f.mag ? ' (Kompass)' : ''}`, prefix: 'P' + n, lat: q.lat, lon: q.lon, type: 'peilung', note: '' });
        await idbPut('caches', c); drawCacheMarkers(); toast('💾 als Wegpunkt P' + n + ' gespeichert');
      });
    };
    $b('#pCalc').onclick = calc;
    if (pre.deg != null) setTimeout(() => { if ($b('#pDist').value) calc(); }, 50);
  });
}

export { startPeilMessen, updatePeilbar, showPeilung };
