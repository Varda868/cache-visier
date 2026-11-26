/* CacheVisier · ui/team: Team-Suche über b:con talk – Suchfeld in Tortenstücke aufteilen, abgesuchte Stellen für alle einfärben.
   Plan und Ende gehen als normale Chatnachricht (Art 4423, lesbarer Text + Feld "plan"), abgesuchte Felder flüchtig (Art 20442, Feld "team"). */
import { bearing, destPoint, esc, haversine } from '../kern/geo.js';
import { ZELLE, inSektor, planPruefen, sektorAnteil, teileSektoren, zellMitte, zellOk, zelle } from '../kern/team.js';
import { buzz } from './ansagen.js';
import { $, S, run, toast } from './basis.js';
import { LIVE_KIND } from './funk.js';
import { NX, talkRufname, talkSend } from './talk.js';
import { curCache } from './ziel-routing.js';

const MAX_ALTER = 2 * 3600000;
// S erst bei Gebrauch anfassen: die Module laden sich teils im Kreis, beim Laden ist S evtl. noch nicht fertig
const TM = () => S.team || (S.team = { plan: null, chan: null, mit: false, zellen: new Map(), meine: new Set(), ende: {}, weg: 0, gesendet: 0, neu: false });
const meinSektor = () => { const p = TM().plan; return p && S.talk.pk ? p.s.find(x => x.pk === S.talk.pk) : null; };

