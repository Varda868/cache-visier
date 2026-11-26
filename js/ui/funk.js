import { esc, fmtDist, haversine } from '../kern/geo.js';
import { buzz } from './ansagen.js';
import { $, S, run, toast } from './basis.js';
import { loadScript } from './import.js';
import { teamZellenEmpfang } from './team.js';
import { NX, talkEvent, talkRufname } from './talk.js';

/* ---------- Sprechfunk über Nostr mit den Bausteinen der b:con-App (bcon/: Codec2, Sprechfunk, netz.js) ---------- */
const LIVE_KIND = 20442; // flüchtig (Relays speichern nicht): Live-Position im Kanal, versiegelt
let _bc = null;
function bconVoice() {
  if (!_bc) _bc = (async () => {
    if (typeof Codec2Modul === 'undefined') await loadScript('bcon/codec2.js');
    if (typeof Sprechfunk === 'undefined') await loadScript('bcon/sprechfunk.js');
    const netz = await import(new URL('bcon/netz.js', document.baseURI).href);
    await Sprechfunk.laden();
    return { netz, SF: Sprechfunk, emp: new Sprechfunk.Empfaenger(), mic: new Sprechfunk.Mikrofon(), sammler: new netz.Sammler() };
  })().catch(e => { _bc = null; throw e; });
  return _bc;
}
function talkFab() {
  const f = $('#fPtt'); if (!f) return;
  const T = S.talk, ch = T.channels || [], on = !!(S.set.talkOn && T.pool && ch.length);
  f.hidden = !on;
  const c = ch.find(x => x.id === T.sendTo); $('#fPttCh').textContent = c ? c.icon : '';
  f.title = c ? `Sprechen an ${c.name} (gedrückt halten)` : '';
  if (on && !f._bound) { f._bound = true; bindPtt(f); bconVoice().catch(() => {}); } // Bausteine vorladen, damit der Druck sofort zählt
}
function bindPtt(el) {
  el.oncontextmenu = e => e.preventDefault();
  el.onpointerdown = e => { e.preventDefault(); S.talk.held = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } run(pttStart); };
  el.onpointerup = el.onpointercancel = () => { S.talk.held = false; run(pttStop); };
}
function pttShow(s) { // s = null: bereit, sonst Sekunden seit Start
  const t = $('#tPtt'), f = $('#fPtt');
  if (t) { t.classList.toggle('on', s != null); t.textContent = s == null ? '🎙️ Gedrückt halten zum Sprechen' : s > 25 ? `🎙️ noch ${Math.ceil(30 - s)} s` : `🎙️ spricht … ${Math.floor(s)} s`; }
  if (f) { f.classList.toggle('on', s != null); $('#fPttT').textContent = s == null ? '' : s > 25 ? `noch ${Math.ceil(30 - s)}` : `${Math.floor(s)} s`; }
  if (s == null) [t, f].forEach(e => e && e.style.removeProperty('--pegel'));
}
async function pttStart() {
  const T = S.talk;
  if (T.rec || T.recStarting) return;
  const chan = (T.channels || []).find(c => c.id === T.sendTo);
  if (!chan) throw new Error('Kein Kanal: Cache als Ziel wählen oder Team-Passwort setzen');
  T.recStarting = true;
  try {
    const B = await bconVoice(); await B.SF.audio();
    const codec = new B.SF.Codec(3), zeit = Math.floor(Date.now() / 1000);  // Codec2 1600 (Kennung 3), Standard für Gruppen
    const a = new B.netz.Aufnahme(T.sk, { codec: 3, flags: B.netz.mitPrio(0, 0), ziel: B.netz.ALLE, zeit, name: talkRufname(), region: '', gruppe: 0 }, codec.nb);
    T.rec = { a, codec, chan, t0: Date.now(), zeit };
    B.mic.agc = true;
    B.mic.beiRahmen = pcm => { if (T.rec) T.rec.a.rahmen(T.rec.codec.kodieren(pcm)); };
    B.mic.beiPegel = p => { if (!T.rec) return; const v = Math.min(1, p * 3).toFixed(2); [$('#tPtt'), $('#fPtt')].forEach(e => e && e.style.setProperty('--pegel', v)); };
    await B.mic.oeffnen(codec.n);
    if (!T.held) {                                                        // losgelassen, während das Mikrofon aufging (z. B. Freigabe-Dialog)
      T.rec = null; B.mic.beiRahmen = null; B.mic.schliessen(); codec.frei();
      return toast('🎙️ Mikrofon bereit – zum Sprechen gedrückt halten');
    }
    T.rec.t0 = Date.now();
    B.SF.signal('frei'); buzz([30]);
    pttShow(0);
    T.recTimer = setInterval(() => {
      if (!T.rec) return;
      const s = (Date.now() - T.rec.t0) / 1000;
      pttShow(s);
      if (s >= 30) run(pttStop);                                         // höchstens 30 s an Gruppen (b:con-Regel)
    }, 200);
  } finally { T.recStarting = false; }
}
async function pttStop() {
  const T = S.talk;
  if (T.recStarting) return;                                              // pttStart merkt am Halte-Status selbst, dass losgelassen wurde
  const r = T.rec; if (!r) return;
  T.rec = null; clearInterval(T.recTimer);
  pttShow(null);
  const B = await bconVoice();
  B.mic.beiRahmen = null; B.mic.schliessen(); B.SF.signal('los'); r.codec.frei();
  const k = await r.a.fertig();
  if (!k || Date.now() - r.t0 < 400) return toast('Zu kurz – Taste länger halten');
  const X = NX(), kenn = await B.netz.kennung(k), anzahl = Math.ceil(k.length / 1600), ablauf = String(r.zeit + 86400);
  let ok = 0;
  for (let t = 0; t < anzahl; t++) {
    const tags = [['talk', kenn, String(t), String(anzahl)], ['alt', 'b:con-Sprechfunk'], ['L', 'bcon.gruppe'], ['l', r.chan.kennung, 'bcon.gruppe'],
      ['gruppe', r.chan.kennung], ['expiration', ablauf]];
    const ev = await X.finishEvent({ kind: 4420, created_at: r.zeit, tags, content: await B.netz.versiegeln(r.chan.ck, k.subarray(t * 1600, (t + 1) * 1600)) }, T.sk);
    const res = await T.pool.publish(ev); ok = Math.max(ok, res.filter(x => x.ok).length);
    await talkEvent(ev);                                                  // eigenes Echo in die Liste
  }
  toast(ok ? `🎙️ gesendet (${Math.round((Date.now() - r.t0) / 1000)} s, ${ok} Relay${ok > 1 ? 's' : ''})` : '🎙️ kein Relay hat angenommen');
}
async function voiceWeiter() {
  const T = S.talk; if (T.playing) return;
  T.playing = true; $('#fPtt')?.classList.add('rx');
  while (T.queue.length) await voicePlay(T.queue.shift()).catch(e => console.warn('Wiedergabe', e));
  T.playing = false; $('#fPtt')?.classList.remove('rx');
}
async function voicePlay(d) {
  const B = await bconVoice(), c = B.SF.CODECS[d.kopf.codec]; if (!c) return;
  await B.SF.audio();
  const slot = 200 + (S.talk.slot++ % 50);
  B.emp.beginnen(slot, d.kopf.codec, { weg: 'nostr', sprecher: d.kopf.schluessel });
  await B.emp.slots.get(slot)?.bereit;
  const nb = B.emp.slots.get(slot)?.codec?.nb || 8;
  let ms = 0;
  d.pakete.forEach((p, i) => {
    const dauer = (p.length ? p.length / nb : 10) * c.ms, b = new Uint8Array(5 + p.length);
    b.set([0x50, slot, i + 1, dauer & 255, dauer >> 8]); b.set(p, 5);
    B.emp.paket(b); ms += dauer;
  });
  await new Promise(r => setTimeout(r, ms + 300));
  B.emp.beenden(slot);
}
/* Live-Position: alle 30 s im gewählten Kanal (Cache oder Team), nur solange b:con talk an und die Einstellung es erlaubt */
async function liveEmpfang(ev, chan) {
  try {
    const j = JSON.parse(await NX().nip44Decrypt(chan.ck, ev.content));
    if (j.team) teamZellenEmpfang(ev.pubkey, j);
    if (!isFinite(j.lat) || !isFinite(j.lon)) return;
    S.talk.pos[ev.pubkey] = { name: String(j.n || ev.pubkey.slice(0, 6)).slice(0, 9), lat: +j.lat, lon: +j.lon, acc: +j.acc || 0, ts: ev.created_at * 1000, live: true, chan: chan.icon + ' ' + chan.name };
    drawTalkPos(); talkRenderMates();
  } catch (e) { /* nicht lesbar */ }
}
async function liveSenden() {
  const T = S.talk, m = S.set.talkLive;
  if (!S.set.talkOn || m === 'aus' || !T.pool || !S.pos || document.hidden) return;
  const ch = (T.channels || []).filter(c => m === 'cache+team' || c.id === 'team');
  for (const c of ch) {
    const body = JSON.stringify({ n: talkRufname(), lat: +S.pos.lat.toFixed(6), lon: +S.pos.lon.toFixed(6), acc: Math.round(S.pos.acc || 0) });
    const ev = await NX().finishEvent({ kind: LIVE_KIND, tags: [['L', 'bcon.gruppe'], ['l', c.kennung, 'bcon.gruppe'], ['gruppe', c.kennung]], content: await NX().nip44Encrypt(c.ck, body) }, T.sk);
    T.pool.publish(ev, 3000);
  }
}
setInterval(() => run(liveSenden), 30000);
window.CVT = { liveSenden, bconVoice }; // für Tests und die Browser-Konsole
function talkRenderMates() {
  const el = $('#talkMates'); if (!el) return;
  const now = Date.now(), list = Object.values(S.talk.pos).filter(p => now - p.ts < 5 * 60000);
  el.innerHTML = list.length ? '👥 ' + list.map(p => `${esc(p.name)}${S.pos ? ' ' + fmtDist(haversine(S.pos.lat, S.pos.lon, p.lat, p.lon)) : ''}${p.live ? '' : ' (gemeldet)'}`).join(' · ') : '';
}

function drawTalkPos() {
  if (!S.map || !S.L.talk) return;
  S.L.talk.clearLayers();
  const now = Date.now();
  for (const p of Object.values(S.talk.pos)) {
    if (now - p.ts > 3 * 3600000) continue;
    window.L.marker([p.lat, p.lon], { icon: window.L.divIcon({ className: 'talkPos', html: '💬 ' + esc(p.name), iconSize: null }) })
      .bindPopup(`${esc(p.name)} · ${new Date(p.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`).addTo(S.L.talk);
  }
}

export { LIVE_KIND, _bc, bconVoice, talkFab, bindPtt, pttShow, pttStart, pttStop, voiceWeiter, voicePlay, liveEmpfang, liveSenden, talkRenderMates, drawTalkPos };
