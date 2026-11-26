/* CacheVisier · kern/sicherung: was in eine Sicherung kommt und wie sie zurückgespielt wird – ohne Browser, testbar */
const GEHEIME = ['apiToken', 'okapiKey', 'talkPw'];
const istGeheim = k => /^kiKey_/.test(k) || GEHEIME.includes(k);

/* Einstellungen für die Datei: ohne Schlüssel, außer ausdrücklich gewünscht; ocUuid gehört zum Konto und kommt mit */
function settingsFuerSicherung(set, mitSchluessel) {
  const o = {};
  for (const [k, v] of Object.entries(set || {})) if (mitSchluessel || !istGeheim(k)) o[k] = v;
  return o;
}
/* Einstellungen zurückspielen: Werte aus der Datei gelten; fehlen dort Schlüssel, bleiben die vorhandenen */
function settingsZusammen(cur, imp) {
  const o = { ...(cur || {}), ...(imp || {}) };
  for (const k of Object.keys(cur || {})) if (istGeheim(k) && !(imp && imp[k])) o[k] = cur[k];
  o.setupDone = true;
  return o;
}
/* eigene Logs ohne Doppelte (gleicher Cache, gleiche Zeit, gleicher Text) */
function logSchluessel(l) { return `${l.geocode}|${l.ts}|${(l.text || '').slice(0, 80)}`; }
function neueLogs(vorhanden, importiert) {
  const da = new Set((vorhanden || []).map(logSchluessel));
  return (importiert || []).filter(l => l && l.geocode && !da.has(logSchluessel(l)));
}
/* Prüfen, ob eine Datei eine CacheVisier-Sicherung ist */
function pruefeSicherung(d) {
  if (!d || d.app !== 'CacheVisier' || d.format !== 1) throw new Error('Keine CacheVisier-Sicherung (oder unbekanntes Format)');
  return { meta: d.meta || [], ai: d.ai || [], mylogs: d.mylogs || [], photos: d.photos || [], caches: d.caches || [] };
}
export { istGeheim, settingsFuerSicherung, settingsZusammen, logSchluessel, neueLogs, pruefeSicherung };
