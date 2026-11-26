import { GEAR_HARD, toolsOf } from '../kern/ausruestung.js';
import { TYPE_INFO, dnfStreak, lastFound, logTypeInfo } from '../kern/caches.js';
import { bearing, compassName, esc, fmtCoord, fmtDate, fmtDist, haversine, htmlText, rot13 } from '../kern/geo.js';
import { $, S, openSheet, run, toast } from './basis.js';
import { showDiag, showSettings } from './einstellungen.js';
import { showChecker } from './checker.js';
import { showHilfe } from './hilfe.js';
import { showSonden } from './sonden.js';
import { nfcMoeglich, showNfc } from './nfc.js';
import { showSicherung } from './sicherung.js';
import { loadNewestBackup, loadOcNearby, pickFile, stripHtml } from './import.js';
import { aiAll, showAi } from './ki-auswertung.js';
import { multiState, showMulti } from './multi.js';
import { showOffline } from './offline.js';
import { showPeilung } from './peilung.js';
import { showTour } from './tour.js';
import { curCache, gearBadge, setTarget, targetCache } from './ziel-routing.js';

/* ---------- Blätter: Liste ---------- */
function showList(filter = '') {
  const p = S.pos;
  let list = [...S.caches.values()];
  if (filter) { const f = filter.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(f) || c.geocode.toLowerCase().includes(f)); }
  if (p) list.forEach(c => { c._d = haversine(p.lat, p.lon, c.lat, c.lon); c._b = bearing(p.lat, p.lon, c.lat, c.lon); });
  list.sort((a, b) => (a._d || 0) - (b._d || 0));
  const rows = list.slice(0, 300).map(c => {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    return `<li class="row${c.found ? ' found' : ''}" data-g="${esc(c.geocode)}"><span class="dot" style="background:${ti[1]}"></span>
      <div class="grow"><b>${esc(c.name)}</b><small>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${S.ai.has(c.geocode) ? ' · 🤖' : ''}${gearBadge(c)}</small></div>
      <span class="dd">${p ? fmtDist(c._d) + '<br>' + compassName(c._b) : ''}</span></li>`;
  }).join('');
  openSheet(`Caches (${S.caches.size})`, `
    <div class="tools">
      <button id="lFolder">📁 c:geo-Backup laden</button><button id="lFile">📄 Datei wählen</button><button id="lOc">🟢 OC in der Nähe</button>
      <button id="lTour">🗺️ Tour</button>${S.set.sonden ? '<button id="lSonde">🎈 Sonden</button>' : ''}<button id="lSet">⚙️ Einstellungen</button><button id="lHelp">❓ Hilfe</button><button id="lMore" aria-expanded="${S.moreOpen ? 'true' : 'false'}">${S.moreOpen ? '▴ Weniger' : '⋯ Mehr'}</button>
      <span id="lMoreBox" ${S.moreOpen ? '' : 'hidden'}><button id="lAi">🤖 Alle auswerten</button><button id="lPeil">📐 Peilung</button><button id="lOff">📦 Offline</button><button id="lBackup">💾 Sicherung</button><button id="lDiag">🩺 Diagnose</button>${nfcMoeglich() ? '<button id="lNfc">📶 NFC</button>' : ''}</span>
    </div>
    <input id="lFilter" type="search" placeholder="Suchen (Name oder Code)" value="${esc(filter)}">
    <ul class="list">${rows || '<li class="empty">Noch keine Caches. In c:geo Caches offline speichern und ein Backup machen, dann „c:geo-Backup laden“.</li>'}</ul>`, b => {
    b.querySelector('#lFolder').onclick = () => run(loadNewestBackup);
    b.querySelector('#lFile').onclick = pickFile;
    b.querySelector('#lOc').onclick = () => run(loadOcNearby);
    b.querySelector('#lPeil').onclick = () => showPeilung();
    b.querySelector('#lOff').onclick = () => run(showOffline);
    b.querySelector('#lTour').onclick = () => showTour();
    if (b.querySelector('#lSonde')) b.querySelector('#lSonde').onclick = () => run(showSonden);
    b.querySelector('#lAi').onclick = () => run(aiAll);
    b.querySelector('#lSet').onclick = showSettings;
    b.querySelector('#lDiag').onclick = showDiag;
    if (b.querySelector('#lNfc')) b.querySelector('#lNfc').onclick = showNfc;
    b.querySelector('#lHelp').onclick = () => showHilfe();
    b.querySelector('#lBackup').onclick = () => run(showSicherung);
    b.querySelector('#lMore').onclick = e => { S.moreOpen = !S.moreOpen; b.querySelector('#lMoreBox').hidden = !S.moreOpen; e.target.textContent = S.moreOpen ? '▴ Weniger' : '⋯ Mehr'; e.target.setAttribute('aria-expanded', String(S.moreOpen)); };
    const fi = b.querySelector('#lFilter'); fi.oninput = () => { clearTimeout(fi._t); fi._t = setTimeout(() => showList(fi.value), 300); };
    b.querySelectorAll('li.row').forEach(li => { li.onclick = () => targetCache(li.dataset.g); });
  });
}

