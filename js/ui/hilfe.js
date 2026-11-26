/* CacheVisier · ui/hilfe: Hilfeseite im Blatt und Ersteinrichtung in drei Schritten (Berechtigungen, Caches, KI-Schlüssel) */
import { esc } from '../kern/geo.js';
import { KIA, S, closeSheet, openSheet, run, saveSettings, toast } from './basis.js';
import { loadNewestBackup, loadOcNearby, pickFile } from './import.js';

function showHilfe(anker) {
  openSheet('❓ Hilfe', `
    <div class="tools"><button id="hSetup">🚀 Ersteinrichtung</button><a class="btn" href="hilfe.html${anker ? '#' + anker : ''}" target="_blank" rel="noopener">↗ Im Browser öffnen</a></div>
    <iframe class="hilfe" src="hilfe.html${anker ? '#' + anker : ''}" title="Hilfe"></iframe>`, b => {
    b.querySelector('#hSetup').onclick = () => showSetup(0);
  });
}

/* Ersteinrichtung: erscheint nach dem ersten Start einmal, später über die Hilfe */
const SCHRITTE = ['Berechtigungen', 'Caches laden', 'KI-Schlüssel'];
function showSetup(i) {
  i = Math.max(0, Math.min(2, i | 0));
  const kopf = `<div class="setupK">${SCHRITTE.map((t, k) => `<span class="${k === i ? 'on' : k < i ? 'ok' : ''}">${k + 1}. ${t}</span>`).join('')}</div>`;
  const ok = v => (v ? '✅' : '⏳');
  const gem = KIA().find(a => a.id === 'gemini');
  const inhalt = [
    `<p>CacheVisier braucht <b>Kamera</b> (Fadenkreuz), <b>Standort</b> (Abstand, Richtung) und <b>Bewegungssensoren</b> (Kompass).</p>
     <ul class="list">
       <li>${ok(S.stream)} Kamera ${S.stream ? 'läuft' : '– noch nicht frei (beim Start erlauben)'}</li>
       <li>${ok(S.pos)} Standort ${S.pos ? `da (±${Math.round(S.pos.acc)} m)` : '– warte auf GPS'}</li>
       <li>${ok(S.cols)} Kompass ${S.cols ? 'liefert Daten' : '– Bewegungssensoren erlauben (Schloss-Symbol in der Adresszeile)'}</li>
     </ul>
     <p class="sub">Fehlt etwas, kannst du trotzdem weiter – Hinweise oben im Bild sagen, was los ist.</p>`,
    `<p>Am besten aus <b>c:geo</b>: dort die Caches mit Logs offline speichern und eine Sicherung anlegen (Kontodaten nicht mitsichern). Dann hier den Ordner <b>cgeo</b> wählen.</p>
     <div class="tools"><button data-l="cgeo">📁 c:geo-Backup laden</button><button data-l="datei">📄 Datei wählen (GPX, .sqlite)</button><button data-l="oc">🟢 OC in der Nähe</button></div>
     <p class="sub">${S.caches.size ? `✅ ${S.caches.size} Caches geladen.` : 'Noch keine Caches geladen.'} Opencaching braucht einen eigenen Schlüssel (⚙️ → Opencaching).</p>`,
    `<p>Für die KI-Suchhilfe trägst du <b>deinen eigenen Schlüssel</b> ein. Er bleibt im Handy. Am einfachsten Gemini: kostenlose Stufe, versteht Fotos.</p>
     <ol class="list"><li><a href="${gem ? gem.keyUrl : 'https://aistudio.google.com/apikey'}" target="_blank" rel="noopener">Schlüssel bei Google AI Studio holen ↗</a></li><li>Hier einfügen und prüfen.</li></ol>
     <label class="f"><span>Gemini-Schlüssel</span><input id="sKey" type="password" autocomplete="off" spellcheck="false" value="${esc(S.set.kiKey_gemini || '')}"></label>
     <div class="tools"><button id="sPruef">Prüfen</button></div><p class="sub" id="sMsg">Optional – ohne Schlüssel geht alles außer der KI.</p>`
  ][i];
  openSheet('🚀 Ersteinrichtung', kopf + inhalt + `
    <div class="tools setupNav">${i > 0 ? '<button data-n="-1">← Zurück</button>' : ''}<button data-n="skip">Überspringen</button>${i < 2 ? '<button data-n="1" class="hl">Weiter →</button>' : '<button data-n="fertig" class="hl">✅ Fertig</button>'}</div>
    <p class="sub">Ausführliche Anleitung: ☰ → ❓ Hilfe</p>`, b => {
    b.querySelectorAll('[data-n]').forEach(x => {
      x.onclick = () => {
        const n = x.dataset.n;
        if (n === 'skip' || n === 'fertig') { S.set.setupDone = true; saveSettings(); closeSheet(); if (n === 'fertig') toast('Los geht\'s – ☰ öffnet die Cache-Liste'); return; }
        showSetup(i + +n);
      };
    });
    b.querySelectorAll('[data-l]').forEach(x => {
      x.onclick = () => run(async () => {
        if (x.dataset.l === 'cgeo') await loadNewestBackup(); else if (x.dataset.l === 'datei') await pickFile(); else await loadOcNearby();
        if (S.caches.size) showSetup(1);
      });
    });
    const key = b.querySelector('#sKey');
    if (key) {
      key.oninput = () => { S.set.kiKey_gemini = key.value.trim(); saveSettings(); };
      b.querySelector('#sPruef').onclick = () => run(async () => {
        const m = b.querySelector('#sMsg'); if (!S.set.kiKey_gemini) return (m.textContent = 'Erst den Schlüssel einfügen.');
        m.textContent = '… prüfe';
        try { const ids = await window.CVKI.models({ ...gem, key: S.set.kiKey_gemini }); m.textContent = `✅ Schlüssel gilt (${ids.length} Modelle). Die KI ist bereit.`; S.set.kiMode = 'direkt'; saveSettings(); }
        catch (e) { m.textContent = '❌ ' + (e && e.message || e); }
      });
    }
  });
}
function maybeSetup() {
  if (S.set.setupDone) return;
  if (S.caches.size) { S.set.setupDone = true; saveSettings(); return; } // wer schon Caches hat, braucht keine Ersteinrichtung
  if (navigator.webdriver) return; // automatische Browser-Tests: nicht dazwischenfunken (dort eigener Test)
  setTimeout(() => { if (!S.set.setupDone && document.querySelector('#sheet').hidden) showSetup(0); }, 1500);
}
window.CVH = { showSetup, showHilfe }; // für Tests und die Browser-Konsole

export { showHilfe, showSetup, maybeSetup };
