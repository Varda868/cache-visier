'use strict';
const assert = require('assert');
const A = require('../app.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≉ ${b}`);

t('fmtCoord', () => assert.strictEqual(A.fmtCoord(48.34995, 10.93705), 'N 48° 20.997 E 010° 56.223'));
t('fmtCoord Rundung 59.9995', () => assert.strictEqual(A.fmtCoord(48 + 59.99996 / 60, 10.5), 'N 49° 00.000 E 010° 30.000'));
t('haversine 1 Bogenminute Breite ≈ 1853 m', () => near(A.haversine(48, 10, 48 + 1 / 60, 10), 1853.2, 1));
t('bearing Nord/Ost', () => { near(A.bearing(48, 10, 48.01, 10), 0, 1e-6); near(A.bearing(48, 10, 48, 10.01), 90, 0.01); });
t('destPoint rückwärts', () => { const p = A.destPoint(48.37, 10.89, 250, 33); near(A.haversine(48.37, 10.89, p.lat, p.lon), 250, 0.01); near(A.bearing(48.37, 10.89, p.lat, p.lon), 33, 0.01); });
t('rot13', () => assert.strictEqual(A.rot13('Hagre qre Onax'), 'Unter der Bank'));
t('fmtDist', () => { assert.strictEqual(A.fmtDist(8.4), '8 m'); assert.strictEqual(A.fmtDist(1234), '1,23 km'); });

// Lage: senkrecht nach Norden (beta 90)
t('Euler: senkrecht nach Norden → Kamera Nord, waagerecht', () => {
  const c = A.colsFromEuler(0, 90, 0), v = A.camVec(c);
  near(v[0], 0); near(v[1], 1); near(v[2], 0); near(A.viewHeading(c), 0);
});
t('Euler: alpha 270 → Osten', () => near(A.viewHeading(A.colsFromEuler(270, 90, 0)), 90, 1e-6));
t('Euler: flach liegend → Oberkante zählt', () => { const c = A.colsFromEuler(300, 0, 0); near(A.vecElev(A.camVec(c)), -90, 1e-6); near(A.viewHeading(c), 60, 1e-6); });

// Quaternion aus Euler (Z-X-Y) muss dieselbe Matrix ergeben
function qmul(a, b) { const [x1, y1, z1, w1] = a, [x2, y2, z2, w2] = b; return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2]; }
const D = Math.PI / 180;
function q(axis, deg) { const h = deg * D / 2, s = Math.sin(h); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]; }
t('Quaternion = Euler (50 Zufallslagen)', () => {
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * 360, b = Math.random() * 360 - 180, g = Math.random() * 180 - 90;
    const qq = qmul(qmul(q([0, 0, 1], a), q([1, 0, 0], b)), q([0, 1, 0], g));
    const E = A.colsFromEuler(a, b, g), Q = A.colsFromQuat(qq);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) near(E[r][k], Q[r][k], 1e-9);
  }
});
t('Projektion: Ziel geradeaus → Bildmitte, rechts → rechts', () => {
  const c = A.colsFromEuler(0, 90, 0);
  const p = A.projectToScreen(c, [0, 50, 0], 50, 400, 800); near(p.x, 200); near(p.y, 400); assert.ok(p.inView);
  const r = A.projectToScreen(c, [10, 50, 0], 50, 400, 800); assert.ok(r.x > 200 && r.inView);
  const b = A.projectToScreen(c, [0, -50, 0], 50, 400, 800); assert.ok(b.behind); near(Math.abs(b.dirDeg), 180, 1e-6);
  const u = A.projectToScreen(c, [0, 50, -1.4], 50, 400, 800); assert.ok(u.y > 400); // Boden liegt tiefer
});
t('Projektion: Rand-Pfeil zeigt nach rechts für Ziel im Osten', () => near(A.projectToScreen(A.colsFromEuler(0, 90, 0), [50, 0, 0], 50, 400, 800).dirDeg, 90, 1e-6));
t('Bildschirmdrehung 90°', () => {
  const c = A.colsFromEuler(0, 90, 0), s = A.screenCols(c, 90);
  near(s[0][2], -1, 1e-9); // Bildschirm-rechts zeigt nach unten? (Gerät-oben zeigt nach links → rechts = -oben)
});