/* ---------- Blätter: Cache-Infos + Hint ---------- */
function infoSheet() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const wp = (c.wpts || []).map((w, i) => `<li class="row" ${w.lat != null ? `data-w="${i}"` : ''}><div class="grow"><b>${esc(w.prefix)} ${esc(w.name)}</b><small>${esc(w.type)} · ${w.lat != null ? fmtCoord(w.lat, w.lon) : 'ohne Koordinaten'}${w.note ? ' · ' + esc(stripHtml(w.note).slice(0, 140)) : ''}</small></div><span class="dd">${w.lat != null ? 'Ziel' : ''}</span></li>`).join('');
  openSheet(c.name, `
    <p class="sub">${esc(c.geocode)} · ${(TYPE_INFO[c.type] || TYPE_INFO.other)[0]} · D${c.d || '?'}/T${c.t || '?'} ${c.size ? '· ' + esc(c.size) : ''} ${c.owner ? '· von ' + esc(c.owner) : ''}</p>
    <p class="coord">${fmtCoord(c.lat, c.lon)}${c.corrected ? ' (korrigiert)' : ''}</p>
    ${toolsOf(c, S.ai.get(c.geocode)).length ? `<h4>🧰 Ausrüstung</h4><ul class="list">${toolsOf(c, S.ai.get(c.geocode)).map(a => { const has = S.set['gear_' + a.key] !== false, hart = GEAR_HARD.has(a.key); return `<li class="gear ${has ? 'ok' : hart ? 'miss' : 'soft'}">${a.icon} <b>${esc(a.label)}</b> <small>${has ? '✓ hast du' : hart ? '✗ fehlt – Tour überspringt' : '🎒 einpacken'}</small></li>`; }).join('')}</ul>` : ''}
    ${(c.attrs || []).filter(a => !a.tool).length ? `<h4>Attribute</h4><div class="chips">${(c.attrs || []).filter(a => !a.tool).map(a => `<span class="chip${a.yes ? '' : ' neg'}">${a.icon} ${esc(a.label)}</span>`).join('')}</div>` : ''}
    <h4>Hint</h4>
    <div id="hint" class="hint blur">${esc(htmlText(c.hint) || '– kein Hint –')}</div>
    <div class="tools"><button id="hShow">👁 Anzeigen</button><button id="hRot">🔤 ROT13</button><button id="hCache">🎯 Cache als Ziel</button></div>
    ${c.note ? `<h4>Persönliche Notiz</h4><div class="hint">${esc(htmlText(c.note))}</div>` : ''}
    ${wp ? `<h4>Wegpunkte</h4><ul class="list">${wp}</ul>` : ''}
    <div class="tools"><button id="hMulti">🧩 Stationen</button><button id="hPeil">📐 Peilung</button>${['mystery', 'multi', 'wherigo'].includes(c.type) ? '<button id="hChk">✔️ Checker</button>' : ''}<button id="hOpen">↗️ In c:geo / im Browser öffnen</button></div>`, b => {
    const hc = b.querySelector('#hChk');
    if (hc) hc.onclick = () => { const m = S.multi.get(c.geocode), f = m && m.stationen ? multiState(c, m).fin : null; if (f && f.lat != null) showChecker(c, f.lat, f.lon, 'Final berechnet'); else if (c.corrected) showChecker(c, c.lat, c.lon, 'korrigierte Koordinaten'); else showChecker(c, null, null); };
    b.querySelector('#hMulti').onclick = () => run(() => showMulti(c));
    b.querySelector('#hPeil').onclick = () => showPeilung();
    const h = b.querySelector('#hint');
    b.querySelector('#hShow').onclick = () => h.classList.toggle('blur');
    b.querySelector('#hRot').onclick = () => { h.textContent = rot13(h.textContent); h.classList.remove('blur'); };
    b.querySelector('#hCache').onclick = () => targetCache(c.geocode);
    b.querySelector('#hOpen').onclick = () => openExternal(c.geocode);
    b.querySelectorAll('li[data-w]').forEach(li => { li.onclick = () => { const w = c.wpts[+li.dataset.w]; setTarget({ kind: 'wpt', geocode: c.geocode, lat: w.lat, lon: w.lon, label: `${w.prefix} ${w.name}`, name: c.name }); }; });
  });
}
function openExternal(code) { window.open(/^OC/i.test(code) ? 'https://www.opencaching.de/' + code : 'https://coord.info/' + code, '_blank'); }

