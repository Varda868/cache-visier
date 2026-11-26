'use strict';
/* CacheVisier – PWA fürs Cachen vor Ort
   Kamera mit Fadenkreuz (Handy senkrecht) / Karte (Handy waagerecht), Abstand + Richtung,
   Hint, D/T, Logs, Lampe, Fotos, Offline-Logs, Import c:geo-Backup / GPX / Opencaching (OKAPI),
   KI-Auswertung der Logs über ein eigenes PHP-Skript. */
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
  const want = ['geocode', 'name', 'type', 'latitude', 'longitude', 'difficulty', 'terrain', 'size', 'hint', 'owner', 'found', 'disabled', 'archived', 'personal_note', 'coordsChanged', 'shortdesc', 'description'];
  const sel = want.filter(c => cc.includes(c));
  const res = q(`SELECT ${sel.map(c => '"' + c + '"').join(',')} FROM "${tc}"`);
  const caches = new Map();
  for (const row of res.values) {
    const o = {}; res.columns.forEach((c, i) => { o[c] = row[i]; });
    if (!o.geocode || o.latitude == null || o.longitude == null) continue;
    caches.set(o.geocode, {
      geocode: o.geocode, name: o.name || o.geocode, type: normType(o.type), lat: +o.latitude, lon: +o.longitude,
      d: num(o.difficulty), t: num(o.terrain), size: normSize(o.size), hint: htmlText(o.hint || ''), owner: o.owner || '',
      found: !!o.found, disabled: !!o.disabled, archived: !!o.archived, note: o.personal_note || '', corrected: !!o.coordsChanged,
      desc: [o.shortdesc, o.description].filter(Boolean).join('\n\n'), logs: [], wpts: [], src: 'cgeo'
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
        c.logs.push({ date: toMs(o.date), type: o.type, author: o.author || '', text: htmlText(o.log || '') });
      }
    }
  }
  if (tables.includes('cg_attributes')) {
    const ac = cols('cg_attributes');
    if (ac.includes('geocode') && ac.includes('attribute')) {
      for (const row of q('SELECT geocode, attribute FROM cg_attributes').values) {
        const c = caches.get(row[0]), a = c && mapAttr(row[1]);
        if (a) (c.attrs = c.attrs || []).push(a);
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
        const c = caches.get(o.geocode); if (!c) continue;
        const has = o.latitude != null && o.longitude != null;
        if (String(o.type) === 'original' && has) { c.orig = { lat: +o.latitude, lon: +o.longitude }; continue; } // ursprüngliche Listing-Koordinaten
        c.wpts.push({ name: o.name || o.prefix || 'Wegpunkt', prefix: o.prefix || '', lat: has ? +o.latitude : null, lon: has ? +o.longitude : null, type: String(o.type || ''), note: o.note || '' });
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

/* --- Cache-Attribute: GC-Nummer (GPX), c:geo-Rohname, Opencaching-Name → einheitlicher Schlüssel --- */
const ATTRS = [ // Schlüssel, Symbol, Text, Ausrüstung?, GC-Nummer, Muster
  ['flashlight', '🔦', 'Taschenlampe nötig', true, 44, /flashlight|taschenlampe/i],
  ['uv', '🟣', 'UV-Lampe nötig', true, 48, /(^|[^a-z])uv([^a-z]|$)|uv-?(licht|lampe)/i],
  ['special_tool', '🔧', 'Spezialwerkzeug nötig', true, 51, /s-tool|special.?tool|spezialwerkzeug|werkzeug/i],
  ['tree_climbing', '🌳', 'Baumklettern', true, 64, /tree.?climb|baumklett/i],
  ['climbing_gear', '🧗', 'Kletterausrüstung nötig', true, 3, /rappel|climbing.?gear|kletterausr|abseil/i],
  ['climbing', '🧗', 'Klettern (schwierig)', true, 10, /^climbing|difficult.?climb|klettern/i],
  ['boat', '🚣', 'Boot nötig', true, 4, /boat|boot/i],
  ['scuba', '🤿', 'Tauchausrüstung nötig', true, 5, /scuba|tauch/i],
  ['wading', '🥾', 'Waten / Wathose', true, 11, /wading|waten|wathose|nasse f/i],
  ['swimming', '🏊', 'Schwimmen', true, 12, /swimming|schwimm/i],
  ['night', '🌙', 'Nachtcache', false, 52, /night.?cache|nachtcache|nur nachts/i],
  ['night_rec', '🌃', 'nachts empfohlen', false, 14, /^night(_|$)|recommended at night|nachts/i],
  ['field_puzzle', '🧩', 'Rätsel vor Ort', false, 47, /field.?puzzle|rätsel vor ort|feldrätsel/i],
  ['ticks', '🕷️', 'Zecken', false, 19, /ticks|zecken/i],
  ['thorns', '🌵', 'Dornen', false, 39, /thorn|dornen/i],
  ['poison', '☠️', 'Giftpflanzen', false, 17, /poison|giftpfl/i],
  ['cliff', '⛰️', 'Absturz/Steinschlag', false, 21, /cliff|absturz|steinschl/i],
  ['danger', '⚠️', 'gefährliches Gelände', false, 23, /danger|gefährl/i],
  ['hunting', '🎯', 'Jagdgebiet', false, 22, /hunting|jagd/i],
  ['stealth', '🤫', 'unauffällig vorgehen', false, 40, /stealth|unauffällig/i],
  ['teamwork', '👥', 'Teamarbeit', false, 66, /teamwork|teamarbeit/i],
  ['fee', '💶', 'Gebühr', false, 2, /fee|gebühr/i],
  ['parking', '🅿️', 'Parkplatz', false, 25, /parking|parkpl/i],
  ['public', '🚌', 'ÖPNV in der Nähe', false, 26, /public|öpnv|öffentl/i],
  ['available', '🕒', 'rund um die Uhr', false, 13, /available|24.?7|jederzeit|rund um die uhr/i],
  ['wheelchair', '♿', 'rollstuhlgeeignet', false, 24, /wheelchair|rollstuhl/i],
  ['kids', '👶', 'kindgerecht', false, 6, /kids|kinder/i],
  ['dogs', '🐕', 'Hunde erlaubt', false, 1, /dogs|hunde/i],
  ['winter', '❄️', 'wintertauglich', false, 15, /winter/i],
  ['hike_long', '🥾', 'lange Wanderung', false, 57, /hike_long|long hike|lange wander/i],
  ['seasonal', '📅', 'nur saisonal', false, 62, /seasonal|saison/i]
];
function mapAttr(raw, gcId, inc) {
  let a = null;
  if (gcId != null && gcId !== '') a = ATTRS.find(x => x[4] === +gcId);
  const r = String(raw || '').trim();
  if (!a && r) a = ATTRS.find(x => x[5].test(r.replace(/[_-](yes|no)$/i, '')));
  const neg = inc != null ? !+inc : /[_-]no$|\bnicht\b|\bkein/i.test(r);
  if (!a) return r ? { key: 'x:' + r.toLowerCase(), icon: '•', label: r.replace(/[_-](yes|no)$/i, ''), tool: false, yes: !neg } : null;
  return { key: a[0], icon: a[1], label: (neg ? 'nicht: ' : '') + a[2], tool: a[3] && !neg, yes: !neg };
}
function toolAttrs(c) { return (c.attrs || []).filter(a => a.tool); }
/* Ausrüstung: übliche Cacher-Werkzeuge (Grundausstattung + „erweiterte Cache-Ausrüstung“, ECA).
   hart = ohne das Teil geht der Cache nicht (Tour überspringt ihn), sonst nur „einpacken“.
   Erkannt aus Attributen (siehe ATTRS) und aus Text: Hint und KI-Suchhilfe direkt, Listing nur mit Bedarfswort in der Nähe. */
const GEAR = [ // Schlüssel, Symbol, Text, hart, „hab ich“ vorbelegt, Muster
  ['flashlight', '🔦', 'Taschenlampe', false, true, /taschenlampe|stirnlampe/i],
  ['uv', '🟣', 'UV-Lampe / UV-Stift', true, false, /\buv\b|uv-?(lampe|licht|stift|taschenlampe|led)|schwarzlicht|unsichtbare?n? tinte/i],
  ['pen', '✏️', 'Stift', false, true, /(eigenen|kein(en)?|ohne) stift|stift (mitbringen|mitnehmen|nicht vergessen)|byop|bring your own pen/i],
  ['tweezers', '🥢', 'Pinzette', false, true, /pinzette/i],
  ['magnet', '🧲', 'Magnet / Teleskopmagnet', true, false, /teleskopmagnet|magnetstift|magnetangel|starke[nr]? magnet|magnet (mitbringen|mitnehmen|nötig|benötigt|hilft)|mit (einem|nem) magnet/i],
  ['mirror', '🪞', 'Inspektionsspiegel', false, false, /(teleskop|inspektions|zahnarzt)spiegel|spiegel (mitbringen|hilft|nötig|benötigt)/i],
  ['gloves', '🧤', 'Handschuhe', false, true, /handschuh/i],
  ['special_tool', '🔧', 'Spezialwerkzeug (Schraubendreher, Inbus, Torx …)', true, false, /schraubendreher|schraubenzieher|inbus|torx|vierkant|dreikant|bit-?satz|steckschlüssel|maulschlüssel|spezialwerkzeug/i],
  ['water', '💧', 'Wasser zum Einfüllen', true, false, /wasser (mitbringen|mitnehmen|einfüllen|nachfüllen)|(liter|flasche|kanister) wasser|wassercache/i],
  ['measure', '📏', 'Zollstock / Maßband', false, false, /zollstock|maßband|meterstab/i],
  ['ladder', '🪜', 'Leiter', true, false, /\b(trittleiter|klappleiter|stehleiter|teleskopleiter|leiter)\b/i],
  ['pole', '🎣', 'Teleskopstange / Angel', true, false, /teleskop(stange)?\b|\bangel(rute|haken)?\b|stange mit haken|greifzange/i],
  ['wading', '🥾', 'Wathose / Gummistiefel', true, false, /wathose|gummistiefel|watstiefel/i]
];
const GEAR_HARD = new Set(GEAR.filter(g => g[3]).map(g => g[0]).concat(['tree_climbing', 'climbing_gear', 'climbing', 'boat', 'scuba', 'swimming']));
const NEED = /(mitbring|mitnehm|benötig|brauch|nötig|erforderlich|hilfreich|empfohl|einpack|nicht vergessen|dabei haben|ohne .{0,20} geht)/i;
function textTools(c, ai) {
  const direct = [c.hint, c.note];
  if (ai) (ai.suchhilfe || []).forEach(h => { if (h.kategorie === 'werkzeug' || h.kategorie === 'zugang') direct.push(h.hinweis, h.zitat); });
  const dtxt = direct.filter(Boolean).map(htmlText).join('\n'), desc = htmlText(c.desc || '');
  const inDesc = re => { const g = new RegExp(re.source, 'gi'); let m; while ((m = g.exec(desc))) { if (NEED.test(desc.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80))) return true; } return false; };
  return GEAR.filter(t => t[5].test(dtxt) || inDesc(t[5])).map(t => ({ key: t[0], icon: t[1], label: t[2] + ' (aus Text)', tool: true, yes: true, derived: true }));
}
function toolsOf(c, ai) {
  const a = toolAttrs(c);
  return a.concat(textTools(c, ai).filter(d => !a.some(x => x.key === d.key)));
}
/* fehlende Ausrüstung; hartOnly: nur das, ohne das der Cache nicht geht */
function missingGear(c, set, ai, hartOnly) { return toolsOf(c, ai).filter(a => set['gear_' + a.key] === false && (!hartOnly || GEAR_HARD.has(a.key))); }

/* Tour: Reihenfolge durch Caches (nächster Nachbar + 2-opt), damit man nicht hin und her läuft */
function planTour(start, pts, loop) {
  const n = pts.length; if (!n) return [];
  const all = [start].concat(pts), D = all.map(a => all.map(b => haversine(a.lat, a.lon, b.lat, b.lon)));
  const order = [0], left = new Set(pts.map((_, i) => i + 1));
  while (left.size) { const last = order[order.length - 1]; let best = null; for (const j of left) if (best == null || D[last][j] < D[last][best]) best = j; order.push(best); left.delete(best); }
  const len = o => { let s = 0; for (let i = 1; i < o.length; i++) s += D[o[i - 1]][o[i]]; return loop ? s + D[o[o.length - 1]][0] : s; };
  let cur = len(order), better = true, guard = 0;
  while (better && guard++ < 50) {
    better = false;
    for (let i = 1; i < order.length - 1; i++) for (let k = i + 1; k < order.length; k++) {
      const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
      const l = len(cand); if (l < cur - 0.5) { order.splice(0, order.length, ...cand); cur = l; better = true; }
    }
  }
  return order.slice(1).map(i => i - 1);
}

/* --- Reflektoren (Firetacks) im Kamerabild: kleine, sehr helle Flecken vor dunklem Grund --- */
function findBrightSpots(px, w, h, o) {
  o = o || {};
  const N = w * h, Y = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) { const y = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]; Y[i] = y; sum += y; }
  // Schwelle robust aus Median und MAD: große helle Flächen (Laterne) sollen kleine Reflektoren nicht „überstrahlen“
  const hist = new Uint32Array(256); for (let i = 0; i < N; i++) hist[Math.min(255, Y[i] | 0)]++;
  const q = f => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= f * N) return v; } return 255; };
  const med = q(0.5), mean = sum / N;
  const dev = new Uint32Array(256); for (let v = 0; v < 256; v++) dev[Math.abs(v - med)] += hist[v];
  let c = 0, mad = 0; for (let v = 0; v < 256; v++) { c += dev[v]; if (c >= N / 2) { mad = v; break; } }
  const thr = Math.max(o.min || 200, med + (o.k || 6) * 1.4826 * Math.max(mad, 2)), maxArea = Math.max(4, N * (o.maxFrac || 0.004));
  const seen = new Uint8Array(N), spots = [], stack = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0] || Y[s0] < thr) continue;
    let n = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0, mx = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      n++; sx += x; sy += y; sr += px[4 * i]; sg += px[4 * i + 1]; sb += px[4 * i + 2]; if (Y[i] > mx) mx = Y[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= N || seen[j] || Y[j] < thr) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (n > maxArea) continue;                                   // große helle Fläche (Laterne, Himmel) ist kein Reflektor
    let bs = 0, bn = 0; const m = 3;                             // Hintergrund: Rahmen um den Fleck
    for (let y = Math.max(0, y0 - m); y <= Math.min(h - 1, y1 + m); y++) for (let x = Math.max(0, x0 - m); x <= Math.min(w - 1, x1 + m); x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue; bs += Y[y * w + x]; bn++;
    }
    const bg = bn ? bs / bn : mean, contrast = mx - bg;
    if (contrast < (o.contrast || 70)) continue;
    if (n < (o.minN || 2) && contrast < (o.strong || 130)) continue; // einzelnes helles Pixel: meist Rauschen, nur sehr kräftige zählen
    spots.push({ x: sx / n, y: sy / n, r: Math.max(1, Math.max(x1 - x0, y1 - y0) / 2), n, rgb: [sr / n, sg / n, sb / n], score: contrast * Math.sqrt(n) });
  }
  return mergeSpots(spots, o.merge == null ? Math.max(6, w * 0.035) : o.merge).sort((a, b) => b.score - a.score).slice(0, o.max || 8);
}
/* Flecken, die näher als d Pixel beieinander liegen, als einen Reflektor zählen (Mitte gewichtet, Farbe vom hellsten) */
function mergeSpots(spots, d) {
  const g = spots.map((p, i) => i), find = i => (g[i] === i ? i : (g[i] = find(g[i])));
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const a = spots[i], b = spots[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r < d) g[find(i)] = find(j);
  }
  const by = new Map();
  spots.forEach((p, i) => { const k = find(i); (by.get(k) || by.set(k, []).get(k)).push(p); });
  return [...by.values()].map(ps => {
    const w = ps.reduce((s, p) => s + p.score, 0), top = ps.reduce((a, b) => (b.score > a.score ? b : a));
    const x = ps.reduce((s, p) => s + p.x * p.score, 0) / w, y = ps.reduce((s, p) => s + p.y * p.score, 0) / w;
    const r = Math.max(...ps.map(p => Math.hypot(p.x - x, p.y - y) + p.r));
    return { x, y, r, n: ps.reduce((s, p) => s + p.n, 0), rgb: top.rgb, score: w, teile: ps.length };
  });
}
function colorName(rgb) {
  const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 45) return 'weiß';
  const hue = mx === r ? ((g - b) / (mx - mn) * 60 + 360) % 360 : mx === g ? (b - r) / (mx - mn) * 60 + 120 : (r - g) / (mx - mn) * 60 + 240;
  return hue < 20 || hue >= 330 ? 'rot' : hue < 45 ? 'orange' : hue < 70 ? 'gelb' : hue < 170 ? 'grün' : hue < 260 ? 'blau' : 'violett';
}
/* --- Reflektoren über mehrere Bilder verfolgen, damit die Anzeige ruhig bleibt ---
   dets: Funde eines Bildes {fx, fy, fr, rgb, score, teile} (Lage relativ zur Bildbreite/-höhe).
   Jeder Fund wird dem nächsten bekannten Reflektor zugeordnet (Fenster gate). Angezeigt wird ein Reflektor erst,
   wenn er in 2 der letzten 3 Bilder da war, und er bleibt bis zu hold ms (Standard 0,8 s) stehen, wenn er kurz fehlt.
   Lage und Größe laufen weich nach, die Farbe entscheidet eine abklingende Mehrheit (Wechsel erst bei klarem Vorsprung),
   der hervorgehobene Reflektor wechselt nur, wenn ein anderer deutlich stärker ist. */
