import { ATTRS, GEAR } from '../kern/ausruestung.js';
import { APP_VERSION, camVec, esc, fmtDate, vecElev, viewHeading } from '../kern/geo.js';
import { KIA, S, openSheet, run, saveSettings, toast } from './basis.js';
import { connectFolder, findDbFiles } from './import.js';
import { applyMapDark } from './karte.js';
import { applyNight } from './nacht.js';
import { initTalk } from './talk.js';

/* ---------- Einstellungen + Diagnose ---------- */
/* Einstellungen: <h4>-Abschnitte als aufklappbare Gruppen, wichtigste zuerst; offen bleibt, was in dieser Sitzung offen war */
const GRUPPEN_FOLGE = ['KI-Auswertung', 'Unterwegs', 'Anzeige', 'Meine Ausrüstung', '💬 b:con talk', 'Routing', 'Opencaching', 'Daten'];
function gruppen(html) {
  const teile = html.split(/<h4>(.*?)<\/h4>/), kopf = teile[0], g = [];
  for (let i = 1; i < teile.length; i += 2) g.push({ titel: teile[i], inhalt: teile[i + 1] });
  const rang = t => { const k = GRUPPEN_FOLGE.findIndex(x => t.startsWith(x)); return k < 0 ? 99 : k; };
  g.sort((a, b) => rang(a.titel) - rang(b.titel));
  const offen = S.setOpen || {};
  return kopf + g.map(x => `<details class="grp" data-g="${esc(x.titel)}" ${offen[x.titel] ? 'open' : ''}><summary>${x.titel}</summary>${x.inhalt}</details>`).join('');
}
function showSettings() {
  const s = S.set;
  const f = (k, label, type = 'text', extra = '') => `<label class="f"><span>${label}</span><input data-k="${k}" type="${type}" value="${esc(s[k])}" ${extra}></label>`;
  const chk = (k, label) => `<label class="f c"><input data-k="${k}" type="checkbox" ${s[k] ? 'checked' : ''}><span>${label}</span></label>`;
  openSheet('Einstellungen', gruppen(`
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
    ${chk('zonenAR', '🎯 KI-Suchzonen als Ringe im Kamerabild')}
    ${chk('camSave', '🔋 Kamera aus, solange die Karte zu sehen ist (Akku sparen; mit Lampe bleibt sie an)')}
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
    <label class="f"><span>Unterwegs</span><select data-k="routeCosting"><option value="pedestrian">zu Fuß</option><option value="bicycle">Fahrrad</option><option value="motor_scooter">Roller</option><option value="auto">Auto</option></select></label>
    ${f('lookahead', 'Markierung so weit voraus auf dem Weg (m)', 'number', 'min="10" max="80" step="5"')}
    <h4>Daten</h4>
    ${f('maxLogs', 'Logs pro Cache beim Laden (5–500, gilt beim nächsten Import)', 'number', 'min="5" max="500" step="5" inputmode="numeric"')}
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
    `) + `<p class="sub">CacheVisier ${APP_VERSION} <span id="vStand"></span></p>`, b => {
    fetch('version.txt', { cache: 'no-cache' }).then(r => (r.ok ? r.text() : '')).then(t => { const [sha, ts] = t.trim().split(' '); const el = b.querySelector('#vStand'); if (el && sha) el.textContent = `· Stand ${sha}${ts ? ' vom ' + ts.slice(8, 10) + '.' + ts.slice(5, 7) + '. ' + ts.slice(11, 16) + ' UTC' : ''}`; }).catch(() => {});
    b.querySelectorAll('details.grp').forEach(d => { d.ontoggle = () => { S.setOpen = S.setOpen || {}; S.setOpen[d.dataset.g] = d.open; }; });
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
      const fest = () => { // Text: Leerzeichen/Zeilenumbrüche vom Kopieren weg; Zahl: auf den erlaubten Bereich begrenzen
        const k = el.dataset.k;
        if (el.type === 'checkbox') return (s[k] = el.checked);
        if (el.type === 'number') {
          let v = +String(el.value).replace(',', '.'); const lo = el.min !== '' ? +el.min : -Infinity, hi = el.max !== '' ? +el.max : Infinity;
          if (!isFinite(v)) v = s[k];
          if (v < lo || v > hi) { v = Math.min(hi, Math.max(lo, v)); el.value = v; toast(`Erlaubt: ${lo} bis ${hi}`); }
          return (s[k] = v);
        }
        return (s[k] = el.tagName === 'SELECT' || k === 'talkPw' ? el.value : String(el.value).trim());
      };
      // Text sofort beim Tippen merken: Wer das Blatt direkt schließt, verliert sonst die Eingabe
      if (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'number') el.oninput = () => { s[el.dataset.k] = el.dataset.k === 'talkPw' ? el.value : el.value.trim(); clearTimeout(S.setT); S.setT = setTimeout(saveSettings, 400); };
      el.onchange = () => {
        const k = el.dataset.k;
        fest();
        if (el.type !== 'checkbox' && el.type !== 'number' && el.tagName === 'INPUT' && k !== 'talkPw' && el.value !== s[k]) el.value = s[k];
        if (k === 'maxLogs') toast(`Gilt beim nächsten Laden: Caches neu aus c:geo, GPX oder Opencaching laden (höchstens so viele, wie die Quelle hat)`, 6000);
        if (k === 'ocUser') s.ocUuid = '';
        saveSettings();
        if (k === 'sensor') toast('Kompass-Quelle gilt nach Neustart der App');
        if (k === 'mapDark') applyMapDark();
        if (k === 'night') applyNight();
        if (k === 'kiMode') kiWeg();
        if (/^talk(On|Pw|Cache|Relays)$/.test(k)) { clearTimeout(S.talkT); S.talkT = setTimeout(() => run(initTalk), 800); }
        if (k === 'routeCosting' && s.routing) { S.route = null; S.steer = null; S.routeTs = 0; }
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
      <li>${has(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)} Kamera · ${S.track ? 'läuft' : 'aus'}${S.camRestarts ? ` · ${S.camAus || 0}× auf der Karte ausgeschaltet, Neustart zuletzt ${S.camRestartMs} ms` : ''}</li>
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

export { showSettings, showDiag };