/* ---------- Blätter: Logs ---------- */
function logsSheet() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const lf = lastFound(c.logs), streak = dnfStreak(c.logs);
  const items = (c.logs || []).map(l => { const [n, k] = logTypeInfo(l.type); return `<li class="log ${k}"><div class="lh"><span class="lt">${esc(n)}</span> ${fmtDate(l.date)} · ${esc(l.author)}</div><div class="lx">${esc(htmlText(l.text))}</div></li>`; }).join('');
  openSheet(`Logs · ${c.geocode}`, `
    <p class="sub">${(c.logs || []).length} Logs · letzter Fund: ${lf ? fmtDate(lf) : '–'}${streak ? ` · <b class="warn">${streak} DNF in Folge</b>` : ''}</p>
    <ul class="logs">${items || '<li class="empty">Keine Logs gespeichert. In c:geo den Cache mit Logs offline speichern.</li>'}</ul>`);
}

/* ---------- Ein Knopf „Cache“: Hint, Logs und KI als Reiter ---------- */
const REITER = [['info', '💡 Hint'], ['logs', '📜 Logs'], ['ki', '🤖 KI']];
function cacheTabs(active) {
  S.cacheTab = active;
  const bar = document.createElement('div'); bar.className = 'tabs';
  bar.innerHTML = REITER.map(([k, l]) => `<button data-tab="${k}" class="${k === active ? 'on' : ''}">${l}</button>`).join('');
  bar.onclick = e => { const b = e.target.closest('[data-tab]'); if (b && b.dataset.tab !== active) ({ info: showInfo, logs: showLogs, ki: showAi })[b.dataset.tab](); };
  $('#sheetBody').prepend(bar);
}
function showInfo() { if (!curCache()) return toast('Kein Cache als Ziel'); infoSheet(); cacheTabs('info'); }
function showLogs() { if (!curCache()) return toast('Kein Cache als Ziel'); logsSheet(); cacheTabs('logs'); }
function showCache() { ({ info: showInfo, logs: showLogs, ki: showAi })[S.cacheTab || 'info'](); }

export { showList, showInfo, openExternal, showLogs, cacheTabs, showCache };
