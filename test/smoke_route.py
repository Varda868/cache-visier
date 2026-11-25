import asyncio
from playwright.async_api import async_playwright
SHAPE = r'''_tgg{A_nmvS?_jAwcA?'''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37001, 'longitude': 10.87000, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(600)
        await pg.evaluate("""(shape) => { window._rc = 0; const of = window.fetch; window.fetch = async (u, o) => { u = String(u);
          if (u.includes('api/route.php')) { window._rc++; window._last = JSON.parse(o.body); window._tok = o.headers['X-App-Token'];
            return new Response(JSON.stringify({trip:{summary:{length:0.211,time:170}, legs:[{shape, maneuvers:[
              {instruction:'Nach Osten auf Testweg gehen.', begin_shape_index:0},{instruction:'Links abbiegen auf Brückenweg.', begin_shape_index:1},{instruction:'Sie haben Ihr Ziel erreicht.', begin_shape_index:2}]}]}})); }
          return of(u, o); }; }""", SHAPE)
        await pg.click('#bStart'); await pg.wait_for_timeout(1200)
        await pg.evaluate("""() => { CV.set.apiToken = 'tok123'; CV.caches.set('GC7FAX4', {geocode:'GC7FAX4', name:'Testmulti', type:'multi', lat:48.3712, lon:10.8712, d:2, t:1.5, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'}); }""")
        await pg.click('#bRoute'); await pg.wait_for_timeout(300)
        print('Toast ohne Ziel:', await pg.text_content('#toast'))
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(2200)
        print('Anfragen:', await pg.evaluate('_rc'), '| Token mitgeschickt:', await pg.evaluate('_tok'), '| Art:', await pg.evaluate('_last.costing'))
        for _ in range(25):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:270, beta:90, gamma:0, absolute:true}))"); await pg.wait_for_timeout(20)
        await pg.wait_for_timeout(300)
        print('Distanz:', await pg.text_content('#dist'), '|', await pg.text_content('#dir'))
        print('Info:', await pg.text_content('#rinfo'))
        print('Marker:', await pg.evaluate('!document.querySelector("#marker").hidden'), await pg.text_content('#mLabel'), '| Fadenkreuz grün:', await pg.evaluate('document.querySelector("#cross").classList.contains("lock")'))
        await pg.screenshot(path='shot-route.png')
        # Abseits der Route (50 m südlich) -> nach zwei Positionen neu berechnen (Sperre 20 s im Test aufheben)
        await pg.evaluate('CV.routeTs = 0')
        await ctx.set_geolocation({'latitude': 48.3695, 'longitude': 10.8706, 'accuracy': 5}); await pg.wait_for_timeout(1500)
        await pg.evaluate('CV.routeTs = 0')
        await ctx.set_geolocation({'latitude': 48.36951, 'longitude': 10.87061, 'accuracy': 5}); await pg.wait_for_timeout(1500)
        print('Abseits: Anfragen', await pg.evaluate('_rc'), '|', await pg.text_content('#dir'))
        # Kurz vor dem Ziel -> Luftlinie
        await ctx.set_geolocation({'latitude': 48.37105, 'longitude': 10.87119, 'accuracy': 5}); await pg.wait_for_timeout(1500)
        print('Am Ende:', await pg.text_content('#dir'), '| Label:', await pg.text_content('#mLabel'))
        # Server-Weg kaputt (401) -> Rückfall direkt auf FOSSGIS
        await pg.evaluate("""(shape) => { const of = window.fetch; window._dc = 0; window.fetch = async (u, o) => { u = String(u);
          if (u.includes('api/route.php')) return new Response('{"ok":false,"error":"Token falsch"}', {status: 401});
          if (u.startsWith('https://valhalla1.openstreetmap.de/route?json=')) { window._dc++; return new Response(JSON.stringify({trip:{summary:{length:0.211,time:170}, legs:[{shape, maneuvers:[{instruction:'Direkt.', begin_shape_index:0}]}]}})); }
          return of(u, o); }; }""", SHAPE)
        await pg.evaluate('CV.route = null; CV.routeTs = 0')
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(2500)
        print('Rückfall: direkte Anfragen', await pg.evaluate('_dc'), '| Toast:', await pg.text_content('#toast'), '| Weg über:', await pg.evaluate('CV.route && CV.route.via'))
        print('Label-Schriftgröße:', await pg.evaluate('getComputedStyle(document.querySelector("#mLabel")).fontSize'))
        await pg.click('#bRoute'); await pg.wait_for_timeout(200)
        print('Aus:', await pg.text_content('#dir'), '| Info leer:', (await pg.text_content('#rinfo')) == '')
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
