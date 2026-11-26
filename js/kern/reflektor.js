/* --- Reflektoren (Firetacks) im Kamerabild: kleine, sehr helle Flecken vor dunklem Grund --- */
function findBrightSpots(px, w, h, o) {
  o = o || {};
  const N = w * h, Y = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) { const y = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]; Y[i] = y; sum += y; }
  // Schwelle robust aus Median und MAD: große helle Flächen (Laterne) sollen kleine Reflektoren nicht „überstrahlen“
  const hist = new Uint32Array(256); for (let i = 0; i < N; i++) hist[Math.min(255, Y[i] | 0)]++;
  const q = f => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= f * N) return v; } return 255; };
  const med = q(0.5), mean = sum / N;
  const dev = new Uint32Array(256); for (let v = 0; v < 256; v++) dev[Math.abs(v - med)] += hist[v];
  let c = 0, mad = 0; for (let v = 0; v < 256; v++) { c += dev[v]; if (c >= N / 2) { mad = v; break; } }
  const thr = Math.max(o.min || 200, med + (o.k || 6) * 1.4826 * Math.max(mad, 2)), maxArea = Math.max(4, N * (o.maxFrac || 0.004));
  const seen = new Uint8Array(N), spots = [], stack = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0] || Y[s0] < thr) continue;
    let n = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0, mx = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    stack.push(s0); seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      n++; sx += x; sy += y; sr += px[4 * i]; sg += px[4 * i + 1]; sb += px[4 * i + 2]; if (Y[i] > mx) mx = Y[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= N || seen[j] || Y[j] < thr) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (n > maxArea) continue;                                   // große helle Fläche (Laterne, Himmel) ist kein Reflektor
    let bs = 0, bn = 0; const m = 3;                             // Hintergrund: Rahmen um den Fleck
    for (let y = Math.max(0, y0 - m); y <= Math.min(h - 1, y1 + m); y++) for (let x = Math.max(0, x0 - m); x <= Math.min(w - 1, x1 + m); x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue; bs += Y[y * w + x]; bn++;
    }
    const bg = bn ? bs / bn : mean, contrast = mx - bg;
    if (contrast < (o.contrast || 70)) continue;
    if (n < (o.minN || 2) && contrast < (o.strong || 130)) continue; // einzelnes helles Pixel: meist Rauschen, nur sehr kräftige zählen
    spots.push({ x: sx / n, y: sy / n, r: Math.max(1, Math.max(x1 - x0, y1 - y0) / 2), n, rgb: [sr / n, sg / n, sb / n], score: contrast * Math.sqrt(n) });
  }
  return mergeSpots(spots, o.merge == null ? Math.max(6, w * 0.035) : o.merge).sort((a, b) => b.score - a.score).slice(0, o.max || 8);
}
/* Flecken, die näher als d Pixel beieinander liegen, als einen Reflektor zählen (Mitte gewichtet, Farbe vom hellsten) */
function mergeSpots(spots, d) {
  const g = spots.map((p, i) => i), find = i => (g[i] === i ? i : (g[i] = find(g[i])));
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const a = spots[i], b = spots[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r < d) g[find(i)] = find(j);
  }
  const by = new Map();
  spots.forEach((p, i) => { const k = find(i); (by.get(k) || by.set(k, []).get(k)).push(p); });
  return [...by.values()].map(ps => {
    const w = ps.reduce((s, p) => s + p.score, 0), top = ps.reduce((a, b) => (b.score > a.score ? b : a));
    const x = ps.reduce((s, p) => s + p.x * p.score, 0) / w, y = ps.reduce((s, p) => s + p.y * p.score, 0) / w;
    const r = Math.max(...ps.map(p => Math.hypot(p.x - x, p.y - y) + p.r));
    return { x, y, r, n: ps.reduce((s, p) => s + p.n, 0), rgb: top.rgb, score: w, teile: ps.length };
  });
}
function colorName(rgb) {
  const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 45) return 'weiß';
  const hue = mx === r ? ((g - b) / (mx - mn) * 60 + 360) % 360 : mx === g ? (b - r) / (mx - mn) * 60 + 120 : (r - g) / (mx - mn) * 60 + 240;
  return hue < 20 || hue >= 330 ? 'rot' : hue < 45 ? 'orange' : hue < 70 ? 'gelb' : hue < 170 ? 'grün' : hue < 260 ? 'blau' : 'violett';
}
/* --- Reflektoren über mehrere Bilder verfolgen, damit die Anzeige ruhig bleibt ---
   dets: Funde eines Bildes {fx, fy, fr, rgb, score, teile} (Lage relativ zur Bildbreite/-höhe).
   Jeder Fund wird dem nächsten bekannten Reflektor zugeordnet (Fenster gate). Angezeigt wird ein Reflektor erst,
   wenn er in 2 der letzten 3 Bilder da war, und er bleibt bis zu hold ms (Standard 0,8 s) stehen, wenn er kurz fehlt.
   Lage und Größe laufen weich nach, die Farbe entscheidet eine abklingende Mehrheit (Wechsel erst bei klarem Vorsprung),
   der hervorgehobene Reflektor wechselt nur, wenn ein anderer deutlich stärker ist. */
