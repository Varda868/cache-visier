import { haversine, htmlText } from './geo.js';

/* --- Cache-Attribute: GC-Nummer (GPX), c:geo-Rohname, Opencaching-Name → einheitlicher Schlüssel --- */
const ATTRS = [ // Schlüssel, Symbol, Text, Ausrüstung?, GC-Nummer, Muster
  ['flashlight', '🔦', 'Taschenlampe nötig', true, 44, /flashlight|taschenlampe/i],
  ['uv', '🟣', 'UV-Lampe nötig', true, 48, /(^|[^a-z])uv([^a-z]|$)|uv-?(licht|lampe)/i],
  ['special_tool', '🔧', 'Spezialwerkzeug nötig', true, 51, /s-tool|special.?tool|spezialwerkzeug|werkzeug/i],
  ['tree_climbing', '🌳', 'Baumklettern', true, 64, /tree.?climb|baumklett/i],
  ['climbing_gear', '🧗', 'Kletterausrüstung nötig', true, 3, /rappel|climbing.?gear|kletterausr|abseil/i],
  ['climbing', '🧗', 'Klettern (schwierig)', true, 10, /^climbing|difficult.?climb|klettern/i],
  ['boat', '🚣', 'Boot nötig', true, 4, /boat|boot/i],
  ['scuba', '🤿', 'Tauchausrüstung nötig', true, 5, /scuba|tauch/i],
  ['wading', '🥾', 'Waten / Wathose', true, 11, /wading|waten|wathose|nasse f/i],
  ['swimming', '🏊', 'Schwimmen', true, 12, /swimming|schwimm/i],
  ['night', '🌙', 'Nachtcache', false, 52, /night.?cache|nachtcache|nur nachts/i],
  ['night_rec', '🌃', 'nachts empfohlen', false, 14, /^night(_|$)|recommended at night|nachts/i],
  ['field_puzzle', '🧩', 'Rätsel vor Ort', false, 47, /field.?puzzle|rätsel vor ort|feldrätsel/i],
  ['ticks', '🕷️', 'Zecken', false, 19, /ticks|zecken/i],
  ['thorns', '🌵', 'Dornen', false, 39, /thorn|dornen/i],
  ['poison', '☠️', 'Giftpflanzen', false, 17, /poison|giftpfl/i],
  ['cliff', '⛰️', 'Absturz/Steinschlag', false, 21, /cliff|absturz|steinschl/i],
  ['danger', '⚠️', 'gefährliches Gelände', false, 23, /danger|gefährl/i],
  ['hunting', '🎯', 'Jagdgebiet', false, 22, /hunting|jagd/i],
  ['stealth', '🤫', 'unauffällig vorgehen', false, 40, /stealth|unauffällig/i],
  ['teamwork', '👥', 'Teamarbeit', false, 66, /teamwork|teamarbeit/i],
  ['fee', '💶', 'Gebühr', false, 2, /fee|gebühr/i],
  ['parking', '🅿️', 'Parkplatz', false, 25, /parking|parkpl/i],
  ['public', '🚌', 'ÖPNV in der Nähe', false, 26, /public|öpnv|öffentl/i],
  ['available', '🕒', 'rund um die Uhr', false, 13, /available|24.?7|jederzeit|rund um die uhr/i],
  ['wheelchair', '♿', 'rollstuhlgeeignet', false, 24, /wheelchair|rollstuhl/i],
  ['kids', '👶', 'kindgerecht', false, 6, /kids|kinder/i],
  ['dogs', '🐕', 'Hunde erlaubt', false, 1, /dogs|hunde/i],
  ['winter', '❄️', 'wintertauglich', false, 15, /winter/i],
  ['hike_long', '🥾', 'lange Wanderung', false, 57, /hike_long|long hike|lange wander/i],
  ['seasonal', '📅', 'nur saisonal', false, 62, /seasonal|saison/i]
];
function mapAttr(raw, gcId, inc) {
  let a = null;
  if (gcId != null && gcId !== '') a = ATTRS.find(x => x[4] === +gcId);
  const r = String(raw || '').trim();
  if (!a && r) a = ATTRS.find(x => x[5].test(r.replace(/[_-](yes|no)$/i, '')));
  const neg = inc != null ? !+inc : /[_-]no$|\bnicht\b|\bkein/i.test(r);
  if (!a) return r ? { key: 'x:' + r.toLowerCase(), icon: '•', label: r.replace(/[_-](yes|no)$/i, ''), tool: false, yes: !neg } : null;
  return { key: a[0], icon: a[1], label: (neg ? 'nicht: ' : '') + a[2], tool: a[3] && !neg, yes: !neg };
}
function toolAttrs(c) { return (c.attrs || []).filter(a => a.tool); }
/* Ausrüstung: übliche Cacher-Werkzeuge (Grundausstattung + „erweiterte Cache-Ausrüstung“, ECA).
   hart = ohne das Teil geht der Cache nicht (Tour überspringt ihn), sonst nur „einpacken“.
   Erkannt aus Attributen (siehe ATTRS) und aus Text: Hint und KI-Suchhilfe direkt, Listing nur mit Bedarfswort in der Nähe. */
