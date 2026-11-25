'use strict';
/* CacheVisier – PWA fürs Cachen vor Ort
   Kamera mit Fadenkreuz (Handy senkrecht) / Karte (Handy waagerecht), Abstand + Richtung,
   Hint, D/T, Logs, Lampe, Fotos, Offline-Logs, Import c:geo-Backup / GPX / Opencaching (OKAPI),
   KI-Auswertung der Logs über ein eigenes PHP-Skript. */
const APP_VERSION = '0.1.0';

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
/* Ziel (Ost/Nord/Oben in Metern) auf den Bildschirm projizieren; berücksichtigt Neigung und Kippen */
function projectToScreen(cols, t, fovH, W, H) {
  const dx = dot(cols[0], t), dy = dot(cols[1], t), fwd = -dot(cols[2], t);
  const tanH = Math.tan(fovH / 2 * D2R), tanV = tanH * H / W;
  const dirDeg = Math.atan2(dx, dy) / D2R; // Richtung in der Bildebene (0 = oben, 90 = rechts)
  if (fwd <= 0.05) return { behind: true, dx, dy, fwd, dirDeg };
  const x = W / 2 + dx / fwd / tanH * W / 2, y = H / 2 - dy / fwd / tanV * H / 2;
  return { behind: false, x, y, dx, dy, fwd, dirDeg, inView: x >= 0 && x <= W && y >= 0 && y <= H };
}

/* --- Cache-Typen, Größen, Logtypen --- */
const TYPE_INFO = {
  tradi: ['Tradi', '#2ecc40'], multi: ['Multi', '#ff9f1a'], mystery: ['Mystery', '#3d8bff'], earth: ['Earth', '#b5835a'],
  event: ['Event', '#ff4136'], virtual: ['Virtual', '#eeeeee'], webcam: ['Webcam', '#aaaaaa'], wherigo: ['Wherigo', '#b10dc9'],
  letterbox: ['Letterbox', '#39cccc'], lab: ['Lab', '#7fdbff'], other: ['Sonstiger', '#888888']
};
function normType(t) {
  const s = String(t || '').toLowerCase();
  if (/tradi/.test(s)) return 'tradi';
  if (/multi/.test(s)) return 'multi';
  if (/myst|unknown|quiz|puzzle|math/.test(s)) return 'mystery';
  if (/earth/.test(s)) return 'earth';
  if (/event|mega|giga|cito|trash|block|hq/.test(s)) return 'event';
  if (/wherigo/.test(s)) return 'wherigo';
  if (/letter/.test(s)) return 'letterbox';
  if (/webcam/.test(s)) return 'webcam';
  if (/virtu/.test(s)) return 'virtual';
  if (/\blab\b|adventure/.test(s)) return 'lab';
  return 'other';
}
function normSize(s) {
  const v = String(s || '').toLowerCase().replace(/[_-]/g, ' ').trim();
  const map = { nano: 'Nano', micro: 'Micro', small: 'Small', regular: 'Normal', normal: 'Normal', large: 'Groß', xlarge: 'Sehr groß', 'very large': 'Sehr groß', virtual: 'Virtuell', none: 'Keine Dose', other: 'Andere', 'not chosen': 'Nicht gewählt', unknown: '' };
  return v in map ? map[v] : (s ? String(s) : '');
}
const LOGTYPES = {
  2: ['Gefunden', 'found'], 3: ['Nicht gefunden', 'dnf'], 4: ['Notiz', 'note'], 5: ['Archiviert', 'admin'],
  7: ['Archivierung nötig', 'maint'], 9: ['Will teilnehmen', 'note'], 10: ['Teilgenommen', 'found'], 11: ['Webcam-Foto', 'found'],
  12: ['Wiederhergestellt', 'admin'], 18: ['Reviewer-Notiz', 'admin'], 22: ['Deaktiviert', 'admin'], 23: ['Aktiviert', 'admin'],
  24: ['Veröffentlicht', 'admin'], 45: ['Wartung nötig', 'maint'], 46: ['Owner-Wartung', 'admin'], 47: ['Koordinaten geändert', 'admin'],
  68: ['Reviewer-Notiz', 'admin'], 74: ['Ankündigung', 'admin']
};
function logTypeInfo(t) {
  if (t == null || t === '') return ['Log', 'other'];
  if (typeof t === 'number' || /^\d+$/.test(String(t))) return LOGTYPES[+t] || ['Log #' + t, 'other'];
  const s = String(t).toLowerCase();
  if (/didn|not found|nicht gefunden|dnf/.test(s)) return ['Nicht gefunden', 'dnf'];
  if (/needs maint|wartung nötig|needs arch|archivierung nötig/.test(s)) return ['Wartung nötig', 'maint'];
  if (/owner maint|maintenance performed/.test(s)) return ['Owner-Wartung', 'admin'];
  if (/found|gefunden|attended|teilgenommen|webcam/.test(s)) return ['Gefunden', 'found'];
  if (/note|comment|notiz|kommentar/.test(s)) return ['Notiz', 'note'];
  if (/disable|enable|archiv|publish|review|coord|announce/.test(s)) return [String(t), 'admin'];
  return [String(t), 'other'];
}
/* DNFs seit dem letzten Fund (Logs neueste zuerst) */
function dnfStreak(logs) {
  let n = 0;
  for (const l of logs || []) { const k = logTypeInfo(l.type)[1]; if (k === 'found') break; if (k === 'dnf') n++; }
  return n;
}
function lastFound(logs) { const l = (logs || []).find(x => logTypeInfo(x.type)[1] === 'found'); return l ? l.date : null; }

/* --- Feldnotizen (geocache_visits.txt, UTF-16LE mit BOM) --- */
const FN_TYPES = { found: 'Found it', dnf: "Didn't find it", note: 'Write note', maint: 'Needs Maintenance' };
function fieldNoteLine(l) {
  const iso = new Date(l.ts).toISOString().slice(0, 16) + 'Z';
  const txt = String(l.text || '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `${l.geocode},${iso},${FN_TYPES[l.type] || 'Write note'},"${txt}"`;
}
function utf16le(str) {
  const b = new Uint8Array(2 + str.length * 2); b[0] = 0xFF; b[1] = 0xFE;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); b[2 + 2 * i] = c & 255; b[3 + 2 * i] = c >> 8; }
  return b;
}
function sniffFormat(u8) {
  let head = ''; for (let i = 0; i < Math.min(16, u8.length); i++) head += String.fromCharCode(u8[i]);
  if (head.startsWith('SQLite format 3')) return 'sqlite';
  if (u8[0] === 0x50 && u8[1] === 0x4b) return 'zip';
  const txt = new TextDecoder().decode(u8.slice(0, 4000));
  if (/<gpx[\s>]/i.test(txt)) return 'gpx';
  return 'unknown';
}

