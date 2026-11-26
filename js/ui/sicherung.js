/* CacheVisier · ui/sicherung: Sicherung als Datei speichern/teilen und wieder laden */
import { esc, fmtDate } from '../kern/geo.js';
import { istGeheim, neueLogs, pruefeSicherung, settingsFuerSicherung, settingsZusammen } from '../kern/sicherung.js';
import { $, S, idb, idbAll, idbGet, idbPut, openSheet, run, saveSettings, toast } from './basis.js';

const metaAlle = async () => { const d = await idb(); return new Promise((res, rej) => {
  const out = [], t = d.transaction('meta', 'readonly'), r = t.objectStore('meta').openCursor();
  r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
  t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
}); };
const blobZuUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
const urlZuBlob = u => fetch(u).then(r => r.blob());
const mb = n => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 1048576 * 10 ? 1 : 0).replace('.', ',') + ' MB');

async function baueSicherung(o) {
  const meta = [];
  for (const [k, v] of await metaAlle()) {
    if (k === 'dir') continue;                                   // Ordnerzugriff gilt nur auf diesem Gerät
    if (k === 'settings') { meta.push([k, settingsFuerSicherung(v, o.schluessel)]); continue; }
    if (k === 'nostrSk' && !o.schluessel) continue;              // b:con-Schlüssel ist eine Identität
    if (/^multi:|^tour$|^target$|^talklog$/.test(k) && !o.stand) continue;
    meta.push([k, v]);
  }
  const d = { app: 'CacheVisier', format: 1, erstellt: new Date().toISOString(), meta };
  if (o.stand) d.ai = await idbAll('ai');
  if (o.logs) {
    d.mylogs = await idbAll('mylogs');
    d.photos = [];
    for (const p of await idbAll('photos')) { const { blob, ...rest } = p; d.photos.push({ ...rest, data: blob ? await blobZuUrl(blob) : null }); }
  }
  if (o.caches) d.caches = await idbAll('caches');
  return d;
}

async function spieleEin(d) {
  const x = pruefeSicherung(d); let n = { logs: 0, fotos: 0, ai: 0, caches: 0, meta: 0 };
  for (const [k, v] of x.meta) {
    if (k === 'settings') { S.set = settingsZusammen(S.set, v); saveSettings(); n.meta++; continue; }
    await idbPut('meta', v, k); n.meta++;
  }
  for (const a of x.ai) { await idbPut('ai', a); n.ai++; }
  for (const c of x.caches) { await idbPut('caches', c); n.caches++; }
  // Fotos neu anlegen und Nummern umschreiben, damit die Logs ihre Fotos behalten
  const neu = new Map(), vorhanden = await idbAll('mylogs'), logs = neueLogs(vorhanden, x.mylogs);
  const fotosDa = new Map((await idbAll('photos')).map(p => [`${p.geocode}|${p.ts}`, p.id]));
  for (const p of x.photos) {
    const { id, data, ...rest } = p;
    const da = fotosDa.get(`${rest.geocode}|${rest.ts}`);
    if (da != null) { neu.set(id, da); continue; }               // dasselbe Foto gibt es schon
    if (!data) continue;
    const nid = await idbPut('photos', { ...rest, blob: await urlZuBlob(data) }); neu.set(id, nid); n.fotos++;
  }
  for (const l of logs) { const { id, ...rest } = l; await idbPut('mylogs', { ...rest, photoIds: (l.photoIds || []).map(i => neu.get(i)).filter(i => i != null) }); n.logs++; }
  return n;
}

