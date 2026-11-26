/* Tests für ki.js: gleiche Prompts/Schemas/Normalisierung wie api/ki.php (Abgleich per PHP), Anbieterkette mit nachgebautem fetch */
const assert = require('assert'), { execFileSync } = require('child_process'), path = require('path');
const KI = require('../ki.js');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

const cache = { geocode: 'GC7GD1K', name: 'Rosenau  Multi Test', type: 'Multi', d: 2, t: 2.5, size: 'Small', hint: 'unter dem Stein, links',
  attribute: 'Taschenlampe nötig, Kinderfreundlich',
  logs: [{ date: '2026-11-20', type: 'Gefunden', author: 'LISA', text: 'Dose 5 m nördlich der Bank, Logbuch nass. ' + 'x'.repeat(900) },
         { date: '2026-10-01', type: 'Nicht gefunden', author: 'Tom', text: 'Viele Muggel 🙈' }] };
const multi = { geocode: 'GC7GD1K', name: 'Rosenau Multi', type: 'Multi', start: 'N 48° 22.200 E 010° 52.200', attribute: '',
  beschreibung: 'Station 1: Zähle die Latten (A). Final: N 48° 22.{A}00', wegpunkte: [{ prefix: 'S1', name: 'Zaun', coord: 'N 48° 22.210 E 010° 52.210', note: 'am Spielplatz' }] };
const foto = { geocode: 'GC7GD1K', station: { name: 'Zaun', aufgabe: 'Zähle die Latten', variablen: [{ name: 'A', frage: 'Anzahl Latten' }] }, regeln: 'A=1' };
const rohLogs = { kurzfassung: 'Unter dem Stein.', zustand: 'wartung_noetig', dnf_serie: '2', letzter_fund: '2026-11-20T10:00',
  zustand_details: [{ punkt: 'Logbuch nass', datum: '2026-11-20', zitat: 'Logbuch nass', log_nr: '1' }, { punkt: '' }, 'kaputt'],
  suchhilfe: [{ kategorie: 'versteck', hinweis: 'unter Stein', zitat: 'Stein', log_nr: 1 }, { kategorie: 'quatsch', hinweis: 'x', log_nr: 2.7 }],
  warnungen: [], koordinaten_korrektur: { meter: 5, richtung_grad: 370, zitat: '5 m nördlich', log_nr: 1, sicherheit: 'hoch' },
  positionen: [{ anker: 'Bank', osm_key: 'Amenity!', osm_value: 'bench', abstand_m: 900, richtung_grad: -5, richtung_text: 'nördlich', zitat: 'Bank', log_nr: 1, sicherheit: 'egal' }, { anker: '' }] };
const rohMulti = { stationen: [{ nr: 0, name: 'Zaun', art: 'formel', vorlage: 'N 48° 22.{A}00', aufgabe: '  Zähle  ', variablen: [{ name: 'a-1', frage: 'Latten' }, { name: '9x', frage: 'nein' }, 'kaputt'] }, 'x'],
  final: { art: 'unsinn', vorlage: 'N 48', text: 'Final' }, regeln: 'A=1' };
const rohFoto = { gelesen: '23 Latten', werte: [{ name: 'a', wert: 23, begruendung: '12+11', sicherheit: 'hoch' }, { name: '', wert: 1 }, { name: 'B', wert: true, sicherheit: 'x' }] };

// 1) Abgleich mit PHP
const jobs = [['build_prompt', cache], ['build_multi_prompt', multi], ['build_foto_prompt', foto], ['schema', {}], ['schema_multi', {}], ['schema_foto', {}],
  ['normalize', rohLogs], ['normalize_multi', rohMulti], ['normalize_foto', rohFoto], ['normalize', {}], ['extract_json', '<think>hm</think>```json\n{"a":1}\n```']];
const php = JSON.parse(execFileSync('php', [path.join(__dirname, 'php_ki.php')], { input: JSON.stringify(jobs.map(([fn, arg]) => ({ fn, arg }))) }).toString());
const js = [KI.buildPrompt(cache), KI.buildMultiPrompt(multi), KI.buildFotoPrompt(foto), KI.schema(), KI.schemaMulti(), KI.schemaFoto(),
  KI.normalize(rohLogs), KI.normalizeMulti(rohMulti), KI.normalizeFoto(rohFoto), KI.normalize({}), KI.extractJson('<think>hm</think>```json\n{"a":1}\n```')];
