# Zielzone: beim ersten Erreichen D/T, Größe und letzten Log zeigen und ansagen – nur einmal, nicht an Zwischenstationen
import asyncio, math
from playwright.async_api import async_playwright
LAT0, LON0 = 48.3700, 10.8700
KY, KX = 110540, 111320 * math.cos(math.radians(48.37))
def at(n): return {'latitude': LAT0 - n / KY, 'longitude': LON0, 'accuracy': 5}   # n Meter südlich vom Cache
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation=at(80), permissions=['geolocation'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("window._said = []; window.speechSynthesis && (speechSynthesis.speak = u => window._said.push(u.text));")
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(700)
        await pg.evaluate(f"""() => {{ const d = Date.now();
          CV.caches.set('GC1', {{geocode:'GC1', name:'Zaun-Tradi', type:'tradi', lat:{LAT0}, lon:{LON0}, d:2, t:1.5, size:'Micro', hint:'', wpts:[{{prefix:'S1', name:'Station 1', lat:{LAT0 - 40 / KY}, lon:{LON0}}}], src:'gpx',
            logs:[{{type:'Found it', date:d - 2*86400000, author:'LISA', text:'Dose nass'}}, {{type:'Didn\\'t find it', date:d - 5*86400000, author:'Tom', text:''}}]}}); }}""")
        # erst die Zwischenstation als Ziel: dort keine Karte
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(200)
        await pg.evaluate(f"CV.target = {{kind:'wpt', geocode:'GC1', lat:{LAT0 - 40 / KY}, lon:{LON0}, label:'S1 Station 1', name:'Zaun-Tradi'}}")
        await ctx.set_geolocation(at(42)); await pg.wait_for_timeout(700)
        print('An Station:', await pg.is_visible('#arrive'))
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(200)   # Cache wieder als Ziel
        await ctx.set_geolocation(at(40)); await pg.wait_for_timeout(500); print('40 m:', await pg.is_visible('#arrive'))
        await ctx.set_geolocation(at(20)); await pg.wait_for_timeout(700)
        print('20 m:', await pg.is_visible('#arrive'), '|', ' '.join((await pg.text_content('#arrive')).split()))
        print('Ansage:', [t for t in await pg.evaluate('_said') if 'Zielzone' in t])
        await pg.screenshot(path='test/shot-ankunft.png')
        await pg.click('#arrive [data-a="zu"]'); await pg.wait_for_timeout(500)
        await ctx.set_geolocation(at(60)); await pg.wait_for_timeout(500); await ctx.set_geolocation(at(15)); await pg.wait_for_timeout(700)
        print('erneut in der Zone:', await pg.is_visible('#arrive'), '| Zielzone-Ansagen:', len([t for t in await pg.evaluate('_said') if 'Zielzone' in t]))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
