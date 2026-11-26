import { mapAttr } from '../kern/ausruestung.js';
import { importCgeo, normSize, normType, sniffFormat } from '../kern/caches.js';
import { htmlText, num, toMs } from '../kern/geo.js';
import { S, closeSheet, idbPut, mergeCaches, replaceSource, run, saveSettings, toast } from './basis.js';

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
  const key = String(S.set.okapiKey || '').replace(/\s+/g, '');
  if (!key) throw new Error('OKAPI-Schlüssel fehlt (☰ → ⚙️ → Opencaching)');
  const u = new URL('https://www.opencaching.de/okapi/services/' + method);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('consumer_key', key);
  let r;
  try { r = await fetch(u); } catch (e) { throw new Error('Opencaching nicht erreichbar (Netz?)'); }
  if (!r.ok) {
    const t = await r.text(); let m = t.slice(0, 160);
    try { m = JSON.parse(t).error.developer_message || m; } catch (e) { /* Text lassen */ }
    if (/consumer_key|Consumer does not exist/i.test(m)) throw new Error('OKAPI-Schlüssel wird nicht angenommen. Den „Consumer Key“ von opencaching.de/okapi/signup.html eintragen, nicht das „Consumer Secret“ (Schlüssel von opencaching.pl/.nl/.us gelten hier nicht).');
    if (/username/i.test(m) && method.startsWith('users/')) throw new Error('OC-Benutzername nicht gefunden: ' + S.set.ocUser);
    throw new Error('OKAPI ' + r.status + ': ' + m);
  }
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
    // found_status geht nur mit OAuth-Zugang (Level 3); not_found_by mit der Benutzer-ID reicht der einfache Schlüssel (Level 1)
    not_found_by: uuid && S.set.hideFound ? uuid : ''
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
    for (const c of Object.values(g)) if (c && !(S.set.hideFound && c.is_found)) out.push(mapOkapi(c));
  }
  await mergeCaches(out);
  toast(`✅ ${out.length} Opencaching-Caches geladen`);
}

export { _sql, loadScript, loadSqlJs, importSqliteBuf, parseGpx, importFileObj, pickFile, connectFolder, findDbFiles, loadNewestBackup, checkShareInbox, okapi, stripHtml, mapOkapi, loadOcNearby };
