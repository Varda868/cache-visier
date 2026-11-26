import asyncio, json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation'])
        pg = await ctx.new_page(); errs = []; seen = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def gem(route):
            req = route.request; seen.append((req.url, req.headers.get('authorization')))
            if req.url.endswith('/models'): return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': [{'id': 'models/gemini-3.7-flash'}, {'id': 'models/gemini-x'}]}))
            out = {'kurzfassung': 'Unter dem Stein links.', 'zustand': 'gut', 'zustand_details': [], 'dnf_serie': 0, 'suchhilfe': [{'kategorie': 'versteck', 'hinweis': 'unter dem Stein', 'zitat': 'Stein', 'log_nr': 1}], 'warnungen': [], 'positionen': []}
            await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'model': 'gemini-3.7-flash', 'choices': [{'message': {'content': json.dumps(out)}}]}))
        await pg.route('https://generativelanguage.googleapis.com/**', gem)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(800)
        await pg.evaluate("CV.caches.set('GC7GD1K', {geocode:'GC7GD1K', name:'Rosenau Multi', type:'multi', lat:48.3712, lon:10.8700, d:2, t:2, size:'Small', hint:'Stein', logs:[{date:Date.now(), type:'Found it', author:'LISA', text:'unter dem Stein'}], wpts:[], src:'gpx'})")
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(300); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)")
        print('Anbieter:', await pg.locator('.kiA').count(), '| Skript-Felder versteckt:', await pg.is_hidden('#kiSkript'))
        await pg.fill('[data-k="kiKey_gemini"]', 'test-schluessel'); await pg.press('[data-k="kiKey_gemini"]', 'Tab')
        await pg.click('.kiP[data-a="gemini"]'); await pg.wait_for_timeout(600)
        print('Prüfen:', await pg.text_content('.kiA[data-a="gemini"] .kiS'))
        await pg.select_option('[data-k="kiMode"]', 'skript'); print('Skript-Modus: direkt versteckt', await pg.is_hidden('#kiDirekt'))
        await pg.select_option('[data-k="kiMode"]', 'direkt'); await pg.click('#sheetClose')
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        await pg.click('#bCache'); await pg.click('[data-tab="ki"]'); await pg.wait_for_timeout(400)
        print('Blatt vor Auswertung:', ' '.join((await pg.text_content('#sheetBody')).split())[:120])
        btn = pg.locator('#sheetBody button', has_text='auswerten')
        if await btn.count(): await btn.first.click(); await pg.wait_for_timeout(1500)
        print('Ergebnis:', ' '.join((await pg.text_content('#sheetBody')).split())[:160])
        print('Aufrufe:', [(u.split('/')[-1], a) for u, a in seen])
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
