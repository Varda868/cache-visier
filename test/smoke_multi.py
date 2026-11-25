import asyncio, json
from playwright.async_api import async_playwright
MULTI = {"stationen": [
  {"nr": 1, "name": "Brunnen", "art": "listing", "vorlage": "", "von": "", "distanz": "", "winkel": "", "aufgabe": "Zähle die Latten am Zaun hinter dem Brunnen = A", "variablen": [{"name": "A", "frage": "Anzahl Latten am Zaun"}]},
  {"nr": 2, "name": "Tafel", "art": "projektion", "von": "1", "distanz": "A*10", "winkel": "90", "vorlage": "", "aufgabe": "Jahreszahl auf der Tafel, Quersumme = B", "variablen": [{"name": "B", "frage": "Quersumme der Jahreszahl"}]}],
  "final": {"art": "formel", "vorlage": "N 48° 22.{A}{B} E 010° 52.{A+B}0", "von": "", "distanz": "", "winkel": "", "text": "N 48 22.AB E 010 52.(A+B)0"}, "regeln": ""}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.3700, 'longitude': 10.8700, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(600)
        await pg.evaluate("""(multi) => { window._calls = []; const of = window.fetch; window.fetch = async (u, o) => { u = String(u);
          if (u.includes('api/ki.php')) { const body = JSON.parse(o.body); window._calls.push({aktion: body.aktion, bildKB: body.bild ? Math.round(body.bild.length / 1024) : 0, frage: body.station && body.station.aufgabe, besch: body.beschreibung && body.beschreibung.slice(0, 40)});
            if (body.aktion === 'multi') return new Response(JSON.stringify({ok: true, model: 'Groq · mock', result: multi}));
            if (body.aktion === 'foto') return new Response(JSON.stringify({ok: true, model: 'Gemini · mock', result: {gelesen: '23 senkrechte Latten', werte: [{name: body.station.variablen[0].name, wert: '23', begruendung: 'links 12, rechts 11', sicherheit: 'mittel'}]}})); }
          return of(u, o); }; }""", MULTI)
        await pg.click('#bStart'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""() => { CV.caches.set('GC9MULT', {geocode:'GC9MULT', name:'Lattenmulti', type:'multi', lat:48.3701, lon:10.8701, d:2, t:1.5, size:'Small', hint:'',
           desc:'<p>Station 1 am Brunnen: Zähle die Latten = A.</p><p>Station 2: peile A*10 m nach Osten.</p>', logs:[], wpts:[{name:'Stage 2', prefix:'S2', lat:null, lon:null, type:'stage', note:'Tafel'}], src:'gpx'}); }""")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(500)
        print('Kärtchen vorher:', (await pg.text_content('#stage')).strip()[:80])
        await pg.click('#stage [data-a="open"]'); await pg.wait_for_timeout(300)
        await pg.click('#mGo'); await pg.wait_for_timeout(800)
        print('KI-Aufrufe:', await pg.evaluate('_calls'))
        print('Kärtchen:', ' '.join((await pg.text_content('#stage')).split())[:160])
        await pg.click('#sheetClose')
        # Foto aus der Kamera-App (Dateiauswahl mit capture)
        async with pg.expect_file_chooser() as fc:
            await pg.click('#stage [data-a="foto"]')
        ch = await fc.value
        print('Dateiauswahl: capture =', await ch.element.get_attribute('capture'), '| accept =', await ch.element.get_attribute('accept'))
        await ch.set_files('/tmp/zaun.jpg'); await pg.wait_for_timeout(1500)
        print('Foto-Aufruf:', (await pg.evaluate('_calls'))[-1])
        print('Vorschlag:', ' '.join((await pg.locator('#stn1 .foto').text_content()).split()))
        await pg.click('#stn1 [data-take="A"]'); await pg.wait_for_timeout(400)
        print('A eingetragen:', await pg.input_value('#stn1 input[data-v="A"]'), '| S2-Ort:', await pg.text_content('#stn2 .coord'))
        await pg.fill('#stn2 input[data-v="B"]', '7'); await pg.press('#stn2 input[data-v="B"]', 'Tab'); await pg.wait_for_timeout(400)
        print('Final:', await pg.text_content('.stn.final .coord.big'), '|', ' '.join((await pg.text_content('.stn.final small')).split()))
        await pg.screenshot(path='/tmp/shot-multi.png')
        await pg.click('#mFin'); await pg.wait_for_timeout(300)
        print('Ziel:', await pg.text_content('#tName'), '| Kärtchen:', ' '.join((await pg.text_content('#stage')).split())[:90])
        # Freie Foto-Frage
        await pg.click('#bAi'); await pg.click('#aAsk'); await pg.wait_for_timeout(200)
        await pg.fill('#fq', 'Wie viele Latten hat der Zaun?')
        async with pg.expect_file_chooser() as fc:
            await pg.click('#fGal')
        ch = await fc.value; print('Galerie: capture =', await ch.element.get_attribute('capture'))
        await ch.set_files('/tmp/zaun.jpg'); await pg.wait_for_timeout(1500)
        print('Antwort:', ' '.join((await pg.text_content('#fr')).split())[:120])
        await pg.screenshot(path='/tmp/shot-frage.png')
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