function trackSpots(st, dets, now, o) {
  o = o || {};
  const gate = o.gate || 0.07, hold = o.hold || 800, a = o.alpha || 0.45, need = o.need || 2;
  st = st || { tracks: [], next: 1, primary: null };
  const tr = st.tracks, used = new Set();
  for (const d of [...dets].sort((p, q) => q.score - p.score)) {
    let best = null, bd = Infinity;
    for (const t of tr) {
      if (used.has(t)) continue;
      const dist = Math.hypot(t.fx - d.fx, t.fy - d.fy);
      const g = t.shown ? Math.max(gate, t.fr * 3) : Math.max(gate * 0.35, t.fr * 2); // neue Kandidaten nur bei fast gleicher Lage bestätigen (Rauschen)
      if (dist < g && dist < bd) { bd = dist; best = t; }
    }
    const name = colorName(d.rgb);
    if (best) {
      used.add(best);
      best.fx += a * (d.fx - best.fx); best.fy += a * (d.fy - best.fy); best.fr += 0.3 * (d.fr - best.fr);
      best.score += 0.4 * (d.score - best.score); best.teile = d.teile || 1; best.last = now; best.hits.push(1); best.px = Math.max(best.px || 0, d.n || 2);
      best.rgb = d.rgb;
      for (const k in best.votes) best.votes[k] *= 0.8;
      best.votes[name] = (best.votes[name] || 0) + 1;
      const lead = Object.keys(best.votes).reduce((x, y) => (best.votes[y] > best.votes[x] ? y : x));
      if (lead !== best.name && best.votes[lead] > 1.3 * (best.votes[best.name] || 0)) best.name = lead;
    } else {
      const t = { id: st.next++, fx: d.fx, fy: d.fy, fr: d.fr, score: d.score, teile: d.teile || 1, rgb: d.rgb, name, votes: { [name]: 1 }, hits: [1], last: now, shown: false, px: d.n || 2 };
      tr.push(t); used.add(t);
    }
  }
  for (const t of tr) if (!used.has(t)) t.hits.push(0);
  for (const t of tr) {
    if (t.hits.length > 3) t.hits.splice(0, t.hits.length - 3);
    if (!t.shown && t.hits.reduce((x, y) => x + y, 0) >= (t.px < 2 ? 3 : need)) t.shown = true; // ein einzelnes Pixel muss 3 von 3 Bildern da sein
  }
  st.tracks = tr.filter(t => now - t.last <= hold && (t.shown || t.hits.some(Boolean)));
  const vis = st.tracks.filter(t => t.shown).sort((p, q) => q.score - p.score).slice(0, o.max || 8);
  const cur = vis.find(t => t.id === st.primary);
  if (vis.length && (!cur || vis[0].score > 1.5 * cur.score)) st.primary = vis[0].id;
  if (!vis.length) st.primary = null;
  st.visible = vis.map(t => ({ id: t.id, fx: t.fx, fy: t.fy, fr: t.fr, name: t.name, teile: t.teile, score: t.score, primary: t.id === st.primary }));
  return st;
}

/* Ansagen: größte Stufe unterhalb der Entfernung */
const ANN_STEPS = [2000, 1000, 500, 200, 100, 50, 20, 10];
function annStepBelow(d) { return ANN_STEPS.find(x => x < d) == null ? null : ANN_STEPS.find(x => x < d); }

export { findBrightSpots, mergeSpots, colorName, trackSpots, ANN_STEPS, annStepBelow };
