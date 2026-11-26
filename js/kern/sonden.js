/* CacheVisier · kern/sonden: Wettersonden aus der SondeHub-Datenbank aufbereiten (letzte Position, Landepunkt, Fundmeldung) – ohne Browser, testbar */
import { bearing, compassName, haversine } from './geo.js';

/* Zeit ohne Zonenangabe (kommt bei SondeHub vor) gilt als UTC */
const utc = d => { const s = String(d || ''); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !s ? s : s + 'Z') || 0; };
const str = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, n);

/* /sondes-Antwort {serial: telemetrie} → Liste nach Entfernung; status: steigt | faellt | unten (gelandet oder nicht mehr gehört) */
function sondenListe(roh, lat, lon, now = Date.now()) {
  return Object.values(roh && typeof roh === 'object' ? roh : {})
    .filter(s => s && s.serial && isFinite(s.lat) && isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)
    .map(s => {
      const ts = utc(s.datetime || s.time_received), vz = +s.vel_v || 0, alt = Math.round(+s.alt || 0), still = now - ts > 15 * 60000;
      const status = still || Math.abs(vz) < 1 ? 'unten' : vz > 0 ? 'steigt' : 'faellt';
      const d = haversine(lat, lon, +s.lat, +s.lon);
      return { serial: str(s.serial, 16), typ: str(s.subtype || s.type, 16), lat: +s.lat, lon: +s.lon, alt, vz: Math.round(vz * 10) / 10, ts, status,
        freq: isFinite(s.frequency) ? +s.frequency : null, dist: d, richtung: compassName(bearing(lat, lon, +s.lat, +s.lon)) };
    })
    .sort((a, b) => a.dist - b.dist);
}
/* /predictions → Map serial → letzter vorhergesagter Punkt (= Landepunkt) */
function landepunkte(preds) {
  const m = new Map();
  for (const p of Array.isArray(preds) ? preds : []) {
    try {
      const d = typeof p.data === 'string' ? JSON.parse(p.data) : p.data, l = Array.isArray(d) && d[d.length - 1];
      if (p.vehicle && l && isFinite(l.lat) && isFinite(l.lon)) m.set(str(p.vehicle, 16), { lat: +l.lat, lon: +l.lon, alt: Math.round(+l.alt || 0), ts: (+l.time || 0) * 1000 });
    } catch (e) { /* kaputte Vorhersage überspringen */ }
  }
  return m;
}
/* /recovered → Map serial → jüngste Meldung (gefunden oder vergeblich gesucht) */
function fundMeldungen(rec) {
  const m = new Map();
  for (const r of Array.isArray(rec) ? rec : []) {
    if (!r || !r.serial) continue;
    const k = str(r.serial, 16), ts = utc(r.datetime), alt = m.get(k);
    if (!alt || ts > alt.ts) m.set(k, { gefunden: r.recovered === true, von: str(r.recovered_by, 40), text: str(r.description, 200), ts });
  }
  return m;
}
/* "vor 25 min" / "vor 3 h" */
function vorZeit(ts, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  return m < 1 ? 'gerade eben' : m < 90 ? `vor ${m} min` : `vor ${Math.round(m / 60)} h`;
}
export { sondenListe, landepunkte, fundMeldungen, vorZeit };
