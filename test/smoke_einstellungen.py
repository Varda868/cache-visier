# Einstellungen: Eingabe bleibt beim direkten Schließen, Leerzeichen weg, Zahlen begrenzt, OKAPI-Fehler verständlich
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation'], has_touch=True)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(500)
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.click('summary:has-text("Opencaching")')
        await pg.click('[data-k="okapiKey"]'); await pg.keyboard.type('  ABCdef123 \t')
        await pg.evaluate("document.querySelector('#sheetClose').click()"); await pg.wait_for_timeout(600)
        print('Schlüssel gespeichert (getrimmt):', repr(await pg.evaluate('CV.set.okapiKey')))
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.click('summary:has-text("Daten")')
        await pg.fill('[data-k="maxLogs"]', '400'); await pg.press('[data-k="maxLogs"]', 'Tab'); await pg.wait_for_timeout(200)
        print('Logs 400:', await pg.evaluate('CV.set.maxLogs'), '| Hinweis:', (await pg.text_content('#toast'))[:60])
        await pg.fill('[data-k="maxLogs"]', '900'); await pg.press('[data-k="maxLogs"]', 'Tab'); await pg.wait_for_timeout(200)
        print('Logs 900 →', await pg.evaluate('CV.set.maxLogs'), '| Feld:', await pg.input_value('[data-k="maxLogs"]'))
        # OKAPI mit ungültigem Schlüssel: verständliche Meldung (gemockt, ohne Netz)
        await pg.route('https://www.opencaching.de/**', lambda r: r.fulfill(status=400, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"error":{"developer_message":"Parameter \'consumer_key\' has invalid value: Consumer does not exist.","status":400}}'))
        await pg.click('#sheetClose'); await pg.click('#bList'); await pg.click('#lOc'); await pg.wait_for_timeout(800)
        print('Meldung:', await pg.text_content('#toast'))
        # OKAPI-Suche mit Benutzer: not_found_by statt found_status (das bräuchte OAuth)
        urls = []
        async def oc(route):
            u = route.request.url; urls.append(u)
            if 'users/by_username' in u: body = '{"uuid":"U-123"}'
            elif 'search/nearest' in u: body = '{"results":["OC1","OC2"]}'
            else: body = '{"OC1":{"code":"OC1","name":"Eins","location":"48.37|10.87","type":"Traditional","status":"Available","is_found":false,"latest_logs":[],"alt_wpts":[],"attrnames":[]},"OC2":{"code":"OC2","name":"Zwei","location":"48.371|10.871","type":"Traditional","status":"Available","is_found":true,"latest_logs":[],"alt_wpts":[],"attrnames":[]}}'
            await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=body)
        await pg.unroute('https://www.opencaching.de/**'); await pg.route('https://www.opencaching.de/**', oc)
        await pg.evaluate("CV.set.okapiKey = 'K'; CV.set.ocUser = 'pferseeer'; CV.set.ocUuid = ''; CV.set.hideFound = true")
        await pg.click('#lOc'); await pg.wait_for_timeout(800)
        su = [u for u in urls if 'search/nearest' in u][0]
        print('Suche:', 'not_found_by=U-123' in su, '| found_status:', 'found_status' in su, '| geladen:', await pg.evaluate("[...CV.caches.keys()].filter(k => k.startsWith('OC'))"), '|', await pg.text_content('#toast'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