/* --- c:geo-Datenbank (Backup cgeo.sqlite) auslesen; exec(sql) liefert [{columns, values}] wie sql.js --- */
function importCgeo(exec, maxLogs) {
  const q = sql => { const r = exec(sql); return r && r[0] ? r[0] : { columns: [], values: [] }; };
  const tables = q("SELECT name FROM sqlite_master WHERE type='table'").values.map(v => v[0]);
  const cols = t => q(`PRAGMA table_info("${t}")`).values.map(v => v[1]);
  const tc = tables.includes('cg_caches') ? 'cg_caches' : tables.find(t => { const c = cols(t); return c.includes('geocode') && c.includes('latitude'); });
  if (!tc) throw new Error('Keine Cache-Tabelle gefunden (Tabellen: ' + tables.join(', ') + ')');
  const cc = cols(tc);
  const want = ['geocode', 'name', 'type', 'latitude', 'longitude', 'difficulty', 'terrain', 'size', 'hint', 'owner', 'found', 'disabled', 'archived', 'personal_note', 'coordsChanged'];
  const sel = want.filter(c => cc.includes(c));
  const res = q(`SELECT ${sel.map(c => '"' + c + '"').join(',')} FROM "${tc}"`);
  const caches = new Map();
  for (const row of res.values) {
    const o = {}; res.columns.forEach((c, i) => { o[c] = row[i]; });
    if (!o.geocode || o.latitude == null || o.longitude == null) continue;
    caches.set(o.geocode, {
      geocode: o.geocode, name: o.name || o.geocode, type: normType(o.type), lat: +o.latitude, lon: +o.longitude,
      d: num(o.difficulty), t: num(o.terrain), size: normSize(o.size), hint: o.hint || '', owner: o.owner || '',
      found: !!o.found, disabled: !!o.disabled, archived: !!o.archived, note: o.personal_note || '', corrected: !!o.coordsChanged,
      logs: [], wpts: [], src: 'cgeo'
    });
  }
  if (tables.includes('cg_logs')) {
    const lc = cols('cg_logs');
    const lsel = ['geocode', 'type', 'author', 'log', 'date'].filter(c => lc.includes(c));
    if (lsel.includes('geocode')) {
      const r = q(`SELECT ${lsel.map(c => '"' + c + '"').join(',')} FROM cg_logs${lc.includes('date') ? ' ORDER BY "date" DESC' : ''}`);
      for (const row of r.values) {
        const o = {}; r.columns.forEach((c, i) => { o[c] = row[i]; });
        const c = caches.get(o.geocode); if (!c || c.logs.length >= maxLogs) continue;
        c.logs.push({ date: toMs(o.date), type: o.type, author: o.author || '', text: o.log || '' });
      }
    }
  }
  if (tables.includes('cg_waypoints')) {
    const wc = cols('cg_waypoints');
    const wsel = ['geocode', 'name', 'latitude', 'longitude', 'type', 'prefix', 'note'].filter(c => wc.includes(c));
    if (wsel.includes('geocode') && wsel.includes('latitude')) {
      const r = q(`SELECT ${wsel.map(c => '"' + c + '"').join(',')} FROM cg_waypoints`);
      for (const row of r.values) {
        const o = {}; r.columns.forEach((c, i) => { o[c] = row[i]; });
        const c = caches.get(o.geocode); if (!c || o.latitude == null || o.longitude == null) continue;
        c.wpts.push({ name: o.name || o.prefix || 'Wegpunkt', prefix: o.prefix || '', lat: +o.latitude, lon: +o.longitude, type: String(o.type || ''), note: o.note || '' });
      }
    }
  }
  return [...caches.values()];
}

/* --- Nächstes OSM-Objekt mit bestimmtem Tag --- */
function nearestOsm(els, key, value, lat, lon) {
  const nodes = new Map(); for (const e of els) if (e.type === 'node') nodes.set(e.id, e);
  let best = null;
  for (const e of els) {
    const t = e.tags; if (!t || t[key] == null) continue;
    if (value && value !== '*' && t[key] !== value) continue;
    let p;
    if (e.type === 'node') p = e;
    else if (e.type === 'way') {
      const ns = (e.nodes || []).map(id => nodes.get(id)).filter(Boolean); if (!ns.length) continue;
      p = { lat: ns.reduce((s, n) => s + n.lat, 0) / ns.length, lon: ns.reduce((s, n) => s + n.lon, 0) / ns.length };
    } else continue;
    const d = haversine(lat, lon, p.lat, p.lon);
    if (!best || d < best.dist) best = { lat: p.lat, lon: p.lon, dist: d, name: t.name || '' };
  }
  return best;
}

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

