/* CacheVisier – KI-Auswertung direkt im Handy mit dem eigenen Schlüssel des Nutzers.
   Gleiche Aufgaben, Prompts, Schemas und Normalisierung wie api/ki.php (dort für den Betrieb über einen eigenen Server).
   Der Schlüssel liegt nur in den Einstellungen auf diesem Gerät und geht direkt an den gewählten Anbieter.
   Anbieter, die Aufrufe aus dem Browser zulassen (geprüft 26.11.2026): Gemini, Groq, OpenRouter, Mistral, OpenAI, Claude.
   Nicht aus dem Browser erreichbar: GitHub Models, Z.ai, Cerebras. */
(function (root) {
  'use strict';

  const ANBIETER = [
    { id: 'gemini', name: 'Gemini', type: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.7-flash',
      json: true, vision: true, timeout: 60, keyUrl: 'https://aistudio.google.com/apikey', frei: true },
    { id: 'groq', name: 'Groq', type: 'openai', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b',
      json: true, vision: false, timeout: 40, keyUrl: 'https://console.groq.com/keys', frei: true },
    { id: 'openrouter', name: 'OpenRouter', type: 'openai', base: 'https://openrouter.ai/api/v1', model: '',
      json: false, vision: false, timeout: 90, keyUrl: 'https://openrouter.ai/keys', frei: true },
    { id: 'mistral', name: 'Mistral', type: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest',
      json: true, vision: false, timeout: 60, keyUrl: 'https://console.mistral.ai/api-keys', frei: true },
    { id: 'openai', name: 'OpenAI', type: 'openai', base: 'https://api.openai.com/v1', model: '',
      json: true, vision: true, timeout: 60, keyUrl: 'https://platform.openai.com/api-keys', neu: true },
    { id: 'claude', name: 'Claude', type: 'anthropic', base: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5',
      vision: true, timeout: 60, keyUrl: 'https://console.anthropic.com/settings/keys' },
  ];

  /* ---------- Hilfen (wie in ki.php) ---------- */
  const chars = s => Array.from(s);
  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/gu, ' ').trim();
    const a = chars(s);
    return a.length > n ? a.slice(0, n).join('') + ' …' : s;
  }
  const substr = (s, n) => chars(String(s == null ? '' : s)).slice(0, n).join('');
  const arr = v => Array.isArray(v) ? v : [];
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const scalar = v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  const str = v => v == null ? '' : typeof v === 'boolean' ? (v ? '1' : '') : String(v);
  const isNum = v => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && isFinite(+v));
  const int = v => { const x = isNum(v) ? Math.trunc(+v) : (typeof v === 'boolean' ? +v : 0); return x || 0; };
  const fmod = (a, b) => a % b;

  /* ---------- Logs auswerten ---------- */
  function buildPrompt(c) {
    const logs = arr(c.logs).slice(0, 60);
    const lines = logs.map((l, i) => `[${i + 1}] ${clip(l.date, 10)} | ${clip(l.type, 30)} | ${clip(l.author, 40)}: ${clip(l.text, 800)}`);
    const hint = clip(c.hint, 400);
    return 'Du hilfst einem Geocacher, der JETZT vor Ort sucht. Werte die Logs aus (neueste zuerst, [Nr] Datum | Typ | Autor: Text).\n'
      + 'Ziel: alles, was beim Finden hilft, und der aktuelle Zustand der Dose. Spoiler sind ausdrücklich erwünscht.\n\n'
      + 'Cache: ' + clip(c.geocode, 12) + ' – ' + clip(c.name, 120) + '\n'
      + 'Typ: ' + clip(c.type, 20) + ' · D' + (c.d ?? '?') + '/T' + (c.t ?? '?') + ' · Größe laut Listing: ' + clip(c.size, 20) + '\n'
      + 'Hint: ' + (hint !== '' ? hint : '–') + '\n'
      + 'Attribute: ' + (clip(c.attribute, 400) || '–') + '\n\nLogs:\n' + lines.join('\n') + '\n\n'
      + 'Regeln:\n'
      + "- Nur Konkretes aus Logs und Hint. Keine Allgemeinplätze wie 'schöner Cache', 'Danke', 'gut versteckt', 'Owner hat sich Mühe gegeben', keine Fundstatistik als Text.\n"
      + '- Nichts erfinden. Jeder Punkt mit kurzem wörtlichem Zitat, Lognummer und Datum des Logs (JJJJ-MM-TT).\n'
      + '- Neuere Logs haben Vorrang. Widerspricht ein alter Log einem neuen (z. B. Dose ersetzt, Versteck geändert), nimm den neuen und erwähne das alte nur, wenn es hilft.\n'
      + '- kurzfassung: 1–2 Sätze, nur das Wichtigste für die Suche jetzt (wo/wie versteckt, Zustand, Warnung). Kein Füllsatz.\n'
      + '- suchhilfe: jeder brauchbare Hinweis einzeln, möglichst wörtlich konkret. kategorie:\n'
      + '  versteck (wo genau: Höhe, Seite, unter/in/hinter was), behaelter (Art und Größe: Petling, Filmdose, magnetisch, Nano, Attrappe),\n'
      + '  werkzeug (übliche Namen verwenden: Taschenlampe, UV-Lampe/UV-Stift, Pinzette, Stift, Magnet/Teleskopmagnet, Inspektionsspiegel,\n'
      + '  Handschuhe, Schraubendreher/Inbus/Torx, Wasser zum Einfüllen, Zollstock, Leiter, Teleskopstange/Angel, Wathose;\n'
      + '  Werkzeug-Attribute einbeziehen und aus den Logs konkretisieren,\n'
      + '  z. B. welches Spezialwerkzeug genau), zugang (Weg dorthin, Zaun, Hang, Gebüsch, nasse Füße),\n'
      + '  tarnung (wie getarnt, wonach aussehen), muggel (belebt, Tageszeit, Anwohner, Kameras), parken (Parkplatz, Startpunkt), sonstiges.\n'
      + '- zustand_details: konkrete Zustandsangaben mit Datum: Logbuch voll/nass/fehlt, Dose beschädigt/undicht/offen, Deckel, Stift fehlt,\n'
      + '  Ersatzdose gelegt, Owner-Wartung, Reviewer-Notiz, deaktiviert. letzte_wartung: Datum der letzten Owner-Wartung oder leer.\n'
      + '- zustand: gut, wartung_noetig, vermutlich_weg (mehrere DNF in Folge bei erfahrenen Findern o. ä.) oder unklar.\n'
      + "- dnf_serie: Anzahl 'Nicht gefunden' seit dem letzten Fund. letzter_fund: JJJJ-MM-TT oder leer.\n"
      + '- warnungen: Zecken, Brennnesseln, Dornen, Baustelle, Privatgelände, Hund, Jäger/Hochsitz, Verkehr, gesperrt, nachts nicht, Koordinaten daneben.\n'
      + "- stationen: nur bei Multi/Mystery/Wherigo: Hinweise zu Stationen oder Rätsel aus den Logs (z. B. 'Station 2: Schild hinter Hecke', 'Zahl ist schwer lesbar').\n"
      + '  Keine fertigen Finalkoordinaten erfinden.\n'
      + "- koordinaten_korrektur: nur wenn Logs sagen, dass die Koordinaten daneben liegen (z. B. '10 m nördlich'). Sonst meter = 0.\n"
      + "- positionen: Lagehinweise relativ zu Objekten wie '8 m neben der Bushaltestelle', 'am dritten Baum hinter der Bank'.\n"
      + '  anker = Bezugspunkt in Worten. osm_key/osm_value = passendes OpenStreetMap-Tag, z. B. highway=bus_stop, amenity=bench, amenity=waste_basket,\n'
      + '  highway=street_lamp, power=pole, natural=tree, leisure=playground, amenity=parking, highway=crossing, amenity=post_box,\n'
      + '  historic=wayside_cross, barrier=gate, man_made=bridge, bridge=yes, tourism=information, highway=traffic_signals.\n'
      + "  osm_value '*' = beliebiger Wert. Ist der Bezug die Listing-Koordinate oder gibt es kein Tag: osm_key und osm_value leer, anker 'Listing-Koordinaten'.\n"
      + "  abstand_m = 0 wenn unbekannt. richtung_grad = Himmelsrichtung in Grad (N=0, O=90, S=180, W=270), -1 wenn unbekannt oder nur 'links/rechts'.\n"
      + '  richtung_text = Richtung in Worten wie im Log. sicherheit: hoch, mittel oder niedrig.\n'
      + '- Leere Listen sind richtig, wenn die Logs nichts hergeben. Lieber nichts als Allgemeines.';
  }

  const KAT = ['versteck', 'behaelter', 'werkzeug', 'zugang', 'tarnung', 'muggel', 'parken', 'sonstiges'];
  const SICH = ['hoch', 'mittel', 'niedrig'];
  function schema() {
    const q = { type: 'string' }, n = { type: 'integer' }, sich = { type: 'string', enum: SICH };
    const beleg = (extra, req) => ({ type: 'array', items: { type: 'object',
      properties: { ...extra, datum: q, zitat: q, log_nr: n }, required: [...req, 'zitat', 'log_nr'] } });
    return {
      type: 'object',
      properties: {
        kurzfassung: q,
        zustand: { type: 'string', enum: ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar'] },
        zustand_details: beleg({ punkt: q }, ['punkt']),
        letzter_fund: q,
        letzte_wartung: q,
        dnf_serie: n,
        suchhilfe: beleg({ kategorie: { type: 'string', enum: KAT }, hinweis: q }, ['kategorie', 'hinweis']),
        warnungen: beleg({ hinweis: q }, ['hinweis']),
        stationen: beleg({ station: q, hinweis: q }, ['station', 'hinweis']),
        koordinaten_korrektur: { type: 'object', properties: {
          meter: { type: 'number' }, richtung_grad: { type: 'number' }, zitat: q, log_nr: n, sicherheit: sich },
          required: ['meter', 'richtung_grad', 'zitat', 'log_nr'] },
        positionen: { type: 'array', items: { type: 'object', properties: {
          anker: q, osm_key: q, osm_value: q, abstand_m: { type: 'number' }, richtung_grad: { type: 'number' },
          richtung_text: q, zitat: q, log_nr: n, sicherheit: sich },
          required: ['anker', 'osm_key', 'osm_value', 'abstand_m', 'richtung_grad', 'zitat', 'log_nr', 'sicherheit'] } },
      },
      required: ['kurzfassung', 'zustand', 'zustand_details', 'dnf_serie', 'suchhilfe', 'warnungen', 'positionen'],
    };
  }

  function normalize(r) {
    r = isObj(r) ? r : {};
    const s = (v, n = 600) => scalar(v) ? clip(str(v), n) : '';
    const f = (v, d) => isNum(v) ? +v : d;
    const sich = v => SICH.includes(v) ? v : 'niedrig';
    const datum = v => { const m = /^\d{4}-\d{2}-\d{2}/.exec(scalar(v) ? str(v) : ''); return m ? m[0] : ''; };
    const liste = (v, felder, max, extra = {}) => {
      const out = [];
      for (const x of arr(v).slice(0, max)) {
        if (!isObj(x)) continue;
        const e = {};
        for (const k of felder) e[k] = s(x[k] ?? '', 300);
        if (felder.map(k => e[k]).join('') === '') continue;
        for (const [k, erlaubt] of Object.entries(extra)) e[k] = erlaubt.includes(x[k] ?? '') ? x[k] : erlaubt[erlaubt.length - 1];
        e.datum = datum(x.datum ?? '');
        e.zitat = s(x.zitat ?? '', 300);
        e.log_nr = Math.trunc(f(x.log_nr ?? 0, 0));
        out.push(e);
      }
      return out;
    };
    const out = {
      kurzfassung: s(r.kurzfassung ?? '', 600),
      zustand: ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar'].includes(r.zustand ?? '') ? r.zustand : 'unklar',
      zustand_details: liste(r.zustand_details ?? null, ['punkt'], 10),
      letzter_fund: datum(r.letzter_fund ?? ''),
      letzte_wartung: datum(r.letzte_wartung ?? ''),
      dnf_serie: Math.max(0, Math.trunc(f(r.dnf_serie ?? 0, 0))),
      suchhilfe: liste(r.suchhilfe ?? (r.versteck_hinweise ?? null), ['hinweis'], 14, { kategorie: KAT }),
      warnungen: liste(r.warnungen ?? null, ['hinweis'], 8),
      stationen: liste(r.stationen ?? null, ['station', 'hinweis'], 12),
      koordinaten_korrektur: null,
      positionen: [],
    };
    const k = r.koordinaten_korrektur ?? null;
    if (isObj(k) && f(k.meter ?? 0, 0) > 0 && f(k.meter, 0) < 2000) {
      out.koordinaten_korrektur = { meter: f(k.meter, 0), richtung_grad: fmod(f(k.richtung_grad ?? -1, -1), 360),
        zitat: s(k.zitat ?? '', 300), log_nr: Math.trunc(f(k.log_nr ?? 0, 0)), sicherheit: sich(k.sicherheit ?? '') };
    }
    for (const p of arr(r.positionen).slice(0, 8)) {
      if (!isObj(p) || s(p.anker ?? '') === '') continue;
      const rg = f(p.richtung_grad ?? -1, -1);
      out.positionen.push({
        anker: s(p.anker, 120), osm_key: s(p.osm_key ?? '', 40).toLowerCase().replace(/[^a-z0-9_:]/g, ''),
        osm_value: s(p.osm_value ?? '', 60), abstand_m: Math.max(0, Math.min(500, f(p.abstand_m ?? 0, 0))),
        richtung_grad: rg < 0 ? -1 : fmod(rg, 360), richtung_text: s(p.richtung_text ?? '', 60),
        zitat: s(p.zitat ?? '', 300), log_nr: Math.trunc(f(p.log_nr ?? 0, 0)), sicherheit: sich(p.sicherheit ?? ''),
      });
    }
    return out;
  }

  /* ---------- Multi: Stationen aus dem Listing ---------- */
  function buildMultiPrompt(c) {
    const wp = [];
    for (const w of arr(c.wegpunkte).slice(0, 40)) {
      if (!isObj(w)) continue;
      wp.push('- ' + clip(w.prefix, 8) + ' ' + clip(w.name, 80) + ' | ' + clip(w.coord, 40) + ' | ' + clip(w.note, 400));
    }
    const desc = substr(String(c.beschreibung ?? '').trim(), 16000);
    return 'Lies aus dem Listing eines Geocaches die Stationen heraus, damit ein Cacher vor Ort Station für Station abarbeiten kann.\n\n'
      + 'Cache: ' + clip(c.geocode, 12) + ' – ' + clip(c.name, 120) + ' · Typ: ' + clip(c.type, 20) + '\n'
      + 'Listing-Koordinaten (Start): ' + clip(c.start, 40) + '\n'
      + 'Attribute: ' + (clip(c.attribute, 400) || '–') + '\n\n'
      + 'Beschreibung:\n' + desc + '\n\n'
      + (wp.length ? 'Wegpunkte:\n' + wp.join('\n') + '\n\n' : '')
      + 'Regeln:\n'
      + "- stationen in der Reihenfolge des Listings (ohne das Final). nr ab 1. name kurz (z. B. 'Brunnen', 'Infotafel').\n"
      + "- art: 'listing' (Station liegt an den Listing-Koordinaten), 'koordinaten' (feste Koordinaten), 'formel' (Koordinaten mit Variablen),\n"
      + "  'projektion' (Peilung von einem Punkt), 'unbekannt' (Ort nur beschrieben).\n"
      + "- vorlage: Koordinaten im Format 'N 48° 22.123 E 010° 53.456'. Unbekannte Teile als {Ausdruck} mit den Variablennamen aus dem Listing\n"
      + "  und + - * / ( ). Beispiele: 'N 48° 22.ABC' -> 'N 48° 22.{A}{B}{C}'; 'N 48° 2(A+1).(B*C)' -> 'N 48° 2{A+1}.{B*C}'.\n"
      + '  Funktionen: QS(x) Quersumme, IQS(x) einstellige Quersumme. Ost als E schreiben.\n'
      + "- projektion: von = 'listing' oder Nummer der Station, distanz in Metern und winkel in Grad, jeweils als Ausdruck (z. B. 'A*10', '2{B}0' NICHT, sondern 'B*10+200').\n"
      + '- aufgabe: was an der Station zu tun ist, möglichst wörtlich aus dem Listing, vollständig, mit Hinweisen wo man suchen muss.\n'
      + '- variablen: jede an dieser Station zu ermittelnde Variable mit name (wie im Listing, z. B. A) und frage (genau was zu bestimmen ist,\n'
      + "  inklusive Umrechnung wie 'Quersumme', 'Buchstabenwert', 'letzte Ziffer').\n"
      + '- final: Koordinaten des Finals wie oben (art, vorlage, von, distanz, winkel) und text = Originalformel aus dem Listing.\n'
      + "- regeln: allgemeine Rechenregeln des Listings (z. B. 'Buchstabenwert A=1', 'Ziffern addieren'), sonst leer.\n"
      + "- Nichts erfinden. Steht etwas nicht im Listing, leer lassen bzw. art 'unbekannt'.";
  }
  const ARTEN = ['listing', 'koordinaten', 'formel', 'projektion', 'unbekannt'];
  function schemaMulti() {
    const q = { type: 'string' };
    const ort = { art: { type: 'string', enum: ARTEN }, vorlage: q, von: q, distanz: q, winkel: q };
    return {
      type: 'object',
      properties: {
        stationen: { type: 'array', items: { type: 'object', properties: { nr: { type: 'integer' }, name: q, ...ort,
          aufgabe: q,
          variablen: { type: 'array', items: { type: 'object', properties: { name: q, frage: q }, required: ['name', 'frage'] } },
        }, required: ['nr', 'name', 'art', 'aufgabe', 'variablen'] } },
        final: { type: 'object', properties: { ...ort, text: q }, required: ['art', 'vorlage', 'text'] },
        regeln: q,
      },
      required: ['stationen', 'final'],
    };
  }
  function normalizeOrt(o) {
    return {
      art: ARTEN.includes(o.art ?? '') ? o.art : 'unbekannt',
      vorlage: clip(o.vorlage ?? '', 160),
      von: clip(o.von ?? '', 20),
      distanz: clip(o.distanz ?? '', 80),
      winkel: clip(o.winkel ?? '', 80),
    };
  }
  function normalizeMulti(r) {
    r = isObj(r) ? r : {};
    const st = [];
    arr(r.stationen).slice(0, 30).forEach((s, i) => {
      if (!isObj(s)) return;
      const vars = [];
      for (const v of arr(s.variablen).slice(0, 20)) {
        const name = isObj(v) ? str(v.name ?? '').replace(/[^A-Za-z0-9]/g, '') : '';
        if (!isObj(v) || name === '' || !/^[A-Za-z]/.test(name)) continue;
        vars.push({ name: name.slice(0, 6).toUpperCase(), frage: clip(v.frage ?? '', 300) });
      }
      st.push({ nr: int(s.nr ?? (i + 1)) || i + 1, name: clip(s.name ?? '', 80), ...normalizeOrt(s),
        aufgabe: substr(String(s.aufgabe ?? '').trim(), 1500), variablen: vars });
    });
    const f = isObj(r.final) ? r.final : {};
    return { stationen: st, final: { ...normalizeOrt(f), text: clip(f.text ?? '', 300) }, regeln: clip(r.regeln ?? '', 600) };
  }

  /* ---------- Foto: Werte an einer Station ablesen ---------- */
  function buildFotoPrompt(c) {
    const st = isObj(c.station) ? c.station : {};
    const fragen = [];
    for (const v of arr(st.variablen).slice(0, 20)) if (isObj(v)) fragen.push('- ' + clip(v.name, 6) + ': ' + clip(v.frage, 300));
    return 'Das Foto zeigt eine Station des Geocaches ' + clip(c.geocode, 12) + ' (Station: ' + clip(st.name, 80) + ').\n'
      + 'Aufgabe laut Listing: ' + substr(String(st.aufgabe ?? ''), 1200) + '\n'
      + 'Rechenregeln: ' + clip(c.regeln, 400) + '\n\n'
      + 'Gesucht:\n' + fragen.join('\n') + '\n\n'
      + '- gelesen: was auf dem Foto zur Aufgabe passt, wörtlich (Text, Zahlen, Jahreszahlen, Anzahl von Dingen).\n'
      + '- werte: für jede gesuchte Variable den fertigen Wert nach den Regeln der Frage (z. B. schon die Quersumme bilden).\n'
      + '  Zählaufgaben (Latten, Fenster, Stufen, Nieten …): jedes Teil einzeln zählen, nicht schätzen; in begruendung die Zählweise nennen\n'
      + "  (z. B. 'links vom Pfosten 12, rechts 11 = 23'). Ist ein Teil abgeschnitten oder verdeckt, das sagen und sicherheit senken.\n"
      + '  begruendung kurz: woher der Wert kommt und wie gerechnet. Nicht sicher lesbar oder nicht im Bild: wert leer, sicherheit niedrig.\n'
      + '- Nichts raten, was nicht im Bild zu sehen ist.';
  }
  function schemaFoto() {
    const q = { type: 'string' };
    return { type: 'object', properties: {
      gelesen: q,
      werte: { type: 'array', items: { type: 'object', properties: {
        name: q, wert: q, begruendung: q, sicherheit: { type: 'string', enum: SICH } },
        required: ['name', 'wert', 'begruendung', 'sicherheit'] } },
    }, required: ['gelesen', 'werte'] };
  }
  function normalizeFoto(r) {
    r = isObj(r) ? r : {};
    const w = [];
    for (const x of arr(r.werte).slice(0, 20)) {
      if (!isObj(x)) continue;
      const name = str(x.name ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
      if (name === '') continue;
      w.push({ name, wert: clip(scalar(x.wert) ? str(x.wert) : '', 20), begruendung: clip(x.begruendung ?? '', 300),
        sicherheit: SICH.includes(x.sicherheit ?? '') ? x.sicherheit : 'niedrig' });
    }
    return { gelesen: clip(r.gelesen ?? '', 800), werte: w };
  }

  /* ---------- Anbieter aufrufen ---------- */
  function extractJson(t) {
    t = String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    t = t.trim().replace(/^```(?:json)?|```$/gm, '').trim();
    try { const d = JSON.parse(t); if (d && typeof d === 'object') return d; } catch (e) { /* weiter */ }
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { const d = JSON.parse(t.slice(a, b + 1)); return d && typeof d === 'object' ? d : null; } catch (e) { return null; }
  }
  function kurz(s, n = 160) { return clip(s, n); }

  async function post(url, headers, body, timeoutS, fetchFn) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ac ? setTimeout(() => ac.abort(), (timeoutS || 60) * 1000) : null;
    let r, text;
    try {
      r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
      text = await r.text();
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Verbindung fehlgeschlagen' + (e && e.message ? ': ' + e.message : ''));
    } finally { if (tm) clearTimeout(tm); }
    let data = null; try { data = JSON.parse(text); } catch (e) { /* unten */ }
    if (r.status < 200 || r.status >= 300) {
      const m = data && (data.error && (data.error.message || data.error) || data.message);
      const err = new Error('HTTP ' + r.status + (m ? ': ' + (typeof m === 'string' ? m : JSON.stringify(m)) : ''));
      err.status = r.status; throw err;
    }
    if (!data || typeof data !== 'object') throw new Error('Antwort nicht lesbar');
    return data;
  }

  async function callAnthropic(p, prompt, sch, tool, img, fetchFn) {
    const data = await post(p.base, { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, {
      model: p.model, max_tokens: 3000,
      tools: [{ name: tool, description: 'Strukturierte Antwort', input_schema: sch }],
      tool_choice: { type: 'tool', name: tool },
      messages: [{ role: 'user', content: img
        ? [{ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.b64 } }, { type: 'text', text: prompt }]
        : prompt }],
    }, p.timeout, fetchFn);
    for (const b of data.content || []) if (b && b.type === 'tool_use' && isObj(b.input)) return [b.input, data.usage || null, data.model || p.model];
    throw new Error('keine strukturierte Antwort');
  }

  async function callOpenai(p, prompt, sch, img, fetchFn) {
    const body = {
      model: p.model,
      messages: [
        { role: 'system', content: 'Antworte ausschließlich mit einem JSON-Objekt nach diesem Schema, ohne weiteren Text: ' + JSON.stringify(sch) },
        { role: 'user', content: img
          ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:' + img.mime + ';base64,' + img.b64 } }]
          : prompt },
      ],
    };
    // OpenAI selbst: neuere Modelle kennen nur max_completion_tokens und keine eigene temperature
    if (p.id === 'openai') body.max_completion_tokens = 4000;
    else { body.temperature = 0.2; body.max_tokens = 3000; } // Denkmodelle (gpt-oss, Qwen) verbrauchen einen Teil davon fürs Nachdenken
    if (p.json) body.response_format = { type: 'json_object' };
    const data = await post(p.base.replace(/\/+$/, '') + '/chat/completions', { Authorization: 'Bearer ' + p.key }, body, p.timeout, fetchFn);
    const text = (((data.choices || [])[0] || {}).message || {}).content || '';
    const obj = extractJson(typeof text === 'string' ? text : '');
    if (!obj) throw new Error('kein gültiges JSON');
    return [obj, data.usage || null, data.model || p.model];
  }

  const AUFGABEN = {
    logs: [buildPrompt, schema, normalize, 'auswertung'],
    multi: [buildMultiPrompt, schemaMulti, normalizeMulti, 'stationen'],
    foto: [buildFotoPrompt, schemaFoto, normalizeFoto, 'ablesung'],
  };

  /* in: wie die Anfrage an ki.php ({aktion, geocode, …}); anbieter: [{id,name,type,base,model,key,json,vision,timeout}] in Reihenfolge.
     Liefert {ok, result, usage, model, fallbacks} wie ki.php oder wirft einen Fehler mit allen Gründen. */
  async function run(input, anbieter, fetchFn) {
    fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    if (!isObj(input) || !input.geocode) throw new Error('Ungültige Anfrage');
    const aktion = AUFGABEN[input.aktion] ? input.aktion : 'logs';
    let img = null;
    if (aktion === 'foto') {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(input.bild || ''));
      if (!m || m[2].length > 5500000) throw new Error('Foto fehlt oder ist zu groß');
      img = { mime: m[1], b64: m[2] };
    }
    const [bp, sc, norm, tool] = AUFGABEN[aktion];
    const prompt = bp(input), sch = sc();
    const errors = []; let tried = 0;
    for (const p of anbieter || []) {
      if (!p || !p.key || !p.model) continue;
      if (img && !p.vision) continue;                 // Foto nur an Modelle, die Bilder verstehen
      tried++;
      try {
        const [result, usage, model] = p.type === 'anthropic' ? await callAnthropic(p, prompt, sch, tool, img, fetchFn) : await callOpenai(p, prompt, sch, img, fetchFn);
        return { ok: true, result: norm(result), usage, model: p.name + ' · ' + model, fallbacks: errors };
      } catch (e) { errors.push(p.name + ': ' + kurz(e && e.message || e)); }
    }
    if (img && !tried) throw new Error('Kein bildfähiger Anbieter mit Schlüssel (z. B. Gemini)');
    if (!tried) throw new Error('Noch kein KI-Schlüssel eingetragen (☰ → ⚙️ → KI-Auswertung)');
    throw new Error(errors.join(' | '));
  }

  /* Modelle des Anbieters abfragen (kostet keine Tokens) – zum Prüfen des Schlüssels und zur Auswahl */
  async function models(p, fetchFn) {
    fetchFn = fetchFn || fetch.bind(root);
    const anth = p.type === 'anthropic';
    const url = anth ? 'https://api.anthropic.com/v1/models?limit=100' : p.base.replace(/\/+$/, '') + '/models';
    const headers = anth ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : { Authorization: 'Bearer ' + p.key };
    let r;
    try { r = await fetchFn(url, { headers }); } catch (e) { throw new Error('Verbindung fehlgeschlagen'); }
    const j = await r.json().catch(() => null);
    if (!r.ok) { const m = j && (j.error && (j.error.message || j.error) || j.message); throw new Error('HTTP ' + r.status + (m ? ': ' + kurz(typeof m === 'string' ? m : JSON.stringify(m), 120) : '')); }
    let ids = arr(j && (j.data || j.models)).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
    if (p.id === 'openrouter') ids = ids.filter(id => /:free$/.test(id)).concat(ids.filter(id => !/:free$/.test(id)));
    return ids;
  }

  const KI = { ANBIETER, run, models, buildPrompt, buildMultiPrompt, buildFotoPrompt, schema, schemaMulti, schemaFoto,
    normalize, normalizeMulti, normalizeFoto, extractJson, clip };
  if (typeof module !== 'undefined' && module.exports) module.exports = KI;
  else root.CVKI = KI;
})(typeof self !== 'undefined' ? self : this);
