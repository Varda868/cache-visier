import { $, S, flash, idbPut, toast } from './basis.js';
import { initMap } from './karte.js';

/* ---------- Kamera, Lampe, Foto ---------- */
async function startCamera() {
  if (S.stream) return true;
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) { toast('Kamera: ' + e.message, 5000); return false; }
  const v = $('#cam'); v.srcObject = S.stream; try { await v.play(); } catch (e) { /* Autoplay */ }
  S.track = S.stream.getVideoTracks()[0];
  document.body.classList.add('camon'); updateButtons(); keepAwake();
  return true;
}
function stopCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = S.track = null; S.torch = false; document.body.classList.remove('camon'); updateButtons();
}
async function toggleTorch() {
  if (!S.track && !(await startCamera())) return;
  const caps = S.track.getCapabilities ? S.track.getCapabilities() : {};
  if (!caps.torch) return toast('Lampe wird von Gerät/Browser nicht unterstützt');
  try { await S.track.applyConstraints({ advanced: [{ torch: !S.torch }] }); S.torch = !S.torch; }
  catch (e) { toast('Lampe: ' + e.message); }
  updateButtons();
}
async function grabFrame() {
  let blob = null;
  try { if ('ImageCapture' in window) blob = await new window.ImageCapture(S.track).takePhoto(); } catch (e) { console.warn('takePhoto', e); }
  if (!blob) {
    const v = $('#cam'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  }
  if (S.torch) { try { await S.track.applyConstraints({ advanced: [{ torch: true }] }); } catch (e) { /* egal */ } }
  return blob;
}
async function savePhoto(blob, label) {
  const t = S.target;
  await idbPut('photos', { geocode: t ? t.geocode || '' : '', name: label || (t ? (t.name || t.label || '') : ''), ts: Date.now(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon, blob });
}
async function takePhoto() {
  if (!S.track && !(await startCamera())) return;
  const blob = await grabFrame(); await savePhoto(blob);
  const t = S.target;
  flash(); toast('📸 Foto gespeichert' + (t && t.geocode ? ' zu ' + t.geocode : ''));
}
async function shrinkImage(blob, max, q) {
  const bmp = await createImageBitmap(blob), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', q);
}
async function keepAwake() {
  if (!S.set.keepAwake || !('wakeLock' in navigator) || S.wake) return;
  try { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener('release', () => { S.wake = null; }); } catch (e) { /* egal */ }
}
function updateButtons() {
  $('#bTorch').classList.toggle('on', S.torch);
  $('#bRoute').classList.toggle('on', !!S.set.routing);
  const m = S.modeLock || 'auto';
  $('#bMode').innerHTML = m === 'auto' ? '🔄<small>Auto</small>' : m === 'cam' ? '📷<small>Kamera</small>' : '🗺️<small>Karte</small>';
}

/* ---------- Modus Kamera / Karte ---------- */
function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; document.body.dataset.mode = m;
  if (m === 'map') { initMap(); setTimeout(() => S.map && S.map.invalidateSize(), 60); }
}
function cycleModeLock() {
  S.modeLock = S.modeLock == null ? 'cam' : S.modeLock === 'cam' ? 'map' : null;
  if (S.modeLock) setMode(S.modeLock);
  updateButtons();
  toast(S.modeLock ? (S.modeLock === 'cam' ? 'Kamera fest' : 'Karte fest') : 'Automatisch: senkrecht = Kamera, waagerecht = Karte');
}

export { startCamera, stopCamera, toggleTorch, grabFrame, savePhoto, takePhoto, shrinkImage, keepAwake, updateButtons, setMode, cycleModeLock };