t('Typen und Logtypen', () => {
  assert.strictEqual(A.normType('mystery'), 'mystery'); assert.strictEqual(A.normType('Unknown Cache'), 'mystery');
  assert.strictEqual(A.normType('Traditional Cache'), 'tradi'); assert.strictEqual(A.normType('Multi'), 'multi');
  assert.strictEqual(A.logTypeInfo(3)[1], 'dnf'); assert.strictEqual(A.logTypeInfo("Didn't find it")[1], 'dnf');
  assert.strictEqual(A.logTypeInfo('Found it')[1], 'found'); assert.strictEqual(A.logTypeInfo(45)[1], 'maint');
});
t('DNF-Serie', () => assert.strictEqual(A.dnfStreak([{ type: 3 }, { type: 4 }, { type: 3 }, { type: 2 }, { type: 3 }]), 2));
t('Feldnotiz', () => {
  const l = A.fieldNoteLine({ geocode: 'GC7GD1K', ts: Date.UTC(2026, 10, 25, 16, 20), type: 'found', text: 'TFTC "super"\nDanke' });
  assert.strictEqual(l, 'GC7GD1K,2026-11-25T16:20Z,Found it,"TFTC ""super"" Danke"');
  const b = A.utf16le('Aä'); assert.deepStrictEqual([...b], [0xFF, 0xFE, 0x41, 0, 0xE4, 0]);
});
t('Formaterkennung', () => {
  assert.strictEqual(A.sniffFormat(Buffer.from('SQLite format 3\0xxxx')), 'sqlite');
  assert.strictEqual(A.sniffFormat(Buffer.from('<?xml version="1.0"?><gpx version="1.0">')), 'gpx');
});
t('nächstes OSM-Objekt (Knoten und Weg)', () => {
  const els = [
    { type: 'node', id: 1, lat: 48.3701, lon: 10.8901, tags: { highway: 'bus_stop', name: 'Pfersee Nord' } },
    { type: 'node', id: 2, lat: 48.3800, lon: 10.8900, tags: { highway: 'bus_stop' } },
    { type: 'node', id: 3, lat: 48.3700, lon: 10.8902 }, { type: 'node', id: 4, lat: 48.3702, lon: 10.8902 },
    { type: 'way', id: 9, nodes: [3, 4], tags: { man_made: 'bridge' } }
  ];
  const b = A.nearestOsm(els, 'highway', 'bus_stop', 48.37, 10.89); assert.strictEqual(b.name, 'Pfersee Nord'); assert.ok(b.dist < 15);
  const w = A.nearestOsm(els, 'man_made', '*', 48.37, 10.89); near(w.lat, 48.3701, 1e-9);
  assert.strictEqual(A.nearestOsm(els, 'amenity', 'bench', 48.37, 10.89), null);
});

// Route: Polyline6 kodieren/dekodieren, Position auf der Route
function enc(pts) { let out = '', pl = 0, po = 0; const e = v => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); e(a - pl); e(b - po); pl = a; po = b; } return out; }
t('Polyline6 hin und zurück', () => {
  const pts = [[48.370012, 10.870034], [48.369987, 10.871234], [48.371111, 10.871222], [-33.9, -70.6]];
  const d = A.decodePolyline(enc(pts)); assert.strictEqual(d.length, 4); d.forEach((p, i) => { near(p[0], pts[i][0], 1e-9); near(p[1], pts[i][1], 1e-9); });
});
t('Route: Position, Abstand, Punkt voraus', () => {
  const pts = [[48.3700, 10.8700], [48.3700, 10.8712], [48.3711, 10.8712]], cum = A.routeCum(pts);
  near(cum[1], A.haversine(48.37, 10.87, 48.37, 10.8712), 1e-9);
  const m = A.routeLocate(pts, cum, 48.37005, 10.8706); // knapp nördlich vom ersten Segment, in der Mitte
  assert.strictEqual(m.i, 0); near(m.off, 5.56, 0.05); near(m.along, cum[1] / 2, 0.5);
  const q = A.routePointAt(pts, cum, cum[1] + 50); near(q[1], 10.8712, 1e-9); assert.ok(q[0] > 48.3700 && q[0] < 48.3711);
  assert.deepStrictEqual(A.routePointAt(pts, cum, 1e9), pts[2]); assert.deepStrictEqual(A.routePointAt(pts, cum, -5), pts[0]);
});

