/* CacheVisier · ui/warnungen: Hinweisleiste oben bei ungenauem GPS, fehlendem/hängendem oder abweichendem Kompass */
import { warnState } from '../kern/warnung.js';
import { buzz } from './ansagen.js';
import { $, S } from './basis.js';

let _t = 0;
function checkWarnings(now, head) {
  if (!S.started || now - _t < 500) return; _t = now;
  S.startTs = S.startTs || Date.now();
  const z = { now: Date.now(), startTs: S.startTs, pos: S.pos, cam: S.mode === 'cam', oriTs: S.oriTs ? Date.now() - (performance.now() - S.oriTs) : 0, head, st: S.warnSt };
  const w = warnState(z); S.warnSt = z.st;
  const el = $('#warn'), weg = S.warnWeg || (S.warnWeg = {});
  const zeigen = w && !(weg[w.kind] > Date.now());
  if (!zeigen) { if (!el.hidden) el.hidden = true; S.warnKind = null; return; }
  if (S.warnKind !== w.kind) { S.warnKind = w.kind; if (w.kind === 'dev' || w.kind === 'gps') buzz([40, 60, 40]); }
  if (el.dataset.text !== w.text) { el.dataset.text = w.text; el.innerHTML = `<span>${w.text}</span><button aria-label="ausblenden">✕</button>`; }
  el.hidden = false;
  el.onclick = () => { weg[w.kind] = Date.now() + 120000; el.hidden = true; }; // 2 min Ruhe für diese Warnung
}
export { checkWarnings };
