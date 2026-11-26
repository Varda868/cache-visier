import { parseCoord } from '../kern/formeln.js';
import { esc, fmtCoord } from '../kern/geo.js';
import { buzz } from './ansagen.js';
import { $, S, idbGet, idbPut, openSheet, run, toast } from './basis.js';
import { LIVE_KIND, bconVoice, bindPtt, drawTalkPos, liveEmpfang, talkFab, talkRenderMates, voiceWeiter } from './funk.js';
import { teamPlanEmpfang, teamStart } from './team.js';
import { curCache, setTarget } from './ziel-routing.js';

/* ---------- b:con talk über öffentliche Nostr-Relays (Chat Art 4423, Sprechfunk Art 4420 nur als Hinweis) ---------- */
const NX = () => window.CVNostr;
function talkRufname() { return (S.set.talkName || 'CACHER').toUpperCase().replace(/[^A-Z0-9\-/.]/g, '').slice(0, 9) || 'CACHER'; } // Base40, wie b:con
async function talkKey() {
  let h = await idbGet('meta', 'nostrSk').catch(() => null);
  if (!h) { const b = NX().randomBytes(32); b[0] &= 0x7f; h = NX().hex(b); await idbPut('meta', h, 'nostrSk'); } // bleibt nur im Handy
  return NX().unhex(h);
}
/* Kanäle: 🧩 der aktuelle Cache (Passwort = GC/OC-Code, wie eine b:con-Gruppe) – alle, die diesen Cache als Ziel haben
   und b:con talk an, sind automatisch drin –, dazu optional 🔒 Team (eigenes Passwort). Gefunden werden die Events über
   das Label bcon.gruppe mit der Gruppenkennung (Relays filtern nur einbuchstabige Tags). */