jobs.forEach(([fn], i) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(js[i])), php[i], fn + ' weicht von ki.php ab'); n++; });

// 2) Anbieterkette mit nachgebautem fetch
const calls = [];
const fake = handler => async (url, opt) => { calls.push({ url, opt, body: opt.body ? JSON.parse(opt.body) : null }); const [st, j] = handler(url, opt); return { status: st, ok: st < 300, text: async () => JSON.stringify(j), json: async () => j }; };
const A = id => ({ ...KI.ANBIETER.find(a => a.id === id), key: 'k-' + id });
(async () => {
  // Gemini mit 429 → Groq liefert Text mit Codeblock
  let r = await KI.run({ geocode: 'GC1', ...cache }, [A('gemini'), A('groq')], fake(url => url.includes('googleapis')
    ? [429, { error: { message: 'Quota' } }] : [200, { model: 'gpt-oss', choices: [{ message: { content: '```json\n' + JSON.stringify(rohLogs) + '\n```' } }] }]));
  ok(r.ok && r.model === 'Groq · gpt-oss' && r.fallbacks[0].startsWith('Gemini: HTTP 429'), 'Rückfall auf Groq');
  ok(r.result.zustand === 'wartung_noetig' && r.result.suchhilfe.length === 2, 'Ergebnis normalisiert');
  ok(calls[0].opt.headers.Authorization === 'Bearer k-gemini' && calls[0].body.response_format.type === 'json_object' && calls[0].body.max_tokens === 3000, 'OpenAI-Form für Gemini');
  // OpenAI selbst: max_completion_tokens, keine temperature
  calls.length = 0;
  await KI.run({ geocode: 'GC1' }, [{ ...A('openai'), model: 'gpt-x' }], fake(() => [200, { choices: [{ message: { content: '{}' } }] }]));
  ok(calls[0].body.max_completion_tokens && calls[0].body.temperature === undefined && calls[0].body.max_tokens === undefined, 'OpenAI-Parameter');
  // Claude: Werkzeug erzwungen, Browser-Kopfzeile, Foto als Bild
  calls.length = 0;
  r = await KI.run({ aktion: 'foto', ...foto, bild: 'data:image/jpeg;base64,QUJD' }, [A('groq'), A('claude')], fake(() => [200, { model: 'haiku', content: [{ type: 'tool_use', input: rohFoto }] }]));
  ok(calls.length === 1 && calls[0].url === 'https://api.anthropic.com/v1/messages', 'Foto überspringt Groq (ohne Bild)');
  ok(calls[0].opt.headers['anthropic-dangerous-direct-browser-access'] === 'true' && calls[0].body.tool_choice.name === 'ablesung' && calls[0].body.messages[0].content[0].type === 'image', 'Claude-Form');
  ok(r.result.werte[0].name === 'A' && r.result.werte[0].wert === '23', 'Foto normalisiert');
  // keine Schlüssel / kein bildfähiger Anbieter / alle kaputt
  await assert.rejects(KI.run({ geocode: 'GC1' }, []), /Noch kein KI-Schlüssel/); n++;
  await assert.rejects(KI.run({ geocode: 'GC1', aktion: 'foto', bild: 'data:image/png;base64,QQ==' }, [A('groq')]), /bildfähig/); n++;
  await assert.rejects(KI.run({ geocode: 'GC1' }, [A('groq'), A('mistral')], fake(() => [200, { choices: [{ message: { content: 'kein json' } }] }])), /Groq: kein gültiges JSON \| Mistral: kein gültiges JSON/); n++;
  await assert.rejects(KI.run({ geocode: 'GC1' }, [A('groq')], async () => { throw new TypeError('Failed to fetch'); }), /Verbindung fehlgeschlagen/); n++;
  // Modelle laden
  const ids = await KI.models(A('openrouter'), fake(() => [200, { data: [{ id: 'a/b' }, { id: 'c/d:free' }] }]));
  ok(ids[0] === 'c/d:free', 'OpenRouter: kostenlose Modelle zuerst');
  const g = await KI.models(A('gemini'), fake(() => [200, { data: [{ id: 'models/gemini-3.7-flash' }] }]));
  ok(g[0] === 'gemini-3.7-flash', 'Gemini: Präfix models/ weg');
  await assert.rejects(KI.models(A('claude'), fake(() => [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }])), /HTTP 401: invalid x-api-key/); n++;
  console.log(n + ' KI-Tests bestanden');
})().catch(e => { console.error(e); process.exit(1); });
