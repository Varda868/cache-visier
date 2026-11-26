import { compassName, destPoint, esc, screenCols, screenRay } from '../kern/geo.js';
import { colorName, findBrightSpots, trackSpots } from '../kern/reflektor.js';
import { buzz } from './ansagen.js';
import { $, S, saveSettings, toast } from './basis.js';
import { showPeilung } from './peilung.js';

/* ---------- Nachtmodus: rote Oberfläche + Reflektorsuche ---------- */
function applyNight() {
  document.body.classList.toggle('night', !!S.set.night);
  $('#bNight').classList.toggle('on', !!S.set.night);
  if (S.set.night) startSpotLoop(); else { S.spots = []; S.spotTrack = null; drawSpots(); }
}
function toggleNight() {
  S.set.night = !S.set.night; saveSettings(); applyNight();
  toast(S.set.night ? '🌙 Nachtmodus: rote Anzeige, Reflektorsuche im Kamerabild (Lampe an)' : 'Nachtmodus aus');
}
let _spotTimer, _spotCv;
function startSpotLoop() {
  if (_spotTimer) return;
  _spotTimer = setInterval(() => {
    if (!S.set.night) { clearInterval(_spotTimer); _spotTimer = null; return; }
    const v = $('#cam');
    if (S.mode !== 'cam' || !S.stream || !v.videoWidth || document.hidden) { S.spotTrack = null; if (S.spots.length) { S.spots = []; drawSpots(); } return; }
    const w = 320, h = Math.round(320 * v.videoHeight / v.videoWidth);
    _spotCv = _spotCv || document.createElement('canvas'); _spotCv.width = w; _spotCv.height = h;
    const g = _spotCv.getContext('2d', { willReadFrequently: true });
    g.drawImage(v, 0, 0, w, h);
    const dets = findBrightSpots(g.getImageData(0, 0, w, h).data, w, h).map(p => ({ ...p, fx: p.x / w, fy: p.y / h, fr: p.r / w }));
    S.spotRaw = dets.length; // für Diagnose und Test: Funde im Einzelbild
    S.spotTrack = trackSpots(S.spotTrack, dets, Date.now());
    S.spots = S.spotTrack.visible;
    drawSpots();
  }, 220);
}
function drawSpots() {
  const cv = $('#spots'), v = $('#cam'), W = window.innerWidth, H = window.innerHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const info = $('#spotInfo'); S.spotScreen = [];
  if (!S.spots.length || !v.videoWidth) { info.hidden = !S.set.night || S.mode !== 'cam'; info.textContent = S.torch ? '✨ keine Reflektoren' : '✨ Lampe an für Reflektorsuche'; return; }
  const k = Math.max(W / v.videoWidth, H / v.videoHeight), ox = (W - v.videoWidth * k) / 2, oy = (H - v.videoHeight * k) / 2; // object-fit: cover
  g.font = 'bold 15px system-ui'; g.textAlign = 'center';
  const FARBE = { 'weiß': '#ffffff', rot: '#ff3b30', orange: '#ff9500', gelb: '#ffd60a', 'grün': '#30d158', blau: '#0a84ff', violett: '#bf5af2' };
  S.spots.forEach((p, i) => {
    const x = ox + p.fx * v.videoWidth * k, y = oy + p.fy * v.videoHeight * k, r = Math.max(16, p.fr * v.videoWidth * k * 2.5);
    const name = p.name || colorName(p.rgb), col = FARBE[name] || '#ffffff';
    S.spotScreen.push({ x, y, r, name });
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();   // dunkler Rand für Kontrast
    g.lineWidth = (p.primary ?? i === 0) ? 4 : 3; g.strokeStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    const label = name + (p.teile > 1 ? ` (${p.teile})` : '');
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(label, x, y - r - 6);
    g.fillStyle = col; g.fillText(label, x, y - r - 6);
  });
  info.hidden = false; info.textContent = `✨ ${S.spots.length} Reflektor${S.spots.length > 1 ? 'en' : ''} · antippen = Peilung`;
}

/* Reflektor antippen: Richtung vom Standort zum Reflektor als Peilung übernehmen, Peilstrahl auf der Karte */
function onCamTap(e) {
  if (!S.set.night || !S.cols || !(S.spotScreen || []).length || S.mode !== 'cam') return;
  const x = e.clientX, y = e.clientY;
  const hit = S.spotScreen.map(s => ({ s, d: Math.hypot(s.x - x, s.y - y) - s.r })).sort((a, b) => a.d - b.d)[0];
  if (!hit || hit.d > 40) return;
  const W = window.innerWidth, H = window.innerHeight, ang = (screen.orientation && screen.orientation.angle) || +window.orientation || 0;
  const fov = W > H ? Math.min(S.set.fovH * 1.6, 120) : S.set.fovH;
  const ray = screenRay(screenCols(S.cols, ang), hit.s.x, hit.s.y, fov, W, H), deg = (ray.deg + S.set.compassOffset + 360) % 360;
  if (S.pos) { S.rays = (S.rays || []).concat([{ lat: S.pos.lat, lon: S.pos.lon, deg, name: hit.s.name, ts: Date.now() }]).slice(-12); drawRays(); }
  buzz([40]); toast(`📐 Peilung ${Math.round(deg)}° ${compassName(deg)} zum Reflektor (${hit.s.name}) – Entfernung eintragen oder schätzen`, 4000);
  showPeilung({ deg: Math.round(deg), dist: null });
}
function drawRays() {
  if (!S.map || !S.L.rays) return;
  S.L.rays.clearLayers();
  for (const r of S.rays || []) {
    const e = destPoint(r.lat, r.lon, 300, r.deg);
    window.L.polyline([[r.lat, r.lon], [e.lat, e.lon]], { color: '#ffffff', weight: 2, dashArray: '4 6', opacity: 0.8 }).bindPopup(`${Math.round(r.deg)}° · ${esc(r.name)}`).addTo(S.L.rays);
  }
}

export { applyNight, toggleNight, _spotTimer, _spotCv, startSpotLoop, drawSpots, onCamTap, drawRays };