function trackSpots(st, dets, now, o) {
  o = o || {};
  const gate = o.gate || 0.07, hold = o.hold || 800, a = o.alpha || 0.45, need = o.need || 2;
  st = st || { tracks: [], next: 1, primary: null };
  const tr = st.tracks, used = new Set();
  for (const d of [...dets].sort((p, q) => q.score - p.score)) {
    let best = null, bd = Infinity;
    for (const t of tr) {
      if (used.has(t)) continue;
      const dist = Math.hypot(t.fx - d.fx, t.fy - d.fy);
      const g = t.shown ? Math.max(gate, t.fr * 3) : Math.max(gate * 0.35, t.fr * 2); // neue Kandidaten nur bei fast gleicher Lage bestätigen (Rauschen)
      if (dist < g && dist < bd) { bd = dist; best = t; }
    }
    const name = colorName(d.rgb);
    if (best) {
      used.add(best);
      best.fx += a * (d.fx - best.fx); best.fy += a * (d.fy - best.fy); best.fr += 0.3 * (d.fr - best.fr);
      best.score += 0.4 * (d.score - best.score); best.teile = d.teile || 1; best.last = now; best.hits.push(1); best.px = Math.max(best.px || 0, d.n || 2);
      best.rgb = d.rgb;
      for (const k in best.votes) best.votes[k] *= 0.8;
      best.votes[name] = (best.votes[name] || 0) + 1;
      const lead = Object.keys(best.votes).reduce((x, y) => (best.votes[y] > best.votes[x] ? y : x));
      if (lead !== best.name && best.votes[lead] > 1.3 * (best.votes[best.name] || 0)) best.name = lead;
    } else {
      const t = { id: st.next++, fx: d.fx, fy: d.fy, fr: d.fr, score: d.score, teile: d.teile || 1, rgb: d.rgb, name, votes: { [name]: 1 }, hits: [1], last: now, shown: false, px: d.n || 2 };
      tr.push(t); used.add(t);
    }
  }
  for (const t of tr) if (!used.has(t)) t.hits.push(0);
  for (const t of tr) {
    if (t.hits.length > 3) t.hits.splice(0, t.hits.length - 3);
    if (!t.shown && t.hits.reduce((x, y) => x + y, 0) >= (t.px < 2 ? 3 : need)) t.shown = true; // ein einzelnes Pixel muss 3 von 3 Bildern da sein
  }
  st.tracks = tr.filter(t => now - t.last <= hold && (t.shown || t.hits.some(Boolean)));
  const vis = st.tracks.filter(t => t.shown).sort((p, q) => q.score - p.score).slice(0, o.max || 8);
  const cur = vis.find(t => t.id === st.primary);
  if (vis.length && (!cur || vis[0].score > 1.5 * cur.score)) st.primary = vis[0].id;
  if (!vis.length) st.primary = null;
  st.visible = vis.map(t => ({ id: t.id, fx: t.fx, fy: t.fy, fr: t.fr, name: t.name, teile: t.teile, score: t.score, primary: t.id === st.primary }));
  return st;
}
/* --- Koordinatenmittelung (GPS averaging) ---
   fixes: [{lat, lon, acc, ts}]. Messungen mit Genauigkeit schlechter als accMax (Standard 20 m) und Ausreißer
   (weiter als 3 × Median-Abstand, mind. 5 m vom Median) fallen weg.
   Modus 'stehen': nach Genauigkeit gewichteter Mittelwert (Gewicht 1/acc²).
   Modus 'umrunden': Mittelpunkt eines Kreises durch die Spur (Kåsa-Ausgleich). Nur gültig, wenn die Spur den Punkt
   umschließt (etwa ab ¾ Runde) und der Radius 1–40 m ist; sonst gewichteter Mittelwert mit Hinweis.
   streuung68: Radius, in dem 68 % der Messungen liegen. fehler: geschätzter Fehler des Ergebnisses. GPS-Fehler sind über
   etwa 30 s miteinander verbunden, deshalb zählt nicht jede Sekunde als neue Messung (n_eff = Dauer / 30 s, mind. 1). */
function averageFixes(fixes, mode, o) {
  o = o || {};
  const accMax = o.accMax || 20;
  let F = (fixes || []).filter(f => f && isFinite(f.lat) && isFinite(f.lon) && (!(f.acc > 0) || f.acc <= accMax));
  if (!F.length) return null;
  const med = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const lat0 = med(F.map(f => f.lat)), lon0 = med(F.map(f => f.lon)), kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  let P = F.map(f => ({ x: (f.lon - lon0) * kx, y: (f.lat - lat0) * ky, w: 1 / Math.pow(Math.max(f.acc || 5, 3), 2), ts: f.ts || 0 }));
  const d0 = P.map(p => Math.hypot(p.x, p.y)), mdist = med(d0), lim = Math.max(5, 3 * mdist);
  // Beim Umrunden ist der Abstand zum Median der Kreisradius – Ausreißer dort über die Abweichung vom typischen Radius erkennen
  const keep = mode === 'umrunden' ? d0.map(d => Math.abs(d - mdist) <= Math.max(5, 3 * med(d0.map(x => Math.abs(x - mdist))))) : d0.map(d => d <= lim);
  P = P.filter((p, i) => keep[i]);
  const n = P.length, ws = P.reduce((a, p) => a + p.w, 0);
  let cx = P.reduce((a, p) => a + p.x * p.w, 0) / ws, cy = P.reduce((a, p) => a + p.y * p.w, 0) / ws, art = 'mittel', hinweis = '', radius = 0, bogen = 0;
  if (mode === 'umrunden' && n >= 8) {
    // Kåsa: x² + y² + D·x + E·y + G = 0 per kleinster Quadrate (Normalgleichungen 3×3)
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (const p of P) { const z = -(p.x * p.x + p.y * p.y); a11 += p.x * p.x; a12 += p.x * p.y; a13 += p.x; a22 += p.y * p.y; a23 += p.y; b1 += z * p.x; b2 += z * p.y; b3 += z; }
    const A = [[a11, a12, a13], [a12, a22, a23], [a13, a23, n]], B = [b1, b2, b3];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D0 = det(A);
    if (Math.abs(D0) > 1e-9) {
      const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v)));
      const D = det(col(0)) / D0, E = det(col(1)) / D0, G = det(col(2)) / D0;
      const kx2 = -D / 2, ky2 = -E / 2, r2 = kx2 * kx2 + ky2 * ky2 - G;
      if (r2 > 0) {
        const r = Math.sqrt(r2), ang = P.map(p => Math.atan2(p.y - ky2, p.x - kx2)).sort((a, b) => a - b);
        let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
        for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
        bogen = Math.round(360 - gap * 180 / Math.PI);
        // Bei kurzen Bögen rechnet der Ausgleich den Kreis zu klein und die Mitte zu nah an die Spur. Deshalb zusätzlich:
        // Die Spur muss die Mitte wirklich umschließen (Schwerpunkt der Spur nahe der Kreismitte), praktisch ab etwa ¾ Runde.
        const umschliesst = Math.hypot(cx - kx2, cy - ky2) < 0.35 * r;
        if (r >= 1 && r <= 40 && bogen >= 240 && umschliesst) { cx = kx2; cy = ky2; radius = r; art = 'kreis'; }
        else hinweis = bogen < 240 || !umschliesst ? `Spur reicht noch nicht für die Kreismitte – weiter im Kreis gehen (mindestens ¾ Runde)` : 'Kreis passt nicht (Radius) – Mittelwert verwendet';
      }
    }
  } else if (mode === 'umrunden') hinweis = 'noch zu wenige Messungen für den Kreis';
  const res = art === 'kreis' ? P.map(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius)) : P.map(p => Math.hypot(p.x - cx, p.y - cy));
  const sorted = [...res].sort((a, b) => a - b), streuung68 = sorted[Math.min(sorted.length - 1, Math.floor(0.68 * sorted.length))] || 0;
  const ts = P.map(p => p.ts).filter(Boolean), dauer = ts.length ? (Math.max(...ts) - Math.min(...ts)) / 1000 : 0;
  const neff = Math.max(1, Math.min(n, dauer / 30));
  return { lat: lat0 + cy / ky, lon: lon0 + cx / kx, n: F.length, used: n, streuung68, fehler: Math.max(1, streuung68 / Math.sqrt(neff)) /* unter 1 m ist mit Handy-GPS nicht belastbar */, dauer, art, radius, bogen, hinweis };
}

/* Ansagen: größte Stufe unterhalb der Entfernung */
const ANN_STEPS = [2000, 1000, 500, 200, 100, 50, 20, 10];
function annStepBelow(d) { return ANN_STEPS.find(x => x < d) == null ? null : ANN_STEPS.find(x => x < d); }

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

