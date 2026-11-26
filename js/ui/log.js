import { FN_TYPES, fieldNoteLine, utf16le } from '../kern/caches.js';
import { esc, fmtDate } from '../kern/geo.js';
import { $, S, idbAll, idbByIndex, idbDel, idbGet, idbPut, openSheet, run, toast } from './basis.js';
import { openExternal } from './blaetter.js';
import { foundAndNext } from './tour.js';
import { curCache } from './ziel-routing.js';

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

export { showMyLog, shareFiles, exportFieldNotes };
