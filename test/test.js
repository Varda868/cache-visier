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

t('HTML aus Logs in Text', () => {
  assert.strictEqual(A.htmlText('<p>Vielen Dank an <strong>SteinernerMann</strong>.</p> <p>TFTC #47853<br />Radler!</p>'), 'Vielen Dank an SteinernerMann.\nTFTC #47853\nRadler!');
  assert.strictEqual(A.htmlText('Gr&uuml;&szlig;e &amp; &#8222;Dose&#x201C; <img src="x.gif" alt=":-)">'), 'Grüße & „Dose“ :-)');
  assert.strictEqual(A.htmlText('3 < 5 und 7 > 2'), '3 < 5 und 7 > 2');
  assert.strictEqual(A.htmlText('<ul><li>eins</li><li>zwei</li></ul>'), '• eins\n• zwei');
});

t('Sonnenhöhe Augsburg', () => {
  near(A.sunElevation(48.37, 10.89, new Date(Date.UTC(2026, 5, 21, 11, 16))), 65.1, 1.0);   // Mittag Sommeranfang
  near(A.sunElevation(48.37, 10.89, new Date(Date.UTC(2026, 11, 21, 11, 15))), 18.2, 1.0);  // Mittag Winteranfang
  assert.ok(A.sunElevation(48.37, 10.89, new Date(Date.UTC(2026, 10, 25, 20, 0))) < -30);   // Novemberabend
});

t('Reflektoren finden, große Lichtflächen ignorieren', () => {
  const w = 120, h = 90, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[4 * i] = 20 + (i % 7); px[4 * i + 1] = 22; px[4 * i + 2] = 25; px[4 * i + 3] = 255; }
  const put = (x0, y0, s, r, g, b) => { for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const i = y * w + x; px[4 * i] = r; px[4 * i + 1] = g; px[4 * i + 2] = b; } };
  put(30, 20, 3, 255, 255, 250);      // weißer Reflektor
  put(80, 60, 2, 255, 230, 220);      // rötlich-heller Reflektor
  put(5, 50, 25, 255, 255, 255);      // Laterne / helle Fläche (zu groß)
  const sp = A.findBrightSpots(px, w, h);
  assert.strictEqual(sp.length, 2);
  near(sp.find(p => p.x < 50).x, 31, 0.01); near(sp.find(p => p.x < 50).y, 21, 0.01);
  assert.strictEqual(A.colorName([255, 255, 250]), 'weiß'); assert.strictEqual(A.colorName([230, 40, 30]), 'rot'); assert.strictEqual(A.colorName([40, 220, 60]), 'grün');
});
t('Ansage-Stufen', () => {
  assert.strictEqual(A.annStepBelow(730), 500); assert.strictEqual(A.annStepBelow(100), 50); assert.strictEqual(A.annStepBelow(9), null); assert.strictEqual(A.annStepBelow(5000), 2000);
});

t('Attribute zuordnen', () => {
  const f = A.mapAttr('flashlight_yes'); assert.strictEqual(f.key, 'flashlight'); assert.ok(f.tool && f.yes);
  assert.strictEqual(A.mapAttr('treeclimbing_yes').key, 'tree_climbing');
  assert.strictEqual(A.mapAttr('rappelling_yes').key, 'climbing_gear');
  assert.strictEqual(A.mapAttr('climbing_yes').key, 'climbing');
  assert.strictEqual(A.mapAttr('nightcache_yes').key, 'night'); assert.strictEqual(A.mapAttr('night_yes').key, 'night_rec');
  const d = A.mapAttr('dogs_no'); assert.strictEqual(d.key, 'dogs'); assert.ok(!d.yes); assert.ok(d.label.startsWith('nicht'));
  assert.strictEqual(A.mapAttr('', 51, 1).key, 'special_tool'); assert.ok(!A.mapAttr('', 51, 0).tool);
  assert.strictEqual(A.mapAttr('UV-Lampe erforderlich').key, 'uv'); assert.strictEqual(A.mapAttr('Hunde nicht erlaubt').yes, false);
  const c = { attrs: [A.mapAttr('flashlight_yes'), A.mapAttr('boat_yes'), A.mapAttr('parking_yes')] };
  assert.deepStrictEqual(A.toolAttrs(c).map(a => a.key), ['flashlight', 'boat']);
  assert.deepStrictEqual(A.missingGear(c, { gear_flashlight: true, gear_boat: false }).map(a => a.key), ['boat']);
});

