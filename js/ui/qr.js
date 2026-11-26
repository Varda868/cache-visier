/* CacheVisier · ui/qr: QR-Codes im Kamerabild erkennen (BarcodeDetector, Chrome/Android) und Fundkarte für QR und NFC.
   Inhalt wird nie selbst geöffnet: Koordinate → Ziel, Link → erst nach Tipp, mit Domain davor. */
import { parseCoord } from '../kern/formeln.js';
import { esc, fmtCoord } from '../kern/geo.js';
import { buzz } from './ansagen.js';
import { $, S, toast } from './basis.js';
import { curCache, setTarget } from './ziel-routing.js';

let _det = null, _busy = false, _letzt = { txt: '', ts: 0 };
async function detektor() {
  if (_det !== null) return _det;
  _det = false;
  try {
    if ('BarcodeDetector' in window) {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) _det = new window.BarcodeDetector({ formats: ['qr_code', 'data_matrix', 'aztec'].filter(x => f.includes(x)) });
    }
  } catch (e) { _det = false; }
  return _det;
}
const qrMoeglich = async () => !!(await detektor());

/* alle ~0,7 s im Kamerabild nachsehen */
async function qrTick() {
  if (_busy || S.mode !== 'cam' || S.set.qrScan === false || document.hidden) return;
  const v = $('#cam'); if (!v || !v.videoWidth || v.paused) return;
  const d = await detektor(); if (!d) return;
  _busy = true;
  try {
    const r = await d.detect(v);
    const q = r && r.find(x => x.rawValue);
    rahmen(q, v);
    if (q && (q.rawValue !== _letzt.txt || Date.now() - _letzt.ts > 30000)) zeigeCode(q.rawValue, '🔳 QR-Code');
    if (q) _letzt = { txt: q.rawValue, ts: Date.now() };
  } catch (e) { /* Bild gerade nicht lesbar */ }
  _busy = false;
}
setInterval(qrTick, 700);

/* Rahmen um den Code – Videokoordinaten auf den Bildschirm umrechnen (object-fit: cover) */
function rahmen(q, v) {
  const el = $('#qrBox'); if (!el) return;
  if (!q || !q.boundingBox) { el.hidden = true; return; }
  const W = innerWidth, H = innerHeight, k = Math.max(W / v.videoWidth, H / v.videoHeight);
  const ox = (W - v.videoWidth * k) / 2, oy = (H - v.videoHeight * k) / 2, b = q.boundingBox;
  Object.assign(el.style, { left: ox + b.x * k + 'px', top: oy + b.y * k + 'px', width: b.width * k + 'px', height: b.height * k + 'px' });
  el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 1500);
}

/* Fundkarte: was steht drin, was kann man damit machen */
function zeigeCode(raw, quelle) {
  const txt = String(raw || '').slice(0, 2000), el = $('#codeCard'); if (!el || !txt.trim()) return;
  const c = parseCoord(txt), url = /^https?:\/\/[^\s]+$/i.test(txt.trim()) ? txt.trim() : null;
  let host = ''; try { host = url ? new URL(url).host : ''; } catch (e) { /* kein Link */ }
  el.innerHTML = `<div class="cc-h">${quelle}</div>
    <div class="cc-t">${c ? `📍 <b>${esc(fmtCoord(c.lat, c.lon))}</b>` : url ? `🔗 <b>${esc(host)}</b><br><small>${esc(url.slice(0, 120))}</small>` : esc(txt.slice(0, 300))}</div>
    ${c && txt.replace(/\s+/g, ' ').length > 40 ? `<div class="cc-s">${esc(txt.slice(0, 200))}</div>` : ''}
    <div class="cc-b">${c ? '<button data-c="ziel">🎯 Als Ziel</button>' : ''}${url ? '<button data-c="auf">🔗 Öffnen</button>' : ''}<button data-c="kop">📋 Kopieren</button><button data-c="zu" aria-label="Schließen">✕</button></div>`;
  el.hidden = false; buzz([40, 40, 40]);
  el.querySelectorAll('[data-c]').forEach(b => {
    b.onclick = async () => {
      const k = b.dataset.c, cc = curCache();
      if (k === 'ziel') { setTarget({ kind: 'wpt', geocode: cc ? cc.geocode : '', lat: c.lat, lon: c.lon, label: quelle.replace(/^\S+\s/, '') + ': ' + fmtCoord(c.lat, c.lon), name: cc ? cc.name : '' }); toast('🎯 Ziel gesetzt'); el.hidden = true; }
      if (k === 'auf') window.open(url, '_blank', 'noopener');
      if (k === 'kop') { try { await navigator.clipboard.writeText(c ? fmtCoord(c.lat, c.lon) : txt); toast('📋 kopiert'); } catch (e) { toast('Kopieren nicht erlaubt'); } }
      if (k === 'zu') el.hidden = true;
    };
  });
}
window.CVQR = { zeigeCode, qrTick }; // für Tests
export { qrMoeglich, qrTick, zeigeCode };