// c:geo-Datenbank nachbauen
let sqlite; try { sqlite = require('node:sqlite'); } catch (e) { sqlite = null; }
if (sqlite) t('c:geo-Backup einlesen (nachgebaute Tabellen)', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE cg_caches(_id INTEGER PRIMARY KEY, updated LONG, detailed INTEGER, geocode TEXT UNIQUE, name TEXT, type TEXT, latitude DOUBLE, longitude DOUBLE,
      difficulty FLOAT, terrain FLOAT, size TEXT, hint TEXT, owner TEXT, found INTEGER, disabled INTEGER, archived INTEGER, personal_note TEXT, coordsChanged INTEGER);
    CREATE TABLE cg_logs(_id INTEGER PRIMARY KEY, geocode TEXT, updated LONG, service_log_id TEXT, type INTEGER, author TEXT, log TEXT, date LONG, found INTEGER, friend INTEGER);
    CREATE TABLE cg_waypoints(_id INTEGER PRIMARY KEY, geocode TEXT, updated LONG, type TEXT, prefix TEXT, lookup TEXT, name TEXT, latitude DOUBLE, longitude DOUBLE, note TEXT, own INTEGER);
    INSERT INTO cg_caches(geocode,name,type,latitude,longitude,difficulty,terrain,size,hint,owner,found,disabled,archived,personal_note,coordsChanged)
      VALUES('GC7FAX4','Testmulti','multi',48.3655,10.8712,2.5,1.5,'SMALL','Unter der Bank','Owner',0,0,0,'Notiz',1),
            ('GC12345','Ohne Koord','traditional',NULL,NULL,1,1,'MICRO','',' ',0,0,0,'',0);
    INSERT INTO cg_logs(geocode,type,author,log,date) VALUES('GC7FAX4',2,'A','alt gefunden',1700000000000),('GC7FAX4',3,'B','nicht gefunden',1760000000000),('GC7FAX4',2,'C','gefunden',1750000000000);
    INSERT INTO cg_waypoints(geocode,type,prefix,name,latitude,longitude,note) VALUES('GC7FAX4','stage','S1','Station 1',48.366,10.872,'Zahl am Schild'),('GC7FAX4','final','FN','Final',NULL,NULL,'');`);
  const exec = sql => { const st = db.prepare(sql); const cols = st.columns().map(c => c.name); const rows = st.all(); return rows.length || cols.length ? [{ columns: cols, values: rows.map(r => cols.map(c => r[c])) }] : []; };
  const list = A.importCgeo(exec, 40);
  assert.strictEqual(list.length, 1);
  const c = list[0];
  assert.strictEqual(c.type, 'multi'); assert.strictEqual(c.size, 'Small'); assert.strictEqual(c.d, 2.5); assert.ok(c.corrected);
  assert.strictEqual(c.logs.length, 3); assert.strictEqual(c.logs[0].author, 'B'); assert.strictEqual(A.dnfStreak(c.logs), 1);
  assert.strictEqual(c.wpts.length, 1); assert.strictEqual(c.wpts[0].prefix, 'S1');
});
else console.log('– node:sqlite fehlt, c:geo-Test übersprungen');

console.log(`\n${n} Tests bestanden`);
