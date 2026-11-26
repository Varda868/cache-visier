import { D2R, bearing, compassName, fmtDist, haversine, projectToScreen, screenCols, viewHeading, wrap180 } from '../kern/geo.js';
import { checkArrival } from './ankunft.js';
import { announce, buzz } from './ansagen.js';
import { $, S } from './basis.js';
import { updateMap } from './karte.js';
import { updatePeilbar } from './peilung.js';
import { activeRoute, routeText } from './ziel-routing.js';

/* ---------- Hauptschleife: Anzeige ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (now - S.lastFrame < 40) return; S.lastFrame = now;
  const t = S.target, p = S.pos;
  const ang = (screen.orientation && screen.orientation.angle) || +window.orientation || 0;
  const sc = S.cols ? screenCols(S.cols, ang) : null;
  const head = sc ? (viewHeading(sc) + S.set.compassOffset + 360) % 360 : (p && p.heading != null && p.speed > 0.7 ? p.heading : null);
  const stale = S.cols && now - S.oriTs > 3000;
  $('#status').textContent = `${navigator.onLine ? '' : '📴 offline · '}${S.cols ? (stale ? '⚠️ Kompass hängt' : S.oriSrc) : 'Kompass: fehlt'} · GPS ${p ? '±' + Math.round(p.acc) + ' m' : 'wartet …'}`;
  if (!t || !p) {
    $('#dist').textContent = p ? '–' : 'GPS …'; $('#acc').textContent = ''; $('#dir').textContent = t ? '' : 'Kein Ziel';
    $('#marker').hidden = true; $('#edge').hidden = true; $('#near').hidden = true; return;
  }
  const dist = haversine(p.lat, p.lon, t.lat, t.lon), brg = bearing(p.lat, p.lon, t.lat, t.lon);
  // mit Route zielen Nadel und Markierung auf einen Punkt ein Stück voraus auf dem Weg
  const R = activeRoute(), aim = R && S.steer ? S.steer : t;
  const adist = aim === t ? dist : haversine(p.lat, p.lon, aim.lat, aim.lon), abrg = aim === t ? brg : bearing(p.lat, p.lon, aim.lat, aim.lon);
  $('#dist').textContent = fmtDist(R ? R.rest : dist); $('#acc').textContent = '±' + Math.round(p.acc) + ' m';
  const rel = head != null ? wrap180(abrg - head) : null;
  $('#dir').textContent = R ? routeText(R, dist, brg)
    : `${compassName(brg)} ${Math.round(brg)}°` + (rel != null ? (Math.abs(rel) < 8 ? ' · geradeaus' : rel > 0 ? ` · ${Math.round(rel)}° rechts` : ` · ${Math.round(-rel)}° links`) : '');
  $('#rinfo').textContent = R ? `🧭 Weg · Luftlinie ${fmtDist(dist)} · ca. ${Math.max(1, Math.round(R.time * (R.rest / Math.max(R.len, 1)) / 60))} min${R.gap > 15 ? ` · Weg endet ${fmtDist(R.gap)} vor dem Ziel` : ''}`
    : S.set.routing ? (S.routeBusy ? '🧭 Route wird berechnet …' : '🧭 keine Route (☰ ⚙️ Routing prüfen)') : '';
  $('#needle').style.transform = `rotate(${rel != null ? rel : abrg}deg)`;
  checkArrival(t, dist, p);
  const nearR = Math.max(8, (p.acc || 10) * 1.3);
  const near = dist < nearR;
  $('#near').hidden = !near;
  if (near) $('#near').textContent = `Nahbereich – such im Umkreis von ca. ${Math.round(Math.max(dist, p.acc || 0))} m (GPS ±${Math.round(p.acc)} m)`;
  if (S.mode === 'cam' && S.cols) {
    const W = window.innerWidth, H = window.innerHeight;
    const b = (abrg - S.set.compassOffset) * D2R;
    const vec = [adist * Math.sin(b), adist * Math.cos(b), -S.set.phoneH];
    const fov = W > H ? S.set.fovH * 1.6 : S.set.fovH; // grob: im Querformat ist das Bild breiter
    const pr = projectToScreen(sc, vec, Math.min(fov, 120), W, H);
    const mk = $('#marker'), ed = $('#edge');
    if (!near && !pr.behind && pr.inView) {
      mk.hidden = false; ed.hidden = true;
      const size = aim === t ? Math.max(28, Math.min(130, 900 / Math.sqrt(dist + 4))) : 56; // Wegmarke klein und gleich groß
      mk.style.transform = `translate(${pr.x}px,${pr.y}px)`;
      mk.firstElementChild.style.width = mk.firstElementChild.style.height = size + 'px';
      $('#mLabel').textContent = aim === t ? fmtDist(dist) : '🧭 Weg'; $('#mLabel').style.top = (size / 2) + 'px';
      const lock = Math.hypot(pr.x - W / 2, pr.y - H / 2) < Math.min(W, H) * 0.07;
      $('#cross').classList.toggle('lock', lock);
      if (lock && !S.lockPrev && now - S.lockTs > 1500) { buzz([40]); S.lockTs = now; }
      S.lockPrev = lock;
    } else {
      mk.hidden = true; $('#cross').classList.remove('lock');
      ed.hidden = near;
      if (!near) {
        const ang = pr.dirDeg * D2R, rx = W / 2 - 46, ry = H / 2 - 120;
        const sx = Math.sin(ang), sy = -Math.cos(ang);
        const k = Math.min(rx / Math.abs(sx || 1e-6), ry / Math.abs(sy || 1e-6));
        ed.style.transform = `translate(${W / 2 + sx * k}px,${H / 2 + sy * k}px) rotate(${pr.dirDeg}deg)`;
      }
    }
  } else { $('#marker').hidden = true; $('#edge').hidden = true; }
  if (S.mode === 'map' && now - S.lastMap > 250) { S.lastMap = now; updateMap(dist, head); }
  announce(t, R ? R.rest : dist, R);
  if (S.peil) updatePeilbar(sc);
}

export { frame };
