# Hilfe im Blatt, Ersteinrichtung (3 Schritte), neue untere Leiste mit Reitern
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://generativelanguage.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body='{"data":[{"id":"models/gemini-3.7-flash"}]}'))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        print('Start-Link:', await pg.get_attribute('#start a', 'href'))
        await pg.click('#bStart'); await pg.wait_for_timeout(700)
        print('Leiste:', await pg.eval_on_selector_all('#bar button small', 'e => e.map(x => x.textContent)'))
        await pg.evaluate('CVH.showSetup(0)'); await pg.wait_for_timeout(200)
        print('Schritt 1:', ' '.join((await pg.text_content('#sheetBody')).split())[:150])
        await pg.click('[data-n="1"]'); await pg.wait_for_timeout(150)
        print('Schritt 2 Knöpfe:', await pg.eval_on_selector_all('[data-l]', 'e => e.map(x => x.textContent)'))
        await pg.click('[data-n="1"]'); await pg.wait_for_timeout(150)
        await pg.fill('#sKey', ' AIza-test '); await pg.click('#sPruef'); await pg.wait_for_timeout(500)
        print('Schritt 3:', await pg.text_content('#sMsg'), '| gespeichert:', repr(await pg.evaluate('CV.set.kiKey_gemini')))
        await pg.click('[data-n="fertig"]'); await pg.wait_for_timeout(200)
        print('fertig:', await pg.evaluate('CV.set.setupDone'), '| Blatt zu:', await pg.is_hidden('#sheet'))
        await pg.click('#bList'); await pg.click('#lHelp'); await pg.wait_for_timeout(800)
        fr = pg.frame_locator('iframe.hilfe')
        print('Hilfe im Blatt:', await fr.locator('h1').text_content(), '| Abschnitte:', await fr.locator('h2').count())
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
