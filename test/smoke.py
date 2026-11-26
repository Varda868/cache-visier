import asyncio, json, sys
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8797/index.html'
TEST = [{"geocode": "GC7FAX4", "name": "Testmulti Pfersee", "type": "multi", "lat": 48.3712, "lon": 10.8712, "d": 2.5, "t": 1.5, "size": "Small",
  "hint": "Unter der Bank", "owner": "X", "found": False, "disabled": False, "archived": False, "note": "", "corrected": False,
  "logs": [{"date": 1763600000000, "type": 3, "author": "B", "text": "Nix gefunden"}, {"date": 1763000000000, "type": 2, "author": "A", "text": "8 m neben der Bushaltestelle, TFTC"}],
  "wpts": [{"name": "Station 1", "prefix": "S1", "lat": 48.3705, "lon": 10.8705, "type": "stage", "note": ""}], "src": "gpx"}]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.3700, 'longitude': 10.8700, 'accuracy': 6},
                                  permissions=['geolocation', 'camera'])
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.click('#bStart'); await pg.wait_for_timeout(1500)
        # Testdaten einspielen
        await pg.evaluate("""async (list) => { const CV = window.CV; for (const c of list) CV.caches.set(c.geocode, c); }""", TEST)
        await pg.click('#bList'); await pg.wait_for_timeout(300)
        rows = await pg.locator('li.row').count(); print('Listeneinträge:', rows)
        await pg.click('li.row'); await pg.wait_for_timeout(300)
        print('Ziel:', await pg.text_content('#tName'), '|', await pg.text_content('#tSub'))
        # Handy senkrecht Richtung Norden: Ziel liegt im Norden (ca. 133 m)
        async def ori(a, b_, g):
            await pg.evaluate(f"window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {{alpha:{a}, beta:{b_}, gamma:{g}, absolute:true}}))")
        for _ in range(25): await ori(0, 90, 0); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(300)
        print('Modus:', await pg.evaluate('document.body.dataset.mode'), '| Distanz:', await pg.text_content('#dist'), '| Richtung:', await pg.text_content('#dir'))
        print('Marker sichtbar:', await pg.evaluate('!document.querySelector("#marker").hidden'), '| Rand-Pfeil:', await pg.evaluate('!document.querySelector("#edge").hidden'), '| Status:', await pg.text_content('#status'))
        for _ in range(25): await ori(326, 90, 0); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(300)
        print('Blick 34°: Marker', await pg.evaluate('!document.querySelector("#marker").hidden'), '| Fadenkreuz grün', await pg.evaluate('document.querySelector("#cross").classList.contains("lock")'), '|', await pg.text_content('#dir'))
        await pg.screenshot(path='shot-kamera.png')
        # nach Süden drehen → Rand-Pfeil
        for _ in range(25): await ori(180, 90, 0); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(200)
        print('Süden: Marker', await pg.evaluate('!document.querySelector("#marker").hidden'), '| Rand-Pfeil', await pg.evaluate('!document.querySelector("#edge").hidden'), '|', await pg.text_content('#dir'))
        # flach halten → Karte
        for _ in range(30): await ori(0, 0, 0); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(300)
        print('Flach → Modus:', await pg.evaluate('document.body.dataset.mode'))
        await pg.screenshot(path='shot-karte.png')
        for _ in range(30): await ori(0, 80, 0); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(200)
        print('Wieder senkrecht → Modus:', await pg.evaluate('document.body.dataset.mode'))
        # Blätter
        await pg.click('#bHint'); await pg.wait_for_timeout(200); await pg.click('#hRot'); print('Hint ROT13:', await pg.text_content('#hint')); await pg.click('#sheetClose')
        await pg.click('#bLogs'); await pg.wait_for_timeout(200); print('Logs:', await pg.text_content('#sheetBody p.sub')); await pg.click('#sheetClose')
        await pg.click('#bPhoto'); await pg.wait_for_timeout(1500)
        await pg.click('#bLog'); await pg.wait_for_timeout(500)
        print('Foto-Vorschauen:', await pg.locator('.thumbs img').count())
        await pg.fill('#lText', 'TFTC, Dose trocken'); await pg.click('#lSave'); await pg.wait_for_timeout(600)
        print('Offline-Logs:', await pg.locator('#sheetBody .logs li.log').count())
        await pg.screenshot(path='shot-log.png')
        await pg.click('#sheetClose')
        await pg.click('#bTorch'); await pg.wait_for_timeout(300); print('Toast Lampe:', await pg.text_content('#toast'))
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)"); print('Einstellungsfelder:', await pg.locator('#sheetBody [data-k]').count()); await pg.click('#sheetClose')
        await pg.click('#bList'); await pg.evaluate("document.querySelector('#lMoreBox').hidden && document.querySelector('#lMore').click()"); await pg.click('#lDiag'); await pg.wait_for_timeout(300); await pg.screenshot(path='shot-diag.png'); await pg.click('#sheetClose')
        # KI mit gemocktem fetch (Skript + OSM) – Weg „eigenes KI-Skript“
        await pg.evaluate("CV.set.kiMode = 'skript'; CV.set.apiUrl = './api/ki.php'")
        await pg.evaluate("""() => { const of = window.fetch; window.fetch = async (u, o) => {
          u = String(u);
          if (u.includes('api/ki.php')) return new Response(JSON.stringify({ok:true, model:'Groq · mock', result:{kurzfassung:'Magnetischer Petling unten am Geländer, Logbuch nass.', zustand:'wartung_noetig', letzter_fund:'2025-11-13', letzte_wartung:'', dnf_serie:1,
             zustand_details:[{punkt:'Logbuch nass', datum:'2025-11-19', zitat:'Logbuch nass', log_nr:1}],
             suchhilfe:[{kategorie:'versteck', hinweis:'Unterseite Geländer, Ostseite', datum:'2025-11-13', zitat:'8 m neben der Bushaltestelle', log_nr:2},{kategorie:'werkzeug', hinweis:'Pinzette mitnehmen', datum:'2025-11-13', zitat:'TFTC', log_nr:2}],
             warnungen:[{hinweis:'Zecken im hohen Gras', datum:'2025-11-19', zitat:'Nix gefunden', log_nr:1}], stationen:[], koordinaten_korrektur:null,
             positionen:[{anker:'Bushaltestelle', osm_key:'highway', osm_value:'bus_stop', abstand_m:8, richtung_grad:-1, richtung_text:'neben', zitat:'8 m neben der Bushaltestelle', log_nr:2, sicherheit:'hoch'}]}}));
          if (u.includes('openstreetmap.org/api')) return new Response(JSON.stringify({elements:[{type:'node', id:1, lat:48.37125, lon:10.87105, tags:{highway:'bus_stop', name:'Test'}}]}));
          return of(u, o); }; }""")
        await pg.click('#bAi'); await pg.click('#aGo'); await pg.wait_for_timeout(1200)
        print('KI-Blatt:', (await pg.text_content('#sheetBody'))[:220].replace('\n', ' '))
        await pg.click('q[data-l="2"] >> nth=0'); await pg.wait_for_timeout(200)
        print('Ganzer Log nach Antippen:', (await pg.locator('.ai .full:not([hidden])').first.text_content())[:80])
        print('Abschnitte:', await pg.eval_on_selector_all('#sheetBody h4', 'els => els.map(e => e.textContent)'), '| Badge:', await pg.text_content('.badge'))
        await pg.screenshot(path='shot-ki-blatt.png')
        zb = pg.locator('button[data-z]'); print('Zonen-Buttons:', await zb.count())
        if await zb.count(): await zb.first.click(); await pg.wait_for_timeout(300); print('Neues Ziel:', await pg.text_content('#tName'), '|', await pg.text_content('#dist'))
        print('Nadel:', await pg.evaluate('document.querySelector("#needle").style.transform'), '| Rand:', await pg.evaluate('document.querySelector("#edge").style.transform'))
        await pg.screenshot(path='shot-ki.png')
        print('\nFehler:', json.dumps([e for e in errs if 'leaflet' not in e.lower() and 'ERR_' not in e], ensure_ascii=False, indent=1))
        print('(ausgeblendet, wegen fehlendem Netz:)', [e[:90] for e in errs if 'leaflet' in e.lower() or 'ERR_' in e])
        await b.close()
asyncio.run(main())
