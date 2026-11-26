# KI-Suchzonen im Kamerabild: Ring vor mir sichtbar, hinter mir nicht; Stecknadel am Bezugsobjekt
import asyncio, math
from playwright.async_api import async_playwright
LAT0, LON0 = 48.3700, 10.8700
KY = 110540
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': LAT0, 'longitude': LON0, 'accuracy': 4}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(900)
        await pg.evaluate(f"""() => {{ CV.caches.set('GC1', {{geocode:'GC1', name:'Bank-Tradi', type:'tradi', lat:{LAT0 + 14 / KY}, lon:{LON0}, d:1.5, t:1.5, size:'Micro', hint:'', logs:[], wpts:[], src:'gpx'}});
          CV.ai.set('GC1', {{ zustand:'gut', suchhilfe:[], zones:[
            {{ label:'8 m neben der Bank', lat:{LAT0 + 12 / KY}, lon:{LON0}, r:3, sicherheit:'hoch', alat:{LAT0 + 18 / KY}, alon:{LON0}, anker:'Bank' }},
            {{ label:'hinter mir', lat:{LAT0 - 10 / KY}, lon:{LON0}, r:3, sicherheit:'niedrig' }} ] }}); }}""")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        async def blick(alpha):
            for _ in range(12):
                await pg.evaluate(f"window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {{alpha:{alpha}, beta:80, gamma:0, absolute:true}}))"); await pg.wait_for_timeout(60)
            await pg.wait_for_timeout(200)
            return await pg.evaluate('CV.zonenAR')
        print('Blick nach Norden: Zonen im Bild', await blick(0))
        await pg.screenshot(path='test/shot-zonen.png')
        print('Blick nach Süden: Zonen im Bild', await blick(180))
        await pg.evaluate("CV.set.zonenAR = false"); print('ausgeschaltet:', await blick(0))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