// Multi: Formeln und Koordinaten
t('Ausdrücke rechnen', () => {
  assert.strictEqual(A.evalExpr('A*2+B', { A: 3, B: '4' }).value, 10);
  assert.strictEqual(A.evalExpr('(a+1)*(b-1)', { A: 2, B: 5 }).value, 12);
  assert.strictEqual(A.evalExpr('QS(1987)', {}).value, 25);
  assert.strictEqual(A.evalExpr('IQS(1987)', {}).value, 7);
  assert.strictEqual(A.evalExpr('2^3%5', {}).value, 3);
  assert.deepStrictEqual(A.evalExpr('A+C', { A: 1 }).missing, ['C']);
  assert.throws(() => A.evalExpr('A+*', { A: 1 }));
  assert.throws(() => A.evalExpr('alert(1)', {}));
});
t('Koordinaten-Vorlage füllen und lesen', () => {
  const f = A.fillTemplate('N 48° 2{A+1}.{B*C} E 010° 5{D}.{E}{F}0', { A: 1, B: 12, C: 10, D: 3, E: 4, F: 5 });
  assert.ok(f.ok); assert.strictEqual(f.text, 'N 48° 22.120 E 010° 53.450');
  const p = A.parseCoord(f.text); near(p.lat, 48 + 22.12 / 60, 1e-9); near(p.lon, 10 + 53.45 / 60, 1e-9);
  const g = A.fillTemplate('N 48° 22.{A}{B}{C}', { A: 1 }); assert.ok(!g.ok); assert.deepStrictEqual(g.missing.sort(), ['B', 'C']); assert.strictEqual(g.text, 'N 48° 22.1??');
  near(A.parseCoord('N48 22.120 O10 53.450').lon, 10 + 53.45 / 60, 1e-9);
  near(A.parseCoord('48.36867, 10.89083').lat, 48.36867, 1e-9);
  assert.strictEqual(A.parseCoord('N 48° 62.000 E 010° 53.000'), null);
});
t('Stationen auflösen inkl. Peilung', () => {
  const base = { lat: 48.37, lon: 10.89 }, pts = {};
  const s1 = A.resolvePoint({ art: 'listing' }, {}, base, pts); pts['1'] = s1; near(s1.lat, 48.37, 1e-12);
  const s2 = A.resolvePoint({ art: 'projektion', von: '1', distanz: 'A*10', winkel: '90' }, { A: 15 }, base, pts);
  near(A.haversine(48.37, 10.89, s2.lat, s2.lon), 150, 0.05); near(A.bearing(48.37, 10.89, s2.lat, s2.lon), 90, 0.01);
  const s3 = A.resolvePoint({ art: 'formel', vorlage: 'N 48° 22.{A}00 E 010° 53.{B}00' }, { A: 3 }, base, pts);
  assert.deepStrictEqual(s3.missing, ['B']); assert.strictEqual(s3.lat, undefined);
  assert.ok(A.stationVarsDone({ variablen: [{ name: 'A' }] }, { A: '0' })); assert.ok(!A.stationVarsDone({ variablen: [{ name: 'A' }] }, { A: ' ' }));
});

