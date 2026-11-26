/* CacheVisier · ui/basis: Zustand S, Voreinstellungen, IndexedDB, Blätter, Toast, Laden/Speichern */
import { keepAwake } from './kamera.js';
import { autoZoom, drawCacheMarkers } from './karte.js';
import { renderTop } from './ziel-routing.js';

const $ = s => document.querySelector(s);
const KIA = () => (window.CVKI ? CVKI.ANBIETER : []);
function kiDefaults() { const o = {}; for (const a of KIA()) { o['kiKey_' + a.id] = ''; o['kiModel_' + a.id] = a.model; } return o; }
const DEFAULTS = {
  fovH: 50, phoneH: 1.4, compassOffset: 0, sensor: 'auto', autoMode: true, maxLogs: 40,
  kiMode: 'direkt', ...kiDefaults(), apiUrl: '', apiToken: '', okapiKey: '', ocUser: '', ocUuid: '', ocRadius: 3, hideFound: true,
  keepAwake: true, camSave: true, zonenAR: true, smoothing: 0.25, mapDark: 'on', autoZoom: true,
  night: false, speak: true, vibrate: true, stepLen: 0.75, declination: 4, skipGear: true,
  talkOn: false, talkName: '', talkPw: '', talkCache: true, talkLive: 'aus', talkRelays: 'wss://nos.lol wss://relay.primal.net wss://nostr.mom',
  gear_flashlight: true, gear_uv: false, gear_pen: true, gear_tweezers: true, gear_magnet: false, gear_mirror: false, gear_gloves: true,
  gear_special_tool: false, gear_water: false, gear_measure: false, gear_ladder: false, gear_pole: false, gear_wading: false,
  gear_tree_climbing: false, gear_climbing_gear: false, gear_climbing: false, gear_boat: false, gear_scuba: false, gear_swimming: false,
  tourRadius: 2000, tourLoop: false, setupDone: false,
  routing: false, routeCosting: 'pedestrian', lookahead: 25
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

export { $, KIA, kiDefaults, DEFAULTS, S, _db, idb, tx, idbGet, idbPut, idbDel, idbAll, idbByIndex, idbReplaceAll, toastTimer, toast, flash, saveSettings, openSheet, closeSheet, run, loadAll, replaceSource, mergeCaches, afterDataChange };