/* Wer ist dabei: ich + alle, die in den letzten Minuten im Kanal gefunkt oder ihre Position geteilt haben */
function teamLeute() {
  const T = S.talk, now = Date.now(), m = new Map();
  m.set(T.pk, { pk: T.pk, n: talkRufname(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon });
  for (const msg of T.msgs || []) if (!msg.eigen && msg.pk && now - msg.ts < 15 * 60000 && !m.has(msg.pk)) m.set(msg.pk, { pk: msg.pk, n: msg.name });
  for (const [pk, p] of Object.entries(T.pos || {})) if (now - p.ts < 10 * 60000) m.set(pk, { pk, n: (m.get(pk) || {}).n || p.name, lat: p.lat, lon: p.lon });
  return [...m.values()];
}
function teamZiel() {
  const c = curCache(); if (!c) return null;
  const t = S.target && S.target.lat != null ? S.target : c;
  return { gc: c.geocode, lat: t.lat, lon: t.lon };
}
async function teamStart() {
  if (!S.talk.pool || !S.talk.pk) return toast('b:con talk ist aus');
  const z = teamZiel(); if (!z) return toast('Erst einen Cache als Ziel wählen');
  const leute = teamLeute();
  if (leute.length < 2) return toast('👥 Noch niemand im Kanal: Mitsucher brauchen b:con talk mit demselben Cache bzw. Team-Passwort und sollten kurz etwas schreiben oder 📍 Standort senden.', 6500);
  const plan = { v: 1, gc: z.gc, ts: Date.now(), lat: +z.lat.toFixed(6), lon: +z.lon.toFixed(6), r: 20, s: teileSektoren(z.lat, z.lon, leute) };
  const txt = `👥 Suche aufgeteilt bei ${z.gc} (${plan.r} m): ` + plan.s.map(x => `${x.n} ${x.name}`).join(' · ');
  const n = await talkSend(txt, { plan });
  toast(`👥 Plan an ${plan.s.length} Sucher gesendet (${n} Relay${n > 1 ? 's' : ''})`);
}
async function teamEnde(gefunden) {
  const p = TM().plan; if (!p) return;
  if (gefunden) await talkSend(`✅ ${talkRufname()} hat bei ${p.gc} gefunden – Suche beendet`, { plan: { v: 1, gc: p.gc, ts: Date.now(), ende: true } });
  else { TM().weg = p.ts; teamAus(); }
}
function teamAus() { const t = TM(); t.plan = null; t.mit = false; t.zellen = new Map(); t.meine = new Set(); teamRender(); drawTeam(); }

/* aus talkEvent: Plan oder Ende empfangen */
function teamPlanEmpfang(roh, pk, chan, eigen) {
  const p = planPruefen(roh), t = TM(); if (!p) return;
  if (p.ende) {
    t.ende[p.gc] = Math.max(t.ende[p.gc] || 0, p.ts);
    if (t.plan && t.plan.gc === p.gc && t.plan.ts <= p.ts) { teamAus(); if (!eigen) { toast('✅ Team-Suche beendet – gefunden!', 5000); buzz([60, 40, 60]); } }
    return;
  }
  if (Date.now() - p.ts > MAX_ALTER || p.ts <= (t.ende[p.gc] || 0) || p.ts === t.weg || (t.plan && t.plan.ts >= p.ts)) return;
  t.plan = p; t.chan = chan ? chan.kennung : null; t.zellen = new Map(); t.meine = new Set(); t.gesendet = 0;
  const me = meinSektor();
  t.mit = !!(eigen && me); // wer aufteilt, macht mit; alle anderen entscheiden selbst
  if (!eigen && me) { toast(`👥 Dein Sektor bei ${p.gc}: ${me.name} (${Math.round(me.von) % 360}°–${Math.round(me.bis) % 360}°)`, 6000); buzz([40, 50, 40, 50, 40]); }
  teamRender(); drawTeam();
}
/* aus liveEmpfang: abgesuchte Felder eines Mitsuchers */
function teamZellenEmpfang(pk, j) {
  const p = TM().plan, d = j && j.team;
  if (!p || !d || d.gc !== p.gc || d.ts !== p.ts || !Array.isArray(d.z)) return;
  let neu = 0;
  for (const k of d.z.slice(0, 400)) if (zellOk(k) && !TM().zellen.has(k)) { TM().zellen.set(k, pk); neu++; }
  if (neu) { teamRender(); drawTeam(); }
}

/* eigene Spur ins Raster schreiben, alle 20 s an die anderen (flüchtig, Relays speichern das nicht) */
function teamTick() {
  const t = TM(), p = t.plan;
  if (!p) return;
  if (Date.now() - p.ts > MAX_ALTER) return teamAus();
  if (!t.mit || !S.pos || (S.pos.acc || 99) > 15) return;
  if (haversine(p.lat, p.lon, S.pos.lat, S.pos.lon) > p.r + 4) return;
  const k = zelle(p.lat, p.lon, S.pos.lat, S.pos.lon);
  if (!t.meine.has(k)) { t.meine.add(k); t.zellen.set(k, S.talk.pk); t.neu = true; teamRender(); drawTeam(); }
}
async function teamSenden() {
  const t = TM(), p = t.plan, T = S.talk;
  if (!p || !t.mit || !t.meine.size || !T.pool || document.hidden) return;
  if (!t.neu && Date.now() - t.gesendet < 60000) return; // ohne Neues nur jede Minute (für Nachzügler)
  const c = (T.channels || []).find(x => x.kennung === t.chan); if (!c) return;
  const body = JSON.stringify({ n: talkRufname(), team: { gc: p.gc, ts: p.ts, z: [...t.meine].slice(-300) } });
  const ev = await NX().finishEvent({ kind: LIVE_KIND, tags: [['L', 'bcon.gruppe'], ['l', c.kennung, 'bcon.gruppe'], ['gruppe', c.kennung]], content: await NX().nip44Encrypt(c.ck, body) }, T.sk);
  T.pool.publish(ev, 3000); t.neu = false; t.gesendet = Date.now();
}
setInterval(teamTick, 2000);
setInterval(() => run(teamSenden), 20000);
window.CVTeam = { teamSenden, teamTick }; // für Tests

/* Leiste über der unteren Knopfreihe */
let _rT = 0;
function teamRender() {
  const el = $('#teamBar'); if (!el) return;
  const t = TM(), p = t.plan;
  if (!p) { el.hidden = true; return; }
  const now = performance.now(); if (now - _rT < 300 && !el.hidden) { clearTimeout(t.rT); t.rT = setTimeout(teamRender, 320); return; } _rT = now;
  const me = meinSektor(), alle = { von: 0, bis: 360 };
  const anteil = Math.round(100 * sektorAnteil(me || alle, p.r, t.zellen));
  const wohin = me && S.pos ? (() => {
    const d = haversine(p.lat, p.lon, S.pos.lat, S.pos.lon), b = bearing(p.lat, p.lon, S.pos.lat, S.pos.lon);
    return d > p.r + 4 ? ' · zum Ziel' : inSektor(b, me) || d < 3 ? ' · ✔ du bist drin' : ' · ↻ nicht in deinem Stück';
  })() : '';
  el.innerHTML = `<span>👥 ${me ? `Dein Sektor <b>${esc(me.name)}</b> ${Math.round(me.von) % 360}–${Math.round(me.bis) % 360}°` : `Team sucht bei ${esc(p.gc)}`} · ${anteil} % abgesucht${wohin}</span>
    ${me && !t.mit ? '<button data-t="mit">▶ Mitmachen</button>' : ''}${me ? '<button data-t="gef">✅</button>' : ''}<button data-t="aus" aria-label="Team-Suche ausblenden">✕</button>`;
  el.hidden = false;
  el.querySelectorAll('[data-t]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.t;
      if (k === 'mit') { t.mit = true; t.neu = true; teamTick(); teamRender(); toast('👥 Deine abgesuchten Stellen werden mit dem Team geteilt'); }
      if (k === 'gef') run(() => teamEnde(true));
      if (k === 'aus') teamEnde(false);
    };
  });
}

