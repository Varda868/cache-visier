/* CacheVisier · kern/warnung: welche Warnung gerade gilt (GPS, Kompass) – ohne Browser, testbar.
   z: { now, startTs, pos: {acc, speed, heading, ts} | null, posTs, cam: bool, oriTs: ms | 0, head: Grad | null, st: Zustand }
   Rückgabe: { kind, text } oder null. st merkt sich Stichproben und Hysterese zwischen den Aufrufen. */
function wrapDeg(d) { return ((d + 540) % 360) - 180; }
function median(a) { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function warnState(z) {
  const st = z.st || (z.st = {}); st.dev = st.dev || []; st.gpsBad = st.gpsBad || 0;
  const { now, pos } = z;
  const since = now - (z.startTs != null ? z.startTs : now);
  // 1) kein GPS
  if (!pos) return since > 15000 ? { kind: 'nogps', text: '📡 Noch kein GPS – Standort erlauben und ins Freie gehen' } : null;
  // 2) GPS ungenau: ab ±20 m für 3 s anzeigen, erst unter ±15 m wieder weg
  if (pos.acc > 20) { st.gpsBad = st.gpsBad || now; if (now - st.gpsBad >= 3000) st.gpsOn = true; }
  else if (pos.acc < 15) { st.gpsBad = 0; st.gpsOn = false; }
  if (st.gpsOn) return { kind: 'gps', text: `📡 GPS ungenau (±${Math.round(pos.acc)} m) – Abstand und Markierung unsicher. Kurz warten, freier Himmel hilft.` };
  // 3) Kompass fehlt oder hängt (nur wichtig in der Kamera)
  if (z.cam) {
    if (!z.oriTs && since > 5000) return { kind: 'nocompass', text: '🧭 Kein Kompass – Bewegungssensoren für die Seite erlauben (Schloss-Symbol in der Adresszeile)' };
    if (z.oriTs && now - z.oriTs > 3000) return { kind: 'stale', text: '🧭 Kompass hängt – Handy kurz bewegen' };
  }
  // 4) Kompass weicht von der Laufrichtung ab: beim Gehen (> 1,2 m/s) Kompass mit GPS-Kurs vergleichen
  if (z.head != null && pos.speed > 1.2 && pos.heading != null && isFinite(pos.heading) && pos.ts !== st.lastTs) {
    st.lastTs = pos.ts; st.dev.push({ t: now, d: Math.abs(wrapDeg(z.head - pos.heading)) });
  }
  st.dev = st.dev.filter(x => now - x.t < 20000);
  if (st.dev.length >= 6) {
    const m = median(st.dev.map(x => x.d));
    if (m > 40) st.devOn = true; else if (m < 25) st.devOn = false;
    if (st.devOn) return { kind: 'dev', text: `🧭 Kompass weicht ~${Math.round(m)}° von der Laufrichtung ab – Handy in Form einer 8 schwenken` };
  } else if (!st.dev.length) st.devOn = false;
  return null;
}
export { warnState, wrapDeg, median };
