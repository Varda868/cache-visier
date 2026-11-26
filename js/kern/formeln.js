import { destPoint, fmtCoord } from './geo.js';

/* --- Multi: Ausdrücke rechnen, Koordinaten-Vorlagen füllen, Stationen auflösen --- */
function quersumme(n) { return String(Math.abs(Math.trunc(n))).split('').reduce((a, d) => a + +d, 0); }
function evalExpr(src, vars) {
  const s = String(src == null ? '' : src).replace(/×/g, '*').replace(/÷/g, '/').replace(/(\d),(\d)/g, '$1.$2');
  let i = 0; const missing = new Set();
  const peek = () => { while (s[i] === ' ') i++; return s[i]; };
  const FN = { QS: quersumme, IQS: n => { n = Math.abs(Math.trunc(n)); while (n > 9) n = quersumme(n); return n; },
    ABS: Math.abs, RUND: Math.round, ROUND: Math.round, INT: Math.trunc, FLOOR: Math.floor };
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error('Klammer fehlt'); i++; return v; }
    if (c === '-') { i++; return -primary(); }
    if (c === '+') { i++; return primary(); }
    if (c != null && /[0-9.]/.test(c)) { const j = i; while (/[0-9.]/.test(s[i] || '')) i++; return parseFloat(s.slice(j, i)); }
    if (c != null && /[A-Za-z_]/.test(c)) {
      const j = i; while (/[A-Za-z0-9_]/.test(s[i] || '')) i++;
      const name = s.slice(j, i);
      if (peek() === '(') {
        const f = FN[name.toUpperCase()]; if (!f) throw new Error('Unbekannte Funktion ' + name);
        i++; const v = sum(); if (peek() !== ')') throw new Error('Klammer fehlt'); i++; return isNaN(v) ? NaN : f(v);
      }
      const k = Object.keys(vars || {}).find(x => x.toUpperCase() === name.toUpperCase());
      const raw = k != null ? String(vars[k]).trim().replace(',', '.') : '';
      const v = raw === '' ? NaN : Number(raw);
      if (isNaN(v)) { missing.add(name.toUpperCase()); return NaN; }
      return v;
    }
    throw new Error(c == null ? 'Ausdruck endet zu früh' : 'Unerwartetes Zeichen ' + c);
  }
  function pow() { const v = primary(); if (peek() === '^') { i++; return Math.pow(v, pow()); } return v; }
  function prod() { let v = pow(); for (;;) { const c = peek(); if (c === '*') { i++; v *= pow(); } else if (c === '/') { i++; v /= pow(); } else if (c === '%') { i++; v %= pow(); } else return v; } }
  function sum() { let v = prod(); for (;;) { const c = peek(); if (c === '+') { i++; v += prod(); } else if (c === '-') { i++; v -= prod(); } else return v; } }
  if (peek() == null) return { value: null, missing: [] };
  const v = sum(); if (peek() != null) throw new Error('Unerwartet: ' + s.slice(i));
  return { value: missing.size ? null : v, missing: [...missing] };
}
function fillTemplate(tpl, vars) {
  const missing = new Set(); let err = null;
  const text = String(tpl || '').replace(/\{([^{}]*)\}/g, (_, ex) => {
    try {
      const r = evalExpr(ex, vars);
      if (r.value == null) { r.missing.forEach(m => missing.add(m)); return '?'; }
      return Number.isInteger(r.value) ? String(r.value) : String(Math.round(r.value * 1000) / 1000);
    } catch (e) { err = e.message; return '⚠'; }
  });
  return { text, missing: [...missing], err, ok: !missing.size && !err };
}
function parseCoord(t) {
  t = String(t || '').replace(/(\d),(\d)/g, '$1.$2').replace(/[′'’]/g, ' ');
  let m = /([NS])\s*(\d{1,2})\s*°?\s+(\d{1,2}(?:\.\d+)?)\s*[,;]?\s*([EOW])\s*(\d{1,3})\s*°?\s+(\d{1,2}(?:\.\d+)?)/i.exec(t)
    || /([NS])\s*(\d{1,2})°\s*(\d{1,2}(?:\.\d+)?)\s*[,;]?\s*([EOW])\s*(\d{1,3})°\s*(\d{1,2}(?:\.\d+)?)/i.exec(t);
  if (m) {
    if (+m[3] >= 60 || +m[6] >= 60) return null;
    return { lat: (+m[2] + +m[3] / 60) * (/s/i.test(m[1]) ? -1 : 1), lon: (+m[5] + +m[6] / 60) * (/w/i.test(m[4]) ? -1 : 1) };
  }
  m = /(-?\d{1,2}\.\d{3,})\s*[ ,;]\s*(-?\d{1,3}\.\d{3,})/.exec(t);
  return m ? { lat: +m[1], lon: +m[2] } : null;
}
/* Ort einer Station/des Finals: base = Listing-Koordinaten, pts = schon aufgelöste Stationen nach Nummer */
function resolvePoint(p, vars, base, pts) {
  try {
    if (!p || p.art === 'unbekannt') return { missing: [], text: '' };
    if (p.art === 'listing') return base ? { lat: base.lat, lon: base.lon, text: fmtCoord(base.lat, base.lon) } : { missing: [], text: '' };
    if (p.art === 'koordinaten' || p.art === 'formel') {
      const f = fillTemplate(p.vorlage, vars);
      if (!f.ok) return { text: f.text, missing: f.missing, err: f.err };
      const c = parseCoord(f.text);
      return c ? { lat: c.lat, lon: c.lon, text: f.text } : { text: f.text, missing: [], err: 'Koordinate nicht lesbar' };
    }
    if (p.art === 'projektion') {
      const from = !p.von || /listing/i.test(p.von) ? base : pts[String(p.von).replace(/\D/g, '')];
      const d = evalExpr(p.distanz, vars), w = evalExpr(p.winkel, vars), miss = d.missing.concat(w.missing);
      const what = `Peilung ${p.distanz || '?'} m / ${p.winkel || '?'}°`;
      if (miss.length || d.value == null || w.value == null) return { missing: miss, text: what };
      if (!from || from.lat == null) return { missing: [], text: what, err: 'Startpunkt der Peilung fehlt' };
      const q = destPoint(from.lat, from.lon, d.value, w.value);
      return { lat: q.lat, lon: q.lon, text: `${fmtCoord(q.lat, q.lon)} (${Math.round(d.value)} m / ${Math.round(w.value)}°)` };
    }
  } catch (e) { return { missing: [], text: p.vorlage || '', err: e.message }; }
  return { missing: [], text: '' };
}
function stationVarsDone(st, vars) { return (st.variablen || []).every(v => vars[v.name] != null && String(vars[v.name]).trim() !== ''); }

export { quersumme, evalExpr, fillTemplate, parseCoord, resolvePoint, stationVarsDone };
