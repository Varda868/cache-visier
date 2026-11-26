import { D2R, R_EARTH, haversine } from './geo.js';

/* --- Route (Valhalla): Polyline6 dekodieren, Position auf der Route finden --- */
function decodePolyline(str, prec = 6) {
  const f = Math.pow(10, prec), out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / f, lon / f]);
  }
  return out;
}
function routeCum(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return c;
}
/* nächster Punkt auf der Route: Segment i, Anteil t, Abstand off (m), zurückgelegter Weg along (m) */
function routeLocate(pts, cum, lat, lon) {
  if (pts.length < 2) return { i: 0, t: 0, off: pts.length ? haversine(lat, lon, pts[0][0], pts[0][1]) : Infinity, along: 0 };
  const kx = Math.cos(lat * D2R) * D2R * R_EARTH, ky = D2R * R_EARTH;
  let best = { off: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][1] - lon) * kx, ay = (pts[i][0] - lat) * ky, bx = (pts[i + 1][1] - lon) * kx, by = (pts[i + 1][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { i, t, off, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}
function routePointAt(pts, cum, s) {
  const n = pts.length; if (!n) return null;
  if (s <= 0 || n === 1) return pts[0];
  if (s >= cum[n - 1]) return pts[n - 1];
  let i = 0; while (i < n - 2 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i], t = seg > 0 ? (s - cum[i]) / seg : 0;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

export { decodePolyline, routeCum, routeLocate, routePointAt };
