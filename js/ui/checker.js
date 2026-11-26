/* CacheVisier · ui/checker: berechnete oder korrigierte Koordinate mit dem Checker aus dem Listing prüfen.
   Ein Tipp kopiert die Koordinate im passenden Format und öffnet den Checker; ein Captcha löst der Nutzer selbst. */
import { checkerCoord, findCheckers } from '../kern/caches.js';
import { esc, fmtCoord } from '../kern/geo.js';
import { openSheet, toast } from './basis.js';

function checkerFuer(c) {
  const list = findCheckers(c.desc);
  if (/^GC/i.test(c.geocode || '')) list.push({ name: 'geocaching.com (Checker im Listing)', url: 'https://coord.info/' + c.geocode, captcha: false, format: 'normal', gc: true });
  return list;
}
function showChecker(c, lat, lon, woher) {
  const list = checkerFuer(c), hat = lat != null && lon != null;
  openSheet(`✔️ Prüfen · ${c.geocode}`, `
    ${hat ? `<p>Koordinate${woher ? ` (${esc(woher)})` : ''}:</p><p class="coord">${fmtCoord(lat, lon)}</p>` : '<p class="sub">Noch keine berechnete oder korrigierte Koordinate – der Checker öffnet sich trotzdem.</p>'}
    <ul class="list">${list.map((k, i) => `<li class="row" data-k="${i}"><div class="grow"><b>${esc(k.name)}</b><small>${k.captcha ? '🔒 mit Captcha – das löst du selbst' : k.gc ? 'Listing öffnet sich, Checker steht unter der Beschreibung' : esc(new URL(k.url).hostname)}</small></div><span>↗</span></li>`).join('')
      || '<li class="empty">Kein Checker im Listing gefunden.</li>'}</ul>
    <p class="sub">Antippen kopiert die Koordinate${hat ? '' : ' (falls vorhanden)'} und öffnet den Checker. Dort einfügen und prüfen. Ergebnis immer mit den Logs vergleichen.</p>`, b => {
    b.querySelectorAll('[data-k]').forEach(li => {
      li.onclick = () => {
        const k = list[+li.dataset.k];
        if (hat) { const txt = checkerCoord(lat, lon, k.format); navigator.clipboard.writeText(txt).then(() => toast('📋 ' + txt + ' – im Checker einfügen', 5000)).catch(() => toast('Kopieren ging nicht: ' + txt, 6000)); }
        window.open(k.url, '_blank', 'noopener');
      };
    });
  });
}
export { checkerFuer, showChecker };