/* ====================== Browser-Teil ====================== */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {

const $ = s => document.querySelector(s);
const DEFAULTS = {
  fovH: 50, phoneH: 1.4, compassOffset: 0, sensor: 'auto', autoMode: true, maxLogs: 40,
  apiUrl: './api/ki.php', apiToken: '', okapiKey: '', ocUser: '', ocUuid: '', ocRadius: 3, hideFound: true,
  keepAwake: true, smoothing: 0.25,
  routing: false, routeUrl: './api/route.php', routeCosting: 'pedestrian', lookahead: 25
};
const S = {
  set: { ...DEFAULTS }, caches: new Map(), ai: new Map(), pos: null, cols: null, oriSrc: 'noch keine Daten', oriTs: 0,
  target: null, mode: 'cam', modeLock: null, stream: null, track: null, torch: false, dir: null,
  route: null, steer: null, routeBusy: false, routeTs: 0, offCount: 0,
  map: null, L: {}, follow: true, wake: null, lastFrame: 0, lastMap: 0, sensor: null, started: false
};
window.CV = S; // zum Nachsehen in der Browser-Konsole

/* ---------- IndexedDB ---------- */
let _db;
function idb() {
  return _db || (_db = new Promise((res, rej) => {
    const r = indexedDB.open('cachevisier', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('caches', { keyPath: 'geocode' });
      d.createObjectStore('ai', { keyPath: 'geocode' });
      d.createObjectStore('meta');
      d.createObjectStore('photos', { keyPath: 'id', autoIncrement: true }).createIndex('geocode', 'geocode');
      d.createObjectStore('mylogs', { keyPath: 'id', autoIncrement: true }).createIndex('geocode', 'geocode');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
async function tx(store, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), st = t.objectStore(store); let out;
    const r = fn(st); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const idbGet = (s, k) => tx(s, 'readonly', st => st.get(k));
const idbPut = (s, v, k) => tx(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k)));
const idbDel = (s, k) => tx(s, 'readwrite', st => st.delete(k));
const idbAll = s => tx(s, 'readonly', st => st.getAll());
const idbByIndex = (s, i, v) => tx(s, 'readonly', st => st.index(i).getAll(v));
async function idbReplaceAll(s, arr) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(s, 'readwrite'), st = t.objectStore(s);
    st.clear(); for (const v of arr) st.put(v);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}

/* ---------- Oberfläche: Kleinkram ---------- */
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function flash() { const f = $('#flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 120); }
function saveSettings() { idbPut('meta', S.set, 'settings').catch(() => {}); }
function openSheet(title, html, mount) {
  $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false; $('#sheetBody').scrollTop = 0;
  if (mount) mount($('#sheetBody'));
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }
async function run(fn) { try { return await fn(); } catch (e) { console.error(e); toast('⚠️ ' + (e && e.message || e), 5000); } }

/* ---------- Daten laden / speichern ---------- */
async function loadAll() {
  const set = await idbGet('meta', 'settings').catch(() => null); if (set) S.set = { ...DEFAULTS, ...set };
  for (const c of await idbAll('caches')) S.caches.set(c.geocode, c);
  for (const a of await idbAll('ai')) S.ai.set(a.geocode, a);
  S.dir = await idbGet('meta', 'dir').catch(() => null) || null;
  const t = await idbGet('meta', 'target').catch(() => null);
  if (t && (t.kind !== 'cache' || S.caches.has(t.geocode))) S.target = t;
}
async function replaceSource(list, src) {
  const keep = [...S.caches.values()].filter(c => c.src !== src);
  const all = keep.concat(list);
  await idbReplaceAll('caches', all);
  S.caches = new Map(all.map(c => [c.geocode, c]));
  afterDataChange();
}
async function mergeCaches(list) {
  const d = await idb();
  await new Promise((res, rej) => { const t = d.transaction('caches', 'readwrite'); const st = t.objectStore('caches'); for (const c of list) st.put(c); t.oncomplete = res; t.onerror = () => rej(t.error); });
  for (const c of list) S.caches.set(c.geocode, c);
  afterDataChange();
}
function afterDataChange() {
  if (S.target && S.target.kind === 'cache' && S.caches.has(S.target.geocode)) {
    const c = S.caches.get(S.target.geocode); S.target.lat = c.lat; S.target.lon = c.lon; S.target.name = c.name;
  }
  drawCacheMarkers(); renderTop();
}

/* ---------- Import ---------- */
let _sql;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Laden fehlgeschlagen: ' + src)); document.head.appendChild(s); });
}
async function loadSqlJs() {
  if (_sql) return _sql;
  const bases = ['https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/', 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/'];
  let err;
  for (const b of bases) {
    try { if (!window.initSqlJs) await loadScript(b + 'sql-wasm.js'); _sql = await window.initSqlJs({ locateFile: f => b + f }); return _sql; } catch (e) { err = e; }
  }
  throw new Error('SQLite-Modul nicht ladbar (einmal mit Internet öffnen): ' + (err && err.message));
}
async function importSqliteBuf(buf, name) {
  const SQL = await loadSqlJs(); const db = new SQL.Database(buf);
  try {
    const list = importCgeo(sql => db.exec(sql), S.set.maxLogs);
    await replaceSource(list, 'cgeo');
    toast(`✅ ${list.length} Caches aus ${name}`);
  } finally { db.close(); }
}
function parseGpx(text, maxLogs) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX-Datei nicht lesbar');
  const kids = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
  const kid = (el, n) => kids(el, n)[0];
  const txt = (el, n) => { const k = kid(el, n); return k ? k.textContent.trim() : ''; };
  const caches = new Map(), extra = [];
  for (const w of doc.getElementsByTagName('wpt')) {
    const lat = +w.getAttribute('lat'), lon = +w.getAttribute('lon'), code = txt(w, 'name');
    if (!isFinite(lat) || !isFinite(lon) || !code) continue;
    const gc = [...w.getElementsByTagNameNS('*', 'cache')][0];
    if (gc) {
      const logs = [];
      for (const l of kids(kid(gc, 'logs'), 'log')) {
        if (logs.length >= maxLogs) break;
        logs.push({ date: toMs(txt(l, 'date')), type: txt(l, 'type'), author: txt(l, 'finder'), text: txt(l, 'text') });
      }
      logs.sort((a, b) => (b.date || 0) - (a.date || 0));
      caches.set(code, {
        geocode: code, name: txt(gc, 'name') || txt(w, 'urlname') || code, type: normType(txt(gc, 'type') || txt(w, 'type')),
        lat, lon, d: num(txt(gc, 'difficulty')), t: num(txt(gc, 'terrain')), size: normSize(txt(gc, 'container')),
        hint: txt(gc, 'encoded_hints'), owner: txt(gc, 'placed_by') || txt(gc, 'owner'),
        found: /found/i.test(txt(w, 'sym')), disabled: gc.getAttribute('available') === 'False', archived: gc.getAttribute('archived') === 'True',
        note: '', corrected: false, logs, wpts: [], src: 'gpx'
      });
    } else {
      const par = w.getElementsByTagNameNS('*', 'Parent')[0];
      extra.push({ code, lat, lon, name: txt(w, 'desc') || txt(w, 'cmt') || code, type: txt(w, 'type').replace(/^Waypoint\|/, ''), parent: par ? par.textContent.trim() : '' });
    }
  }
  for (const x of extra) {
    let p = x.parent && caches.get(x.parent);
    if (!p) for (const c of caches.values()) if (x.code.length > 2 && x.code !== c.geocode && c.geocode.slice(2) === x.code.slice(2)) { p = c; break; }
    if (p) p.wpts.push({ name: x.name, prefix: x.code.slice(0, 2), lat: x.lat, lon: x.lon, type: x.type, note: '' });
  }
  return [...caches.values()];
}
async function importFileObj(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const fmt = sniffFormat(buf);
  if (fmt === 'sqlite') return importSqliteBuf(buf, file.name);
  if (fmt === 'gpx') { const list = parseGpx(new TextDecoder().decode(buf), S.set.maxLogs); await mergeCaches(list); return toast(`✅ ${list.length} Caches aus ${file.name}`); }
  if (fmt === 'zip') throw new Error('ZIP-Datei – bitte vorher entpacken');
  throw new Error('Unbekanntes Dateiformat: ' + file.name);
}
function pickFile() {
  const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
  i.onchange = () => run(async () => { for (const f of i.files) await importFileObj(f); closeSheet(); });
  i.click();
}
/* c:geo-Ordner (z. B. /cgeo) verbinden und neuestes Backup suchen */
async function connectFolder() {
  if (!('showDirectoryPicker' in window)) throw new Error('Ordnerzugriff kann dieser Browser nicht – bitte „Datei wählen“ nehmen.');
  const h = await window.showDirectoryPicker({ id: 'cgeo', mode: 'read' });
  await idbPut('meta', h, 'dir'); S.dir = h; toast('📁 Ordner verbunden: ' + h.name);
  return h;
}
async function findDbFiles(dir, depth = 0, path = '') {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && /\.(sqlite|db)$/i.test(name)) out.push({ path: path + name, file: await h.getFile() });
    else if (h.kind === 'directory' && depth < 3 && !name.startsWith('.') && !/^(maps|geocachedata|_themes|_hgt)$/i.test(name)) out.push(...await findDbFiles(h, depth + 1, path + name + '/'));
  }
  return out;
}
async function loadNewestBackup() {
  let h = S.dir; if (!h) h = await connectFolder();
  if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('Kein Zugriff auf den Ordner');
  }
  const files = await findDbFiles(h);
  if (!files.length) throw new Error('Keine .sqlite-Datei gefunden. In c:geo: Menü → Sichern/Wiederherstellen → Backup erstellen.');
  files.sort((a, b) => b.file.lastModified - a.file.lastModified);
  const f = files[0]; toast('⏳ Lade ' + f.path);
  await importSqliteBuf(new Uint8Array(await f.file.arrayBuffer()), f.path);
}
/* Dateien, die über „Teilen“ an die App geschickt wurden (Service Worker legt sie ab) */
async function checkShareInbox() {
  if (!('caches' in window)) return;
  const c = await caches.open('cv-inbox'); const keys = await c.keys(); if (!keys.length) return;
  for (const k of keys) {
    const r = await c.match(k); const name = decodeURIComponent(k.url.split('/').pop().replace(/^\d+_/, ''));
    const blob = await r.blob();
    await run(() => importFileObj(new File([blob], name)));
    await c.delete(k);
  }
  history.replaceState(null, '', location.pathname);
}

/* ---------- Opencaching (OKAPI) ---------- */
async function okapi(method, params) {
  if (!S.set.okapiKey) throw new Error('OKAPI-Schlüssel fehlt (Einstellungen)');
  const u = new URL('https://www.opencaching.de/okapi/services/' + method);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('consumer_key', S.set.okapiKey);
  const r = await fetch(u);
  if (!r.ok) throw new Error('OKAPI ' + r.status + ': ' + (await r.text()).slice(0, 160));
  return r.json();
}
function stripHtml(h) { return new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.replace(/\n{3,}/g, '\n\n').trim(); }
function mapOkapi(c) {
  const [lat, lon] = String(c.location).split('|').map(Number);
  return {
    geocode: c.code, name: c.name, type: normType(c.type), lat, lon, d: num(c.difficulty), t: num(c.terrain), size: normSize(c.size2),
    hint: c.hint2 || '', owner: c.owner ? c.owner.username : '', found: !!c.is_found,
    disabled: c.status === 'Temporarily unavailable', archived: c.status === 'Archived', note: c.gc_code ? 'auch bei GC: ' + c.gc_code : '', corrected: false,
    logs: (c.latest_logs || []).map(l => ({ date: toMs(l.date), type: l.type, author: l.user ? l.user.username : '', text: stripHtml(l.comment) })),
    wpts: (c.alt_wpts || []).map(w => { const [a, b] = String(w.location).split('|').map(Number); return { name: w.description || w.name, prefix: w.name, lat: a, lon: b, type: w.type_name || w.type || '', note: '' }; }),
    src: 'oc'
  };
}
async function loadOcNearby() {
  if (!S.pos) throw new Error('Noch keine GPS-Position');
  let uuid = S.set.ocUuid;
  if (S.set.ocUser && !uuid) {
    try { uuid = (await okapi('users/by_username', { username: S.set.ocUser, fields: 'uuid' })).uuid; S.set.ocUuid = uuid; saveSettings(); }
    catch (e) { toast('OC-Benutzer nicht gefunden: ' + e.message); }
  }
  toast('⏳ Lade Opencaching …');
  const near = await okapi('caches/search/nearest', {
    center: `${S.pos.lat}|${S.pos.lon}`, radius: S.set.ocRadius, limit: 100, status: 'Available|Temporarily unavailable',
    user_uuid: uuid || '', found_status: uuid && S.set.hideFound ? 'notfound_only' : ''
  });
  const codes = near.results || [];
  if (!codes.length) return toast('Keine OC-Caches im Umkreis');
  const out = [];
  for (let i = 0; i < codes.length; i += 50) {
    const g = await okapi('caches/geocaches', {
      cache_codes: codes.slice(i, i + 50).join('|'),
      fields: 'code|name|location|type|status|difficulty|terrain|size2|hint2|latest_logs|alt_wpts|owner|gc_code' + (uuid ? '|is_found' : ''),
      lpc: S.set.maxLogs, log_fields: 'date|user|type|comment', langpref: 'de|en', user_uuid: uuid || ''
    });
    for (const c of Object.values(g)) if (c) out.push(mapOkapi(c));
  }
  await mergeCaches(out);
  toast(`✅ ${out.length} Opencaching-Caches geladen`);
}

/* ---------- Ziel ---------- */
function setTarget(t) {
  S.target = t; idbPut('meta', t, 'target').catch(() => {});
  S.route = null; S.steer = null;
  renderTop(); drawCacheMarkers(); closeSheet();
  if (S.set.routing) requestRoute('user');
}

/* ---------- Routing (Valhalla) ---------- */
function targetKey(t) { return t ? t.lat.toFixed(6) + ',' + t.lon.toFixed(6) : ''; }
function activeRoute() { return S.set.routing && S.route && S.target && S.route.key === targetKey(S.target) ? S.route : null; }
async function requestRoute(reason) {
  const t = S.target, p = S.pos;
  if (!S.set.routing || !t || S.routeBusy) return;
  if (!p) { if (reason !== 'auto') toast('Route folgt, sobald GPS da ist'); return; }
  const u = (S.set.routeUrl || '').trim();
  if (!u) { toast('Routing-Adresse fehlt (Einstellungen)'); return; }
  S.routeBusy = true; S.routeTs = Date.now();
  const req = { locations: [{ lat: p.lat, lon: p.lon, type: 'break' }, { lat: t.lat, lon: t.lon, type: 'break' }],
    costing: S.set.routeCosting, directions_options: { units: 'kilometers', language: 'de-DE' } };
  try {
    const r = /\.php(\?|$)/.test(u)
      ? await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': S.set.apiToken || '' }, body: JSON.stringify(req) })
      : await fetch(u.replace(/\/+$/, '') + '/route?json=' + encodeURIComponent(JSON.stringify(req)));
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.trip) throw new Error(j && (j.error || j.error_code) ? `${j.error || ''}${j.error_code ? ' (' + j.error_code + ')' : ''}` : 'HTTP ' + r.status);
    if (targetKey(S.target) !== targetKey(t)) return; // Ziel inzwischen gewechselt
    const leg = j.trip.legs[0], pts = decodePolyline(leg.shape, 6), last = pts[pts.length - 1];
    S.route = {
      key: targetKey(t), pts, cum: routeCum(pts), len: j.trip.summary.length * 1000, time: j.trip.summary.time,
      man: (leg.maneuvers || []).map(m => ({ txt: m.instruction || '', i: m.begin_shape_index })),
      gap: haversine(last[0], last[1], t.lat, t.lon), fit: true
    };
    S.offCount = 0; onPosRoute(); drawRoute();
    if (reason !== 'auto') toast(`🧭 ${fmtDist(S.route.len)} Weg · ca. ${Math.max(1, Math.round(S.route.time / 60))} min`);
  } catch (e) {
    if (reason !== 'auto') toast('Routing: ' + e.message, 6000);
  } finally { S.routeBusy = false; }
}
function onPosRoute() {
  const p = S.pos, t = S.target;
  if (S.set.routing && t && p && !S.route && !S.routeBusy && Date.now() - S.routeTs > 30000) { requestRoute('auto'); return; }
  const R = activeRoute();
  if (!R || !p) { S.steer = null; return; }
  const loc = R.loc = routeLocate(R.pts, R.cum, p.lat, p.lon);
  const total = R.cum[R.cum.length - 1];
  R.rest = Math.max(0, total - loc.along) + R.gap;
  R.offLim = Math.max(30, (p.acc || 10) * 1.5);
  if (loc.off > R.offLim) { if (++S.offCount >= 2 && Date.now() - S.routeTs > 20000) requestRoute('auto'); } else S.offCount = 0;
  // letzte Meter: Luftlinie zum Ziel (die Route endet am nächsten Weg)
  R.final = total - loc.along < 30 || haversine(p.lat, p.lon, t.lat, t.lon) < 40;
  if (R.final) S.steer = null;
  else { const q = routePointAt(R.pts, R.cum, loc.along + S.set.lookahead); S.steer = { lat: q[0], lon: q[1] }; }
  R.next = null;
  for (const m of R.man) if (m.i > loc.i) { R.next = { txt: m.txt, d: Math.max(0, R.cum[m.i] - loc.along) }; break; }
}
function routeText(R, dist, brg) {
  if (R.loc && R.loc.off > R.offLim) return `⚠️ ${fmtDist(R.loc.off)} neben der Route – berechne neu …`;
  if (R.final) return `Letztes Stück Luftlinie: ${compassName(brg)} ${Math.round(brg)}°, ${fmtDist(dist)}`;
  if (R.next) return (R.next.d < 15 ? 'Jetzt: ' : `In ${fmtDist(R.next.d)}: `) + R.next.txt;
  return 'Der Route folgen';
}
function toggleRouting() {
  S.set.routing = !S.set.routing; saveSettings(); updateButtons();
  if (S.set.routing) { if (!S.target) toast('🧭 Routing an – erst ein Ziel wählen'); else requestRoute('user'); }
  else { S.route = null; S.steer = null; drawRoute(); toast('Routing aus – Luftlinie'); }
}
function drawRoute() {
  if (!S.map) return;
  const R = activeRoute();
  S.L.route.setLatLngs(R ? R.pts : []);
  if (R && R.fit) { R.fit = false; S.map.fitBounds(window.L.latLngBounds(R.pts.concat([[S.target.lat, S.target.lon]])), { padding: [40, 40], maxZoom: 18 }); S.follow = false; $('#bFollow').hidden = false; }
}
function targetCache(geocode) {
  const c = S.caches.get(geocode); if (!c) return;
  setTarget({ kind: 'cache', geocode, lat: c.lat, lon: c.lon, name: c.name });
}
function curCache() { return S.target ? S.caches.get(S.target.geocode) : null; }
function renderTop() {
  const t = S.target, c = curCache();
  if (!t) { $('#tName').textContent = 'Kein Ziel – ☰ Liste öffnen'; $('#tSub').textContent = ''; return; }
  let name = c ? c.name : t.name;
  if (t.kind === 'wpt') name = '📍 ' + t.label;
  if (t.kind === 'zone') name = '🎯 ' + t.label;
  $('#tName').textContent = name;
  if (c) {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    $('#tSub').innerHTML = `<span class="dot" style="background:${ti[1]}"></span>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${c.disabled ? ' · ⛔ deaktiviert' : ''}`;
  } else $('#tSub').textContent = fmtCoord(t.lat, t.lon);
}

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
async function takePhoto() {
  if (!S.track && !(await startCamera())) return;
  let blob = null;
  try { if ('ImageCapture' in window) blob = await new window.ImageCapture(S.track).takePhoto(); } catch (e) { console.warn('takePhoto', e); }
  if (!blob) {
    const v = $('#cam'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  }
  if (S.torch) { try { await S.track.applyConstraints({ advanced: [{ torch: true }] }); } catch (e) { /* egal */ } }
  const t = S.target;
  await idbPut('photos', { geocode: t ? t.geocode || '' : '', name: t ? (t.name || t.label || '') : '', ts: Date.now(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon, blob });
  flash(); toast('📸 Foto gespeichert' + (t && t.geocode ? ' zu ' + t.geocode : ''));
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

/* ---------- Karte (Leaflet) ---------- */
function initMap() {
  if (S.map || !window.L) return;
  const L = window.L;
  S.map = L.map('map', { zoomControl: false }).setView(S.pos ? [S.pos.lat, S.pos.lon] : [48.37, 10.89], 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
  S.L.caches = L.layerGroup().addTo(S.map);
  S.L.zones = L.layerGroup().addTo(S.map);
  S.L.route = L.polyline([], { color: '#3d8bff', weight: 6, opacity: 0.85 }).addTo(S.map);
  S.L.line = L.polyline([], { color: '#ffdc00', weight: 3, dashArray: '6 8' }).addTo(S.map);
  S.L.steer = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#3d8bff', fillOpacity: 1, interactive: false });
  S.L.acc = L.circle([0, 0], { radius: 1, weight: 1, color: '#39cccc', fillOpacity: 0.1 }).addTo(S.map);
  S.L.me = L.marker([0, 0], { icon: L.divIcon({ className: 'me', html: '<div class="meArrow"></div>', iconSize: [34, 34] }), interactive: false }).addTo(S.map);
  S.map.on('dragstart', () => { S.follow = false; $('#bFollow').hidden = false; });
  drawCacheMarkers(); drawRoute();
}
function drawCacheMarkers() {
  if (!S.map) return;
  const L = window.L; S.L.caches.clearLayers(); S.L.zones.clearLayers();
  const ref = S.pos || (S.target ? { lat: S.target.lat, lon: S.target.lon } : null);
  let list = [...S.caches.values()];
  if (ref) list = list.filter(c => haversine(ref.lat, ref.lon, c.lat, c.lon) < 8000);
  for (const c of list.slice(0, 1500)) {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other, isT = S.target && S.target.geocode === c.geocode;
    const m = L.circleMarker([c.lat, c.lon], { radius: isT ? 11 : 7, color: isT ? '#ffdc00' : '#111', weight: isT ? 3 : 1, fillColor: ti[1], fillOpacity: c.found ? 0.35 : 0.9 });
    const box = document.createElement('div');
    box.innerHTML = `<b>${esc(c.name)}</b><br>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}<br><button class="pbtn">Als Ziel</button>`;
    box.querySelector('button').onclick = () => { targetCache(c.geocode); S.map.closePopup(); };
    m.bindPopup(box); m.addTo(S.L.caches);
    if (isT) for (const w of c.wpts || []) L.circleMarker([w.lat, w.lon], { radius: 5, color: '#ffdc00', weight: 2, fillColor: '#fff', fillOpacity: 0.8 }).bindPopup(esc(w.prefix + ' ' + w.name)).addTo(S.L.caches);
  }
  const ai = S.target && S.ai.get(S.target.geocode);
  for (const z of (ai && ai.zones) || []) if (z.lat != null) {
    L.circle([z.lat, z.lon], { radius: z.r || 5, color: '#ff4136', weight: 2, fillOpacity: z.ring ? 0 : 0.15, dashArray: z.ring ? '4 4' : null }).bindPopup(esc(z.label)).addTo(S.L.zones);
  }
}
function updateMap(dist, heading) {
  if (!S.map || !S.pos) return;
  const ll = [S.pos.lat, S.pos.lon];
  S.L.me.setLatLng(ll); S.L.acc.setLatLng(ll).setRadius(S.pos.acc || 1);
  const a = S.L.me.getElement && S.L.me.getElement();
  if (a && heading != null) a.firstChild.style.transform = `rotate(${heading}deg)`;
  const R = activeRoute();
  if (R && S.L.route.getLatLngs().length !== R.pts.length) drawRoute();
  if (!R && S.L.route.getLatLngs().length) drawRoute();
  // gelb gestrichelt: Luftlinie – mit Route nur das Reststück vom Wegende zum Ziel
  const tl = S.target ? [S.target.lat, S.target.lon] : null;
  S.L.line.setLatLngs(!tl ? [] : R ? (R.gap > 3 ? [R.pts[R.pts.length - 1], tl] : []) : [ll, tl]);
  if (S.steer) S.L.steer.setLatLng([S.steer.lat, S.steer.lon]).addTo(S.map); else S.L.steer.remove();
  if (S.follow) S.map.panTo(ll, { animate: false });
}

/* ---------- Hauptschleife: Anzeige ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  if (now - S.lastFrame < 40) return; S.lastFrame = now;
  const t = S.target, p = S.pos;
  const ang = (screen.orientation && screen.orientation.angle) || +window.orientation || 0;
  const sc = S.cols ? screenCols(S.cols, ang) : null;
  const head = sc ? (viewHeading(sc) + S.set.compassOffset + 360) % 360 : (p && p.heading != null && p.speed > 0.7 ? p.heading : null);
  const stale = S.cols && now - S.oriTs > 3000;
  $('#status').textContent = `${S.cols ? (stale ? '⚠️ Kompass hängt' : S.oriSrc) : 'Kompass: fehlt'} · GPS ${p ? '±' + Math.round(p.acc) + ' m' : 'wartet …'}`;
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
}

/* ---------- Blätter: Liste ---------- */
function showList(filter = '') {
  const p = S.pos;
  let list = [...S.caches.values()];
  if (filter) { const f = filter.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(f) || c.geocode.toLowerCase().includes(f)); }
  if (p) list.forEach(c => { c._d = haversine(p.lat, p.lon, c.lat, c.lon); c._b = bearing(p.lat, p.lon, c.lat, c.lon); });
  list.sort((a, b) => (a._d || 0) - (b._d || 0));
  const rows = list.slice(0, 300).map(c => {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    return `<li class="row${c.found ? ' found' : ''}" data-g="${esc(c.geocode)}"><span class="dot" style="background:${ti[1]}"></span>
      <div class="grow"><b>${esc(c.name)}</b><small>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${S.ai.has(c.geocode) ? ' · 🤖' : ''}</small></div>
      <span class="dd">${p ? fmtDist(c._d) + '<br>' + compassName(c._b) : ''}</span></li>`;
  }).join('');
  openSheet(`Caches (${S.caches.size})`, `
    <div class="tools">
      <button id="lFolder">📁 c:geo-Backup laden</button><button id="lFile">📄 Datei wählen</button>
      <button id="lOc">🟢 OC in der Nähe</button><button id="lAi">🤖 Alle auswerten</button>
      <button id="lSet">⚙️ Einstellungen</button><button id="lDiag">🩺 Diagnose</button>
    </div>
    <input id="lFilter" type="search" placeholder="Suchen (Name oder Code)" value="${esc(filter)}">
    <ul class="list">${rows || '<li class="empty">Noch keine Caches. In c:geo Caches offline speichern und ein Backup machen, dann „c:geo-Backup laden“.</li>'}</ul>`, b => {
    b.querySelector('#lFolder').onclick = () => run(loadNewestBackup);
    b.querySelector('#lFile').onclick = pickFile;
    b.querySelector('#lOc').onclick = () => run(loadOcNearby);
    b.querySelector('#lAi').onclick = () => run(aiAll);
    b.querySelector('#lSet').onclick = showSettings;
    b.querySelector('#lDiag').onclick = showDiag;
    const fi = b.querySelector('#lFilter'); fi.oninput = () => { clearTimeout(fi._t); fi._t = setTimeout(() => showList(fi.value), 300); };
    b.querySelectorAll('li.row').forEach(li => { li.onclick = () => targetCache(li.dataset.g); });
  });
}

/* ---------- Blätter: Cache-Infos + Hint ---------- */
function showInfo() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const wp = (c.wpts || []).map((w, i) => `<li class="row" data-w="${i}"><div class="grow"><b>${esc(w.prefix)} ${esc(w.name)}</b><small>${esc(w.type)} · ${fmtCoord(w.lat, w.lon)}</small></div><span class="dd">Ziel</span></li>`).join('');
  openSheet(c.name, `
    <p class="sub">${esc(c.geocode)} · ${(TYPE_INFO[c.type] || TYPE_INFO.other)[0]} · D${c.d || '?'}/T${c.t || '?'} ${c.size ? '· ' + esc(c.size) : ''} ${c.owner ? '· von ' + esc(c.owner) : ''}</p>
    <p class="coord">${fmtCoord(c.lat, c.lon)}${c.corrected ? ' (korrigiert)' : ''}</p>
    <h4>Hint</h4>
    <div id="hint" class="hint blur">${esc(c.hint || '– kein Hint –')}</div>
    <div class="tools"><button id="hShow">👁 Anzeigen</button><button id="hRot">🔤 ROT13</button><button id="hCache">🎯 Cache als Ziel</button></div>
    ${c.note ? `<h4>Persönliche Notiz</h4><div class="hint">${esc(c.note)}</div>` : ''}
    ${wp ? `<h4>Wegpunkte</h4><ul class="list">${wp}</ul>` : ''}
    <div class="tools"><button id="hOpen">↗️ In c:geo / im Browser öffnen</button></div>`, b => {
    const h = b.querySelector('#hint');
    b.querySelector('#hShow').onclick = () => h.classList.toggle('blur');
    b.querySelector('#hRot').onclick = () => { h.textContent = rot13(h.textContent); h.classList.remove('blur'); };
    b.querySelector('#hCache').onclick = () => targetCache(c.geocode);
    b.querySelector('#hOpen').onclick = () => openExternal(c.geocode);
    b.querySelectorAll('li[data-w]').forEach(li => { li.onclick = () => { const w = c.wpts[+li.dataset.w]; setTarget({ kind: 'wpt', geocode: c.geocode, lat: w.lat, lon: w.lon, label: `${w.prefix} ${w.name}`, name: c.name }); }; });
  });
}
function openExternal(code) { window.open(/^OC/i.test(code) ? 'https://www.opencaching.de/' + code : 'https://coord.info/' + code, '_blank'); }

/* ---------- Blätter: Logs ---------- */
function showLogs() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const lf = lastFound(c.logs), streak = dnfStreak(c.logs);
  const items = (c.logs || []).map(l => { const [n, k] = logTypeInfo(l.type); return `<li class="log ${k}"><div class="lh"><span class="lt">${esc(n)}</span> ${fmtDate(l.date)} · ${esc(l.author)}</div><div class="lx">${esc(l.text)}</div></li>`; }).join('');
  openSheet(`Logs · ${c.geocode}`, `
    <p class="sub">${(c.logs || []).length} Logs · letzter Fund: ${lf ? fmtDate(lf) : '–'}${streak ? ` · <b class="warn">${streak} DNF in Folge</b>` : ''}</p>
    <ul class="logs">${items || '<li class="empty">Keine Logs gespeichert. In c:geo den Cache mit Logs offline speichern.</li>'}</ul>`);
}

/* ---------- KI-Auswertung ---------- */
async function osmAround(lat, lon, m) {
  const dLa = m / 111320, dLo = m / (111320 * Math.cos(lat * D2R));
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${(lon - dLo).toFixed(6)},${(lat - dLa).toFixed(6)},${(lon + dLo).toFixed(6)},${(lat + dLa).toFixed(6)}`);
  if (!r.ok) throw new Error('OSM ' + r.status);
  return (await r.json()).elements || [];
}
async function resolveZones(c, res) {
  const zones = [];
  const kk = res.koordinaten_korrektur;
  if (kk && kk.meter > 0 && kk.richtung_grad >= 0) {
    const p = destPoint(c.lat, c.lon, kk.meter, kk.richtung_grad);
    zones.push({ label: `Korrektur: ${Math.round(kk.meter)} m ${compassName(kk.richtung_grad)}`, lat: p.lat, lon: p.lon, r: Math.max(4, kk.meter * 0.3), zitat: kk.zitat || '', sicherheit: kk.sicherheit || '' });
  }
  const pos = res.positionen || [];
  let osm = null;
  if (pos.some(p => p.osm_key)) { try { osm = await osmAround(c.lat, c.lon, 170); } catch (e) { console.warn(e); } }
  for (const p of pos) {
    let anchor = null;
    if (osm && p.osm_key) {
      anchor = nearestOsm(osm, p.osm_key, p.osm_value, c.lat, c.lon);
      if (!anchor && p.osm_key === 'highway' && p.osm_value === 'bus_stop') anchor = nearestOsm(osm, 'public_transport', '*', c.lat, c.lon);
    }
    if (!anchor && /listing|koordinate|cache/i.test(p.anker || '')) anchor = { lat: c.lat, lon: c.lon, dist: 0 };
    const z = { label: `${p.anker}${p.abstand_m > 0 ? ' · ' + p.abstand_m + ' m' : ''}${p.richtung_text ? ' · ' + p.richtung_text : ''}`, zitat: p.zitat || '', sicherheit: p.sicherheit || '' };
    if (anchor) {
      z.anchorDist = Math.round(anchor.dist);
      if (p.abstand_m > 0 && p.richtung_grad >= 0) { const q = destPoint(anchor.lat, anchor.lon, p.abstand_m, p.richtung_grad); z.lat = q.lat; z.lon = q.lon; z.r = Math.max(3, p.abstand_m * 0.3); }
      else { z.lat = anchor.lat; z.lon = anchor.lon; z.r = p.abstand_m > 0 ? p.abstand_m : 5; z.ring = p.abstand_m > 0; }
    } else z.unresolved = true;
    zones.push(z);
  }
  return zones;
}
async function aiAnalyze(c) {
  if (!S.set.apiUrl) throw new Error('KI-Adresse fehlt (Einstellungen)');
  const body = {
    geocode: c.geocode, name: c.name, type: (TYPE_INFO[c.type] || TYPE_INFO.other)[0], d: c.d, t: c.t, size: c.size, hint: c.hint, lat: c.lat, lon: c.lon,
    logs: (c.logs || []).slice(0, 40).map(l => ({ date: l.date ? new Date(l.date).toISOString().slice(0, 10) : '', type: logTypeInfo(l.type)[0], author: l.author, text: String(l.text || '').slice(0, 900) }))
  };
  const r = await fetch(S.set.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': S.set.apiToken || '' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: 'Antwort nicht lesbar (HTTP ' + r.status + ')' }));
  if (!j.ok) throw new Error('KI: ' + (j.error || 'HTTP ' + r.status));
  const res = j.result || {}; res.ts = Date.now(); res.model = j.model || '';
  res.zones = await resolveZones(c, res);
  await idbPut('ai', { geocode: c.geocode, ...res });
  S.ai.set(c.geocode, res);
  return res;
}
async function aiAll() {
  const todo = [...S.caches.values()].filter(c => !S.ai.has(c.geocode) && (c.logs || []).length && !c.found);
  if (S.pos) todo.sort((a, b) => haversine(S.pos.lat, S.pos.lon, a.lat, a.lon) - haversine(S.pos.lat, S.pos.lon, b.lat, b.lon));
  const list = todo.slice(0, 60);
  if (!list.length) return toast('Nichts auszuwerten (alle schon ausgewertet oder ohne Logs)');
  if (!confirm(`${list.length} Caches (die nächsten) mit KI auswerten?`)) return;
  let ok = 0, fail = 0, i = 0;
  const worker = async () => { while (i < list.length) { const c = list[i++]; try { await aiAnalyze(c); ok++; } catch (e) { fail++; console.warn(c.geocode, e); } toast(`🤖 ${ok + fail}/${list.length} ausgewertet${fail ? ` (${fail} Fehler)` : ''}`, 60000); } };
  await Promise.all([worker(), worker()]);
  toast(`✅ ${ok} ausgewertet${fail ? `, ${fail} Fehler` : ''}`); drawCacheMarkers();
}
function showAi() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const a = S.ai.get(c.geocode);
  const body = !a ? `<p>Noch nicht ausgewertet. Die Logs (${(c.logs || []).length}) gehen an dein KI-Skript (${esc(S.set.apiUrl)}).</p>` : `
    <p class="ki">${esc(a.kurzfassung || '')}</p>
    <p class="sub">Zustand: <b>${esc(a.zustand || '?')}</b>${a.letzter_fund ? ' · letzter Fund: ' + esc(a.letzter_fund) : ''}${a.dnf_serie ? ` · <b class="warn">${a.dnf_serie} DNF in Folge</b>` : ''}</p>
    ${(a.versteck_hinweise || []).length ? '<h4>Hinweise zum Versteck</h4><ul class="list">' + a.versteck_hinweise.map(h => `<li class="ai"><b>${esc(h.hinweis)}</b><q>${esc(h.zitat)}</q></li>`).join('') + '</ul>' : ''}
    ${(a.zones || []).length ? '<h4>Suchzonen</h4><ul class="list">' + a.zones.map((z, i) => `<li class="ai"><b>${esc(z.label)}</b>${z.sicherheit ? ` <small>(${esc(z.sicherheit)})</small>` : ''}<q>${esc(z.zitat)}</q>
       ${z.unresolved ? '<small class="warn">Bezugspunkt nicht in OpenStreetMap gefunden</small>' : `<small>${z.anchorDist != null ? 'Bezugspunkt ' + z.anchorDist + ' m von den Listing-Koordinaten · ' : ''}Radius ${Math.round(z.r)} m</small> <button data-z="${i}">🎯 Als Ziel</button>`}</li>`).join('') + '</ul>' : ''}
    <p class="sub">${esc(a.model || '')} · ${fmtDate(a.ts)} – Vorschläge, keine sicheren Koordinaten. Zitat prüfen.</p>`;
  openSheet(`KI · ${c.geocode}`, body + `<div class="tools"><button id="aGo">🤖 ${a ? 'Neu auswerten' : 'Logs auswerten'}</button></div>`, b => {
    b.querySelector('#aGo').onclick = () => run(async () => { toast('🤖 werte aus …', 30000); await aiAnalyze(c); toast('✅ fertig'); drawCacheMarkers(); showAi(); });
    b.querySelectorAll('button[data-z]').forEach(bt => { bt.onclick = () => { const z = a.zones[+bt.dataset.z]; setTarget({ kind: 'zone', geocode: c.geocode, lat: z.lat, lon: z.lon, label: z.label, r: z.r, name: c.name }); }; });
  });
}

/* ---------- Offline-Log + Fotos ---------- */
async function showMyLog() {
  const t = S.target, c = curCache();
  const photos = t && t.geocode ? await idbByIndex('photos', 'geocode', t.geocode) : [];
  const all = (await idbAll('mylogs')).sort((a, b) => b.ts - a.ts);
  const urls = [];
  const thumbs = photos.map(p => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<label class="th"><input type="checkbox" checked value="${p.id}"><img src="${u}"></label>`; }).join('');
  const rows = all.map(l => `<li class="log ${l.type}"><div class="lh"><span class="lt">${esc(FN_TYPES[l.type])}</span> ${esc(l.geocode)} · ${fmtDate(l.ts)} ${new Date(l.ts).toTimeString().slice(0, 5)}${(l.photoIds || []).length ? ' · 📸' + l.photoIds.length : ''}</div>
     <div class="lx">${esc(l.text)}</div><div class="tools"><button data-copy="${l.id}">📋 Kopieren</button><button data-open="${esc(l.geocode)}">↗️ Öffnen</button><button data-photos="${l.id}">🖼 Fotos</button><button data-del="${l.id}">🗑</button></div></li>`).join('');
  openSheet('Offline-Log', `
    ${c ? `<p class="sub">${esc(c.geocode)} · ${esc(c.name)}</p>
    <div class="seg"><label><input type="radio" name="lt" value="found" checked>Gefunden</label><label><input type="radio" name="lt" value="dnf">Nicht gefunden</label><label><input type="radio" name="lt" value="note">Notiz</label><label><input type="radio" name="lt" value="maint">Wartung nötig</label></div>
    <textarea id="lText" rows="4" placeholder="Logtext (kannst du zu Hause noch ausbauen)"></textarea>
    ${thumbs ? `<p class="sub">Fotos anhängen:</p><div class="thumbs">${thumbs}</div>` : '<p class="sub">Noch keine Fotos zu diesem Cache (📸 in der Leiste).</p>'}
    <div class="tools"><button id="lSave">💾 Log speichern</button></div>` : '<p>Kein Cache als Ziel.</p>'}
    <h4>Gespeicherte Offline-Logs (${all.length})</h4>
    <div class="tools"><button id="lExport">📤 Feldnotizen exportieren</button></div>
    <ul class="logs">${rows || '<li class="empty">Noch keine.</li>'}</ul>`, b => {
    const cleanup = () => urls.forEach(u => URL.revokeObjectURL(u));
    $('#sheetClose').addEventListener('click', cleanup, { once: true });
    if (c) b.querySelector('#lSave').onclick = () => run(async () => {
      const type = b.querySelector('input[name=lt]:checked').value, text = b.querySelector('#lText').value.trim();
      const photoIds = [...b.querySelectorAll('.thumbs input:checked')].map(i => +i.value);
      await idbPut('mylogs', { geocode: c.geocode, name: c.name, type, text, ts: Date.now(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon, photoIds });
      toast('💾 Offline-Log gespeichert'); cleanup(); showMyLog();
    });
    b.querySelector('#lExport').onclick = () => run(exportFieldNotes);
    b.querySelectorAll('[data-copy]').forEach(x => { x.onclick = () => { const l = all.find(y => y.id === +x.dataset.copy); navigator.clipboard.writeText(l.text || '').then(() => toast('📋 Text kopiert')); }; });
    b.querySelectorAll('[data-open]').forEach(x => { x.onclick = () => openExternal(x.dataset.open); });
    b.querySelectorAll('[data-photos]').forEach(x => { x.onclick = () => run(async () => { const l = all.find(y => y.id === +x.dataset.photos); const ps = (await Promise.all((l.photoIds || []).map(id => idbGet('photos', id)))).filter(Boolean); if (!ps.length) return toast('Keine Fotos am Log'); await shareFiles(ps.map((p, i) => new File([p.blob], `${l.geocode}_${i + 1}.jpg`, { type: 'image/jpeg' }))); }); });
    b.querySelectorAll('[data-del]').forEach(x => { x.onclick = () => run(async () => { if (!confirm('Offline-Log löschen? (Fotos bleiben)')) return; await idbDel('mylogs', +x.dataset.del); cleanup(); showMyLog(); }); });
  });
}
async function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
}
async function exportFieldNotes() {
  const logs = (await idbAll('mylogs')).sort((a, b) => a.ts - b.ts);
  if (!logs.length) return toast('Keine Offline-Logs');
  const txt = logs.map(fieldNoteLine).join('\r\n') + '\r\n';
  await shareFiles([new File([utf16le(txt)], 'geocache_visits.txt', { type: 'text/plain' })]);
}

