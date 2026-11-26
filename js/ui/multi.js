import { TYPE_INFO } from '../kern/caches.js';
import { resolvePoint, stationVarsDone } from '../kern/formeln.js';
import { esc, fmtCoord, fmtDate, fmtDist, haversine, htmlText } from '../kern/geo.js';
import { start } from '../main.js';
import { $, S, flash, idbGet, idbPut, openSheet, run, toast } from './basis.js';
import { grabFrame, savePhoto, shrinkImage, startCamera } from './kamera.js';
import { kiCall, kiZiel } from './ki-auswertung.js';
import { curCache, setTarget } from './ziel-routing.js';

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

export { multiKey, getMulti, saveMulti, listingBase, multiState, aiMulti, stationFoto, pickImage, renderStage, showMulti, showFotoFrage };
