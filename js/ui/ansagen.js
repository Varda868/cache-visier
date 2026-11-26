import { annStepBelow } from '../kern/reflektor.js';
import { S } from './basis.js';
import { targetKey } from './ziel-routing.js';

/* ---------- Ansagen und Vibration ---------- */
function buzz(p) { if (S.set.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* egal */ } }
function say(t) {
  if (!S.set.speak || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'de-DE'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { /* egal */ }
}
function sayDist(m) { return m >= 1000 ? `${String(m / 1000).replace('.', ',')} Kilometer` : `${m} Meter`; }
function announce(t, d, R) {
  if (!S.set.speak && !S.set.vibrate) return;
  const key = targetKey(t);
  if (S.ann.key !== key) { S.ann = { key, next: annStepBelow(d), last: null }; S.annMan = {}; return; }
  // Abstände zum Ziel: 2 km, 1 km, 500, 200, 100, 50, 20, 10 m
  if (S.ann.next != null && d < S.ann.next * 0.97) {
    const th = S.ann.next;
    S.ann.last = th; S.ann.next = annStepBelow(d);
    say(th <= 10 ? 'Noch 10 Meter. Ziel in der Nähe.' : `Noch ${sayDist(th)}`);
    buzz(th >= 500 ? [80] : th >= 100 ? [80, 80, 80] : [150, 80, 150, 80, 150]);
  } else if (S.ann.last != null && d > S.ann.last * 1.3) S.ann = { key, next: annStepBelow(d), last: null }; // wieder entfernt → neu scharf
  // Abzweigungen mit Route: vorher ankündigen, dann „Jetzt“
  if (R && R.next && !R.final && !(R.loc && R.loc.off > R.offLim)) {
    const fast = S.pos && S.pos.speed > 6, far = fast ? 300 : 120, nearM = fast ? 40 : 20;
    const k = R.key + ':' + R.next.i, st = S.annMan[k] || (S.annMan[k] = {});
    const pat = /links/i.test(R.next.txt) ? [200, 100, 200] : /rechts/i.test(R.next.txt) ? [500] : [100];
    if (!st.far && R.next.d <= far && R.next.d > nearM * 2) { st.far = true; say(`In ${Math.round(R.next.d / 10) * 10} Metern: ${R.next.txt}`); buzz(pat); }
    if (!st.now && R.next.d <= nearM) { st.now = true; st.far = true; say('Jetzt: ' + R.next.txt); buzz(pat); }
  }
}

export { buzz, say, sayDist, announce };