/* Karte: Tortenstücke und abgesuchte Felder */
function sektorPunkte(p, s) {
  const pts = [[p.lat, p.lon]], step = Math.max(4, (s.bis - s.von) / 24);
  for (let a = s.von; a <= s.bis + 0.01; a += step) { const q = destPoint(p.lat, p.lon, p.r, Math.min(a, s.bis)); pts.push([q.lat, q.lon]); }
  return pts;
}
function drawTeam() {
  if (!S.map || !S.L.team) return;
  const L = window.L, t = TM(), p = t.plan; S.L.team.clearLayers();
  if (!p) return;
  const me = meinSektor();
  for (const s of p.s) {
    const mein = me && s.pk === me.pk;
    L.polygon(sektorPunkte(p, s), { color: mein ? '#ffdc00' : '#8aa4c8', weight: mein ? 3 : 1.5, dashArray: mein ? null : '5 6', fillOpacity: mein ? 0.08 : 0.03, interactive: false }).addTo(S.L.team);
    const m = destPoint(p.lat, p.lon, p.r * 0.62, (s.von + s.bis) / 2);
    L.marker([m.lat, m.lon], { icon: L.divIcon({ className: 'teamLbl' + (mein ? ' mein' : ''), html: esc(s.n), iconSize: null }), interactive: false }).addTo(S.L.team);
  }
  const h = ZELLE / 2 / 110540, w = ZELLE / 2 / (111320 * Math.cos(p.lat * Math.PI / 180));
  for (const [k, pk] of t.zellen) {
    const c = zellMitte(p.lat, p.lon, k);
    L.rectangle([[c.lat - h, c.lon - w], [c.lat + h, c.lon + w]], { stroke: false, fillColor: pk === S.talk.pk ? '#2ecc40' : '#39cccc', fillOpacity: 0.38, interactive: false }).addTo(S.L.team);
  }
}

export { teamLeute, teamStart, teamEnde, teamPlanEmpfang, teamZellenEmpfang, teamTick, teamSenden, teamRender, drawTeam, meinSektor };
