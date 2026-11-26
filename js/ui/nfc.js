/* CacheVisier · ui/nfc: NFC-Anhänger lesen und beschreiben (Web NFC, nur Chrome auf Android mit NFC).
   Lesen zeigt Text, Links und Koordinaten auf der Fundkarte; Schreiben für eigene Caches/Stationen. */
import { fmtCoord } from '../kern/geo.js';
import { $, S, openSheet, run, toast } from './basis.js';
import { zeigeCode } from './qr.js';
import { curCache } from './ziel-routing.js';

const nfcMoeglich = () => 'NDEFReader' in window;
let _ctl = null;

function recordText(r) {
  try {
    if (r.recordType === 'text' || r.recordType === 'url' || r.recordType === 'absolute-url') return new TextDecoder(r.encoding || 'utf-8').decode(r.data);
    if (r.mediaType && /^text\/|json|xml/.test(r.mediaType)) return new TextDecoder().decode(r.data);
  } catch (e) { /* unlesbar */ }
  return null;
}
async function nfcLesen(sek = 60) {
  if (!nfcMoeglich()) throw new Error('NFC im Browser geht nur mit Chrome auf Android und eingeschaltetem NFC');
  if (_ctl) _ctl.abort();
  _ctl = new AbortController(); const ctl = _ctl;
  const r = new window.NDEFReader();
  await r.scan({ signal: ctl.signal });
  toast(`📶 Handy an den NFC-Anhänger halten (${sek} s)`, 4000);
  setTimeout(() => ctl.abort(), sek * 1000);
  r.onreadingerror = () => toast('📶 Anhänger nicht lesbar – noch einmal ranhalten');
  r.onreading = ev => {
    const teile = (ev.message.records || []).map(recordText).filter(Boolean);
    zeigeCode(teile.length ? teile.join('\n') : `Anhänger ${ev.serialNumber || ''} ohne lesbaren Text`, '📶 NFC');
  };
}
async function nfcSchreiben(text) {
  if (!nfcMoeglich()) throw new Error('NFC im Browser geht nur mit Chrome auf Android');
  text = String(text || '').trim(); if (!text) throw new Error('Kein Text');
  const w = new window.NDEFReader(), ctl = new AbortController();
  setTimeout(() => ctl.abort(), 60000);
  toast('📶 Handy an den Anhänger halten – wird beschrieben', 4000);
  await w.write({ records: [/^https?:\/\//.test(text) ? { recordType: 'url', data: text } : { recordType: 'text', data: text, lang: 'de' }] }, { signal: ctl.signal });
  toast('✅ Anhänger beschrieben');
}
function showNfc() {
  const c = curCache(), vorschlag = S.pos ? fmtCoord(S.pos.lat, S.pos.lon) : c ? fmtCoord(c.lat, c.lon) : '';
  openSheet('📶 NFC', `
    <p class="sub">Für NFC-Stationen in Multis und eigene Caches. Text, Links und Koordinaten werden angezeigt; Koordinaten lassen sich als Ziel setzen.</p>
    <button id="nLesen" class="big">📶 Anhänger lesen</button>
    <h3>Anhänger beschreiben</h3>
    <textarea id="nText" rows="3" maxlength="500">${vorschlag}</textarea>
    <button id="nSchreib">✍️ Schreiben</button>
    <p class="sub">Überschreibt, was auf dem Anhänger steht. Gesperrte Anhänger lassen sich nicht beschreiben.</p>`, b => {
    b.querySelector('#nLesen').onclick = () => run(() => nfcLesen());
    b.querySelector('#nSchreib').onclick = () => run(() => nfcSchreiben(b.querySelector('#nText').value));
  });
}
export { nfcMoeglich, nfcLesen, nfcSchreiben, showNfc };