// c:geo-Datenbank nachbauen
let sqlite; try { sqlite = require('node:sqlite'); } catch (e) { sqlite = null; }
if (sqlite) t('c:geo-Backup einlesen (nachgebaute Tabellen)', () => {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(`CREATE TABLE cg_caches(_id INTEGER PRIMARY KEY, updated LONG, detailed INTEGER, geocode TEXT UNIQUE, name TEXT, type TEXT, latitude DOUBLE, longitude DOUBLE,
      difficulty FLOAT, terrain FLOAT, size TEXT, hint TEXT, owner TEXT, found INTEGER, disabled INTEGER, archived INTEGER, personal_note TEXT, coordsChanged INTEGER, shortdesc TEXT, description TEXT);
    CREATE TABLE cg_logs(_id INTEGER PRIMARY KEY, geocode TEXT, updated LONG, service_log_id TEXT, type INTEGER, author TEXT, log TEXT, date LONG, found INTEGER, friend INTEGER);
    CREATE TABLE cg_attributes(_id INTEGER PRIMARY KEY, geocode TEXT, updated LONG, attribute TEXT);
    INSERT INTO cg_attributes(geocode, attribute) VALUES('GC7FAX4','flashlight_yes'),('GC7FAX4','s-tool_yes'),('GC7FAX4','dogs_yes');
    CREATE TABLE cg_waypoints(_id INTEGER PRIMARY KEY, geocode TEXT, updated LONG, type TEXT, prefix TEXT, lookup TEXT, name TEXT, latitude DOUBLE, longitude DOUBLE, note TEXT, own INTEGER);
    INSERT INTO cg_caches(geocode,name,type,latitude,longitude,difficulty,terrain,size,hint,owner,found,disabled,archived,personal_note,coordsChanged)
      VALUES('GC7FAX4','Testmulti','multi',48.3655,10.8712,2.5,1.5,'SMALL','Unter der Bank','Owner',0,0,0,'Notiz',1),
            ('GC12345','Ohne Koord','traditional',NULL,NULL,1,1,'MICRO','',' ',0,0,0,'',0);
    UPDATE cg_caches SET shortdesc='Kurz', description='<p>Station 1: Zähle die Latten = A</p>' WHERE geocode='GC7FAX4';
    INSERT INTO cg_logs(geocode,type,author,log,date) VALUES('GC7FAX4',2,'A','alt gefunden',1700000000000),('GC7FAX4',3,'B','nicht gefunden',1760000000000),('GC7FAX4',2,'C','gefunden',1750000000000);
    INSERT INTO cg_waypoints(geocode,type,prefix,name,latitude,longitude,note) VALUES('GC7FAX4','stage','S1','Station 1',48.366,10.872,'Zahl am Schild'),('GC7FAX4','final','FN','Final',NULL,NULL,''),('GC7FAX4','original','OR','Original',48.3650,10.8700,'');`);
  const exec = sql => { const st = db.prepare(sql); const cols = st.columns().map(c => c.name); const rows = st.all(); return rows.length || cols.length ? [{ columns: cols, values: rows.map(r => cols.map(c => r[c])) }] : []; };
  const list = A.importCgeo(exec, 40);
  assert.strictEqual(list.length, 1);
  const c = list[0];
  assert.strictEqual(c.type, 'multi'); assert.strictEqual(c.size, 'Small'); assert.strictEqual(c.d, 2.5); assert.ok(c.corrected);
  assert.strictEqual(c.logs.length, 3); assert.strictEqual(c.logs[0].author, 'B'); assert.strictEqual(A.dnfStreak(c.logs), 1);
  assert.strictEqual(c.wpts.length, 2); assert.strictEqual(c.wpts[0].prefix, 'S1'); assert.strictEqual(c.wpts[1].lat, null); // Final ohne Koordinaten bleibt
  near(c.orig.lat, 48.3650, 1e-9); assert.ok(c.desc.includes('Zähle die Latten'));
  assert.deepStrictEqual(A.toolAttrs(c).map(a => a.key), ['flashlight', 'special_tool']); assert.strictEqual(c.attrs.length, 3);
});
else console.log('– node:sqlite fehlt, c:geo-Test übersprungen');

console.log(`\n${n} Tests bestanden`);
