import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.3700, 'longitude': 10.8700, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("""window._said = []; window._buzz = [];
          window.speechSynthesis && (speechSynthesis.speak = u => window._said.push(u.text)); navigator.vibrate = p => { window._buzz.push(p); return true; };""")
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(600)
        await pg.click('#bStart'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""() => {
          const A = (k, ...r) => ({ key: k, icon: r[0], label: r[1], tool: r[2], yes: true });
          CV.caches.set('GC1', {geocode:'GC1', name:'Nah-Tradi', type:'tradi', lat:48.3712, lon:10.8700, d:1.5, t:1.5, size:'Small', hint:'', logs:[], wpts:[], src:'gpx',
             attrs:[{key:'flashlight', icon:'🔦', label:'Taschenlampe nötig', tool:true, yes:true}, {key:'parking', icon:'🅿️', label:'Parkplatz', tool:false, yes:true}]});
          CV.caches.set('GC2', {geocode:'GC2', name:'Boots-Cache', type:'tradi', lat:48.3705, lon:10.8705, d:2, t:4, size:'Small', hint:'', logs:[], wpts:[], src:'gpx',
             attrs:[{key:'boat', icon:'🚣', label:'Boot nötig', tool:true, yes:true}]});
          CV.caches.set('GC3', {geocode:'GC3', name:'Rätsel ungelöst', type:'mystery', lat:48.3701, lon:10.8701, d:3, t:2, size:'Micro', hint:'', logs:[], wpts:[], src:'gpx'});
          CV.caches.set('GC4', {geocode:'GC4', name:'Weiter-Tradi', type:'tradi', lat:48.3740, lon:10.8700, d:1, t:1, size:'Regular', hint:'', logs:[], wpts:[], src:'gpx'});
        }""")
        await pg.click('#bList'); await pg.wait_for_timeout(200)
        rows = await pg.eval_on_selector_all('li.row small', 'els => els.map(e => e.textContent)')
        print('Liste:', rows)
        await pg.click('li.row[data-g="GC1"]'); await pg.wait_for_timeout(300)
        print('Kopfzeile:', await pg.text_content('#tSub'))
        await pg.click('#bCache'); await pg.click('[data-tab="info"]'); await pg.wait_for_timeout(200)
        print('Info:', ' '.join((await pg.text_content('#sheetBody')).split())[:200]); await pg.click('#sheetClose')
        # Ansagen: 133 m → Stufe 100 m bei Annäherung
        await ctx.set_geolocation({'latitude': 48.37032, 'longitude': 10.8700, 'accuracy': 5}); await pg.wait_for_timeout(1200)
        await ctx.set_geolocation({'latitude': 48.37090, 'longitude': 10.8700, 'accuracy': 5}); await pg.wait_for_timeout(1200)
        print('Gesagt:', await pg.evaluate('_said.filter(t => t.trim())'), '| Vibration:', await pg.evaluate('_buzz.length'))
        # Nachtmodus
        await pg.click('#bNight'); await pg.wait_for_timeout(600)
        print('Nacht:', await pg.evaluate("document.body.classList.contains('night')"), '| Schleier:', await pg.evaluate("getComputedStyle(document.querySelector('#nightveil')).display"), '| Hinweis:', await pg.text_content('#spotInfo'))
        await pg.screenshot(path='/tmp/shot-nacht.png')
        await pg.click('#bNight')
        # Peilung eingeben: 100 Schritte zu 0,75 m nach 90° vom Standort
        await pg.click('#bList'); await pg.evaluate("document.querySelector('#lMoreBox').hidden && document.querySelector('#lMore').click()"); await pg.click('#lPeil'); await pg.wait_for_timeout(200)
        await pg.fill('#pDist', '100'); await pg.select_option('#pUnit', 'steps'); await pg.fill('#pDeg', '90'); await pg.click('#pCalc'); await pg.wait_for_timeout(200)
        print('Peilung:', ' '.join((await pg.text_content('#pRes')).split())[:110])
        # Mit der Kamera peilen: Handy Richtung Osten, leicht nach unten geneigt (beta 80 → Kamera 10° nach unten)
        await pg.click('#pMeasure'); await pg.wait_for_timeout(200)
        for _ in range(25):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:270, beta:80, gamma:0, absolute:true}))"); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(300)
        print('Peilleiste:', await pg.text_content('#pbVal'))
        await pg.click('#pbBoth'); await pg.wait_for_timeout(300)
        print('Übernommen:', await pg.input_value('#pDeg'), '°', await pg.input_value('#pDist'), 'm |', ' '.join((await pg.text_content('#pRes')).split())[:60])
        await pg.click('#sheetClose')
        # Gefunden & weiter (GC2 Boot wird übersprungen, GC3 ungelöst übersprungen → GC4)
        await pg.click('#bLog'); await pg.wait_for_timeout(300)
        await pg.fill('#lText', 'TFTC'); await pg.click('#lNext'); await pg.wait_for_timeout(600)
        print('Weiter zu:', await pg.text_content('#tName'), '| Toast:', await pg.text_content('#toast'))
        print('GC1 gefunden:', await pg.evaluate("CV.caches.get('GC1').found"), '| letzte Ansage:', (await pg.evaluate('_said'))[-1])
        await pg.evaluate("""() => { for (const [g, la, lo] of [['GC5', 48.3760, 10.8700], ['GC6', 48.3720, 10.8700], ['GC7', 48.3790, 10.8700], ['GC8', 48.3745, 10.8701]])
             CV.caches.set(g, {geocode: g, name: 'Linie ' + g, type: 'tradi', lat: la, lon: lo, d: 1, t: 1, size: 'Small', hint: g === 'GC8' ? 'Leiter nötig' : '', logs: [], wpts: [], src: 'gpx'}); }""")
        await pg.click('#bList'); await pg.click('#lTour'); await pg.wait_for_timeout(300)
        print('Tour:', await pg.eval_on_selector_all('#sheetBody li.row b', 'els => els.map(e => e.textContent)'), '|', ' '.join((await pg.text_content('#sheetBody p.sub')).split())[:90])
        await pg.click('#tNew'); await pg.wait_for_timeout(300)
        print('Neu geplant:', await pg.eval_on_selector_all('#sheetBody li.row b', 'els => els.map(e => e.textContent)'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
