import { TYPE_INFO, logTypeInfo, nearestOsm } from '../kern/caches.js';
import { D2R, compassName, destPoint, esc, fmtDate, haversine, htmlText } from '../kern/geo.js';
import { KIA, S, idbPut, openSheet, run, toast } from './basis.js';
import { drawCacheMarkers } from './karte.js';
import { showFotoFrage, showMulti } from './multi.js';
import { curCache, setTarget } from './ziel-routing.js';

/* ---------- KI-Auswertung ---------- */
async function osmAround(lat, lon, m) {
  const dLa = m / 111320, dLo = m / (111320 * Math.cos(lat * D2R));
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${(lon - dLo).toFixed(6)},${(lat - dLa).toFixed(6)},${(lon + dLo).toFixed(6)},${(lat + dLa).toFixed(6)}`);
  if (!r.ok) throw new Error('OSM ' + r.status);
  return (await r.json()).elements || [];
}
async function resolveZones(c, res) {
  const zones = [];
  const kk = res.koordinaten_korrektur;
  if (kk && kk.meter > 0 && kk.richtung_grad >= 0) {
    const p = destPoint(c.lat, c.lon, kk.meter, kk.richtung_grad);
    zones.push({ label: `Korrektur: ${Math.round(kk.meter)} m ${compassName(kk.richtung_grad)}`, lat: p.lat, lon: p.lon, r: Math.max(4, kk.meter * 0.3), zitat: kk.zitat || '', sicherheit: kk.sicherheit || '' });
  }
  const pos = res.positionen || [];
  let osm = null;
  if (pos.some(p => p.osm_key)) { try { osm = await osmAround(c.lat, c.lon, 170); } catch (e) { console.warn(e); } }
  for (const p of pos) {
    let anchor = null;
    if (osm && p.osm_key) {
      anchor = nearestOsm(osm, p.osm_key, p.osm_value, c.lat, c.lon);
      if (!anchor && p.osm_key === 'highway' && p.osm_value === 'bus_stop') anchor = nearestOsm(osm, 'public_transport', '*', c.lat, c.lon);
    }
    if (!anchor && /listing|koordinate|cache/i.test(p.anker || '')) anchor = { lat: c.lat, lon: c.lon, dist: 0 };
    const z = { label: `${p.anker}${p.abstand_m > 0 ? ' · ' + p.abstand_m + ' m' : ''}${p.richtung_text ? ' · ' + p.richtung_text : ''}`, zitat: p.zitat || '', sicherheit: p.sicherheit || '' };
    if (anchor) {
      z.anchorDist = Math.round(anchor.dist);
      if (p.abstand_m > 0 && p.richtung_grad >= 0) { const q = destPoint(anchor.lat, anchor.lon, p.abstand_m, p.richtung_grad); z.lat = q.lat; z.lon = q.lon; z.r = Math.max(3, p.abstand_m * 0.3); }
      else { z.lat = anchor.lat; z.lon = anchor.lon; z.r = p.abstand_m > 0 ? p.abstand_m : 5; z.ring = p.abstand_m > 0; }
    } else z.unresolved = true;
    zones.push(z);
  }
  return zones;
}
function kiAnbieter() { // eigene Schlüssel, in fester Reihenfolge (Gemini zuerst: kostenlos und bildfähig)
  return KIA().map(a => ({ ...a, key: String(S.set['kiKey_' + a.id] || '').trim(), model: String(S.set['kiModel_' + a.id] || '').trim() })).filter(a => a.key && a.model);
}
function kiZiel() { const a = kiAnbieter(); return S.set.kiMode === 'skript' ? 'dein KI-Skript (' + (S.set.apiUrl || 'Adresse fehlt') + ')' : a.length ? a.map(x => x.name).join(' → ') : 'die KI (noch kein Schlüssel eingetragen)'; }
async function kiCall(body) {
  if (S.set.kiMode !== 'skript') {
    if (!window.CVKI) throw new Error('KI-Baustein fehlt');
    try { return await CVKI.run(body, kiAnbieter()); } catch (e) { throw new Error('KI: ' + (e && e.message || e)); }
  }
  if (!S.set.apiUrl) throw new Error('KI-Adresse fehlt (Einstellungen)');
  const r = await fetch(S.set.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': S.set.apiToken || '' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: 'Antwort nicht lesbar (HTTP ' + r.status + ')' }));
  if (!j.ok) throw new Error('KI: ' + (j.error || 'HTTP ' + r.status));
  return j;
}
async function aiAnalyze(c) {
  const body = {
    geocode: c.geocode, name: c.name, type: (TYPE_INFO[c.type] || TYPE_INFO.other)[0], d: c.d, t: c.t, size: c.size, hint: htmlText(c.hint), lat: c.lat, lon: c.lon, attribute: (c.attrs || []).map(a => a.label).join(', '),
    logs: (c.logs || []).slice(0, 40).map(l => ({ date: l.date ? new Date(l.date).toISOString().slice(0, 10) : '', type: logTypeInfo(l.type)[0], author: l.author, text: htmlText(l.text).slice(0, 900) }))
  };
  const j = await kiCall(body);
  const res = j.result || {}; res.ts = Date.now(); res.model = j.model || '';
  res.zones = await resolveZones(c, res);
  await idbPut('ai', { geocode: c.geocode, ...res });
  S.ai.set(c.geocode, res);
  return res;
}
async function aiAll() {
  // ohne Auswertung oder noch im alten Format (ohne Suchhilfe) → (neu) auswerten
  const todo = [...S.caches.values()].filter(c => (!S.ai.has(c.geocode) || !S.ai.get(c.geocode).suchhilfe) && (c.logs || []).length && !c.found);
  if (S.pos) todo.sort((a, b) => haversine(S.pos.lat, S.pos.lon, a.lat, a.lon) - haversine(S.pos.lat, S.pos.lon, b.lat, b.lon));
  const list = todo.slice(0, 60);
  if (!list.length) return toast('Nichts auszuwerten (alle schon ausgewertet oder ohne Logs)');
  if (!confirm(`${list.length} Caches (die nächsten) mit KI auswerten?`)) return;
  let ok = 0, fail = 0, i = 0;
  const worker = async () => { while (i < list.length) { const c = list[i++]; try { await aiAnalyze(c); ok++; } catch (e) { fail++; console.warn(c.geocode, e); } toast(`🤖 ${ok + fail}/${list.length} ausgewertet${fail ? ` (${fail} Fehler)` : ''}`, 60000); } };
  await Promise.all([worker(), worker()]);
  toast(`✅ ${ok} ausgewertet${fail ? `, ${fail} Fehler` : ''}`); drawCacheMarkers();
}
const ZUSTAND = { gut: ['gut', '#2ecc40'], wartung_noetig: ['Wartung nötig', '#ff9f1a'], vermutlich_weg: ['vermutlich weg', '#ff4136'], unklar: ['unklar', '#9aa7b2'] };
const KAT = { versteck: ['📍', 'Versteck'], behaelter: ['📦', 'Behälter'], werkzeug: ['🔧', 'Werkzeug'], zugang: ['🚶', 'Zugang'],
  tarnung: ['🎭', 'Tarnung'], muggel: ['👀', 'Muggel'], parken: ['🅿️', 'Parken / Start'], sonstiges: ['💡', 'Sonstiges'] };
function isoDe(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
/* Beleg: Zitat + Datum + Lognummer; antippen zeigt den ganzen Log */
function beleg(x) {
  const meta = [isoDe(x.datum), x.log_nr ? 'Log ' + x.log_nr : ''].filter(Boolean).join(' · ');
  return `<q data-l="${x.log_nr || 0}">${esc(x.zitat || '')}${meta ? ` <small>(${esc(meta)})</small>` : ''}</q><div class="full" hidden></div>`;
}
function showAi() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const a = S.ai.get(c.geocode);
  let body;
  if (!a) body = `<p>Noch nicht ausgewertet. Die Logs (${(c.logs || []).length}) gehen an ${esc(kiZiel())}.</p>`;
  else {
    const z = ZUSTAND[a.zustand] || ZUSTAND.unklar;
    const hilfe = (a.suchhilfe || []).concat((a.versteck_hinweise || []).map(h => ({ ...h, kategorie: 'versteck' })));
    const gruppen = Object.keys(KAT).map(k => [k, hilfe.filter(h => (KAT[h.kategorie] ? h.kategorie : 'sonstiges') === k)]).filter(g => g[1].length);
    body = `
    <div class="zst"><span class="badge" style="background:${z[1]}">${z[0]}</span>
      <span>${a.letzter_fund ? 'Fund ' + isoDe(a.letzter_fund) : 'kein Fund in den Logs'}${a.dnf_serie ? ` · <b class="warn">${a.dnf_serie} DNF in Folge</b>` : ''}${a.letzte_wartung ? ' · Wartung ' + isoDe(a.letzte_wartung) : ''}</span></div>
    ${a.kurzfassung ? `<p class="ki">${esc(a.kurzfassung)}</p>` : ''}
    ${(a.warnungen || []).length ? '<h4>⚠️ Achtung</h4><ul class="list">' + a.warnungen.map(w => `<li class="ai warnli"><b>${esc(w.hinweis)}</b>${beleg(w)}</li>`).join('') + '</ul>' : ''}
    ${gruppen.length ? '<h4>Suchhilfe</h4><ul class="list">' + gruppen.map(([k, hs]) => hs.map(h => `<li class="ai"><span class="kat">${KAT[k][0]} ${KAT[k][1]}</span><b>${esc(h.hinweis)}</b>${beleg(h)}</li>`).join('')).join('') + '</ul>' : '<p class="sub">Keine konkreten Suchhinweise in den Logs.</p>'}
    ${(a.zustand_details || []).length ? '<h4>Zustand</h4><ul class="list">' + a.zustand_details.map(d => `<li class="ai"><b>${esc(d.punkt)}</b>${beleg(d)}</li>`).join('') + '</ul>' : ''}
    ${(a.stationen || []).length ? '<h4>Stationen</h4><ul class="list">' + a.stationen.map(st => `<li class="ai"><span class="kat">${esc(st.station)}</span><b>${esc(st.hinweis)}</b>${beleg(st)}</li>`).join('') + '</ul>' : ''}
    ${(a.zones || []).length ? '<h4>Suchzonen</h4><ul class="list">' + a.zones.map((zo, i) => `<li class="ai"><b>${esc(zo.label)}</b>${zo.sicherheit ? ` <small>(${esc(zo.sicherheit)})</small>` : ''}<q>${esc(zo.zitat)}</q>
       ${zo.unresolved ? '<small class="warn">Bezugspunkt nicht in OpenStreetMap gefunden</small>' : `<small>${zo.anchorDist != null ? 'Bezugspunkt ' + zo.anchorDist + ' m von den Listing-Koordinaten · ' : ''}Radius ${Math.round(zo.r)} m</small> <button data-z="${i}">🎯 Als Ziel</button>`}</li>`).join('') + '</ul>' : ''}
    <p class="sub">${esc(a.model || '')} · ${fmtDate(a.ts)} – aus den Logs gezogen, Zitat antippen zeigt den ganzen Log.</p>`;
  }
  openSheet(`KI · ${c.geocode}`, body + `<div class="tools"><button id="aGo">🤖 ${a ? 'Neu auswerten' : 'Logs auswerten'}</button><button id="aAsk">❓ Foto-Frage</button><button id="aMulti">🧩 Stationen</button></div>`, b => {
    b.querySelector('#aAsk').onclick = () => run(() => showFotoFrage(c, {}));
    b.querySelector('#aMulti').onclick = () => run(() => showMulti(c));
    b.querySelector('#aGo').onclick = () => run(async () => { toast('🤖 werte aus …', 30000); await aiAnalyze(c); toast('✅ fertig'); drawCacheMarkers(); showAi(); });
    b.querySelectorAll('button[data-z]').forEach(bt => { bt.onclick = () => { const zo = a.zones[+bt.dataset.z]; setTarget({ kind: 'zone', geocode: c.geocode, lat: zo.lat, lon: zo.lon, label: zo.label, r: zo.r, name: c.name }); }; });
    b.querySelectorAll('q[data-l]').forEach(q => {
      q.onclick = () => {
        const n = +q.dataset.l, l = n > 0 ? (c.logs || [])[n - 1] : null, box = q.nextElementSibling;
        if (!l || !box) return;
        if (box.hidden) { const [ty] = logTypeInfo(l.type); box.innerHTML = `<div class="lh"><span class="lt">${esc(ty)}</span> ${fmtDate(l.date)} · ${esc(l.author)}</div><div class="lx">${esc(htmlText(l.text))}</div>`; }
        box.hidden = !box.hidden;
      };
    });
  });
}

export { osmAround, resolveZones, kiAnbieter, kiZiel, kiCall, aiAnalyze, aiAll, ZUSTAND, KAT, isoDe, beleg, showAi };