/* --- Multi: Ausdrücke rechnen, Koordinaten-Vorlagen füllen, Stationen auflösen --- */
function quersumme(n) { return String(Math.abs(Math.trunc(n))).split('').reduce((a, d) => a + +d, 0); }
function evalExpr(src, vars) {
  const s = String(src == null ? '' : src).replace(/×/g, '*').replace(/÷/g, '/').replace(/(\d),(\d)/g, '$1.$2');
  let i = 0; const missing = new Set();
  const peek = () => { while (s[i] === ' ') i++; return s[i]; };
  const FN = { QS: quersumme, IQS: n => { n = Math.abs(Math.trunc(n)); while (n > 9) n = quersumme(n); return n; },
    ABS: Math.abs, RUND: Math.round, ROUND: Math.round, INT: Math.trunc, FLOOR: Math.floor };
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error('Klammer fehlt'); i++; return v; }
    if (c === '-') { i++; return -primary(); }
    if (c === '+') { i++; return primary(); }
    if (c != null && /[0-9.]/.test(c)) { const j = i; while (/[0-9.]/.test(s[i] || '')) i++; return parseFloat(s.slice(j, i)); }
    if (c != null && /[A-Za-z_]/.test(c)) {
      const j = i; while (/[A-Za-z0-9_]/.test(s[i] || '')) i++;
      const name = s.slice(j, i);
      if (peek() === '(') {
        const f = FN[name.toUpperCase()]; if (!f) throw new Error('Unbekannte Funktion ' + name);
        i++; const v = sum(); if (peek() !== ')') throw new Error('Klammer fehlt'); i++; return isNaN(v) ? NaN : f(v);
      }
      const k = Object.keys(vars || {}).find(x => x.toUpperCase() === name.toUpperCase());
      const raw = k != null ? String(vars[k]).trim().replace(',', '.') : '';
      const v = raw === '' ? NaN : Number(raw);
      if (isNaN(v)) { missing.add(name.toUpperCase()); return NaN; }
      return v;
    }
    throw new Error(c == null ? 'Ausdruck endet zu früh' : 'Unerwartetes Zeichen ' + c);
  }
  function pow() { const v = primary(); if (peek() === '^') { i++; return Math.pow(v, pow()); } return v; }
  function prod() { let v = pow(); for (;;) { const c = peek(); if (c === '*') { i++; v *= pow(); } else if (c === '/') { i++; v /= pow(); } else if (c === '%') { i++; v %= pow(); } else return v; } }
  function sum() { let v = prod(); for (;;) { const c = peek(); if (c === '+') { i++; v += prod(); } else if (c === '-') { i++; v -= prod(); } else return v; } }
  if (peek() == null) return { value: null, missing: [] };
  const v = sum(); if (peek() != null) throw new Error('Unerwartet: ' + s.slice(i));
  return { value: missing.size ? null : v, missing: [...missing] };
}
function fillTemplate(tpl, vars) {
  const missing = new Set(); let err = null;
  const text = String(tpl || '').replace(/\{([^{}]*)\}/g, (_, ex) => {
    try {
      const r = evalExpr(ex, vars);
      if (r.value == null) { r.missing.forEach(m => missing.add(m)); return '?'; }
      return Number.isInteger(r.value) ? String(r.value) : String(Math.round(r.value * 1000) / 1000);
    } catch (e) { err = e.message; return '⚠'; }
  });
  return { text, missing: [...missing], err, ok: !missing.size && !err };
}
function parseCoord(t) {
  t = String(t || '').replace(/(\d),(\d)/g, '$1.$2').replace(/[′'’]/g, ' ');
  let m = /([NS])\s*(\d{1,2})\s*°?\s+(\d{1,2}(?:\.\d+)?)\s*[,;]?\s*([EOW])\s*(\d{1,3})\s*°?\s+(\d{1,2}(?:\.\d+)?)/i.exec(t)
    || /([NS])\s*(\d{1,2})°\s*(\d{1,2}(?:\.\d+)?)\s*[,;]?\s*([EOW])\s*(\d{1,3})°\s*(\d{1,2}(?:\.\d+)?)/i.exec(t);
  if (m) {
    if (+m[3] >= 60 || +m[6] >= 60) return null;
    return { lat: (+m[2] + +m[3] / 60) * (/s/i.test(m[1]) ? -1 : 1), lon: (+m[5] + +m[6] / 60) * (/w/i.test(m[4]) ? -1 : 1) };
  }
  m = /(-?\d{1,2}\.\d{3,})\s*[ ,;]\s*(-?\d{1,3}\.\d{3,})/.exec(t);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}
/* Ort einer Station/des Finals: base = Listing-Koordinaten, pts = schon aufgelöste Stationen nach Nummer */
function resolvePoint(p, vars, base, pts) {
  try {
    if (!p || p.art === 'unbekannt') return { missing: [], text: '' };
    if (p.art === 'listing') return base ? { lat: base.lat, lon: base.lon, text: fmtCoord(base.lat, base.lon) } : { missing: [], text: '' };
    if (p.art === 'koordinaten' || p.art === 'formel') {
      const f = fillTemplate(p.vorlage, vars);
      if (!f.ok) return { text: f.text, missing: f.missing, err: f.err };
      const c = parseCoord(f.text);
      return c ? { lat: c.lat, lon: c.lon, text: f.text } : { text: f.text, missing: [], err: 'Koordinate nicht lesbar' };
    }
    if (p.art === 'projektion') {
      const from = !p.von || /listing/i.test(p.von) ? base : pts[String(p.von).replace(/\D/g, '')];
      const d = evalExpr(p.distanz, vars), w = evalExpr(p.winkel, vars), miss = d.missing.concat(w.missing);
      const what = `Peilung ${p.distanz || '?'} m / ${p.winkel || '?'}°`;
      if (miss.length || d.value == null || w.value == null) return { missing: miss, text: what };
      if (!from || from.lat == null) return { missing: [], text: what, err: 'Startpunkt der Peilung fehlt' };
      const q = destPoint(from.lat, from.lon, d.value, w.value);
      return { lat: q.lat, lon: q.lon, text: `${fmtCoord(q.lat, q.lon)} (${Math.round(d.value)} m / ${Math.round(w.value)}°)` };
    }
  } catch (e) { return { missing: [], text: p.vorlage || '', err: e.message }; }
  return { missing: [], text: '' };
}
function stationVarsDone(st, vars) { return (st.variablen || []).every(v => vars[v.name] != null && String(vars[v.name]).trim() !== ''); }

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
const KIA = () => (window.CVKI ? CVKI.ANBIETER : []);
function kiDefaults() { const o = {}; for (const a of KIA()) { o['kiKey_' + a.id] = ''; o['kiModel_' + a.id] = a.model; } return o; }
const DEFAULTS = {
  fovH: 50, phoneH: 1.4, compassOffset: 0, sensor: 'auto', autoMode: true, maxLogs: 40,
  kiMode: 'direkt', ...kiDefaults(), apiUrl: '', apiToken: '', okapiKey: '', ocUser: '', ocUuid: '', ocRadius: 3, hideFound: true,
  keepAwake: true, smoothing: 0.25, mapDark: 'on', autoZoom: true,
  night: false, speak: true, vibrate: true, stepLen: 0.75, declination: 4, skipGear: true,
  talkOn: false, talkName: '', talkPw: '', talkCache: true, talkLive: 'aus', talkRelays: 'wss://nos.lol wss://relay.primal.net wss://nostr.mom',
  gear_flashlight: true, gear_uv: false, gear_pen: true, gear_tweezers: true, gear_magnet: false, gear_mirror: false, gear_gloves: true,
  gear_special_tool: false, gear_water: false, gear_measure: false, gear_ladder: false, gear_pole: false, gear_wading: false,
  gear_tree_climbing: false, gear_climbing_gear: false, gear_climbing: false, gear_boat: false, gear_scuba: false, gear_swimming: false,
  tourRadius: 2000, tourLoop: false,
  routing: false, routeUrl: 'https://valhalla1.openstreetmap.de', routeCosting: 'pedestrian', lookahead: 25
};
const S = {
  set: { ...DEFAULTS }, caches: new Map(), ai: new Map(), multi: new Map(), stageMin: false,
  talk: { msgs: [], seen: new Set(), unread: 0, pos: {}, voice: new Map(), queue: [], slot: 0 },
  ann: {}, annMan: {}, lockPrev: false, lockTs: 0, spots: [], peil: null, pos: null, cols: null, oriSrc: 'noch keine Daten', oriTs: 0,
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
  S.tour = await idbGet('meta', 'tour').catch(() => null) || null;
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
  // zuerst die mitgelieferte Kopie (vendor/, kein fremder Code neben den KI-Schlüsseln); CDN nur, wenn sie fehlt (lokale Entwicklung)
  const bases = ['vendor/sqljs/', 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/', 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/'];
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
        logs.push({ date: toMs(txt(l, 'date')), type: txt(l, 'type'), author: txt(l, 'finder'), text: htmlText(txt(l, 'text')) });
      }
      logs.sort((a, b) => (b.date || 0) - (a.date || 0));
      caches.set(code, {
        geocode: code, name: txt(gc, 'name') || txt(w, 'urlname') || code, type: normType(txt(gc, 'type') || txt(w, 'type')),
        lat, lon, d: num(txt(gc, 'difficulty')), t: num(txt(gc, 'terrain')), size: normSize(txt(gc, 'container')),
        hint: txt(gc, 'encoded_hints'), owner: txt(gc, 'placed_by') || txt(gc, 'owner'),
        found: /found/i.test(txt(w, 'sym')), disabled: gc.getAttribute('available') === 'False', archived: gc.getAttribute('archived') === 'True',
        note: '', corrected: false, logs, wpts: [], src: 'gpx',
        desc: [txt(gc, 'short_description'), txt(gc, 'long_description')].filter(Boolean).join('\n\n'),
        attrs: kids(kid(gc, 'attributes'), 'attribute').map(a => mapAttr(a.textContent.trim(), a.getAttribute('id'), a.getAttribute('inc'))).filter(Boolean)
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
    desc: [c.short_description, c.description].filter(Boolean).join('\n\n'),
    attrs: (c.attrnames || []).map(n => mapAttr(n)).filter(Boolean),
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
      fields: 'code|name|location|type|status|difficulty|terrain|size2|hint2|latest_logs|alt_wpts|owner|gc_code|short_description|description|attrnames' + (uuid ? '|is_found' : ''),
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
  renderTop(); drawCacheMarkers(); closeSheet(); renderStage();
  if (S.set.routing) routeSoon();
  if (S.set.talkOn && S.talk.pool && S.talk.chanCode !== cacheCode()) { S.talk.chanCode = cacheCode(); run(talkSubscribe); }
}
/* schnelles Durchklicken von Zielen löst nur eine Anfrage aus (Rücksicht auf den öffentlichen Valhalla-Server) */
let _routeTimer;
function routeSoon() { clearTimeout(_routeTimer); _routeTimer = setTimeout(() => requestRoute('user'), 1500); }

/* ---------- Routing (Valhalla) ---------- */
const FOSSGIS = 'https://valhalla1.openstreetmap.de';
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
  const direct = base => fetch(base.replace(/\/+$/, '') + '/route?json=' + encodeURIComponent(JSON.stringify(req)));
  try {
    let r, j, via = 'direkt';
    if (/\.php(\?|$)/.test(u)) {
      via = 'Server';
      try {
        r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': S.set.apiToken || '' }, body: JSON.stringify(req) });
        j = await r.json().catch(() => null);
      } catch (e) { r = null; j = null; }
      // Rückfall wie bei Scooterways: Server-Weg kaputt (kein Token, keine config, Valhalla nicht erreichbar) → direkt zu FOSSGIS.
      // Nicht bei Drossel (429) und nicht, wenn Valhalla selbst „kein Weg“ meldet (error_code).
      if (!r || (!r.ok && r.status !== 429 && !(j && j.error_code))) {
        if (r && r.status === 401 && reason !== 'auto') toast('🧭 Token fehlt oder falsch – Route direkt über FOSSGIS', 4000);
        r = await direct(FOSSGIS); j = await r.json().catch(() => null); via = 'direkt';
      }
    } else { r = await direct(u); j = await r.json().catch(() => null); }
    if (!r.ok || !j || !j.trip) throw new Error(j && (j.error || j.error_code) ? `${j.error || ''}${j.error_code ? ' (' + j.error_code + ')' : ''}` : 'HTTP ' + r.status);
    if (targetKey(S.target) !== targetKey(t)) return; // Ziel inzwischen gewechselt
    const leg = j.trip.legs[0], pts = decodePolyline(leg.shape, 6), last = pts[pts.length - 1];
    S.route = {
      key: targetKey(t), pts, cum: routeCum(pts), len: j.trip.summary.length * 1000, time: j.trip.summary.time,
      man: (leg.maneuvers || []).map(m => ({ txt: m.instruction || '', i: m.begin_shape_index })),
      gap: haversine(last[0], last[1], t.lat, t.lon), fit: true, via
    };
    S.offCount = 0; onPosRoute(); drawRoute();
    if (reason !== 'auto') toast(`🧭 ${fmtDist(S.route.len)} Weg · ca. ${Math.max(1, Math.round(S.route.time / 60))} min (${via})`);
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
  for (const m of R.man) if (m.i > loc.i) { R.next = { txt: m.txt, d: Math.max(0, R.cum[m.i] - loc.along), i: m.i }; break; }
}
function routeText(R, dist, brg) {
  if (R.loc && R.loc.off > R.offLim) return `⚠️ ${fmtDist(R.loc.off)} neben der Route – berechne neu …`;
  if (R.final) return `Letztes Stück Luftlinie: ${compassName(brg)} ${Math.round(brg)}°, ${fmtDist(dist)}`;
  if (R.next) return (R.next.d < 15 ? 'Jetzt: ' : `In ${fmtDist(R.next.d)}: `) + R.next.txt;
  return 'Der Route folgen';
}
function toggleRouting() {
  S.set.routing = !S.set.routing; saveSettings(); updateButtons();
  if (S.set.routing) { if (!S.target) toast('🧭 Routing an – erst ein Ziel wählen'); else routeSoon(); }
  else { S.route = null; S.steer = null; drawRoute(); toast('Routing aus – Luftlinie'); }
}
function drawRoute() {
  if (!S.map) return;
  const R = activeRoute();
  S.L.route.setLatLngs(R ? R.pts : []);
  if (R && R.fit && S.set.autoZoom && S.follow) R.fit = false; // Autozoom übernimmt
  if (R && R.fit) { R.fit = false; S.map.fitBounds(window.L.latLngBounds(R.pts.concat([[S.target.lat, S.target.lon]])), { padding: [40, 40], maxZoom: 18 }); S.follow = false; $('#bFollow').hidden = false; }
}
function targetCache(geocode) {
  const c = S.caches.get(geocode); if (!c) return;
  setTarget({ kind: 'cache', geocode, lat: c.lat, lon: c.lon, name: c.name });
  const miss = missingGear(c, S.set, S.ai.get(c.geocode), true), night = (c.attrs || []).some(a => a.yes && (a.key === 'night' || a.key === 'night_rec'));
  if (miss.length) toast('❗ Ausrüstung: ' + miss.map(a => a.icon + ' ' + a.label).join(', '), 5000);
  else if (night && !S.set.night) toast('🌙 Nachtcache – Nachtmodus mit 🌙 oben', 4000);
}
function curCache() { return S.target ? S.caches.get(S.target.geocode) : null; }
/* Ausrüstung: Symbole der nötigen Werkzeuge, ❗ wenn dir etwas fehlt */
function gearBadge(c) {
  const ai = S.ai.get(c.geocode), t = toolsOf(c, ai); if (!t.length) return '';
  return ' · ' + t.map(a => a.icon).join('') + (missingGear(c, S.set, ai, true).length ? ' ❗' : missingGear(c, S.set, ai).length ? ' 🎒' : '');
}
function renderTop() {
  const t = S.target, c = curCache();
  if (!t) { $('#tName').textContent = 'Kein Ziel – ☰ Liste öffnen'; $('#tSub').textContent = ''; return; }
  let name = c ? c.name : t.name;
  if (t.kind === 'wpt') name = '📍 ' + t.label;
  if (t.kind === 'zone') name = '🎯 ' + t.label;
  $('#tName').textContent = name;
  if (c) {
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    $('#tSub').innerHTML = `<span class="dot" style="background:${ti[1]}"></span>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${c.disabled ? ' · ⛔ deaktiviert' : ''}${gearBadge(c)}${tourPos(c.geocode) >= 0 ? ` · 🗺️ ${tourPos(c.geocode) + 1}/${S.tour.ids.length}` : ''}`;
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
    if (S.avg && S.avg.on) avgAdd(S.pos);
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
  S.L.tour = L.layerGroup().addTo(S.map);
  S.L.talk = L.layerGroup().addTo(S.map);
  S.L.rays = L.layerGroup().addTo(S.map);
  S.L.steer = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#3d8bff', fillOpacity: 1, interactive: false });
  S.L.acc = L.circle([0, 0], { radius: 1, weight: 1, color: '#39cccc', fillOpacity: 0.1 }).addTo(S.map);
  S.L.me = L.marker([0, 0], { icon: L.divIcon({ className: 'me', html: '<div class="meArrow"></div>', iconSize: [34, 34] }), interactive: false }).addTo(S.map);
  S.map.on('dragstart', () => { S.follow = false; $('#bFollow').hidden = false; });
  S.map.on('zoomstart', () => { if (!S.progZoom) S.zoomPause = performance.now() + 20000; });
  S.map.on('zoomend', () => { S.progZoom = false; });
  drawCacheMarkers(); drawRoute(); drawTour(); drawTalkPos(); drawRays();
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
    if (isT) for (const w of (c.wpts || []).filter(x => x.lat != null)) L.circleMarker([w.lat, w.lon], { radius: 5, color: '#ffdc00', weight: 2, fillColor: '#fff', fillOpacity: 0.8 }).bindPopup(esc(w.prefix + ' ' + w.name)).addTo(S.L.caches);
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
  if (S.follow) { if (!autoZoom(ll)) S.map.panTo(ll, { animate: false }); }
}
/* Autozoom: ich in der Mitte, das nächste Wichtige noch im Bild – mit Route die nächste Abbiegung, sonst das Ziel */
function autoZoom(ll) {
  const now = performance.now();
  if (!S.set.autoZoom || !S.target || now < (S.zoomPause || 0) || now - (S.lastZoom || 0) < 2500) return false;
  const R = activeRoute();
  let pt = [S.target.lat, S.target.lon];
  if (R && R.loc && !R.final && R.next && R.next.d < 400) pt = routePointAt(R.pts, R.cum, R.loc.along + R.next.d);
  const d = haversine(ll[0], ll[1], pt[0], pt[1]);
  const mirror = [2 * ll[0] - pt[0], 2 * ll[1] - pt[1]];            // gespiegelt, damit ich in der Mitte bleibe
  let z = d < 25 ? 19 : S.map.getBoundsZoom(window.L.latLngBounds([pt, mirror]).pad(0.25), false);
  const fast = S.pos && S.pos.speed > 6;                               // Rad/Auto: weiter raus
  z = Math.max(13, Math.min(fast ? 17 : 19, Math.floor(z)));
  if (z === S.map.getZoom()) return false;
  S.progZoom = true; S.lastZoom = now;
  S.map.setView(ll, z, { animate: true });
  return true;
}
function applyMapDark() {
  const m = S.set.mapDark, p = S.pos || S.target || { lat: 48.37, lon: 10.89 };
  const on = m === 'on' || (m === 'auto' && sunElevation(p.lat, p.lon, new Date()) < -2);
  document.body.classList.toggle('mapdark', on);
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
      <div class="grow"><b>${esc(c.name)}</b><small>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${c.size ? ' · ' + esc(c.size) : ''}${c.found ? ' · ✅' : ''}${S.ai.has(c.geocode) ? ' · 🤖' : ''}${gearBadge(c)}</small></div>
      <span class="dd">${p ? fmtDist(c._d) + '<br>' + compassName(c._b) : ''}</span></li>`;
  }).join('');
  openSheet(`Caches (${S.caches.size})`, `
    <div class="tools">
      <button id="lFolder">📁 c:geo-Backup laden</button><button id="lFile">📄 Datei wählen</button>
      <button id="lOc">🟢 OC in der Nähe</button><button id="lAi">🤖 Alle auswerten</button><button id="lPeil">📐 Peilung</button><button id="lAvg">📍 Mitteln</button><button id="lOff">📦 Offline</button><button id="lTour">🗺️ Tour</button>
      <button id="lSet">⚙️ Einstellungen</button><button id="lDiag">🩺 Diagnose</button>
    </div>
    <input id="lFilter" type="search" placeholder="Suchen (Name oder Code)" value="${esc(filter)}">
    <ul class="list">${rows || '<li class="empty">Noch keine Caches. In c:geo Caches offline speichern und ein Backup machen, dann „c:geo-Backup laden“.</li>'}</ul>`, b => {
    b.querySelector('#lFolder').onclick = () => run(loadNewestBackup);
    b.querySelector('#lFile').onclick = pickFile;
    b.querySelector('#lOc').onclick = () => run(loadOcNearby);
    b.querySelector('#lPeil').onclick = () => showPeilung();
    b.querySelector('#lAvg').onclick = showAvg;
    b.querySelector('#lOff').onclick = () => run(showOffline);
    b.querySelector('#lTour').onclick = () => showTour();
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
  const wp = (c.wpts || []).map((w, i) => `<li class="row" ${w.lat != null ? `data-w="${i}"` : ''}><div class="grow"><b>${esc(w.prefix)} ${esc(w.name)}</b><small>${esc(w.type)} · ${w.lat != null ? fmtCoord(w.lat, w.lon) : 'ohne Koordinaten'}${w.note ? ' · ' + esc(stripHtml(w.note).slice(0, 140)) : ''}</small></div><span class="dd">${w.lat != null ? 'Ziel' : ''}</span></li>`).join('');
  openSheet(c.name, `
    <p class="sub">${esc(c.geocode)} · ${(TYPE_INFO[c.type] || TYPE_INFO.other)[0]} · D${c.d || '?'}/T${c.t || '?'} ${c.size ? '· ' + esc(c.size) : ''} ${c.owner ? '· von ' + esc(c.owner) : ''}</p>
    <p class="coord">${fmtCoord(c.lat, c.lon)}${c.corrected ? ' (korrigiert)' : ''}</p>
    ${toolsOf(c, S.ai.get(c.geocode)).length ? `<h4>🧰 Ausrüstung</h4><ul class="list">${toolsOf(c, S.ai.get(c.geocode)).map(a => { const has = S.set['gear_' + a.key] !== false, hart = GEAR_HARD.has(a.key); return `<li class="gear ${has ? 'ok' : hart ? 'miss' : 'soft'}">${a.icon} <b>${esc(a.label)}</b> <small>${has ? '✓ hast du' : hart ? '✗ fehlt – Tour überspringt' : '🎒 einpacken'}</small></li>`; }).join('')}</ul>` : ''}
    ${(c.attrs || []).filter(a => !a.tool).length ? `<h4>Attribute</h4><div class="chips">${(c.attrs || []).filter(a => !a.tool).map(a => `<span class="chip${a.yes ? '' : ' neg'}">${a.icon} ${esc(a.label)}</span>`).join('')}</div>` : ''}
    <h4>Hint</h4>
    <div id="hint" class="hint blur">${esc(htmlText(c.hint) || '– kein Hint –')}</div>
    <div class="tools"><button id="hShow">👁 Anzeigen</button><button id="hRot">🔤 ROT13</button><button id="hCache">🎯 Cache als Ziel</button></div>
    ${c.note ? `<h4>Persönliche Notiz</h4><div class="hint">${esc(htmlText(c.note))}</div>` : ''}
    ${wp ? `<h4>Wegpunkte</h4><ul class="list">${wp}</ul>` : ''}
    <div class="tools"><button id="hMulti">🧩 Stationen</button><button id="hPeil">📐 Peilung</button><button id="hOpen">↗️ In c:geo / im Browser öffnen</button></div>`, b => {
    b.querySelector('#hMulti').onclick = () => run(() => showMulti(c));
    b.querySelector('#hPeil').onclick = () => showPeilung();
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
  const items = (c.logs || []).map(l => { const [n, k] = logTypeInfo(l.type); return `<li class="log ${k}"><div class="lh"><span class="lt">${esc(n)}</span> ${fmtDate(l.date)} · ${esc(l.author)}</div><div class="lx">${esc(htmlText(l.text))}</div></li>`; }).join('');
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
function kiAnbieter() { // eigene Schlüssel, in fester Reihenfolge (Gemini zuerst: kostenlos und bildfähig)
  return KIA().map(a => ({ ...a, key: String(S.set['kiKey_' + a.id] || '').trim(), model: String(S.set['kiModel_' + a.id] || '').trim() })).filter(a => a.key && a.model);
}
function kiZiel() { const a = kiAnbieter(); return S.set.kiMode === 'skript' ? 'dein KI-Skript (' + (S.set.apiUrl || 'Adresse fehlt') + ')' : a.length ? a.map(x => x.name).join(' → ') : 'die KI (noch kein Schlüssel eingetragen)'; }
async function kiCall(body) {
  if (S.set.kiMode !== 'skript') {
    if (!window.CVKI) throw new Error('KI-Baustein fehlt');
    try { return await CVKI.run(body, kiAnbieter()); } catch (e) { throw new Error('KI: ' + (e && e.message || e)); }
  }
  if (!S.set.apiUrl) throw new Error('KI-Adresse fehlt (Einstellungen)');
  const r = await fetch(S.set.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': S.set.apiToken || '' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ ok: false, error: 'Antwort nicht lesbar (HTTP ' + r.status + ')' }));
  if (!j.ok) throw new Error('KI: ' + (j.error || 'HTTP ' + r.status));
  return j;
}
async function aiAnalyze(c) {
  const body = {
    geocode: c.geocode, name: c.name, type: (TYPE_INFO[c.type] || TYPE_INFO.other)[0], d: c.d, t: c.t, size: c.size, hint: htmlText(c.hint), lat: c.lat, lon: c.lon, attribute: (c.attrs || []).map(a => a.label).join(', '),
    logs: (c.logs || []).slice(0, 40).map(l => ({ date: l.date ? new Date(l.date).toISOString().slice(0, 10) : '', type: logTypeInfo(l.type)[0], author: l.author, text: htmlText(l.text).slice(0, 900) }))
  };
  const j = await kiCall(body);
  const res = j.result || {}; res.ts = Date.now(); res.model = j.model || '';
  res.zones = await resolveZones(c, res);
  await idbPut('ai', { geocode: c.geocode, ...res });
  S.ai.set(c.geocode, res);
  return res;
}
async function aiAll() {
  // ohne Auswertung oder noch im alten Format (ohne Suchhilfe) → (neu) auswerten
  const todo = [...S.caches.values()].filter(c => (!S.ai.has(c.geocode) || !S.ai.get(c.geocode).suchhilfe) && (c.logs || []).length && !c.found);
  if (S.pos) todo.sort((a, b) => haversine(S.pos.lat, S.pos.lon, a.lat, a.lon) - haversine(S.pos.lat, S.pos.lon, b.lat, b.lon));
  const list = todo.slice(0, 60);
  if (!list.length) return toast('Nichts auszuwerten (alle schon ausgewertet oder ohne Logs)');
  if (!confirm(`${list.length} Caches (die nächsten) mit KI auswerten?`)) return;
  let ok = 0, fail = 0, i = 0;
  const worker = async () => { while (i < list.length) { const c = list[i++]; try { await aiAnalyze(c); ok++; } catch (e) { fail++; console.warn(c.geocode, e); } toast(`🤖 ${ok + fail}/${list.length} ausgewertet${fail ? ` (${fail} Fehler)` : ''}`, 60000); } };
  await Promise.all([worker(), worker()]);
  toast(`✅ ${ok} ausgewertet${fail ? `, ${fail} Fehler` : ''}`); drawCacheMarkers();
}
const ZUSTAND = { gut: ['gut', '#2ecc40'], wartung_noetig: ['Wartung nötig', '#ff9f1a'], vermutlich_weg: ['vermutlich weg', '#ff4136'], unklar: ['unklar', '#9aa7b2'] };
const KAT = { versteck: ['📍', 'Versteck'], behaelter: ['📦', 'Behälter'], werkzeug: ['🔧', 'Werkzeug'], zugang: ['🚶', 'Zugang'],
  tarnung: ['🎭', 'Tarnung'], muggel: ['👀', 'Muggel'], parken: ['🅿️', 'Parken / Start'], sonstiges: ['💡', 'Sonstiges'] };
function isoDe(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
/* Beleg: Zitat + Datum + Lognummer; antippen zeigt den ganzen Log */
function beleg(x) {
  const meta = [isoDe(x.datum), x.log_nr ? 'Log ' + x.log_nr : ''].filter(Boolean).join(' · ');
  return `<q data-l="${x.log_nr || 0}">${esc(x.zitat || '')}${meta ? ` <small>(${esc(meta)})</small>` : ''}</q><div class="full" hidden></div>`;
}
function showAi() {
  const c = curCache(); if (!c) return toast('Kein Cache als Ziel');
  const a = S.ai.get(c.geocode);
  let body;
  if (!a) body = `<p>Noch nicht ausgewertet. Die Logs (${(c.logs || []).length}) gehen an ${esc(kiZiel())}.</p>`;
  else {
    const z = ZUSTAND[a.zustand] || ZUSTAND.unklar;
    const hilfe = (a.suchhilfe || []).concat((a.versteck_hinweise || []).map(h => ({ ...h, kategorie: 'versteck' })));
    const gruppen = Object.keys(KAT).map(k => [k, hilfe.filter(h => (KAT[h.kategorie] ? h.kategorie : 'sonstiges') === k)]).filter(g => g[1].length);
    body = `
    <div class="zst"><span class="badge" style="background:${z[1]}">${z[0]}</span>
      <span>${a.letzter_fund ? 'Fund ' + isoDe(a.letzter_fund) : 'kein Fund in den Logs'}${a.dnf_serie ? ` · <b class="warn">${a.dnf_serie} DNF in Folge</b>` : ''}${a.letzte_wartung ? ' · Wartung ' + isoDe(a.letzte_wartung) : ''}</span></div>
    ${a.kurzfassung ? `<p class="ki">${esc(a.kurzfassung)}</p>` : ''}
    ${(a.warnungen || []).length ? '<h4>⚠️ Achtung</h4><ul class="list">' + a.warnungen.map(w => `<li class="ai warnli"><b>${esc(w.hinweis)}</b>${beleg(w)}</li>`).join('') + '</ul>' : ''}
    ${gruppen.length ? '<h4>Suchhilfe</h4><ul class="list">' + gruppen.map(([k, hs]) => hs.map(h => `<li class="ai"><span class="kat">${KAT[k][0]} ${KAT[k][1]}</span><b>${esc(h.hinweis)}</b>${beleg(h)}</li>`).join('')).join('') + '</ul>' : '<p class="sub">Keine konkreten Suchhinweise in den Logs.</p>'}
    ${(a.zustand_details || []).length ? '<h4>Zustand</h4><ul class="list">' + a.zustand_details.map(d => `<li class="ai"><b>${esc(d.punkt)}</b>${beleg(d)}</li>`).join('') + '</ul>' : ''}
    ${(a.stationen || []).length ? '<h4>Stationen</h4><ul class="list">' + a.stationen.map(st => `<li class="ai"><span class="kat">${esc(st.station)}</span><b>${esc(st.hinweis)}</b>${beleg(st)}</li>`).join('') + '</ul>' : ''}
    ${(a.zones || []).length ? '<h4>Suchzonen</h4><ul class="list">' + a.zones.map((zo, i) => `<li class="ai"><b>${esc(zo.label)}</b>${zo.sicherheit ? ` <small>(${esc(zo.sicherheit)})</small>` : ''}<q>${esc(zo.zitat)}</q>
       ${zo.unresolved ? '<small class="warn">Bezugspunkt nicht in OpenStreetMap gefunden</small>' : `<small>${zo.anchorDist != null ? 'Bezugspunkt ' + zo.anchorDist + ' m von den Listing-Koordinaten · ' : ''}Radius ${Math.round(zo.r)} m</small> <button data-z="${i}">🎯 Als Ziel</button>`}</li>`).join('') + '</ul>' : ''}
    <p class="sub">${esc(a.model || '')} · ${fmtDate(a.ts)} – aus den Logs gezogen, Zitat antippen zeigt den ganzen Log.</p>`;
  }
  openSheet(`KI · ${c.geocode}`, body + `<div class="tools"><button id="aGo">🤖 ${a ? 'Neu auswerten' : 'Logs auswerten'}</button><button id="aAsk">❓ Foto-Frage</button><button id="aMulti">🧩 Stationen</button></div>`, b => {
    b.querySelector('#aAsk').onclick = () => run(() => showFotoFrage(c, {}));
    b.querySelector('#aMulti').onclick = () => run(() => showMulti(c));
    b.querySelector('#aGo').onclick = () => run(async () => { toast('🤖 werte aus …', 30000); await aiAnalyze(c); toast('✅ fertig'); drawCacheMarkers(); showAi(); });
    b.querySelectorAll('button[data-z]').forEach(bt => { bt.onclick = () => { const zo = a.zones[+bt.dataset.z]; setTarget({ kind: 'zone', geocode: c.geocode, lat: zo.lat, lon: zo.lon, label: zo.label, r: zo.r, name: c.name }); }; });
    b.querySelectorAll('q[data-l]').forEach(q => {
      q.onclick = () => {
        const n = +q.dataset.l, l = n > 0 ? (c.logs || [])[n - 1] : null, box = q.nextElementSibling;
        if (!l || !box) return;
        if (box.hidden) { const [ty] = logTypeInfo(l.type); box.innerHTML = `<div class="lh"><span class="lt">${esc(ty)}</span> ${fmtDate(l.date)} · ${esc(l.author)}</div><div class="lx">${esc(htmlText(l.text))}</div>`; }
        box.hidden = !box.hidden;
      };
    });
  });
}

/* ---------- Multi: Stationen, nächste Station, Foto → KI ---------- */
const multiKey = g => 'multi:' + g;
async function getMulti(g) {
  if (!S.multi.has(g)) S.multi.set(g, (await idbGet('meta', multiKey(g)).catch(() => null)) || null);
  return S.multi.get(g);
}
function saveMulti(m) { S.multi.set(m.geocode, m); idbPut('meta', m, multiKey(m.geocode)).catch(() => {}); }
function listingBase(c) { return c.orig || { lat: c.lat, lon: c.lon }; }
function multiState(c, m) {
  const vars = m.werte || {}, base = listingBase(c), pts = {};
  const st = (m.stationen || []).map(s => {
    const r = resolvePoint(s, vars, base, pts);
    if (r.lat != null) pts[String(s.nr)] = r;
    const done = !!(m.erledigt || {})[s.nr] || ((s.variablen || []).length > 0 && stationVarsDone(s, vars));
    return { s, r, done };
  });
  return { st, cur: st.findIndex(x => !x.done), fin: resolvePoint(m.final, vars, base, pts), base };
}
async function aiMulti(c) {
  const desc = htmlText(c.desc || '');
  if (desc.length < 40 && !(c.wpts || []).length) throw new Error('Keine Beschreibung gespeichert. In c:geo den Cache mit Details speichern (oder GPX mit Beschreibung) und neu laden.');
  const base = listingBase(c);
  const j = await kiCall({
    aktion: 'multi', geocode: c.geocode, name: c.name, type: (TYPE_INFO[c.type] || TYPE_INFO.other)[0], start: fmtCoord(base.lat, base.lon),
    attribute: (c.attrs || []).map(a => a.label).join(', '),
    beschreibung: desc.slice(0, 16000),
    wegpunkte: (c.wpts || []).map(w => ({ prefix: w.prefix, name: w.name, coord: w.lat != null ? fmtCoord(w.lat, w.lon) : '', note: htmlText(w.note || '').slice(0, 400) }))
  });
  const old = await getMulti(c.geocode);
  const m = { geocode: c.geocode, ...j.result, model: j.model || '', ts: Date.now(), werte: old ? old.werte || {} : {}, erledigt: {}, foto: {} };
  saveMulti(m);
  return m;
}
async function stationFoto(c, idx, blob) {
  const m = await getMulti(c.geocode), st = m && m.stationen[idx];
  if (!st) return;
  if (!blob) {
    if (!S.track && !(await startCamera())) return;
    blob = await grabFrame(); flash();
  }
  await savePhoto(blob, `${c.geocode} S${st.nr} ${st.name}`);
  toast('🤖 lese das Foto …', 60000);
  const bild = await shrinkImage(blob, 2048, 0.85);
  const j = await kiCall({ aktion: 'foto', geocode: c.geocode, station: { name: st.name, aufgabe: st.aufgabe, variablen: st.variablen }, regeln: m.regeln || '', bild });
  m.foto = m.foto || {}; m.foto[st.nr] = { ...j.result, model: j.model || '', ts: Date.now() };
  saveMulti(m);
  toast('✅ Foto gelesen – Werte prüfen und übernehmen');
  showMulti(c, st.nr);
}
/* Foto aus der Kamera-App des Handys (capture) oder aus der Galerie – volle Qualität, Zoom, HDR */
function pickImage(cb, camera) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  if (camera) i.setAttribute('capture', 'environment');
  i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
  i.click();
}
/* Kärtchen oben: nächste Station mit Aufgabe */
async function renderStage() {
  const el = $('#stage'), c = curCache();
  if (!c) { el.hidden = true; return; }
  const m = await getMulti(c.geocode);
  if (curCache() !== c) return;
  let html;
  if (!m) {
    if (!['multi', 'mystery', 'wherigo'].includes(c.type) || !c.desc) { el.hidden = true; return; }
    html = `<div class="st-h"><b>🧩 Stationen</b></div><div class="st-t">Die KI kann die Stationen aus dem Listing lesen.</div>
      <div class="tools"><button data-a="open">🤖 Stationen lesen</button></div>`;
  } else {
    const ms = multiState(c, m);
    if (ms.cur < 0) {
      const f = ms.fin;
      html = `<div class="st-h" data-a="min"><b>🏁 Final</b><span>${ms.st.length} Stationen erledigt</span></div>
        <div class="st-t coord">${esc(f.lat != null ? fmtCoord(f.lat, f.lon) : (f.text || '–'))}${f.missing && f.missing.length ? ` <span class="warn">fehlt: ${f.missing.join(', ')}</span>` : ''}</div>
        <div class="tools">${f.lat != null ? '<button data-a="fin">🎯 Final als Ziel</button>' : ''}<button data-a="open">✏️ Stationen</button></div>`;
    } else {
      const x = ms.st[ms.cur], st = x.s, vars = m.werte || {};
      const vtxt = (st.variablen || []).map(v => `${esc(v.name)}=${vars[v.name] != null && vars[v.name] !== '' ? esc(vars[v.name]) : '?'}`).join(' ');
      const d = x.r.lat != null && S.pos ? fmtDist(haversine(S.pos.lat, S.pos.lon, x.r.lat, x.r.lon)) : '';
      html = `<div class="st-h" data-a="min"><b>🧩 Station ${ms.cur + 1}/${ms.st.length} · ${esc(st.name)}</b><span>${d}</span></div>
        <div class="st-t">${esc(st.aufgabe || 'Keine Aufgabe im Listing gefunden.')}</div>
        ${vtxt ? `<div class="st-v">${vtxt}</div>` : ''}
        ${x.r.lat == null && x.r.text ? `<div class="st-v">📍 ${esc(x.r.text)}${x.r.missing && x.r.missing.length ? ` <span class="warn">fehlt: ${x.r.missing.join(', ')}</span>` : ''}</div>` : ''}
        <div class="tools">${(st.variablen || []).length ? '<button data-a="foto">📸 Foto → KI</button><button data-a="gal">🖼</button>' : '<button data-a="done">✓ erledigt</button>'}
          <button data-a="open">✏️ Werte</button>${x.r.lat != null ? '<button data-a="go">🎯 Ziel</button>' : ''}</div>`;
      el.dataset.idx = ms.cur;
    }
  }
  el.innerHTML = html; el.hidden = false; el.classList.toggle('min', S.stageMin);
  el.querySelectorAll('[data-a]').forEach(b => {
    b.onclick = ev => {
      ev.stopPropagation();
      const a = b.dataset.a;
      if (a === 'min') { S.stageMin = !S.stageMin; el.classList.toggle('min', S.stageMin); return; }
      if (a === 'open') return run(() => showMulti(c));
      if (a === 'foto' || a === 'gal') return pickImage(f => run(() => stationFoto(c, +el.dataset.idx, f)), a === 'foto');
      run(async () => {
        const mm = await getMulti(c.geocode), ms = multiState(c, mm), i = +el.dataset.idx;
        if (a === 'done') { mm.erledigt = mm.erledigt || {}; mm.erledigt[ms.st[i].s.nr] = true; saveMulti(mm); renderStage(); }
        if (a === 'go') { const x = ms.st[i]; setTarget({ kind: 'wpt', geocode: c.geocode, lat: x.r.lat, lon: x.r.lon, label: `S${x.s.nr} ${x.s.name}`, name: c.name }); }
        if (a === 'fin') setTarget({ kind: 'wpt', geocode: c.geocode, lat: ms.fin.lat, lon: ms.fin.lon, label: 'Final (berechnet)', name: c.name });
      });
    };
  });
}
/* Blatt: alle Stationen, Werte eintragen, Foto-Ergebnisse übernehmen, Final */
async function showMulti(c, focusNr) {
  c = c || curCache(); if (!c) return toast('Kein Cache als Ziel');
  const m = await getMulti(c.geocode);
  if (!m) {
    const n = htmlText(c.desc || '').length;
    openSheet(`🧩 Stationen · ${c.geocode}`, `<p>${n ? `Die Beschreibung (${n} Zeichen) und ${(c.wpts || []).length} Wegpunkte gehen an ${esc(kiZiel())}. Die KI zieht Stationen, Aufgaben, Variablen und die Finalformel heraus.` : 'Für diesen Cache ist keine Beschreibung gespeichert. In c:geo den Cache mit Details speichern oder GPX mit Beschreibung laden.'}</p>
      <div class="tools"><button id="mGo">🤖 Stationen aus dem Listing lesen</button></div>`, b => {
      b.querySelector('#mGo').onclick = () => run(async () => { toast('🤖 lese das Listing …', 60000); await aiMulti(c); toast('✅ Stationen gelesen'); renderStage(); showMulti(c); });
    });
    return;
  }
  const ms = multiState(c, m), vars = m.werte || {};
  const miss = r => `${r.missing && r.missing.length ? ` <small class="warn">fehlt: ${r.missing.join(', ')}</small>` : ''}${r.err ? ` <small class="warn">${esc(r.err)}</small>` : ''}`;
  const stHtml = ms.st.map((x, i) => {
    const s = x.s, r = x.r, f = (m.foto || {})[s.nr];
    const coord = r.lat != null ? `<span class="coord">${esc(fmtCoord(r.lat, r.lon))}</span>` : r.text ? `<span class="coord">${esc(r.text)}</span>${miss(r)}` : '<small>Ort nur beschrieben</small>';
    const inputs = (s.variablen || []).map(v => `<div class="var"><b>${esc(v.name)}</b><input data-v="${esc(v.name)}" inputmode="decimal" value="${esc(vars[v.name] == null ? '' : vars[v.name])}"><button data-ask="${esc(v.name)}" title="nur diese Frage per Foto">📸</button><small>${esc(v.frage)}</small></div>`).join('');
    const foto = f ? `<div class="foto"><small>📸 ${esc(f.gelesen || '')} <i>(${esc(f.model || '')})</i></small>${(f.werte || []).map(w => `<div class="fw"><b>${esc(w.name)} = ${esc(w.wert || '–')}</b> <small>${esc(w.sicherheit)} · ${esc(w.begruendung)}</small>${w.wert !== '' ? ` <button data-take="${esc(w.name)}" data-val="${esc(w.wert)}">Übernehmen</button>` : ''}</div>`).join('')}</div>` : '';
    return `<li class="stn${i === ms.cur ? ' cur' : ''}${x.done ? ' done' : ''}" id="stn${s.nr}"><div class="stn-h">${x.done ? '✅' : i === ms.cur ? '👉' : '⬜'} <b>S${s.nr} · ${esc(s.name)}</b></div>
      <div>${coord}</div><div class="aufg">${esc(s.aufgabe)}</div>${inputs}${foto}
      <div class="tools">${(s.variablen || []).length ? `<button data-foto="${i}">📸 Kamera → KI</button><button data-file="${i}">🖼 Galerie → KI</button>` : ''}${r.lat != null ? `<button data-go="${i}">🎯 Ziel</button>` : ''}<button data-done="${s.nr}">${(m.erledigt || {})[s.nr] ? '↩ offen' : '✓ erledigt'}</button></div></li>`;
  }).join('');
  const fin = ms.fin, dist = fin.lat != null ? haversine(ms.base.lat, ms.base.lon, fin.lat, fin.lon) : null;
  openSheet(`🧩 Stationen · ${c.geocode}`, `
    ${m.regeln ? `<p class="sub">Regeln: ${esc(m.regeln)}</p>` : ''}
    <ul class="list">${stHtml || '<li class="empty">Keine Stationen erkannt.</li>'}</ul>
    <div class="stn final"><div class="stn-h">🏁 <b>Final</b></div><div class="sub">${esc(m.final && (m.final.text || m.final.vorlage) || '')}</div>
      <div class="coord big">${esc(fin.lat != null ? fmtCoord(fin.lat, fin.lon) : fin.text || '–')}</div>${miss(fin)}
      ${dist != null ? `<small>${fmtDist(dist)} vom Start${dist > 3219 ? ' – <b class="warn">mehr als 2 Meilen, Werte prüfen</b>' : ''} · mit Logs/Checker prüfen</small>` : ''}
      <div class="tools">${fin.lat != null ? '<button id="mFin">🎯 Final als Ziel</button>' : ''}</div></div>
    <p class="sub">${esc(m.model || '')} · ${fmtDate(m.ts)} – von der KI aus dem Listing gelesen, Formeln prüfen.</p>
    <div class="tools"><button id="mAsk">❓ Foto-Frage</button><button id="mRe">🤖 Neu lesen</button><button id="mClr">🗑 Werte löschen</button></div>`, b => {
    b.querySelector('#mAsk').onclick = () => showFotoFrage(c, {});
    const redraw = () => { const top = $('#sheetBody').scrollTop; showMulti(c).then(() => { $('#sheetBody').scrollTop = top; }); renderStage(); };
    b.querySelectorAll('input[data-v]').forEach(inp => {
      inp.onchange = () => { m.werte = m.werte || {}; const v = inp.value.trim(); if (v === '') delete m.werte[inp.dataset.v]; else m.werte[inp.dataset.v] = v; saveMulti(m); redraw(); };
    });
    b.querySelectorAll('[data-take]').forEach(bt => { bt.onclick = () => { m.werte = m.werte || {}; m.werte[bt.dataset.take] = bt.dataset.val; saveMulti(m); redraw(); }; });
    b.querySelectorAll('[data-foto]').forEach(bt => { bt.onclick = () => pickImage(f => run(() => stationFoto(c, +bt.dataset.foto, f)), true); });
    b.querySelectorAll('[data-file]').forEach(bt => { bt.onclick = () => pickImage(f => run(() => stationFoto(c, +bt.dataset.file, f))); });
    b.querySelectorAll('[data-ask]').forEach(bt => { bt.onclick = () => { const v = ms.st.flatMap(x => x.s.variablen || []).find(y => y.name === bt.dataset.ask); showFotoFrage(c, { frage: v ? v.frage : '', varName: bt.dataset.ask }); }; });
    b.querySelectorAll('[data-go]').forEach(bt => { bt.onclick = () => { const x = ms.st[+bt.dataset.go]; setTarget({ kind: 'wpt', geocode: c.geocode, lat: x.r.lat, lon: x.r.lon, label: `S${x.s.nr} ${x.s.name}`, name: c.name }); }; });
    b.querySelectorAll('[data-done]').forEach(bt => { bt.onclick = () => { m.erledigt = m.erledigt || {}; const k = bt.dataset.done; if (m.erledigt[k]) delete m.erledigt[k]; else m.erledigt[k] = true; saveMulti(m); redraw(); }; });
    const fb = b.querySelector('#mFin'); if (fb) fb.onclick = () => setTarget({ kind: 'wpt', geocode: c.geocode, lat: fin.lat, lon: fin.lon, label: 'Final (berechnet)', name: c.name });
    b.querySelector('#mRe').onclick = () => run(async () => { if (!confirm('Stationen neu aus dem Listing lesen? Eingetragene Werte bleiben.')) return; toast('🤖 lese das Listing …', 60000); await aiMulti(c); toast('✅ neu gelesen'); renderStage(); showMulti(c); });
    b.querySelector('#mClr').onclick = () => { if (!confirm('Alle eingetragenen Werte dieses Caches löschen?')) return; m.werte = {}; m.erledigt = {}; m.foto = {}; saveMulti(m); redraw(); };
    if (focusNr != null) { const el = b.querySelector('#stn' + focusNr); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50); }
  });
}

/* Freie Frage zu einem Foto, z. B. „Wie viele Latten hat der Zaun?“ → Zahl; optional als Variable übernehmen */
async function showFotoFrage(c, preset) {
  c = c || curCache();
  const m = c ? await getMulti(c.geocode) : null;
  const names = m ? [...new Set((m.stationen || []).flatMap(s => (s.variablen || []).map(v => v.name)))] : [];
  const p = preset || {};
  openSheet('❓ Foto-Frage', `
    <label class="f"><span>Was soll die KI auf dem Foto bestimmen?</span>
      <textarea id="fq" rows="2" placeholder="z. B. Wie viele Latten hat der Zaun?">${esc(p.frage || '')}</textarea></label>
    ${names.length ? `<label class="f"><span>Ergebnis übernehmen als</span><select id="fv"><option value="">– nicht übernehmen –</option>${names.map(n => `<option${n === p.varName ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
    <div class="tools"><button id="fCam">📸 Kamera-App</button><button id="fGal">🖼 Galerie</button></div>
    <div id="fr"></div>`, b => {
    const go = cam => {
      const frage = b.querySelector('#fq').value.trim();
      if (!frage) return toast('Erst die Frage eintragen');
      pickImage(file => run(async () => {
        await savePhoto(file, `${c ? c.geocode + ' ' : ''}${frage}`);
        toast('🤖 werte das Foto aus …', 60000);
        const bild = await shrinkImage(file, 2048, 0.85);
        const vsel = b.querySelector('#fv'), vn = vsel && vsel.value ? vsel.value : 'X';
        const j = await kiCall({ aktion: 'foto', geocode: c ? c.geocode : 'FRAGE', station: { name: 'Frage', aufgabe: frage, variablen: [{ name: vn, frage }] }, regeln: m ? m.regeln || '' : '', bild });
        const w = (j.result.werte || [])[0] || { wert: '', begruendung: '', sicherheit: 'niedrig' };
        const url = URL.createObjectURL(file);
        b.querySelector('#fr').innerHTML = `<div class="answer"><img src="${url}"><div><div class="big">${esc(w.wert || '?')}</div>
          <small>Sicherheit: ${esc(w.sicherheit)}</small></div></div><p>${esc(w.begruendung)}</p><p class="sub">Gesehen: ${esc(j.result.gelesen || '')} · ${esc(j.model || '')}</p>
          ${vsel && vsel.value && w.wert ? `<div class="tools"><button id="fTake">Als ${esc(vsel.value)} = ${esc(w.wert)} übernehmen</button></div>` : ''}`;
        toast('✅ ausgewertet – bitte nachprüfen');
        const tk = b.querySelector('#fTake');
        if (tk) tk.onclick = () => { m.werte = m.werte || {}; m.werte[vsel.value] = w.wert; saveMulti(m); renderStage(); toast(`${vsel.value} = ${w.wert} eingetragen`); showMulti(c); };
      }), cam);
    };
    b.querySelector('#fCam').onclick = () => go(true);
    b.querySelector('#fGal').onclick = () => go(false);
  });
}

/* ---------- Ansagen und Vibration ---------- */
function buzz(p) { if (S.set.vibrate && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { /* egal */ } }
function say(t) {
  if (!S.set.speak || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'de-DE'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { /* egal */ }
}
function sayDist(m) { return m >= 1000 ? `${String(m / 1000).replace('.', ',')} Kilometer` : `${m} Meter`; }
function announce(t, d, R) {
  if (!S.set.speak && !S.set.vibrate) return;
  const key = targetKey(t);
  if (S.ann.key !== key) { S.ann = { key, next: annStepBelow(d), last: null }; S.annMan = {}; return; }
  // Abstände zum Ziel: 2 km, 1 km, 500, 200, 100, 50, 20, 10 m
  if (S.ann.next != null && d < S.ann.next * 0.97) {
    const th = S.ann.next;
    S.ann.last = th; S.ann.next = annStepBelow(d);
    say(th <= 10 ? 'Noch 10 Meter. Ziel in der Nähe.' : `Noch ${sayDist(th)}`);
    buzz(th >= 500 ? [80] : th >= 100 ? [80, 80, 80] : [150, 80, 150, 80, 150]);
  } else if (S.ann.last != null && d > S.ann.last * 1.3) S.ann = { key, next: annStepBelow(d), last: null }; // wieder entfernt → neu scharf
  // Abzweigungen mit Route: vorher ankündigen, dann „Jetzt“
  if (R && R.next && !R.final && !(R.loc && R.loc.off > R.offLim)) {
    const fast = S.pos && S.pos.speed > 6, far = fast ? 300 : 120, nearM = fast ? 40 : 20;
    const k = R.key + ':' + R.next.i, st = S.annMan[k] || (S.annMan[k] = {});
    const pat = /links/i.test(R.next.txt) ? [200, 100, 200] : /rechts/i.test(R.next.txt) ? [500] : [100];
    if (!st.far && R.next.d <= far && R.next.d > nearM * 2) { st.far = true; say(`In ${Math.round(R.next.d / 10) * 10} Metern: ${R.next.txt}`); buzz(pat); }
    if (!st.now && R.next.d <= nearM) { st.now = true; st.far = true; say('Jetzt: ' + R.next.txt); buzz(pat); }
  }
}

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

/* ---------- Peilung / Projektion (auch Letterbox: Schritte, Kompasswert) ---------- */
function startPeilMessen() { closeSheet(); S.peil = { deg: null, dist: null }; $('#peilbar').hidden = false; if (S.mode !== 'cam') toast('Handy senkrecht halten und das Ziel anvisieren'); }
function updatePeilbar(sc) {
  const el = $('#peilbar');
  if (!sc) { el.innerHTML = '<b>📐 Peilen</b> – Kompass fehlt'; return; }
  const deg = (viewHeading(sc) + S.set.compassOffset + 360) % 360, pitch = vecElev(camVec(sc));
  const dist = pitch < -1.5 ? S.set.phoneH / Math.tan(-pitch * D2R) : null;
  S.peil.deg = deg; S.peil.dist = dist && dist < 300 ? dist : null;
  if (!el.dataset.ready) {
    el.innerHTML = `<div><b>📐 Peilen</b> <span id="pbVal"></span></div><small>Fadenkreuz auf das Ziel. Für die Entfernung auf den Fuß des Ziels zielen (Handyhöhe ${String(S.set.phoneH).replace('.', ',')} m).</small>
      <div class="tools"><button id="pbDeg">Richtung übernehmen</button><button id="pbBoth">Richtung + Entfernung</button><button id="pbX">✕</button></div>`;
    el.dataset.ready = '1';
    const done = withDist => { const p = S.peil; S.peil = null; el.hidden = true; delete el.dataset.ready; showPeilung({ deg: Math.round(p.deg), dist: withDist && p.dist ? Math.round(p.dist) : null }); };
    el.querySelector('#pbDeg').onclick = () => done(false);
    el.querySelector('#pbBoth').onclick = () => done(true);
    el.querySelector('#pbX').onclick = () => { S.peil = null; el.hidden = true; delete el.dataset.ready; };
  }
  el.querySelector('#pbVal').textContent = `${Math.round(deg)}° ${compassName(deg)} · ${S.peil.dist ? 'ca. ' + Math.round(S.peil.dist) + ' m' : 'Entfernung: auf den Fuß zielen'}`;
}
/* ---------- Koordinaten mitteln (GPS averaging) ---------- */
function avgAdd(p) {
  const A = S.avg; if (!A || !A.on || !p) return;
  if (A.fixes.length && p.ts === A.fixes[A.fixes.length - 1].ts) return;
  A.fixes.push({ lat: p.lat, lon: p.lon, acc: p.acc, ts: p.ts || Date.now() });
  A.res = averageFixes(A.fixes, A.mode);
  const min = Math.floor((Date.now() - A.t0) / 60000);
  if (min > (A.lastMin || 0) && [1, 3, 5, 10].includes(min)) {
    A.lastMin = min; buzz([60, 60, 60]);
    if (A.res) say(`${min} ${min > 1 ? 'Minuten' : 'Minute'} gemittelt, etwa ${Math.max(1, Math.round(A.res.fehler))} Meter genau`);
  }
  avgRender(); avgMap();
}
function avgMap() {
  if (!S.map || !window.L) return;
  const r = S.avg && S.avg.res;
  if (!r) { if (S.L.avg) { S.L.avg.remove(); S.L.avg = null; } return; }
  if (!S.L.avg) S.L.avg = L.layerGroup().addTo(S.map);
  S.L.avg.clearLayers();
  L.circle([r.lat, r.lon], { radius: Math.max(1, r.fehler), color: '#ff851b', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(S.L.avg);
  L.circleMarker([r.lat, r.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#ff851b', fillOpacity: 1 }).bindPopup('📍 gemittelt ' + fmtCoord(r.lat, r.lon)).addTo(S.L.avg);
}
function avgText(r) {
  return `${fmtCoord(r.lat, r.lon)}`;
}
function avgRender() {
  const el = $('#avgOut'); if (!el) return;
  const A = S.avg, r = A && A.res, sec = A ? Math.round(((A.on ? Date.now() : A.t1 || Date.now()) - A.t0) / 1000) : 0;
  const mm = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const btn = $('#avgGo'); if (btn) btn.textContent = A && A.on ? '⏸ Anhalten' : A && A.fixes.length ? '▶ Weiter messen' : '▶ Start';
  if (!A || !A.fixes.length) { el.innerHTML = `<p class="sub">${A && A.on ? '⏳ warte auf GPS …' : 'Noch keine Messung.'}${S.pos ? ` GPS jetzt ±${Math.round(S.pos.acc)} m.` : ''}</p>`; return; }
  const t = S.target, rel = r && t ? (() => { const d = haversine(t.lat, t.lon, r.lat, r.lon), b = bearing(t.lat, t.lon, r.lat, r.lon); return `${d < 0.5 ? '< 1 m' : Math.round(d) + ' m ' + compassName(b) + ' (' + Math.round(b) + '°)'} vom Ziel „${esc(t.label || t.name || '')}“`; })() : '';
  const gut = r && r.fehler <= 2 && sec >= 180;
  el.innerHTML = r ? `
    <div class="avgK">${esc(avgText(r))}</div>
    <p class="sub">${A.on ? '🔴 misst' : '⏸ angehalten'} · ${mm} min · ${r.used} von ${r.n} Messungen verwendet · GPS jetzt ±${S.pos ? Math.round(S.pos.acc) : '?'} m</p>
    <p>Streuung ±${r.streuung68.toFixed(1).replace('.', ',')} m · geschätzt <b>±${r.fehler.toFixed(1).replace('.', ',')} m</b> genau ${gut ? '✅' : sec < 180 ? '· für gute Werte 3–5 min messen' : ''}</p>
    ${r.art === 'kreis' ? `<p class="sub">🔄 Kreismitte aus deiner Runde: Radius ${r.radius.toFixed(1).replace('.', ',')} m, ${r.bogen}° umrundet.</p>` : ''}
    ${r.hinweis ? `<p class="sub">⚠️ ${esc(r.hinweis)}</p>` : ''}
    ${rel ? `<p class="sub">📏 ${rel}</p>` : ''}
    <div class="tools"><button id="avgCopy">📋 Kopieren</button><button id="avgTarget">🎯 Als Ziel</button>${curCache() ? '<button id="avgLog">✍️ In Log übernehmen</button>' : ''}</div>`
    : '<p class="sub">Alle bisherigen Messungen waren ungenauer als 20 m. Weiter warten, freien Himmel suchen.</p>';
  const c = $('#avgCopy'); if (c) c.onclick = () => navigator.clipboard.writeText(avgText(r)).then(() => toast('📋 ' + avgText(r)));
  const g = $('#avgTarget'); if (g) g.onclick = () => { const c0 = curCache(); setTarget(c0 ? { kind: 'wpt', geocode: c0.geocode, lat: r.lat, lon: r.lon, label: 'gemittelt', name: c0.name } : { kind: 'point', lat: r.lat, lon: r.lon, label: 'gemittelt', name: '📍 Gemittelte Koordinaten' }); };
  const l = $('#avgLog'); if (l) l.onclick = () => run(async () => {
    const c0 = curCache(), dl = c0 ? haversine(c0.lat, c0.lon, r.lat, r.lon) : 0, bl = c0 ? bearing(c0.lat, c0.lon, r.lat, r.lon) : 0;
    const txt = `Gemittelte Koordinaten: ${avgText(r)} (${sec < 60 ? 'unter 1 min' : Math.round(sec / 60) + ' min'}, ${r.used} Messungen, etwa ±${Math.max(1, Math.round(r.fehler))} m${c0 ? `; ${dl < 1 ? 'unter 1 m' : Math.round(dl) + ' m ' + compassName(bl)} von den Listing-Koordinaten` : ''})`;
    await showMyLog(); const ta = $('#lText'); if (ta) { ta.value = (ta.value ? ta.value + '\n' : '') + txt; ta.focus(); }
  });
}
function showAvg() {
  const A = S.avg || (S.avg = { on: false, mode: 'stehen', fixes: [], t0: Date.now(), res: null });
  openSheet('📍 Koordinaten mitteln', `
    <div class="seg" id="avgMode"><label><input type="radio" name="am" value="stehen" ${A.mode === 'stehen' ? 'checked' : ''}>🧍 Stehen bleiben</label><label><input type="radio" name="am" value="umrunden" ${A.mode === 'umrunden' ? 'checked' : ''}>🔄 Umrunden</label></div>
    <p class="sub" id="avgTip"></p>
    <div class="tools"><button id="avgGo">▶ Start</button><button id="avgNew">↺ Neu</button></div>
    <div id="avgOut"></div>`, b => {
    const tip = () => { b.querySelector('#avgTip').textContent = A.mode === 'umrunden'
      ? 'In einem gleichmäßigen Kreis von 3–10 m um die Dose gehen, am besten mehrere Runden. Die App rechnet die Kreismitte aus. Das gleicht auch Fehler durch Häuser und Bäume teilweise aus, braucht aber einen ganzen Kreis.'
      : 'Direkt an der Dose stehen bleiben, Handy ruhig und möglichst frei zum Himmel halten. 3–5 Minuten messen, die App sagt nach 1, 3 und 5 Minuten an.';
      b.querySelector('#avgTip').textContent += ' Abweichungen, die über Minuten gleich bleiben (Häuser, Felswand, dichte Bäume), kann keine Mittelung erkennen.'; };
    tip();
    b.querySelectorAll('input[name=am]').forEach(x => { x.onchange = () => { A.mode = x.value; A.res = averageFixes(A.fixes, A.mode); tip(); avgRender(); avgMap(); }; });
    b.querySelector('#avgGo').onclick = () => {
      if (A.on) { A.on = false; A.t1 = Date.now(); }
      else { if (!A.fixes.length) A.t0 = Date.now(); else if (A.t1) A.t0 += Date.now() - A.t1; A.on = true; A.t1 = 0; if (S.pos) avgAdd(S.pos); }
      avgRender();
    };
    b.querySelector('#avgNew').onclick = () => { Object.assign(A, { on: false, fixes: [], t0: Date.now(), t1: 0, res: null, lastMin: 0 }); avgRender(); avgMap(); };
    clearInterval(S.avgTimer); S.avgTimer = setInterval(() => { if (!$('#avgOut')) { clearInterval(S.avgTimer); return; } if (S.avg.on) avgRender(); }, 1000);
    avgRender();
  });
}
function showPeilung(pre) {
  pre = pre || {};
  const c = curCache(), last = S.peilForm || {};
  openSheet('📐 Peilung / Projektion', `
    <label class="f"><span>Von</span><select id="pFrom"><option value="me">meinem Standort</option><option value="target">dem aktuellen Ziel</option><option value="coord">Koordinaten …</option></select></label>
    <input id="pCoord" type="text" placeholder="N 48° 22.123 E 010° 53.456" hidden>
    <div class="two"><label class="f"><span>Entfernung</span><input id="pDist" inputmode="decimal" value="${esc(pre.dist != null ? pre.dist : last.dist || '')}"></label>
      <label class="f"><span>Einheit</span><select id="pUnit"><option value="m">Meter</option><option value="steps">Schritte (${String(S.set.stepLen).replace('.', ',')} m)</option><option value="km">km</option><option value="ft">Fuß</option></select></label></div>
    <div class="two"><label class="f"><span>Richtung (°)</span><input id="pDeg" inputmode="decimal" value="${esc(pre.deg != null ? pre.deg : last.deg || '')}"></label>
      <label class="f c"><input type="checkbox" id="pMag" ${last.mag && pre.deg == null ? 'checked' : ''}><span>Kompasswert (missweisend, +${String(S.set.declination).replace('.', ',')}°)</span></label></div>
    <div class="tools"><button id="pMeasure">📷 Mit der Kamera peilen</button><button id="pCalc">➜ Berechnen</button>${(S.rays || []).length ? `<button id="pRays">✕ ${S.rays.length} Peilstrahl${S.rays.length > 1 ? 'en' : ''} löschen</button>` : ''}</div>
    <div id="pRes"></div>`, b => {
    const $b = q => b.querySelector(q);
    $b('#pFrom').value = last.from || 'me'; $b('#pUnit').value = last.unit || 'm'; $b('#pCoord').value = last.coord || '';
    $b('#pCoord').hidden = $b('#pFrom').value !== 'coord';
    $b('#pFrom').onchange = () => { $b('#pCoord').hidden = $b('#pFrom').value !== 'coord'; };
    $b('#pMeasure').onclick = startPeilMessen;
    if ($b('#pRays')) $b('#pRays').onclick = () => { S.rays = []; drawRays(); $b('#pRays').remove(); toast('Peilstrahlen gelöscht'); };
    const calc = () => {
      const f = { from: $b('#pFrom').value, coord: $b('#pCoord').value, dist: $b('#pDist').value, unit: $b('#pUnit').value, deg: $b('#pDeg').value, mag: $b('#pMag').checked };
      S.peilForm = f;
      const start = f.from === 'me' ? S.pos : f.from === 'target' ? S.target : parseCoord(f.coord);
      const dv = evalExpr(f.dist, {}).value, gv = evalExpr(f.deg, {}).value;
      if (!start) return toast(f.from === 'me' ? 'Noch keine GPS-Position' : f.from === 'target' ? 'Kein Ziel' : 'Koordinaten nicht lesbar');
      if (dv == null || gv == null) return toast('Entfernung und Richtung eintragen');
      const m = dv * ({ m: 1, steps: S.set.stepLen, km: 1000, ft: 0.3048 }[f.unit] || 1), brg = ((gv + (f.mag ? S.set.declination : 0)) % 360 + 360) % 360;
      const q = destPoint(start.lat, start.lon, m, brg), txt = fmtCoord(q.lat, q.lon);
      $b('#pRes').innerHTML = `<div class="stn final"><div class="coord big">${txt}</div><small>${Math.round(m)} m in ${Math.round(brg)}° ${compassName(brg)}${f.mag ? ' (geografisch)' : ''}${S.pos ? ' · ' + fmtDist(haversine(S.pos.lat, S.pos.lon, q.lat, q.lon)) + ' von dir' : ''}</small>
        <div class="tools"><button id="pGo">🎯 Als Ziel</button><button id="pCopy">📋 Kopieren</button>${c ? '<button id="pSave">💾 Als Wegpunkt</button>' : ''}</div></div>`;
      $b('#pGo').onclick = () => setTarget({ kind: 'wpt', geocode: c ? c.geocode : '', lat: q.lat, lon: q.lon, label: `Peilung ${Math.round(m)} m / ${Math.round(brg)}°`, name: c ? c.name : 'Peilung' });
      $b('#pCopy').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('📋 ' + txt));
      const sv = $b('#pSave');
      if (sv) sv.onclick = () => run(async () => {
        c.wpts = c.wpts || []; const n = c.wpts.filter(w => w.type === 'peilung').length + 1;
        c.wpts.push({ name: `Peilung ${n}: ${f.dist} ${f.unit === 'steps' ? 'Schritte' : f.unit} / ${f.deg}°${f.mag ? ' (Kompass)' : ''}`, prefix: 'P' + n, lat: q.lat, lon: q.lon, type: 'peilung', note: '' });
        await idbPut('caches', c); drawCacheMarkers(); toast('💾 als Wegpunkt P' + n + ' gespeichert');
      });
    };
    $b('#pCalc').onclick = calc;
    if (pre.deg != null) setTimeout(() => { if ($b('#pDist').value) calc(); }, 50);
  });
}

/* ---------- b:con talk über öffentliche Nostr-Relays (Chat Art 4423, Sprechfunk Art 4420 nur als Hinweis) ---------- */
const NX = () => window.CVNostr;
function talkRufname() { return (S.set.talkName || 'CACHER').toUpperCase().replace(/[^A-Z0-9\-/.]/g, '').slice(0, 9) || 'CACHER'; } // Base40, wie b:con
async function talkKey() {
  let h = await idbGet('meta', 'nostrSk').catch(() => null);
  if (!h) { const b = NX().randomBytes(32); b[0] &= 0x7f; h = NX().hex(b); await idbPut('meta', h, 'nostrSk'); } // bleibt nur im Handy
  return NX().unhex(h);
}
/* Kanäle: 🧩 der aktuelle Cache (Passwort = GC/OC-Code, wie eine b:con-Gruppe) – alle, die diesen Cache als Ziel haben
   und b:con talk an, sind automatisch drin –, dazu optional 🔒 Team (eigenes Passwort). Gefunden werden die Events über
   das Label bcon.gruppe mit der Gruppenkennung (Relays filtern nur einbuchstabige Tags). */
const _gk = new Map();
async function chanKey(pw) { if (!_gk.has(pw)) _gk.set(pw, NX().groupKey(pw)); return _gk.get(pw); }
function cacheCode() { const c = curCache(); return c && /^(GC|OC)[0-9A-Z]+$/i.test(c.geocode) ? c.geocode.toUpperCase() : ''; }
async function talkChannels() {
  const T = S.talk, ch = [];
  if (S.set.talkCache && cacheCode()) { const g = await chanKey(cacheCode()); ch.push({ id: 'cache', name: cacheCode(), icon: '🧩', ...g }); }
  if (S.set.talkPw) { const g = await chanKey(S.set.talkPw); ch.push({ id: 'team', name: 'Team', icon: '🔒', ...g }); }
  T.channels = ch;
  if (!ch.some(c => c.id === T.sendTo)) T.sendTo = ch.length ? ch[0].id : null;
  return ch;
}
async function talkSubscribe() {
  const T = S.talk; if (!T.pool) return;
  const ch = await talkChannels(), since = Math.floor(Date.now() / 1000) - 86400, filters = [{ kinds: [4420, 4423], '#p': [T.pk], since }];
  if (ch.length) filters.unshift({ kinds: [4420, 4423, LIVE_KIND], '#L': ['bcon.gruppe'], '#l': ch.map(c => c.kennung), since });
  T.pool.sub('cvtalk', filters);
  talkRenderStatus();
}
async function initTalk() {
  const T = S.talk;
  $('#bTalk').hidden = !S.set.talkOn;
  if (T.pool) { T.pool.close(); T.pool = null; }
  talkFab();
  if (!S.set.talkOn) return;
  if (!NX()) return toast('b:con talk: Nostr-Baustein fehlt');
  T.sk = await talkKey(); T.pk = NX().hex(NX().getPublicKey(T.sk));
  if (!T.loaded) { T.loaded = true; const old = await idbGet('meta', 'talklog').catch(() => null); if (old) for (const m of old) { T.msgs.push(m); T.seen.add(m.id); } }
  const urls = String(S.set.talkRelays || '').split(/[\s,]+/).filter(u => /^wss:\/\//.test(u));
  T.pool = new (NX().Pool)(urls, ev => talkEvent(ev), st => { T.status = st; talkRenderStatus(); });
  await talkSubscribe();
  T.pool.open();
  updateTalkBadge();
}
async function talkEvent(ev) {
  const T = S.talk, X = NX();
  if (!ev || T.seen.has(ev.id) || (ev.kind !== 4423 && ev.kind !== 4420 && ev.kind !== LIVE_KIND)) return;
  T.seen.add(ev.id);
  if (!(await X.verifyEvent(ev))) return;                                  // gefälschte oder kaputte Events weg
  const exp = +X.tagVal(ev, 'expiration'); if (exp && exp < Date.now() / 1000) return;
  const gk = X.tagVal(ev, 'gruppe'), toMe = (ev.tags || []).some(t => t[0] === 'p' && t[1] === T.pk), eigen = ev.pubkey === T.pk;
  const chan = gk ? (T.channels || []).find(c => c.kennung === gk) : null;
  if (gk && !chan) return;                                                 // fremde Gruppe oder anderer Cache
  if (!gk && !toMe) return;                                                // offene Nachrichten gibt es hier nicht
  const msg = { id: ev.id, pk: ev.pubkey, ts: ev.created_at * 1000, eigen, chan: chan ? chan.icon + ' ' + chan.name : '✉️ privat', kind: ev.kind };
  if (ev.kind === LIVE_KIND) { if (chan && !eigen) await liveEmpfang(ev, chan); return; }
  if (ev.kind === 4420) {
    // Sprechfunk wie in der b:con-App: Teile sammeln, Kompaktform prüfen (Sprecher-Signatur), dann abspielen
    const B = await bconVoice().catch(() => null); if (!B) return;
    const i = await B.netz.teilLesen(ev, T.sk, new Map((T.channels || []).map(c => [c.kennung, c]))); if (!i) return;
    const k = await B.sammler.teil(i); if (!k) return;
    const d = await B.netz.kompaktLesen(k); if (!d || (!d.signatur && !d.fehlend)) return;
    const echt = d.signatur || ev.pubkey === d.kopf.schluessel, nb = (B.SF.CODECS[d.kopf.codec] ? 8 : 8);
    const sek = Math.max(1, Math.round(d.pakete.reduce((n, p) => n + (p.length ? p.length / (d.kopf.codec === 8 ? 4 : nb) : 10), 0) * (B.SF.CODECS[d.kopf.codec]?.ms || 40) / 1000));
    msg.id = 'v' + i.kennung; msg.name = echt ? (d.kopf.name || d.kopf.schluessel.slice(0, 6)) : d.kopf.schluessel.slice(0, 6) + ' (ungeprüft)';
    msg.text = `🎙️ Sprachnachricht · ${sek} s`; msg.voice = i.kennung;
    T.voice.set(i.kennung, d);
    if (!eigen && msg.ts > Date.now() - 3 * 60000) { T.queue.push(d); voiceWeiter(); }
  } else {
    try {
      const raw = chan ? await X.nip44Decrypt(chan.ck, ev.content) : await X.nip44Decrypt(await X.conversationKey(T.sk, ev.pubkey), ev.content);
      const j = JSON.parse(raw); msg.name = String(j.n || '').slice(0, 12) || ev.pubkey.slice(0, 6); msg.text = String(j.t || '').slice(0, 500);
    } catch (e) { return; }
  }
  if (!msg.text) return;
  const c = parseCoord(msg.text);
  if (c && !eigen) { T.pos[ev.pubkey] = { name: msg.name, lat: c.lat, lon: c.lon, ts: msg.ts }; drawTalkPos(); }
  T.msgs.push(msg); T.msgs.sort((a, b) => a.ts - b.ts); if (T.msgs.length > 300) T.msgs.splice(0, T.msgs.length - 300);
  clearTimeout(T.saveT); T.saveT = setTimeout(() => idbPut('meta', T.msgs.slice(-200), 'talklog').catch(() => {}), 1500);
  if (!eigen && msg.ts > Date.now() - 10 * 60000 && ($('#sheetTitle').textContent !== '💬 b:con talk' || $('#sheet').hidden)) {
    T.unread++; updateTalkBadge(); toast(`💬 ${msg.chan} · ${msg.name}: ${msg.text.slice(0, 80)}`, 4000); buzz([30, 60, 30]);
  }
  talkRenderList();
}
function updateTalkBadge() { const b = $('#bTalk'); b.dataset.n = S.talk.unread || ''; b.classList.toggle('badge', !!S.talk.unread); }
function talkRenderStatus() {
  talkFab();
  const el = $('#talkStatus'); if (!el) return;
  const st = S.talk.status || { offen: 0, gesamt: 0 }, ch = S.talk.channels || [];
  el.innerHTML = `${st.offen ? '🟢' : '🔴'} ${st.offen}/${st.gesamt} Relays · ${ch.length ? ch.map(c => c.icon + ' ' + esc(c.name)).join(' · ') : 'kein Kanal – Cache als Ziel wählen oder Team-Passwort setzen'} · du: ${esc(talkRufname())}`;
}
function talkRenderList() {
  const el = $('#talkList'); if (!el) return;
  const T = S.talk, names = (T.channels || []).map(c => c.icon + ' ' + c.name).concat(['✉️ privat']);
  const list = T.msgs.filter(m => names.includes(m.chan)).slice(-120);
  el.innerHTML = list.map((m, i) => {
    if (!m.chan) return '';
    const c = parseCoord(m.text);
    return `<li class="tmsg${m.eigen ? ' me' : ''}"><div class="th"><span class="chan">${esc(m.chan || '')}</span> <b>${esc(m.name)}</b> <small>${new Date(m.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
      <div class="tt">${esc(m.text)}</div>${c ? `<button data-tgo="${i}">🎯 als Ziel</button>` : ''}${m.voice && S.talk.voice.has(m.voice) ? `<button data-play="${esc(m.voice)}">▶ abspielen</button>` : ''}</li>`;
  }).join('') || '<li class="empty">Noch keine Nachrichten der letzten 24 h.</li>';
  el.querySelectorAll('[data-tgo]').forEach(b => { b.onclick = () => { const m = list[+b.dataset.tgo], c = parseCoord(m.text); setTarget({ kind: 'wpt', geocode: '', lat: c.lat, lon: c.lon, label: '💬 ' + m.name, name: m.name }); }; });
  el.querySelectorAll('[data-play]').forEach(b => { b.onclick = () => { const d = S.talk.voice.get(b.dataset.play); if (d) { S.talk.queue.push(d); voiceWeiter(); } }; });
  if (!list.length) el.innerHTML = '<li class="empty">Noch keine Nachrichten in deinen Kanälen (letzte 24 h).</li>';
  el.scrollTop = el.scrollHeight;
}
async function talkSend(text) {
  const T = S.talk, X = NX();
  text = String(text || '').trim(); if (!text) return;
  if (!T.pool || !T.sk) throw new Error('b:con talk ist aus (Einstellungen)');
  const chan = (T.channels || []).find(c => c.id === T.sendTo);
  if (!chan) throw new Error('Kein Kanal: einen Cache als Ziel wählen oder ein Team-Passwort setzen');
  const body = JSON.stringify({ n: talkRufname(), t: text.slice(0, 500), p: 0 }); // übers Netz nie Durchsage
  const tags = [['L', 'bcon.gruppe'], ['l', chan.kennung, 'bcon.gruppe'], ['gruppe', chan.kennung], ['alt', 'b:con-Chat'],
    ['expiration', String(Math.floor(Date.now() / 1000) + 86400)]];
  const ev = await X.finishEvent({ kind: 4423, tags, content: await X.nip44Encrypt(chan.ck, body) }, T.sk);
  const res = await T.pool.publish(ev), ok = res.filter(r => r.ok).length;
  if (!ok) throw new Error('kein Relay hat angenommen' + (res[0] ? ': ' + (res[0].msg || '') : ''));
  await talkEvent(ev); // eigenes Echo sofort anzeigen
  return ok;
}
async function showTalk() {
  if (S.talk.chanCode !== cacheCode()) { S.talk.chanCode = cacheCode(); await talkSubscribe(); }
  if (!S.set.talkOn) return toast('b:con talk in den Einstellungen einschalten');
  const T = S.talk; T.unread = 0; updateTalkBadge();
  await talkChannels();
  const c = curCache(), here = S.pos ? `📍 ${fmtCoord(S.pos.lat, S.pos.lon)} ±${Math.round(S.pos.acc)} m` : '';
  openSheet('💬 b:con talk', `
    <p class="sub" id="talkStatus"></p><p class="sub" id="talkMates"></p>
    <div class="seg" id="tChan">${(T.channels || []).map(c => `<label><input type="radio" name="tch" value="${c.id}" ${c.id === T.sendTo ? 'checked' : ''}>${c.icon} ${esc(c.name)}</label>`).join('')}</div>
    <ul class="tlist" id="talkList"></ul>
    <button id="tPtt" class="ptt">🎙️ Gedrückt halten zum Sprechen</button>
    <div class="tsend"><input id="tText" type="text" maxlength="500" placeholder="Nachricht …"><button id="tSend">➤</button></div>
    <div class="tools"><button data-q="pos">📍 Standort</button>${c ? '<button data-q="found">✅ Gefunden</button>' : ''}${S.target ? '<button data-q="ziel">🎯 Ziel teilen</button>' : ''}<button data-q="help">🙋 Hilfe</button></div>
    <p class="sub">🧩 = alle, die diesen Cache als Ziel haben und b:con talk an. Den Kanal kann lesen, wer den Code kennt – also nicht geheim. 🔒 Team = nur mit eurem Passwort. Über öffentliche Nostr-Relays, verfällt nach 24 h. b:con ist kein Notrufsystem.</p>`, b => {
    talkRenderStatus(); talkRenderList(); talkRenderMates();
    const send = txt => run(async () => { const n = await talkSend(txt); b.querySelector('#tText').value = ''; toast(`💬 gesendet (${n} Relay${n > 1 ? 's' : ''})`); });
    b.querySelector('#tSend').onclick = () => send(b.querySelector('#tText').value);
    b.querySelector('#tText').onkeydown = e => { if (e.key === 'Enter') send(e.target.value); };
    b.querySelectorAll('input[name=tch]').forEach(r => { r.onchange = () => { S.talk.sendTo = r.value; talkFab(); }; });
    bindPtt(b.querySelector('#tPtt'));
    bconVoice().then(B => B.SF.audio()).catch(() => {}); // Ton freischalten (Nutzergeste)
    b.querySelectorAll('[data-q]').forEach(q => {
      q.onclick = () => {
        const k = q.dataset.q;
        if (k === 'pos') { if (!here) return toast('Noch keine GPS-Position'); send(here + (c ? ` (bei ${c.geocode})` : '')); }
        if (k === 'found') send(`✅ ${c.geocode} ${c.name} gefunden`);
        if (k === 'ziel') send(`🎯 Ziel: ${S.target.label || S.target.name || ''} ${fmtCoord(S.target.lat, S.target.lon)}`);
        if (k === 'help') send(`🙋 Brauche Hilfe${c ? ' bei ' + c.geocode : ''}${here ? ' – ' + here : ''}`);
      };
    });
  });
}
/* ---------- Sprechfunk über Nostr mit den Bausteinen der b:con-App (bcon/: Codec2, Sprechfunk, netz.js) ---------- */
const LIVE_KIND = 20442; // flüchtig (Relays speichern nicht): Live-Position im Kanal, versiegelt
let _bc = null;
function bconVoice() {
  if (!_bc) _bc = (async () => {
    if (typeof Codec2Modul === 'undefined') await loadScript('bcon/codec2.js');
    if (typeof Sprechfunk === 'undefined') await loadScript('bcon/sprechfunk.js');
    const netz = await import('./bcon/netz.js');
    await Sprechfunk.laden();
    return { netz, SF: Sprechfunk, emp: new Sprechfunk.Empfaenger(), mic: new Sprechfunk.Mikrofon(), sammler: new netz.Sammler() };
  })().catch(e => { _bc = null; throw e; });
  return _bc;
}
function talkFab() {
  const f = $('#fPtt'); if (!f) return;
  const T = S.talk, ch = T.channels || [], on = !!(S.set.talkOn && T.pool && ch.length);
  f.hidden = !on;
  const c = ch.find(x => x.id === T.sendTo); $('#fPttCh').textContent = c ? c.icon : '';
  f.title = c ? `Sprechen an ${c.name} (gedrückt halten)` : '';
  if (on && !f._bound) { f._bound = true; bindPtt(f); bconVoice().catch(() => {}); } // Bausteine vorladen, damit der Druck sofort zählt
}
function bindPtt(el) {
  el.oncontextmenu = e => e.preventDefault();
  el.onpointerdown = e => { e.preventDefault(); S.talk.held = true; try { el.setPointerCapture(e.pointerId); } catch (x) { /* egal */ } run(pttStart); };
  el.onpointerup = el.onpointercancel = () => { S.talk.held = false; run(pttStop); };
}
function pttShow(s) { // s = null: bereit, sonst Sekunden seit Start
  const t = $('#tPtt'), f = $('#fPtt');
  if (t) { t.classList.toggle('on', s != null); t.textContent = s == null ? '🎙️ Gedrückt halten zum Sprechen' : s > 25 ? `🎙️ noch ${Math.ceil(30 - s)} s` : `🎙️ spricht … ${Math.floor(s)} s`; }
  if (f) { f.classList.toggle('on', s != null); $('#fPttT').textContent = s == null ? '' : s > 25 ? `noch ${Math.ceil(30 - s)}` : `${Math.floor(s)} s`; }
  if (s == null) [t, f].forEach(e => e && e.style.removeProperty('--pegel'));
}
async function pttStart() {
  const T = S.talk;
  if (T.rec || T.recStarting) return;
  const chan = (T.channels || []).find(c => c.id === T.sendTo);
  if (!chan) throw new Error('Kein Kanal: Cache als Ziel wählen oder Team-Passwort setzen');
  T.recStarting = true;
  try {
    const B = await bconVoice(); await B.SF.audio();
    const codec = new B.SF.Codec(3), zeit = Math.floor(Date.now() / 1000);  // Codec2 1600 (Kennung 3), Standard für Gruppen
    const a = new B.netz.Aufnahme(T.sk, { codec: 3, flags: B.netz.mitPrio(0, 0), ziel: B.netz.ALLE, zeit, name: talkRufname(), region: '', gruppe: 0 }, codec.nb);
    T.rec = { a, codec, chan, t0: Date.now(), zeit };
    B.mic.agc = true;
    B.mic.beiRahmen = pcm => { if (T.rec) T.rec.a.rahmen(T.rec.codec.kodieren(pcm)); };
    B.mic.beiPegel = p => { if (!T.rec) return; const v = Math.min(1, p * 3).toFixed(2); [$('#tPtt'), $('#fPtt')].forEach(e => e && e.style.setProperty('--pegel', v)); };
    await B.mic.oeffnen(codec.n);
    if (!T.held) {                                                        // losgelassen, während das Mikrofon aufging (z. B. Freigabe-Dialog)
      T.rec = null; B.mic.beiRahmen = null; B.mic.schliessen(); codec.frei();
      return toast('🎙️ Mikrofon bereit – zum Sprechen gedrückt halten');
    }
    T.rec.t0 = Date.now();
    B.SF.signal('frei'); buzz([30]);
    pttShow(0);
    T.recTimer = setInterval(() => {
      if (!T.rec) return;
      const s = (Date.now() - T.rec.t0) / 1000;
      pttShow(s);
      if (s >= 30) run(pttStop);                                         // höchstens 30 s an Gruppen (b:con-Regel)
    }, 200);
  } finally { T.recStarting = false; }
}
async function pttStop() {
  const T = S.talk;
  if (T.recStarting) return;                                              // pttStart merkt am Halte-Status selbst, dass losgelassen wurde
  const r = T.rec; if (!r) return;
  T.rec = null; clearInterval(T.recTimer);
  pttShow(null);
  const B = await bconVoice();
  B.mic.beiRahmen = null; B.mic.schliessen(); B.SF.signal('los'); r.codec.frei();
  const k = await r.a.fertig();
  if (!k || Date.now() - r.t0 < 400) return toast('Zu kurz – Taste länger halten');
  const X = NX(), kenn = await B.netz.kennung(k), anzahl = Math.ceil(k.length / 1600), ablauf = String(r.zeit + 86400);
  let ok = 0;
  for (let t = 0; t < anzahl; t++) {
    const tags = [['talk', kenn, String(t), String(anzahl)], ['alt', 'b:con-Sprechfunk'], ['L', 'bcon.gruppe'], ['l', r.chan.kennung, 'bcon.gruppe'],
      ['gruppe', r.chan.kennung], ['expiration', ablauf]];
    const ev = await X.finishEvent({ kind: 4420, created_at: r.zeit, tags, content: await B.netz.versiegeln(r.chan.ck, k.subarray(t * 1600, (t + 1) * 1600)) }, T.sk);
    const res = await T.pool.publish(ev); ok = Math.max(ok, res.filter(x => x.ok).length);
    await talkEvent(ev);                                                  // eigenes Echo in die Liste
  }
  toast(ok ? `🎙️ gesendet (${Math.round((Date.now() - r.t0) / 1000)} s, ${ok} Relay${ok > 1 ? 's' : ''})` : '🎙️ kein Relay hat angenommen');
}
async function voiceWeiter() {
  const T = S.talk; if (T.playing) return;
  T.playing = true; $('#fPtt')?.classList.add('rx');
  while (T.queue.length) await voicePlay(T.queue.shift()).catch(e => console.warn('Wiedergabe', e));
  T.playing = false; $('#fPtt')?.classList.remove('rx');
}
async function voicePlay(d) {
  const B = await bconVoice(), c = B.SF.CODECS[d.kopf.codec]; if (!c) return;
  await B.SF.audio();
  const slot = 200 + (S.talk.slot++ % 50);
  B.emp.beginnen(slot, d.kopf.codec, { weg: 'nostr', sprecher: d.kopf.schluessel });
  await B.emp.slots.get(slot)?.bereit;
  const nb = B.emp.slots.get(slot)?.codec?.nb || 8;
  let ms = 0;
  d.pakete.forEach((p, i) => {
    const dauer = (p.length ? p.length / nb : 10) * c.ms, b = new Uint8Array(5 + p.length);
    b.set([0x50, slot, i + 1, dauer & 255, dauer >> 8]); b.set(p, 5);
    B.emp.paket(b); ms += dauer;
  });
  await new Promise(r => setTimeout(r, ms + 300));
  B.emp.beenden(slot);
}
/* Live-Position: alle 30 s im gewählten Kanal (Cache oder Team), nur solange b:con talk an und die Einstellung es erlaubt */
async function liveEmpfang(ev, chan) {
  try {
    const j = JSON.parse(await NX().nip44Decrypt(chan.ck, ev.content));
    if (!isFinite(j.lat) || !isFinite(j.lon)) return;
    S.talk.pos[ev.pubkey] = { name: String(j.n || ev.pubkey.slice(0, 6)).slice(0, 9), lat: +j.lat, lon: +j.lon, acc: +j.acc || 0, ts: ev.created_at * 1000, live: true, chan: chan.icon + ' ' + chan.name };
    drawTalkPos(); talkRenderMates();
  } catch (e) { /* nicht lesbar */ }
}
async function liveSenden() {
  const T = S.talk, m = S.set.talkLive;
  if (!S.set.talkOn || m === 'aus' || !T.pool || !S.pos || document.hidden) return;
  const ch = (T.channels || []).filter(c => m === 'cache+team' || c.id === 'team');
  for (const c of ch) {
    const body = JSON.stringify({ n: talkRufname(), lat: +S.pos.lat.toFixed(6), lon: +S.pos.lon.toFixed(6), acc: Math.round(S.pos.acc || 0) });
    const ev = await NX().finishEvent({ kind: LIVE_KIND, tags: [['L', 'bcon.gruppe'], ['l', c.kennung, 'bcon.gruppe'], ['gruppe', c.kennung]], content: await NX().nip44Encrypt(c.ck, body) }, T.sk);
    T.pool.publish(ev, 3000);
  }
}
setInterval(() => run(liveSenden), 30000);
window.CVT = { liveSenden, bconVoice }; // für Tests und die Browser-Konsole
function talkRenderMates() {
  const el = $('#talkMates'); if (!el) return;
  const now = Date.now(), list = Object.values(S.talk.pos).filter(p => now - p.ts < 5 * 60000);
  el.innerHTML = list.length ? '👥 ' + list.map(p => `${esc(p.name)}${S.pos ? ' ' + fmtDist(haversine(S.pos.lat, S.pos.lon, p.lat, p.lon)) : ''}${p.live ? '' : ' (gemeldet)'}`).join(' · ') : '';
}

function drawTalkPos() {
  if (!S.map || !S.L.talk) return;
  S.L.talk.clearLayers();
  const now = Date.now();
  for (const p of Object.values(S.talk.pos)) {
    if (now - p.ts > 3 * 3600000) continue;
    window.L.marker([p.lat, p.lon], { icon: window.L.divIcon({ className: 'talkPos', html: '💬 ' + esc(p.name), iconSize: null }) })
      .bindPopup(`${esc(p.name)} · ${new Date(p.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`).addTo(S.L.talk);
  }
}

/* ---------- Offline vorbereiten ---------- */
function tileXY(lat, lon, z) {
  const n = Math.pow(2, z), x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * n);
  return [x, y];
}
async function tileCoverage(c, r) {
  if (!('caches' in window)) return null;
  const have = new Set((await (await caches.open('cv-tiles-v1')).keys()).map(k => k.url.replace(/^https:\/\/[a-c]?\.?tile/, 'https://tile')));
  const dLa = r / 111320, dLo = r / (111320 * Math.cos(c.lat * D2R)), out = [];
  for (const z of [15, 16, 17]) {
    const [x0, y0] = tileXY(c.lat + dLa, c.lon - dLo, z), [x1, y1] = tileXY(c.lat - dLa, c.lon + dLo, z);
    let n = 0, h = 0;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { n++; if (have.has(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`)) h++; }
    out.push({ z, n, h });
  }
  return out;
}
async function showOffline() {
  const ref = S.pos || S.target || (S.map ? { lat: S.map.getCenter().lat, lon: S.map.getCenter().lng } : null);
  if (!ref) return toast('Erst GPS oder ein Ziel');
  const cov = await tileCoverage(ref, 1000);
  openSheet('📦 Offline vorbereiten', `
    <p class="sub">Um ${S.pos ? 'deinen Standort' : 'das Ziel'}: Caches, KI-Auswertung und Stationen landen im Handy. Routing und neue KI-Fragen brauchen weiter Netz.</p>
    <label class="f"><span>Umkreis</span><select id="oR"><option value="1000">1 km</option><option value="2000" selected>2 km</option><option value="5000">5 km</option></select></label>
    <label class="f c"><input type="checkbox" id="oKi" checked><span>🤖 Logs der ungefundenen Caches auswerten (noch nicht ausgewertete)</span></label>
    <label class="f c"><input type="checkbox" id="oMu"><span>🧩 Stationen der Multis aus dem Listing lesen</span></label>
    <div class="tools"><button id="oGo">📦 Vorbereiten</button></div><div id="oOut" class="sub"></div>
    <h4>Karte</h4>
    <p class="sub">${cov ? cov.map(x => `Zoom ${x.z}: ${x.h} von ${x.n} Kacheln da`).join(' · ') + ' (1 km Umkreis)' : ''}</p>
    <p class="sub">Die Kacheln von openstreetmap.org dürfen laut Nutzungsregeln nicht vorab im Paket geladen werden. Offline da ist, was du dir einmal angesehen hast: das Gebiet vorher auf der Karte in den Zoomstufen anschauen. Ein eigener Kachelserver (später SSD-Server) würde das lösen.</p>`, b => {
    b.querySelector('#oGo').onclick = () => run(async () => {
      const r = +b.querySelector('#oR').value, out = b.querySelector('#oOut'), log = t => { out.innerHTML += esc(t) + '<br>'; };
      out.innerHTML = '';
      const libs = await Promise.allSettled([loadSqlJs(), fetch('vendor/leaflet/leaflet.js'), fetch('vendor/leaflet/leaflet.css')]);
      log(`App-Bausteine: ${libs.filter(x => x.status === 'fulfilled').length}/3 im Speicher`);
      const list = [...S.caches.values()].filter(c => !c.found && haversine(ref.lat, ref.lon, c.lat, c.lon) <= r);
      log(`${list.length} ungefundene Caches im Umkreis, davon ${list.filter(c => (c.logs || []).length).length} mit Logs`);
      if (b.querySelector('#oKi').checked) {
        const todo = list.filter(c => (c.logs || []).length && (!S.ai.has(c.geocode) || !S.ai.get(c.geocode).suchhilfe));
        let ok = 0, err = 0;
        for (const c of todo) { try { await aiAnalyze(c); ok++; } catch (e) { err++; } out.lastChild && (out.innerHTML = out.innerHTML.replace(/🤖[^<]*<br>$/, '')); log(`🤖 ausgewertet ${ok + err}/${todo.length}${err ? ` (${err} Fehler)` : ''}`); }
        if (!todo.length) log('🤖 alles schon ausgewertet');
      }
      if (b.querySelector('#oMu').checked) {
        const todo = [];
        for (const c of list) if (['multi', 'wherigo'].includes(c.type) && c.desc && !(await getMulti(c.geocode))) todo.push(c);
        let ok = 0;
        for (const c of todo) { try { await aiMulti(c); ok++; } catch (e) { /* weiter */ } }
        log(`🧩 Stationen gelesen: ${ok}/${todo.length}`);
      }
      drawCacheMarkers(); renderStage();
      log('✅ fertig – Flugmodus-Test lohnt sich');
    });
  });
}

/* ---------- Gefunden & weiter ---------- */
function tourCandidate(c, exclude) {
  if (c.found || c.disabled || c.archived || c.geocode === exclude) return false;
  if (c.type === 'mystery' && !c.corrected) return false;                          // ungelöstes Rätsel
  if (S.set.skipGear && missingGear(c, S.set, S.ai.get(c.geocode), true).length) return false; // Ausrüstung fehlt (hart)
  return true;
}
function makeTour(exclude) {
  const p = S.pos || S.target; if (!p) return null;
  let list = [...S.caches.values()].filter(c => tourCandidate(c, exclude) && haversine(p.lat, p.lon, c.lat, c.lon) <= S.set.tourRadius);
  list = list.sort((a, b) => haversine(p.lat, p.lon, a.lat, a.lon) - haversine(p.lat, p.lon, b.lat, b.lon)).slice(0, 40);
  const order = planTour({ lat: p.lat, lon: p.lon }, list, S.set.tourLoop);
  S.tour = { ids: order.map(i => list[i].geocode), start: { lat: p.lat, lon: p.lon }, loop: S.set.tourLoop, ts: Date.now() };
  idbPut('meta', S.tour, 'tour').catch(() => {});
  drawTour();
  return S.tour;
}
function tourNext(exclude) {
  if (!S.tour || !S.tour.ids.some(g => S.caches.has(g) && tourCandidate(S.caches.get(g), exclude))) makeTour(exclude);
  const g = S.tour && S.tour.ids.find(id => S.caches.has(id) && tourCandidate(S.caches.get(id), exclude));
  return g ? S.caches.get(g) : null;
}
function tourPos(g) { return S.tour ? S.tour.ids.indexOf(g) : -1; }
function drawTour() {
  if (!S.map || !S.L.tour) return;
  S.L.tour.clearLayers();
  if (!S.tour) return;
  const pts = S.tour.ids.map(g => S.caches.get(g)).filter(Boolean);
  const line = [[S.tour.start.lat, S.tour.start.lon]].concat(pts.map(c => [c.lat, c.lon]));
  if (S.tour.loop) line.push(line[0]);
  window.L.polyline(line, { color: '#b10dc9', weight: 3, opacity: 0.8, dashArray: '2 8' }).addTo(S.L.tour);
  pts.forEach((c, i) => window.L.marker([c.lat, c.lon], { interactive: false, icon: window.L.divIcon({ className: 'tourNr' + (c.found ? ' done' : ''), html: String(i + 1), iconSize: [20, 20], iconAnchor: [-6, 22] }) }).addTo(S.L.tour));
}
function showTour() {
  const p = S.pos || S.target;
  if (!S.tour) makeTour();
  if (!S.tour) return toast('Erst GPS oder ein Ziel');
  const pts = S.tour.ids.map(g => S.caches.get(g)).filter(Boolean);
  let prev = S.tour.start, sum = 0;
  const rows = pts.map((c, i) => {
    const d = haversine(prev.lat, prev.lon, c.lat, c.lon); sum += d; prev = c;
    const ti = TYPE_INFO[c.type] || TYPE_INFO.other;
    return `<li class="row${c.found ? ' found' : ''}" data-g="${esc(c.geocode)}"><span class="tnr">${i + 1}</span><div class="grow"><b>${esc(c.name)}</b><small>${esc(c.geocode)} · ${ti[0]} · D${c.d || '?'}/T${c.t || '?'}${gearBadge(c)}</small></div><span class="dd">+${fmtDist(d)}<br><small>${fmtDist(sum)}</small></span></li>`;
  }).join('');
  if (S.tour.loop && pts.length) sum += haversine(prev.lat, prev.lon, S.tour.start.lat, S.tour.start.lon);
  const pack = new Map();
  pts.forEach(c => toolsOf(c, S.ai.get(c.geocode)).forEach(a => { const e = pack.get(a.key) || { icon: a.icon, label: a.label.replace(' (aus Text)', ''), n: 0 }; e.n++; pack.set(a.key, e); }));
  const packHtml = pack.size ? `<p class="sub">🎒 Einpacken: ${[...pack.entries()].map(([k, e]) => `${e.icon} ${esc(e.label)} (${e.n})${S.set['gear_' + k] === false ? ' ✗' : ''}`).join(' · ')}</p>` : '';
  openSheet(`🗺️ Tour (${pts.length})`, `${packHtml}
    <p class="sub">Reihenfolge ohne Hin und Her (Luftlinie, Kreuzungen entfernt). Gesamt ca. ${fmtDist(sum)} Luftlinie${S.tour.loop ? ', zurück zum Start' : ''} – zu Fuß wird es mehr.</p>
    <div class="two"><label class="f"><span>Umkreis</span><select id="tR"><option value="1000">1 km</option><option value="2000">2 km</option><option value="3000">3 km</option><option value="5000">5 km</option></select></label>
      <label class="f c"><input type="checkbox" id="tL" ${S.set.tourLoop ? 'checked' : ''}><span>Rundtour</span></label></div>
    <div class="tools"><button id="tNew">🔄 Neu planen ab hier</button><button id="tGo">▶ Erster Cache als Ziel</button><button id="tOff">✕ Tour beenden</button></div>
    <ul class="list">${rows || '<li class="empty">Keine passenden Caches im Umkreis.</li>'}</ul>`, b => {
    b.querySelector('#tR').value = String(S.set.tourRadius);
    b.querySelector('#tR').onchange = e => { S.set.tourRadius = +e.target.value; saveSettings(); makeTour(); showTour(); };
    b.querySelector('#tL').onchange = e => { S.set.tourLoop = e.target.checked; saveSettings(); makeTour(); showTour(); };
    b.querySelector('#tNew').onclick = () => { makeTour(); showTour(); };
    b.querySelector('#tGo').onclick = () => { const c = tourNext(); if (c) targetCache(c.geocode); };
    b.querySelector('#tOff').onclick = () => { S.tour = null; idbDel('meta', 'tour').catch(() => {}); drawTour(); renderTop(); closeSheet(); toast('Tour beendet'); };
    b.querySelectorAll('li.row').forEach(li => { li.onclick = () => targetCache(li.dataset.g); });
  });
}
async function foundAndNext(c, text, photoIds) {
  await idbPut('mylogs', { geocode: c.geocode, name: c.name, type: 'found', text, ts: Date.now(), lat: S.pos && S.pos.lat, lon: S.pos && S.pos.lon, photoIds });
  c.found = true; await idbPut('caches', c); S.caches.set(c.geocode, c);
  buzz([60, 60, 200]);
  const nx = tourNext(c.geocode);
  drawTour();
  if (!nx) { closeSheet(); drawCacheMarkers(); return toast('✅ Gefunden gespeichert – kein weiterer passender Cache im Umkreis'); }
  targetCache(nx.geocode);
  const ti = (TYPE_INFO[nx.type] || TYPE_INFO.other)[0], d = S.pos ? haversine(S.pos.lat, S.pos.lon, nx.lat, nx.lon) : 0;
  const k = tourPos(nx.geocode) + 1, n = S.tour ? S.tour.ids.length : 0;
  toast(`✅ Gefunden gespeichert · Tour ${k}/${n}: ${nx.name} (${ti}, ${fmtDist(d)})`, 5000);
  say(`Weiter zu ${nx.name}, ${ti}, ${sayDist(Math.round(d / 10) * 10)}`);
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
    <div class="tools"><button id="lSave">💾 Log speichern</button><button id="lNext">✅ Gefunden & weiter ➜</button></div>` : '<p>Kein Cache als Ziel.</p>'}
    <h4>Gespeicherte Offline-Logs (${all.length})</h4>
    <div class="tools"><button id="lExport">📤 Feldnotizen exportieren</button></div>
    <ul class="logs">${rows || '<li class="empty">Noch keine.</li>'}</ul>`, b => {
    const cleanup = () => urls.forEach(u => URL.revokeObjectURL(u));
    $('#sheetClose').addEventListener('click', cleanup, { once: true });
    if (c) b.querySelector('#lNext').onclick = () => run(async () => {
      const photoIds = [...b.querySelectorAll('.thumbs input:checked')].map(i => +i.value);
      cleanup(); await foundAndNext(c, b.querySelector('#lText').value.trim(), photoIds);
    });
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
    <label class="f"><span>Karte dunkel</span><select data-k="mapDark"><option value="on">immer</option><option value="auto">nach Sonnenstand</option><option value="off">nie</option></select></label>
    ${chk('autoZoom', 'Karte zoomt automatisch (Ziel bzw. nächste Abbiegung im Bild)')}
    ${chk('keepAwake', 'Bildschirm anlassen')}
    <h4>Unterwegs</h4>
    ${chk('speak', 'Ansagen per Sprache (Abstände 2 km … 10 m, Abzweigungen)')}
    ${chk('vibrate', 'Vibration (Abstände, Abzweigungen, Fadenkreuz grün)')}
    ${chk('night', 'Nachtmodus (rote Anzeige, Reflektorsuche)')}
    ${f('stepLen', 'Schrittlänge für Peilungen (m)', 'number', 'min="0.3" max="1.5" step="0.01"')}
    ${f('declination', 'Missweisung für Kompasswerte (°, Ost +; Standard 4 – für deinen Ort prüfen)', 'number', 'min="-30" max="30" step="0.1"')}
    <h4>💬 b:con talk (Nostr, öffentliche Relays)</h4>
    ${chk('talkOn', 'b:con talk einschalten')}
    ${f('talkName', 'Rufname (bis 6 Zeichen A–Z, 0–9)')}
    ${chk('talkCache', '🧩 Kanal zum aktuellen Cache (GC/OC-Code): alle, die ihn als Ziel haben, sind dabei')}
    ${f('talkPw', '🔒 Team-Passwort (optional, eigener Kanal)', 'password')}
    <label class="f"><span>📍 Live-Position alle 30 s teilen</span><select data-k="talkLive"><option value="aus">aus</option><option value="team">nur im Team-Kanal</option><option value="cache+team">im Cache- und Team-Kanal</option></select></label>
    ${f('talkRelays', 'Relays (Leerzeichen getrennt)')}
    <h4>Meine Ausrüstung</h4>
    <p class="sub">Erkannt aus Attributen und aus Hint, Listing und KI-Suchhilfe. ❗ = ohne das geht es nicht, 🎒 = einpacken.</p>
    ${GEAR.map(g => chk('gear_' + g[0], `${g[1]} ${g[2]}${g[3] ? '' : ' <small>(hilfreich)</small>'}`)).join('')}
    ${ATTRS.filter(a => a[3] && !GEAR.some(g => g[0] === a[0])).map(a => chk('gear_' + a[0], a[1] + ' ' + a[2].replace(/ nötig$/, ''))).join('')}
    ${chk('skipGear', '„Gefunden & weiter“ überspringt Caches, für die Ausrüstung fehlt')}
    <h4>Routing (Valhalla)</h4>
    ${f('routeUrl', 'Routing-Adresse: ./api/route.php (über deinen Server) oder direkt https://…/ (Valhalla mit HTTPS)')}
    <label class="f"><span>Unterwegs</span><select data-k="routeCosting"><option value="pedestrian">zu Fuß</option><option value="bicycle">Fahrrad</option><option value="motor_scooter">Roller</option><option value="auto">Auto</option></select></label>
    ${f('lookahead', 'Markierung so weit voraus auf dem Weg (m)', 'number', 'min="10" max="80" step="5"')}
    <h4>Daten</h4>
    ${f('maxLogs', 'Logs pro Cache', 'number', 'min="5" max="200" step="5"')}
    <h4>KI-Auswertung</h4>
    <label class="f"><span>Weg</span><select data-k="kiMode"><option value="direkt">direkt mit eigenem Schlüssel</option><option value="skript">über ein eigenes KI-Skript (Server)</option></select></label>
    <div id="kiDirekt">
      <p class="sub">Jeder trägt seinen eigenen Schlüssel ein. Er bleibt nur auf diesem Handy und geht direkt an den Anbieter, kein Server dazwischen. Es reicht einer; mit mehreren springt die App beim Fehler (Limit, Ausfall) zum nächsten. 🆓 = mit kostenloser Stufe, 📷 = versteht Fotos (für Multi-Stationen).</p>
      ${KIA().map(a => `<div class="kiA" data-a="${a.id}"><div class="kiH"><b>${a.name}</b> ${a.frei ? '🆓' : ''}${a.vision ? '📷' : ''} <a href="${a.keyUrl}" target="_blank" rel="noopener">Schlüssel holen ↗</a></div>
        ${f('kiKey_' + a.id, 'Schlüssel', 'password', 'autocomplete="off" spellcheck="false"')}
        ${f('kiModel_' + a.id, 'Modell', 'text', `list="kiL_${a.id}" spellcheck="false" placeholder="${a.model ? '' : 'mit „Prüfen“ auswählen'}"`)}<datalist id="kiL_${a.id}"></datalist>
        <button class="kiP" data-a="${a.id}">Prüfen und Modelle laden</button> <small class="kiS"></small></div>`).join('')}
    </div>
    <div id="kiSkript">
      ${f('apiUrl', 'Adresse deines KI-Skripts (api/ki.php auf deinem Server)')}
      ${f('apiToken', 'Token (wie APP_TOKEN in config.php)', 'password')}
    </div>
    <h4>Opencaching (OKAPI)</h4>
    ${f('okapiKey', 'Consumer Key (opencaching.de/okapi/signup.html)')}
    ${f('ocUser', 'Dein OC-Benutzername (für „gefunden“)')}
    ${f('ocRadius', 'Umkreis (km)', 'number', 'min="0.5" max="50" step="0.5"')}
    ${chk('hideFound', 'Gefundene OC-Caches nicht laden')}
    <p class="sub">CacheVisier ${APP_VERSION}</p>`, b => {
    b.querySelectorAll('select[data-k]').forEach(el => { el.value = s[el.dataset.k]; });
    const kiWeg = () => { b.querySelector('#kiDirekt').hidden = s.kiMode === 'skript'; b.querySelector('#kiSkript').hidden = s.kiMode !== 'skript'; };
    kiWeg();
    b.querySelectorAll('.kiP').forEach(btn => {
      btn.onclick = () => run(async () => {
        const a = KIA().find(x => x.id === btn.dataset.a), st = btn.parentNode.querySelector('.kiS');
        const key = String(s['kiKey_' + a.id] || '').trim(); if (!key) return toast('Erst den Schlüssel eintragen');
        st.textContent = '… prüfe';
        try {
          const ids = await CVKI.models({ ...a, key });
          b.querySelector('#kiL_' + a.id).innerHTML = ids.slice(0, 300).map(i => `<option value="${esc(i)}">`).join('');
          const m = String(s['kiModel_' + a.id] || '').trim(), da = !m || ids.includes(m);
          if (!m && ids.length) { s['kiModel_' + a.id] = ids[0]; b.querySelector(`[data-k="kiModel_${a.id}"]`).value = ids[0]; saveSettings(); }
          st.textContent = `✅ Schlüssel gilt · ${ids.length} Modelle${da ? '' : ' · ⚠️ „' + m + '“ nicht in der Liste'}`;
        } catch (e) { st.textContent = '❌ ' + (e && e.message || e); }
      });
    });
    b.querySelectorAll('[data-k]').forEach(el => {
      el.onchange = () => {
        const k = el.dataset.k;
        s[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
        if (k === 'ocUser') s.ocUuid = '';
        saveSettings();
        if (k === 'sensor') toast('Kompass-Quelle gilt nach Neustart der App');
        if (k === 'mapDark') applyMapDark();
        if (k === 'night') applyNight();
        if (k === 'kiMode') kiWeg();
        if (/^talk(On|Pw|Cache|Relays)$/.test(k)) { clearTimeout(S.talkT); S.talkT = setTimeout(() => run(initTalk), 800); }
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

} // Ende Browser-Teil

/* Export für Tests in Node */
if (typeof module !== 'undefined') module.exports = {
  haversine, bearing, destPoint, wrap180, compassName, rot13, fmtDist, fmtCoord, colsFromEuler, colsFromQuat, orthonormal,
  vecHeading, vecElev, camVec, viewHeading, projectToScreen, normType, normSize, logTypeInfo, dnfStreak, lastFound,
  fieldNoteLine, utf16le, screenCols, screenRay, htmlText, sunElevation, mapAttr, toolAttrs, missingGear, textTools, toolsOf, planTour, GEAR_HARD, findBrightSpots, mergeSpots, colorName, trackSpots, averageFixes, annStepBelow, evalExpr, fillTemplate, parseCoord, resolvePoint, stationVarsDone, quersumme, decodePolyline, routeCum, routeLocate, routePointAt, sniffFormat, importCgeo, nearestOsm, toMs
};