/* ---------- Einstellungen + Diagnose ---------- */
function showSettings() {
  const s = S.set;
  const f = (k, label, type = 'text', extra = '') => `<label class="f"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(s[k])}" ${extra}></label>`;
  const chk = (k, label) => `<label class="f c"><input data-k="${k}" type="checkbox" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`;
  openSheet('Einstellungen', `
    <h4>Anzeige</h4>
    ${f('fovH', 'Bildwinkel waagerecht (°) – so einstellen, dass die Markierung auf dem Ziel sitzt', 'number', 'min="20" max="120" step="1"')}
    ${f('phoneH', 'Handyhöhe über Boden (m)', 'number', 'min="0" max="3" step="0.1"')}
    ${f('compassOffset', 'Kompass-Korrektur (°, + = nach rechts)', 'number', 'min="-180" max="180" step="1"')}
    <label class="f"><span>Kompass-Quelle</span><select data-k="sensor"><option value="auto">Automatisch</option><option value="quat">Lagesensor (Quaternion)</option><option value="euler">Lagewinkel (deviceorientation)</option></select></label>
    ${f('smoothing', 'Glättung (0,05 ruhig … 1 direkt)', 'number', 'min="0.05" max="1" step="0.05"')}
    ${chk('autoMode', 'Automatisch: senkrecht = Kamera, waagerecht = Karte')}
    ${chk('keepAwake', 'Bildschirm anlassen')}
    <h4>Routing (Valhalla)</h4>
    ${f('routeUrl', 'Routing-Adresse: ./api/route.php (über deinen Server) oder direkt https://…/ (Valhalla mit HTTPS)')}
    <label class="f"><span>Unterwegs</span><select data-k="routeCosting"><option value="pedestrian">zu Fuß</option><option value="bicycle">Fahrrad</option><option value="motor_scooter">Roller</option><option value="auto">Auto</option></select></label>
    ${f('lookahead', 'Markierung so weit voraus auf dem Weg (m)', 'number', 'min="10" max="80" step="5"')}
    <h4>Daten</h4>
    ${f('maxLogs', 'Logs pro Cache', 'number', 'min="5" max="200" step="5"')}
    <h4>KI-Auswertung</h4>
    ${f('apiUrl', 'Adresse deines KI-Skripts')}
    ${f('apiToken', 'Token (wie APP_TOKEN in config.php)', 'password')}
    <h4>Opencaching (OKAPI)</h4>
    ${f('okapiKey', 'Consumer Key (opencaching.de/okapi/signup.html)')}
    ${f('ocUser', 'Dein OC-Benutzername (für „gefunden“)')}
    ${f('ocRadius', 'Umkreis (km)', 'number', 'min="0.5" max="50" step="0.5"')}
    ${chk('hideFound', 'Gefundene OC-Caches nicht laden')}
    <p class="sub">CacheVisier ${APP_VERSION}</p>`, b => {
    b.querySelectorAll('select[data-k]').forEach(el => { el.value = s[el.dataset.k]; });
    b.querySelectorAll('[data-k]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.k;
        s[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
        if (k === 'ocUser') s.ocUuid = '';
        saveSettings();
        if (k === 'sensor') toast('Kompass-Quelle gilt nach Neustart der App');
        if ((k === 'routeUrl' || k === 'routeCosting') && s.routing) { S.route = null; S.steer = null; S.routeTs = 0; }
      };
    });
  });
}
async function showDiag() {
  const has = x => x ? '✅' : '❌';
  let caps = null; try { caps = S.track && S.track.getCapabilities ? S.track.getCapabilities() : null; } catch (e) { /* egal */ }
  const head = S.cols ? Math.round(viewHeading(S.cols)) + '°' : '–', el = S.cols ? Math.round(vecElev(camVec(S.cols))) + '°' : '–';
  openSheet('Diagnose', `
    <ul class="list diag">
      <li>${has(window.isSecureContext)} Sichere Verbindung (HTTPS)</li>
      <li>${has('geolocation' in navigator)} GPS · ${S.pos ? '±' + Math.round(S.pos.acc) + ' m' : 'noch keine Position'}</li>
      <li>${has(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)} Kamera · ${S.track ? 'läuft' : 'aus'}</li>
      <li>${has(caps && caps.torch)} Lampe (nur bei laufender Kamera prüfbar)</li>
      <li>${has('ImageCapture' in window)} Fotos in voller Auflösung</li>
      <li>${has('AbsoluteOrientationSensor' in window)} Lagesensor (Quaternion)</li>
      <li>${has('ondeviceorientationabsolute' in window)} deviceorientationabsolute</li>
      <li>ℹ️ ${esc(S.oriSrc)} · Blickrichtung ${head} · Kameraneigung ${el}</li>
      <li>${has('showDirectoryPicker' in window)} Ordnerzugriff (c:geo-Ordner) ${S.dir ? '· verbunden: ' + esc(S.dir.name) : ''}</li>
      <li>${has('wakeLock' in navigator)} Bildschirm anlassen</li>
      <li>${has(navigator.canShare)} Teilen von Dateien</li>
      <li>${has('serviceWorker' in navigator && navigator.serviceWorker.controller)} Offline-Modus (Service Worker aktiv)</li>
      <li>${has(window.L)} Kartenbibliothek geladen</li>
    </ul>
    <div class="tools"><button id="dDir">📁 Ordnerzugriff testen</button></div><div id="dOut" class="sub"></div>`, b => {
    b.querySelector('#dDir').onclick = () => run(async () => {
      const h = await connectFolder(); const files = await findDbFiles(h);
      b.querySelector('#dOut').innerHTML = files.length ? 'Gefunden:<br>' + files.sort((x, y) => y.file.lastModified - x.file.lastModified).map(f => `${esc(f.path)} – ${fmtDate(f.file.lastModified)} – ${(f.file.size / 1048576).toFixed(1)} MB`).join('<br>') : 'Ordner lesbar, aber keine .sqlite-Datei gefunden.';
    });
  });
}

