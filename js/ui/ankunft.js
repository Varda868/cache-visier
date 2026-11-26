/* CacheVisier · ui/ankunft: beim ersten Erreichen der Zielzone einmal D/T, Dosengröße und letzten Logstand zeigen und ansagen */
import { arrivalInfo, logTypeInfo } from '../kern/caches.js';
import { esc, fmtDate } from '../kern/geo.js';
import { buzz, say } from './ansagen.js';
import { $, S } from './basis.js';
import { showLogs } from './blaetter.js';
import { curCache, targetKey } from './ziel-routing.js';

const ZONE_M = 25; // Zielzone: 25 m, bei schlechtem GPS so groß wie die Ungenauigkeit

/* nur für den Cache selbst oder sein Final – Zwischenstationen eines Multis lösen nichts aus */
function zielZaehlt(t) { return t && (t.kind === 'cache' || (t.kind === 'wpt' && /final/i.test(t.label || ''))); }

function checkArrival(t, dist, p) {
  if (!zielZaehlt(t)) return;
  const c = curCache(); if (!c) return;
  const key = c.geocode + '@' + targetKey(t);
  S.arrived = S.arrived || new Set();
  if (S.arrived.has(key) || dist > Math.max(ZONE_M, (p && p.acc) || 0)) return;
  S.arrived.add(key);
  showArrival(c);
}

function showArrival(c) {
  const a = arrivalInfo(c), el = $('#arrive');
  const icon = { found: '✅', dnf: '❌', maint: '🔧', admin: '🛠️', note: '📝' };
  const l = a.last;
  el.innerHTML = `
    <div class="ar-h">🎯 Zielzone · <b>${esc(c.name)}</b></div>
    <div class="ar-r"><span class="ar-c">${esc(a.dt)}</span>${a.size ? `<span class="ar-c">📦 ${esc(a.size)}</span>` : ''}</div>
    <div class="ar-l ${l ? 'k-' + l.kind : ''}">${l ? `${icon[l.kind] || '📄'} Letzter Log: <b>${esc(l.typ)}</b>${l.date ? ` · ${fmtDate(l.date)} (${esc(a.vorText)})` : ''}${l.author ? ` · ${esc(l.author)}` : ''}` : 'Keine Logs gespeichert'}</div>
    ${a.streak >= 2 ? `<div class="ar-w">⚠️ ${a.streak}× nicht gefunden in Folge${a.lastFound ? ` · letzter Fund ${fmtDate(a.lastFound)}` : ''}</div>` : l && l.kind !== 'found' && a.lastFound ? `<div class="ar-s">Letzter Fund: ${fmtDate(a.lastFound)}</div>` : ''}
    <div class="ar-t"><button data-a="logs">📜 Logs</button><button data-a="zu">✕ Schließen</button></div>`;
  el.hidden = false; el.classList.remove('weg');
  clearTimeout(S.arriveT); S.arriveT = setTimeout(hideArrival, 20000);
  el.onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.a === 'logs') showLogs(); hideArrival(); };
  buzz([120, 60, 120]); say(a.sprache);
}
function hideArrival() {
  const el = $('#arrive'); if (!el || el.hidden) return;
  el.classList.add('weg'); clearTimeout(S.arriveT); setTimeout(() => { el.hidden = true; el.classList.remove('weg'); }, 300);
}

export { ZONE_M, zielZaehlt, checkArrival, showArrival, hideArrival };