const GEAR = [ // Schlüssel, Symbol, Text, hart, „hab ich“ vorbelegt, Muster
  ['flashlight', '🔦', 'Taschenlampe', false, true, /taschenlampe|stirnlampe/i],
  ['uv', '🟣', 'UV-Lampe / UV-Stift', true, false, /\buv\b|uv-?(lampe|licht|stift|taschenlampe|led)|schwarzlicht|unsichtbare?n? tinte/i],
  ['pen', '✏️', 'Stift', false, true, /(eigenen|kein(en)?|ohne) stift|stift (mitbringen|mitnehmen|nicht vergessen)|byop|bring your own pen/i],
  ['tweezers', '🥢', 'Pinzette', false, true, /pinzette/i],
  ['magnet', '🧲', 'Magnet / Teleskopmagnet', true, false, /teleskopmagnet|magnetstift|magnetangel|starke[nr]? magnet|magnet (mitbringen|mitnehmen|nötig|benötigt|hilft)|mit (einem|nem) magnet/i],
  ['mirror', '🪞', 'Inspektionsspiegel', false, false, /(teleskop|inspektions|zahnarzt)spiegel|spiegel (mitbringen|hilft|nötig|benötigt)/i],
  ['gloves', '🧤', 'Handschuhe', false, true, /handschuh/i],
  ['special_tool', '🔧', 'Spezialwerkzeug (Schraubendreher, Inbus, Torx …)', true, false, /schraubendreher|schraubenzieher|inbus|torx|vierkant|dreikant|bit-?satz|steckschlüssel|maulschlüssel|spezialwerkzeug/i],
  ['water', '💧', 'Wasser zum Einfüllen', true, false, /wasser (mitbringen|mitnehmen|einfüllen|nachfüllen)|(liter|flasche|kanister) wasser|wassercache/i],
  ['measure', '📏', 'Zollstock / Maßband', false, false, /zollstock|maßband|meterstab/i],
  ['ladder', '🪜', 'Leiter', true, false, /\b(trittleiter|klappleiter|stehleiter|teleskopleiter|leiter)\b/i],
  ['pole', '🎣', 'Teleskopstange / Angel', true, false, /teleskop(stange)?\b|\bangel(rute|haken)?\b|stange mit haken|greifzange/i],
  ['wading', '🥾', 'Wathose / Gummistiefel', true, false, /wathose|gummistiefel|watstiefel/i]
];
const GEAR_HARD = new Set(GEAR.filter(g => g[3]).map(g => g[0]).concat(['tree_climbing', 'climbing_gear', 'climbing', 'boat', 'scuba', 'swimming']));
const NEED = /(mitbring|mitnehm|benötig|brauch|nötig|erforderlich|hilfreich|empfohl|einpack|nicht vergessen|dabei haben|ohne .{0,20} geht)/i;
function textTools(c, ai) {
  const direct = [c.hint, c.note];
  if (ai) (ai.suchhilfe || []).forEach(h => { if (h.kategorie === 'werkzeug' || h.kategorie === 'zugang') direct.push(h.hinweis, h.zitat); });
  const dtxt = direct.filter(Boolean).map(htmlText).join('\n'), desc = htmlText(c.desc || '');
  const inDesc = re => { const g = new RegExp(re.source, 'gi'); let m; while ((m = g.exec(desc))) { if (NEED.test(desc.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80))) return true; } return false; };
  return GEAR.filter(t => t[5].test(dtxt) || inDesc(t[5])).map(t => ({ key: t[0], icon: t[1], label: t[2] + ' (aus Text)', tool: true, yes: true, derived: true }));
}
function toolsOf(c, ai) {
  const a = toolAttrs(c);
  return a.concat(textTools(c, ai).filter(d => !a.some(x => x.key === d.key)));
}
/* fehlende Ausrüstung; hartOnly: nur das, ohne das der Cache nicht geht */
function missingGear(c, set, ai, hartOnly) { return toolsOf(c, ai).filter(a => set['gear_' + a.key] === false && (!hartOnly || GEAR_HARD.has(a.key))); }

/* Tour: Reihenfolge durch Caches (nächster Nachbar + 2-opt), damit man nicht hin und her läuft */
function planTour(start, pts, loop) {
  const n = pts.length; if (!n) return [];
  const all = [start].concat(pts), D = all.map(a => all.map(b => haversine(a.lat, a.lon, b.lat, b.lon)));
  const order = [0], left = new Set(pts.map((_, i) => i + 1));
  while (left.size) { const last = order[order.length - 1]; let best = null; for (const j of left) if (best == null || D[last][j] < D[last][best]) best = j; order.push(best); left.delete(best); }
  const len = o => { let s = 0; for (let i = 1; i < o.length; i++) s += D[o[i - 1]][o[i]]; return loop ? s + D[o[o.length - 1]][0] : s; };
  let cur = len(order), better = true, guard = 0;
  while (better && guard++ < 50) {
    better = false;
    for (let i = 1; i < order.length - 1; i++) for (let k = i + 1; k < order.length; k++) {
      const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
      const l = len(cand); if (l < cur - 0.5) { order.splice(0, order.length, ...cand); cur = l; better = true; }
    }
  }
  return order.slice(1).map(i => i - 1);
}

export { ATTRS, mapAttr, toolAttrs, GEAR, GEAR_HARD, NEED, textTools, toolsOf, missingGear, planTour };
