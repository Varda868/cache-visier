import { mapAttr } from './ausruestung.js';
import { haversine, htmlText, num, toMs } from './geo.js';

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

/* Ankunft in der Zielzone: D/T, Dosengröße und Stand der Logs auf einen Blick (Logs neueste zuerst) */
function arrivalInfo(c, now) {
  now = now || Date.now();
  const num = v => (v == null || v === '' ? '?' : String(v).replace('.', ','));
  const size = normSize(c.size);
  const logs = c.logs || [], l = logs[0] || null;
  let last = null;
  if (l) {
    const [typ, kind] = logTypeInfo(l.type), tage = l.date ? Math.max(0, Math.floor((now - l.date) / 86400000)) : null;
    last = { typ, kind, date: l.date || null, author: l.author || '', tage };
  }
  const streak = dnfStreak(logs), lf = lastFound(logs);
  const vor = d => (d == null ? '' : d === 0 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`);
  const groesse = { Nano: 'Nano', Micro: 'Mikro', Small: 'klein', Normal: 'normal', 'Groß': 'groß', 'Sehr groß': 'sehr groß', Virtuell: 'virtuell', 'Keine Dose': 'keine Dose' }[size] || size;
  const sprache = ['Zielzone.', `Schwierigkeit ${num(c.d)}, Gelände ${num(c.t)}.`, size ? `Dose ${groesse}.` : '',
    last ? `Letzter Log: ${last.typ}${last.tage != null ? ', ' + vor(last.tage) : ''}.` : 'Keine Logs gespeichert.',
    streak >= 2 ? `Achtung, ${streak} mal nicht gefunden in Folge.` : ''].filter(Boolean).join(' ');
  return { dt: `D${num(c.d)} / T${num(c.t)}`, size, last, vorText: last ? vor(last.tage) : '', streak, lastFound: lf, sprache };
}

/* Checker-Links aus dem Listing (HTML oder Text): bekannte Dienste mit Namen, Captcha-Hinweis und passendem Koordinatenformat */
const CHECKER = [
  [/(^|\.)geochecker\.com$/i, 'GeoChecker', false, 'kompakt'],
  [/(^|\.)geocheck\.org$/i, 'GeoCheck', true, 'normal'],
  [/(^|\.)certitudes?\.org$/i, 'Certitude', true, 'normal'],
  [/(^|\.)gc-apps\.com$/i, 'GC-Apps-Checker', false, 'normal'],
  [/(^|\.)gcc\.eu$|(^|\.)geocachingtoolbox\.com$/i, 'Checker', false, 'normal'],
];
function findCheckers(desc) {
  const out = [], seen = new Set();
  const urls = String(desc || '').match(/https?:\/\/[^\s"'<>)]+/gi) || [];
  for (let u of urls) {
    u = u.replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
    let host; try { host = new URL(u).hostname; } catch (e) { continue; }
    const k = CHECKER.find(c => c[0].test(host)) || (/check/i.test(host) ? [null, host.replace(/^www\./, ''), false, 'normal'] : null);
    if (!k || seen.has(u)) continue;
    seen.add(u); out.push({ name: k[1], url: u, captcha: k[2], format: k[3] });
  }
  return out.slice(0, 6);
}
/* Koordinate für den Checker: GeoChecker will „N48 22.123 E010 52.456“ (ohne Gradzeichen) */
function checkerCoord(lat, lon, format) {
  const f = (v, p, n, w) => { const h = v >= 0 ? p : n; v = Math.abs(v); let d = Math.floor(v), m = (v - d) * 60; if (m >= 59.9995) { d++; m = 0; }
    return format === 'kompakt' ? `${h}${String(d).padStart(w, '0')} ${m.toFixed(3).padStart(6, '0')}` : `${h} ${String(d).padStart(w, '0')}° ${m.toFixed(3).padStart(6, '0')}`; };
  return `${f(lat, 'N', 'S', 2)} ${f(lon, 'E', 'W', 3)}`;
}

export { TYPE_INFO, normType, normSize, LOGTYPES, logTypeInfo, dnfStreak, lastFound, FN_TYPES, fieldNoteLine, utf16le, sniffFormat, importCgeo, nearestOsm, arrivalInfo, findCheckers, checkerCoord };