async function showSicherung() {
  const [logs, fotos, ai, metas] = await Promise.all([idbAll('mylogs'), idbAll('photos'), idbAll('ai'), metaAlle()]);
  const multis = metas.filter(([k]) => /^multi:/.test(k)).length, fotoBytes = fotos.reduce((s, p) => s + ((p.blob && p.blob.size) || 0), 0);
  const geheim = Object.keys(S.set).filter(k => istGeheim(k) && S.set[k]).length;
  const cacheBytes = S.caches.size * 6000; // grob: Listing, Logs, Wegpunkte
  openSheet('💾 Sicherung', `
    <p class="sub">Speichert die App-Daten als Datei, z. B. für ein neues Handy oder nach dem Neuinstallieren.</p>
    <label class="f c"><input type="checkbox" checked disabled><span>⚙️ Einstellungen (ohne Schlüssel)</span></label>
    <label class="f c"><input type="checkbox" id="bLogs" checked><span>✍️ Eigene Logs und Fotos (${logs.length} Logs, ${fotos.length} Fotos, ${mb(fotoBytes)})</span></label>
    <label class="f c"><input type="checkbox" id="bStand" checked><span>🧩 Multi-Stände, Tour, KI-Auswertungen (${multis} Multis, ${ai.length} Auswertungen)</span></label>
    <label class="f c"><input type="checkbox" id="bKeys"><span>🔑 Schlüssel mitsichern (${geheim} eingetragen: KI, Opencaching, Team-Passwort, b:con-Kennung)</span></label>
    <label class="f c"><input type="checkbox" id="bCaches"><span>📦 Caches (${S.caches.size}, etwa ${mb(cacheBytes)}) – lassen sich auch neu aus c:geo laden</span></label>
    <p class="sub warn" id="bWarn" hidden>Mit Schlüsseln: Datei gut aufbewahren und nicht weitergeben.</p>
    <div class="tools"><button id="bSave">💾 Als Datei speichern</button>${navigator.canShare ? '<button id="bShare">📤 Teilen</button>' : ''}</div>
    <h4>Zurückholen</h4>
    <div class="tools"><button id="bLoad">📥 Sicherung laden</button></div>
    <p class="sub">Vorhandenes bleibt: Logs werden ergänzt (ohne Doppelte), gleiche Caches und Einstellungen überschrieben. Schlüssel nur, wenn sie in der Datei stehen.</p>`, b => {
    const opts = () => ({ logs: b.querySelector('#bLogs').checked, stand: b.querySelector('#bStand').checked, schluessel: b.querySelector('#bKeys').checked, caches: b.querySelector('#bCaches').checked });
    b.querySelector('#bKeys').onchange = e => { b.querySelector('#bWarn').hidden = !e.target.checked; };
    const datei = async () => {
      toast('⏳ Sicherung wird gebaut …', 20000);
      const d = await baueSicherung(opts()), txt = JSON.stringify(d);
      return new File([txt], `cachevisier-sicherung-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    };
    b.querySelector('#bSave').onclick = () => run(async () => {
      const f = await datei(), u = URL.createObjectURL(f), a = document.createElement('a');
      a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000);
      toast(`✅ ${f.name} (${mb(f.size)}) – liegt unter „Downloads“`, 6000);
    });
    const sh = b.querySelector('#bShare');
    if (sh) sh.onclick = () => run(async () => {
      const f = await datei();
      if (!navigator.canShare({ files: [f] })) throw new Error('Teilen von Dateien geht hier nicht – „Als Datei speichern“ nehmen');
      await navigator.share({ files: [f], title: 'CacheVisier-Sicherung' }); toast('📤 geteilt');
    });
    b.querySelector('#bLoad').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => run(async () => {
        const f = inp.files[0]; if (!f) return;
        let d; try { d = JSON.parse(await f.text()); } catch (e) { throw new Error('Datei nicht lesbar (keine JSON-Datei)'); }
        const x = pruefeSicherung(d);
        if (!confirm(`Sicherung vom ${fmtDate(Date.parse(d.erstellt))} laden?\n${x.mylogs.length} Logs, ${x.photos.length} Fotos, ${x.caches.length} Caches, ${x.ai.length} KI-Auswertungen.`)) return;
        const n = await spieleEin(d);
        toast(`✅ geladen: ${n.logs} Logs, ${n.fotos} Fotos, ${n.caches} Caches, ${n.ai} Auswertungen – App startet neu`, 4000);
        setTimeout(() => location.reload(), 2500);
      });
      inp.click();
    };
  });
}
window.CVB = { baueSicherung, spieleEin }; // für Tests
export { showSicherung, baueSicherung, spieleEin };