const _gk = new Map();
async function chanKey(pw) { if (!_gk.has(pw)) _gk.set(pw, NX().groupKey(pw)); return _gk.get(pw); }
function cacheCode() { const c = curCache(); return c && /^(GC|OC)[0-9A-Z]+$/i.test(c.geocode) ? c.geocode.toUpperCase() : ''; }
async function talkChannels() {
  const T = S.talk, ch = [];
  if (S.set.talkCache && cacheCode()) { const g = await chanKey(cacheCode()); ch.push({ id: 'cache', name: cacheCode(), icon: '🧩', ...g }); }
  if (S.set.talkPw) { const g = await chanKey(S.set.talkPw); ch.push({ id: 'team', name: 'Team', icon: '🔒', ...g }); }
  T.channels = ch;
  if (!ch.some(c => c.id === T.sendTo)) T.sendTo = ch.length ? ch[0].id : null;
  return ch;
}
async function talkSubscribe() {
  const T = S.talk; if (!T.pool) return;
  const ch = await talkChannels(), since = Math.floor(Date.now() / 1000) - 86400, filters = [{ kinds: [4420, 4423], '#p': [T.pk], since }];
  if (ch.length) filters.unshift({ kinds: [4420, 4423, LIVE_KIND], '#L': ['bcon.gruppe'], '#l': ch.map(c => c.kennung), since });
  T.pool.sub('cvtalk', filters);
  talkRenderStatus();
}
async function initTalk() {
  const T = S.talk;
  $('#bTalk').hidden = !S.set.talkOn;
  if (T.pool) { T.pool.close(); T.pool = null; }
  talkFab();
  if (!S.set.talkOn) return;
  if (!NX()) return toast('b:con talk: Nostr-Baustein fehlt');
  T.sk = await talkKey(); T.pk = NX().hex(NX().getPublicKey(T.sk));
  if (!T.loaded) { T.loaded = true; const old = await idbGet('meta', 'talklog').catch(() => null); if (old) for (const m of old) { T.msgs.push(m); T.seen.add(m.id); } }
  const urls = String(S.set.talkRelays || '').split(/[\s,]+/).filter(u => /^wss:\/\//.test(u));
  T.pool = new (NX().Pool)(urls, ev => talkEvent(ev), st => { T.status = st; talkRenderStatus(); });
  await talkSubscribe();
  T.pool.open();
  updateTalkBadge();
}
async function talkEvent(ev) {
  const T = S.talk, X = NX();
  if (!ev || T.seen.has(ev.id) || (ev.kind !== 4423 && ev.kind !== 4420 && ev.kind !== LIVE_KIND)) return;
  T.seen.add(ev.id);
  if (!(await X.verifyEvent(ev))) return;                                  // gefälschte oder kaputte Events weg
  const exp = +X.tagVal(ev, 'expiration'); if (exp && exp < Date.now() / 1000) return;
  const gk = X.tagVal(ev, 'gruppe'), toMe = (ev.tags || []).some(t => t[0] === 'p' && t[1] === T.pk), eigen = ev.pubkey === T.pk;
  const chan = gk ? (T.channels || []).find(c => c.kennung === gk) : null;
  if (gk && !chan) return;                                                 // fremde Gruppe oder anderer Cache
  if (!gk && !toMe) return;                                                // offene Nachrichten gibt es hier nicht
  const msg = { id: ev.id, pk: ev.pubkey, ts: ev.created_at * 1000, eigen, chan: chan ? chan.icon + ' ' + chan.name : '✉️ privat', kind: ev.kind };
  if (ev.kind === LIVE_KIND) { if (chan && !eigen) await liveEmpfang(ev, chan); return; }
  if (ev.kind === 4420) {
    // Sprechfunk wie in der b:con-App: Teile sammeln, Kompaktform prüfen (Sprecher-Signatur), dann abspielen
    const B = await bconVoice().catch(() => null); if (!B) return;
    const i = await B.netz.teilLesen(ev, T.sk, new Map((T.channels || []).map(c => [c.kennung, c]))); if (!i) return;
    const k = await B.sammler.teil(i); if (!k) return;
    const d = await B.netz.kompaktLesen(k); if (!d || (!d.signatur && !d.fehlend)) return;
    const echt = d.signatur || ev.pubkey === d.kopf.schluessel, nb = (B.SF.CODECS[d.kopf.codec] ? 8 : 8);
    const sek = Math.max(1, Math.round(d.pakete.reduce((n, p) => n + (p.length ? p.length / (d.kopf.codec === 8 ? 4 : nb) : 10), 0) * (B.SF.CODECS[d.kopf.codec]?.ms || 40) / 1000));
    msg.id = 'v' + i.kennung; msg.name = echt ? (d.kopf.name || d.kopf.schluessel.slice(0, 6)) : d.kopf.schluessel.slice(0, 6) + ' (ungeprüft)';
    msg.text = `🎙️ Sprachnachricht · ${sek} s`; msg.voice = i.kennung;
    T.voice.set(i.kennung, d);
    if (!eigen && msg.ts > Date.now() - 3 * 60000) { T.queue.push(d); voiceWeiter(); }
  } else {
    try {
      const raw = chan ? await X.nip44Decrypt(chan.ck, ev.content) : await X.nip44Decrypt(await X.conversationKey(T.sk, ev.pubkey), ev.content);
      const j = JSON.parse(raw); msg.name = String(j.n || '').slice(0, 12) || ev.pubkey.slice(0, 6); msg.text = String(j.t || '').slice(0, 500);
      if (j.plan && chan) teamPlanEmpfang(j.plan, ev.pubkey, chan, eigen);
    } catch (e) { return; }
  }
  if (!msg.text) return;
  const c = parseCoord(msg.text);
  if (c && !eigen) { T.pos[ev.pubkey] = { name: msg.name, lat: c.lat, lon: c.lon, ts: msg.ts }; drawTalkPos(); }
  T.msgs.push(msg); T.msgs.sort((a, b) => a.ts - b.ts); if (T.msgs.length > 300) T.msgs.splice(0, T.msgs.length - 300);
  clearTimeout(T.saveT); T.saveT = setTimeout(() => idbPut('meta', T.msgs.slice(-200), 'talklog').catch(() => {}), 1500);
  if (!eigen && msg.ts > Date.now() - 10 * 60000 && ($('#sheetTitle').textContent !== '💬 b:con talk' || $('#sheet').hidden)) {
    T.unread++; updateTalkBadge(); toast(`💬 ${msg.chan} · ${msg.name}: ${msg.text.slice(0, 80)}`, 4000); buzz([30, 60, 30]);
  }
  talkRenderList();
}
function updateTalkBadge() { const b = $('#bTalk'); b.dataset.n = S.talk.unread || ''; b.classList.toggle('badge', !!S.talk.unread); }
function talkRenderStatus() {
  talkFab();
  const el = $('#talkStatus'); if (!el) return;
  const st = S.talk.status || { offen: 0, gesamt: 0 }, ch = S.talk.channels || [];
  el.innerHTML = `${st.offen ? '🟢' : '🔴'} ${st.offen}/${st.gesamt} Relays · ${ch.length ? ch.map(c => c.icon + ' ' + esc(c.name)).join(' · ') : 'kein Kanal – Cache als Ziel wählen oder Team-Passwort setzen'} · du: ${esc(talkRufname())}`;
}
function talkRenderList() {
  const el = $('#talkList'); if (!el) return;
  const T = S.talk, names = (T.channels || []).map(c => c.icon + ' ' + c.name).concat(['✉️ privat']);
  const list = T.msgs.filter(m => names.includes(m.chan)).slice(-120);
  el.innerHTML = list.map((m, i) => {
    if (!m.chan) return '';
    const c = parseCoord(m.text);
    return `<li class="tmsg${m.eigen ? ' me' : ''}"><div class="th"><span class="chan">${esc(m.chan || '')}</span> <b>${esc(m.name)}</b> <small>${new Date(m.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
      <div class="tt">${esc(m.text)}</div>${c ? `<button data-tgo="${i}">🎯 als Ziel</button>` : ''}${m.voice && S.talk.voice.has(m.voice) ? `<button data-play="${esc(m.voice)}">▶ abspielen</button>` : ''}</li>`;
  }).join('') || '<li class="empty">Noch keine Nachrichten der letzten 24 h.</li>';
  el.querySelectorAll('[data-tgo]').forEach(b => { b.onclick = () => { const m = list[+b.dataset.tgo], c = parseCoord(m.text); setTarget({ kind: 'wpt', geocode: '', lat: c.lat, lon: c.lon, label: '💬 ' + m.name, name: m.name }); }; });
  el.querySelectorAll('[data-play]').forEach(b => { b.onclick = () => { const d = S.talk.voice.get(b.dataset.play); if (d) { S.talk.queue.push(d); voiceWeiter(); } }; });
  if (!list.length) el.innerHTML = '<li class="empty">Noch keine Nachrichten in deinen Kanälen (letzte 24 h).</li>';
  el.scrollTop = el.scrollHeight;
}
async function talkSend(text, extra) {
  const T = S.talk, X = NX();
  text = String(text || '').trim(); if (!text) return;
  if (!T.pool || !T.sk) throw new Error('b:con talk ist aus (Einstellungen)');
  const chan = (T.channels || []).find(c => c.id === T.sendTo);
  if (!chan) throw new Error('Kein Kanal: einen Cache als Ziel wählen oder ein Team-Passwort setzen');
  const body = JSON.stringify({ n: talkRufname(), t: text.slice(0, 500), p: 0, ...(extra || {}) }); // übers Netz nie Durchsage; extra z. B. Team-Plan
  const tags = [['L', 'bcon.gruppe'], ['l', chan.kennung, 'bcon.gruppe'], ['gruppe', chan.kennung], ['alt', 'b:con-Chat'],
    ['expiration', String(Math.floor(Date.now() / 1000) + 86400)]];
  const ev = await X.finishEvent({ kind: 4423, tags, content: await X.nip44Encrypt(chan.ck, body) }, T.sk);
  const res = await T.pool.publish(ev), ok = res.filter(r => r.ok).length;
  if (!ok) throw new Error('kein Relay hat angenommen' + (res[0] ? ': ' + (res[0].msg || '') : ''));
  await talkEvent(ev); // eigenes Echo sofort anzeigen
  return ok;
}
async function showTalk() {
  if (S.talk.chanCode !== cacheCode()) { S.talk.chanCode = cacheCode(); await talkSubscribe(); }
  if (!S.set.talkOn) return toast('b:con talk in den Einstellungen einschalten');
  const T = S.talk; T.unread = 0; updateTalkBadge();
  await talkChannels();
  const c = curCache(), here = S.pos ? `📍 ${fmtCoord(S.pos.lat, S.pos.lon)} ±${Math.round(S.pos.acc)} m` : '';
  openSheet('💬 b:con talk', `
    <p class="sub" id="talkStatus"></p><p class="sub" id="talkMates"></p>
    <div class="seg" id="tChan">${(T.channels || []).map(c => `<label><input type="radio" name="tch" value="${c.id}" ${c.id === T.sendTo ? 'checked' : ''}>${c.icon} ${esc(c.name)}</label>`).join('')}</div>
    <ul class="tlist" id="talkList"></ul>
    <button id="tPtt" class="ptt">🎙️ Gedrückt halten zum Sprechen</button>
    <div class="tsend"><input id="tText" type="text" maxlength="500" placeholder="Nachricht …"><button id="tSend">➤</button></div>
    <div class="tools"><button data-q="pos">📍 Standort</button>${c ? '<button data-q="found">✅ Gefunden</button>' : ''}${S.target ? '<button data-q="ziel">🎯 Ziel teilen</button>' : ''}<button data-q="help">🙋 Hilfe</button>${c && (T.channels || []).length ? '<button data-q="team">👥 Suche aufteilen</button>' : ''}</div>
    <p class="sub">🧩 = alle, die diesen Cache als Ziel haben und b:con talk an. Den Kanal kann lesen, wer den Code kennt – also nicht geheim. 🔒 Team = nur mit eurem Passwort. Über öffentliche Nostr-Relays, verfällt nach 24 h. b:con ist kein Notrufsystem.</p>`, b => {
    talkRenderStatus(); talkRenderList(); talkRenderMates();
    const send = txt => run(async () => { const n = await talkSend(txt); b.querySelector('#tText').value = ''; toast(`💬 gesendet (${n} Relay${n > 1 ? 's' : ''})`); });
    b.querySelector('#tSend').onclick = () => send(b.querySelector('#tText').value);
    b.querySelector('#tText').onkeydown = e => { if (e.key === 'Enter') send(e.target.value); };
    b.querySelectorAll('input[name=tch]').forEach(r => { r.onchange = () => { S.talk.sendTo = r.value; talkFab(); }; });
    bindPtt(b.querySelector('#tPtt'));
    bconVoice().then(B => B.SF.audio()).catch(() => {}); // Ton freischalten (Nutzergeste)
    b.querySelectorAll('[data-q]').forEach(q => {
      q.onclick = () => {
        const k = q.dataset.q;
        if (k === 'pos') { if (!here) return toast('Noch keine GPS-Position'); send(here + (c ? ` (bei ${c.geocode})` : '')); }
        if (k === 'found') send(`✅ ${c.geocode} ${c.name} gefunden`);
        if (k === 'ziel') send(`🎯 Ziel: ${S.target.label || S.target.name || ''} ${fmtCoord(S.target.lat, S.target.lon)}`);
        if (k === 'team') run(teamStart);
        if (k === 'help') send(`🙋 Brauche Hilfe${c ? ' bei ' + c.geocode : ''}${here ? ' – ' + here : ''}`);
      };
    });
  });
}

export { NX, talkRufname, talkKey, _gk, chanKey, cacheCode, talkChannels, talkSubscribe, initTalk, talkEvent, updateTalkBadge, talkRenderStatus, talkRenderList, talkSend, showTalk };
