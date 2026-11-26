# Checker: aus dem Multi-Final und dem Hint-Reiter, Koordinate kopiert, Checker-Link geöffnet
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation', 'clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("window._opened = []; window.open = (u) => { window._opened.push(u); return null; };")
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(500)
        await pg.evaluate("""() => { CV.caches.set('GC7AAAA', {geocode:'GC7AAAA', name:'Rätsel', type:'mystery', lat:48.4234, lon:10.8855, corrected:true, d:3, t:2, size:'Small', hint:'', logs:[], wpts:[], src:'cgeo',
          desc:'<p>Lösung prüfen bei <a href="https://www.geochecker.com/index.php?code=xyz&amp;action=check">GeoChecker</a></p>'}); }""")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(200)
        await pg.click('#bCache'); await pg.click('[data-tab="info"]'); await pg.wait_for_timeout(200)
        await pg.click('#hChk'); await pg.wait_for_timeout(200)
        print('Blatt:', ' '.join((await pg.text_content('#sheetBody')).split())[:170])
        await pg.click('li.row[data-k="0"]'); await pg.wait_for_timeout(300)
        print('kopiert:', await pg.evaluate('navigator.clipboard.readText()'), '| geöffnet:', await pg.evaluate('_opened'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