/* ---------- Start ---------- */
async function start() {
  if (S.started) return; S.started = true;
  $('#start').hidden = true;
  startGps();
  await startOrientation();
  await startCamera();
  keepAwake();
}
async function init() {
  document.body.dataset.mode = 'cam';
  await loadAll().catch(e => console.error(e));
  renderTop(); updateButtons();
  $('#bStart').onclick = () => run(start);
  $('#bList').onclick = () => showList();
  $('#bRoute').onclick = toggleRouting;
  $('#top').onclick = e => { if (!e.target.closest('button')) showInfo(); };
  $('#bHint').onclick = showInfo;
  $('#bLogs').onclick = showLogs;
  $('#bAi').onclick = showAi;
  $('#bLog').onclick = () => run(showMyLog);
  $('#bTorch').onclick = () => run(toggleTorch);
  $('#bPhoto').onclick = () => run(takePhoto);
  $('#bMode').onclick = cycleModeLock;
  $('#bFollow').onclick = () => { S.follow = true; $('#bFollow').hidden = true; };
  $('#sheetClose').onclick = closeSheet;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.started) keepAwake(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e));
  if (/[?&]share=/.test(location.search)) run(checkShareInbox);
  requestAnimationFrame(frame);
}
window.addEventListener('DOMContentLoaded', init);

} // Ende Browser-Teil

/* Export für Tests in Node */
if (typeof module !== 'undefined') module.exports = {
  haversine, bearing, destPoint, wrap180, compassName, rot13, fmtDist, fmtCoord, colsFromEuler, colsFromQuat, orthonormal,
  vecHeading, vecElev, camVec, viewHeading, projectToScreen, normType, normSize, logTypeInfo, dnfStreak, lastFound,
  fieldNoteLine, utf16le, screenCols, decodePolyline, routeCum, routeLocate, routePointAt, sniffFormat, importCgeo, nearestOsm, toMs
};
