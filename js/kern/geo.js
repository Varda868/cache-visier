/* CacheVisier · kern/geo: Koordinaten, Entfernung, Richtung, Formatierung, Lage des Handys (Rotationsmatrix), Projektion ins Bild */
const APP_VERSION = '0.2.0';

/* ====================== Reine Hilfsfunktionen (auch in Node testbar) ====================== */
const D2R = Math.PI / 180, R_EARTH = 6371008.8;

function haversine(la1, lo1, la2, lo2) {
  const dLa = (la2 - la1) * D2R, dLo = (lo2 - lo1) * D2R;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * D2R) * Math.cos(la2 * D2R) * Math.sin(dLo / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearing(la1, lo1, la2, lo2) {
  const p1 = la1 * D2R, p2 = la2 * D2R, dl = (lo2 - lo1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
function destPoint(la, lo, dist, brg) {
  const d = dist / R_EARTH, t = brg * D2R, p1 = la * D2R, l1 = lo * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
}
function wrap180(a) { return ((a + 180) % 360 + 360) % 360 - 180; }
function compassName(b) { return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round((((b % 360) + 360) % 360) / 45) % 8]; }
function rot13(s) { return String(s || '').replace(/[a-zA-Z]/g, c => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b); }); }
function fmtDist(m) {
  if (m == null || !isFinite(m)) return '–';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(m < 10000 ? 2 : 1).replace('.', ',') + ' km';
}
function fmtCoord(lat, lon) {
  const f = (v, pos, neg, w) => {
    const h = v >= 0 ? pos : neg; v = Math.abs(v);
    let d = Math.floor(v), m = (v - d) * 60;
    if (m >= 59.9995) { d += 1; m = 0; }
    return `${h} ${String(d).padStart(w, '0')}° ${m.toFixed(3).padStart(6, '0')}`;
  };
  return f(lat, 'N', 'S', 2) + ' ' + f(lon, 'E', 'W', 3);
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
/* HTML aus c:geo-Logs/Listings in lesbaren Text: Absätze und <br> als Zeilenumbruch, Tags weg, Entities aufgelöst */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  szlig: 'ß', euro: '€', hellip: '…', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', sbquo: '‚', lsquo: '‘', rsquo: '’',
  laquo: '«', raquo: '»', deg: '°', copy: '©', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
function htmlText(s) {
  s = String(s == null ? '' : s);
  const tags = /<\/?[a-z][^>]*>/i.test(s);
  if (!tags && !/&(#x?[0-9a-f]+|[a-z]+);/i.test(s)) return s;
  if (tags) {
    s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n').replace(/<\s*li[^>]*>/gi, '• ')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1').replace(/<\/?[a-z][^>]*>/gi, '');
  }
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (ENT[e] != null ? ENT[e] : m))
    .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v) { if (v == null || v === '') return null; const n = +v; return isFinite(n) && n > 0 ? n : null; }
function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
  if (/^\d+$/.test(String(v))) { const n = +v; return n > 1e11 ? n : n * 1000; }
  const t = Date.parse(v); return isNaN(t) ? null : t;
}

/* --- Lage des Handys: Spalten der Rotationsmatrix Gerät -> Welt (Ost, Nord, Oben) ---
   c1 = rechte Bildschirmkante, c2 = obere Kante, c3 = aus dem Bildschirm zum Nutzer.
   Die Rückkamera schaut entlang -c3. */
function colsFromEuler(alpha, beta, gamma) {
  const a = alpha * D2R, b = beta * D2R, g = gamma * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg],
    [-sa * cb, ca * cb, sb],
    [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg]
  ];
}
function colsFromQuat(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
  ];
}
/* Bildschirmdrehung (screen.orientation.angle) auf die Gerätespalten anwenden */
function screenCols(cols, angle) {
  if (!angle) return cols;
  const t = angle * D2R, c = Math.cos(t), s = Math.sin(t);
  const r = [0, 1, 2].map(i => c * cols[0][i] - s * cols[1][i]);
  const u = [0, 1, 2].map(i => s * cols[0][i] + c * cols[1][i]);
  return [r, u, cols[2]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function orthonormal(c1, c3) {
  c3 = norm(c3); const k = dot(c1, c3);
  c1 = norm([c1[0] - k * c3[0], c1[1] - k * c3[1], c1[2] - k * c3[2]]);
  return [c1, cross(c3, c1), c3];
}
function vecHeading(v) { return (Math.atan2(v[0], v[1]) / D2R + 360) % 360; }
function vecElev(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return Math.asin(Math.max(-1, Math.min(1, v[2] / n))) / D2R; }
function camVec(cols) { return [-cols[2][0], -cols[2][1], -cols[2][2]]; }
/* Blickrichtung: bei senkrechtem Handy die Kamera, bei flachem Handy die Oberkante */
function viewHeading(cols) {
  const cam = camVec(cols);
  return Math.abs(vecElev(cam)) < 50 ? vecHeading(cam) : vecHeading(cols[1]);
}
/* Richtung (Grad) und Höhenwinkel eines angetippten Bildschirmpunkts im Kamerabild */
function screenRay(cols, x, y, fovH, W, H) {
  const tanH = Math.tan(fovH / 2 * D2R), tanV = tanH * H / W;
  const u = (x - W / 2) / (W / 2) * tanH, v = -(y - H / 2) / (H / 2) * tanV, c = camVec(cols);
  const d = [0, 1, 2].map(i => c[i] + u * cols[0][i] + v * cols[1][i]);
  return { deg: vecHeading(d), elev: vecElev(d) };
}
/* Ziel (Ost/Nord/Oben in Metern) auf den Bildschirm projizieren; berücksichtigt Neigung und Kippen */
function projectToScreen(cols, t, fovH, W, H) {
  const dx = dot(cols[0], t), dy = dot(cols[1], t), fwd = -dot(cols[2], t);
  const tanH = Math.tan(fovH / 2 * D2R), tanV = tanH * H / W;
  const dirDeg = Math.atan2(dx, dy) / D2R; // Richtung in der Bildebene (0 = oben, 90 = rechts)
  if (fwd <= 0.05) return { behind: true, dx, dy, fwd, dirDeg };
  const x = W / 2 + dx / fwd / tanH * W / 2, y = H / 2 - dy / fwd / tanV * H / 2;
  return { behind: false, x, y, dx, dy, fwd, dirDeg, inView: x >= 0 && x <= W && y >= 0 && y <= H };
}

export { APP_VERSION, D2R, R_EARTH, haversine, bearing, destPoint, wrap180, compassName, rot13, fmtDist, fmtCoord, fmtDate, ENT, htmlText, esc, num, toMs, colsFromEuler, colsFromQuat, screenCols, dot, norm, cross, orthonormal, vecHeading, vecElev, camVec, viewHeading, screenRay, projectToScreen };
