import { D2R } from './geo.js';

/* --- Sonnenhöhe in Grad (Näherung, auf ca. 1° genau) – für „Karte dunkel: automatisch“ --- */
function sunElevation(lat, lon, date) {
  const d = date.getTime() / 86400000 - 10957.5;            // Tage seit J2000.0
  const g = ((357.529 + 0.98560028 * d) % 360) * D2R;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * D2R - ra;
  return Math.asin(Math.sin(lat * D2R) * Math.sin(dec) + Math.cos(lat * D2R) * Math.cos(dec) * Math.cos(ha)) / D2R;
}

export { sunElevation };
