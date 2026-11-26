/* CacheVisier – PWA fürs Cachen vor Ort. Einstieg: lädt alle Module, startet beim DOMContentLoaded. */
import { frame } from './ui/anzeige.js';
import { $, S, closeSheet, loadAll, run } from './ui/basis.js';
import { showInfo, showList, showLogs } from './ui/blaetter.js';
import { checkShareInbox } from './ui/import.js';
import { cycleModeLock, keepAwake, startCamera, takePhoto, toggleTorch, updateButtons } from './ui/kamera.js';
import { applyMapDark } from './ui/karte.js';
import { showAi } from './ui/ki-auswertung.js';
import { showMyLog } from './ui/log.js';
import { renderStage } from './ui/multi.js';
import { applyNight, onCamTap, toggleNight } from './ui/nacht.js';
import { startGps, startOrientation } from './ui/sensoren.js';
import { initTalk, showTalk } from './ui/talk.js';
import { renderTop, toggleRouting } from './ui/ziel-routing.js';
import './ui/ankunft.js';
import './ui/ansagen.js';
import './ui/anzeige.js';
import './ui/basis.js';
import './ui/blaetter.js';
import './ui/einstellungen.js';
import './ui/funk.js';
import './ui/import.js';
import './ui/kamera.js';
import './ui/karte.js';
import './ui/ki-auswertung.js';
import './ui/log.js';
import './ui/multi.js';
import './ui/nacht.js';
import './ui/offline.js';
import './ui/peilung.js';
import './ui/sensoren.js';
import './ui/talk.js';
import './ui/tour.js';
import './ui/ziel-routing.js';

/* ---------- Start ---------- */
async function start() {
  if (S.started) return; S.started = true;
  try { if ('speechSynthesis' in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch (e) { /* egal */ }
  $('#start').hidden = true;
  startGps();
  await startOrientation();
  await startCamera();
  keepAwake();
}
async function init() {
  document.body.dataset.mode = 'cam';
  await loadAll().catch(e => console.error(e));
  renderTop(); updateButtons(); renderStage(); applyMapDark(); setInterval(applyMapDark, 60000); applyNight(); run(initTalk);
  $('#bStart').onclick = () => run(start);
  $('#bList').onclick = () => showList();
  $('#bRoute').onclick = toggleRouting;
  $('#bNight').onclick = toggleNight;
  $('#bTalk').onclick = showTalk;
  $('#cam').addEventListener('click', onCamTap);
  $('#top').onclick = e => { if (!e.target.closest('button')) showInfo(); };
  $('#bHint').onclick = showInfo;
  $('#bLogs').onclick = showLogs;
  $('#bAi').onclick = showAi;
  $('#bLog').onclick = () => run(showMyLog);
  $('#bTorch').onclick = () => run(toggleTorch);
  $('#bPhoto').onclick = () => run(takePhoto);
  $('#bMode').onclick = cycleModeLock;
  $('#bFollow').onclick = () => { S.follow = true; S.zoomPause = 0; $('#bFollow').hidden = true; };
  $('#sheetClose').onclick = closeSheet;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.started) keepAwake(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e));
  if (/[?&]share=/.test(location.search)) run(checkShareInbox);
  requestAnimationFrame(frame);
}
window.addEventListener('DOMContentLoaded', init);

export { start, init };
