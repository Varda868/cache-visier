import asyncio, math, random
from playwright.async_api import async_playwright
LAT0, LON0 = 48.3700, 10.8700
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
def at(x, y): return {'latitude': LAT0 + y / KY, 'longitude': LON0 + x / KX, 'accuracy': 5}
async def main():
    random.seed(3)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation=at(0, 0), permissions=['geolocation', 'clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("window._said = []; window.speechSynthesis && (speechSynthesis.speak = u => window._said.push(u.text));")
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(800)
        # Cache als Ziel, Listing 3 m südwestlich vom wahren Ort
        await pg.evaluate(f"CV.caches.set('GC1', {{geocode:'GC1', name:'Test-Tradi', type:'tradi', lat:{LAT0 - 2 / KY}, lon:{LON0 - 2 / KX}, d:1.5, t:1.5, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'}})")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(200)
        await pg.click('#bList'); await pg.click('#lAvg'); await pg.wait_for_timeout(200)
        print('Blatt:', ' '.join((await pg.text_content('#sheetBody')).split())[:140])
        await pg.click('#avgGo')
        for i in range(60):
            await ctx.set_geolocation(at(random.uniform(-4, 4), random.uniform(-4, 4))); await pg.wait_for_timeout(40)
        print('Stehen:', ' '.join((await pg.text_content('#avgOut')).split())[:260])
        await pg.click('#avgCopy'); await pg.wait_for_timeout(150); print('Zwischenablage:', await pg.evaluate('navigator.clipboard.readText()'))
        # Umrunden: neu, Kreis 6 m um (2 O, 1 N)
        await pg.click('#avgNew'); await pg.check('input[name=am][value=umrunden]'); await pg.click('#avgGo')
        for i in range(90):
            a = i / 90 * 2 * math.pi * 1.25
            await ctx.set_geolocation(at(2 + 6 * math.cos(a) + random.uniform(-1, 1), 1 + 6 * math.sin(a) + random.uniform(-1, 1))); await pg.wait_for_timeout(40)
        out = ' '.join((await pg.text_content('#avgOut')).split())
        print('Umrunden:', out[:300])
        r = await pg.evaluate('CV.avg.res'); d = math.hypot((r['lon'] - LON0) * KX - 2, (r['lat'] - LAT0) * KY - 1)
        print(f"Abstand zur wahren Mitte: {d:.2f} m | Art: {r['art']} | Radius {r['radius']:.1f} m")
        await pg.click('#avgGo')
        await pg.click('#avgLog'); await pg.wait_for_timeout(300)
        print('Logtext:', await pg.input_value('#lText'))
        await pg.click('#sheetClose'); await pg.click('#bList'); await pg.click('#lAvg'); await pg.wait_for_timeout(200)
        await pg.click('#avgTarget'); await pg.wait_for_timeout(200)
        print('Ziel jetzt:', await pg.text_content('#tName'), '|', await pg.text_content('#tSub'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
