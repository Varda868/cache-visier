import { camVec, colsFromEuler, colsFromQuat, dot, orthonormal, vecElev } from '../kern/geo.js';
import { start } from '../main.js';
import { S, toast } from './basis.js';
import { setMode } from './kamera.js';
import { drawCacheMarkers } from './karte.js';
import { onPosRoute } from './ziel-routing.js';

/* ---------- Sensoren: GPS ---------- */
function startGps() {
  if (!('geolocation' in navigator)) return toast('Kein GPS im Browser');
  navigator.geolocation.watchPosition(p => {
    const first = !S.pos;
    S.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, ts: p.timestamp };
    if (first) drawCacheMarkers();
    onPosRoute();
  }, e => toast('GPS: ' + e.message), { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
}

/* ---------- Sensoren: Lage / Kompass ---------- */
function onCols(cols, src) {
  let k = S.set.smoothing;
  // große Sprünge (> ca. 30°) direkt übernehmen: sonst bleibt die Mittelung bei 180°-Drehungen hängen
  if (S.cols && Math.min(dot(S.cols[0], cols[0]), dot(S.cols[2], cols[2])) < 0.85) k = 1;
  if (S.cols && k < 1) {
    const m = (a, b) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    cols = orthonormal(m(S.cols[0], cols[0]), m(S.cols[2], cols[2]));
  } else cols = orthonormal(cols[0], cols[2]);
  S.cols = cols; S.oriSrc = src; S.oriTs = performance.now();
  if (S.set.autoMode && !S.modeLock) {
    const el = vecElev(camVec(cols));
    if (S.mode === 'cam' && el < -55) setMode('map');
    else if (S.mode === 'map' && el > -35) setMode('cam');
  }
}
async function startOrientation() {
  const want = S.set.sensor;
  if ((want === 'auto' || want === 'quat') && 'AbsoluteOrientationSensor' in window) {
    try {
      if (navigator.permissions) await Promise.all(['accelerometer', 'magnetometer', 'gyroscope'].map(n => navigator.permissions.query({ name: n }).catch(() => null)));
      const s = new window.AbsoluteOrientationSensor({ frequency: 30, referenceFrame: 'device' });
      await new Promise((res, rej) => {
        let ok = false;
        s.onreading = () => { if (!ok) { ok = true; res(); } onCols(colsFromQuat(s.quaternion), 'Kompass: Lagesensor (Quaternion)'); };
        s.onerror = e => { if (!ok) rej(e.error || e); else toast('Sensorfehler: ' + (e.error && e.error.name)); };
        s.start(); setTimeout(() => { if (!ok) rej(new Error('keine Sensordaten')); }, 2500);
      });
      S.sensor = s; return;
    } catch (e) { console.warn('AbsoluteOrientationSensor:', e); }
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (e) { /* iOS: abgelehnt */ }
  }
  const handler = (ev, abs) => {
    let a = ev.alpha;
    if (ev.webkitCompassHeading != null) { a = 360 - ev.webkitCompassHeading; abs = true; }
    if (a == null || ev.beta == null) return;
    onCols(colsFromEuler(a, ev.beta, ev.gamma || 0), abs ? 'Kompass: Lagewinkel (absolut)' : '⚠️ Kompass nicht nordbezogen');
  };
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', e => handler(e, true));
  else window.addEventListener('deviceorientation', e => handler(e, e.absolute === true));
}

export { startGps, onCols, startOrientation };
