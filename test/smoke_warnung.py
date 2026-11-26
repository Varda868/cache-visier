# Warnhinweise: ungenaues GPS, fehlender Kompass in der Kamera, Ausblenden per Antippen
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(1500)
        print('nach 1,5 s:', await pg.is_visible('#warn'))
        await pg.wait_for_timeout(4500)
        print('ohne Kompass (Kamera):', await pg.is_visible('#warn') and await pg.text_content('#warn span'))
        for _ in range(3):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:90, gamma:0, absolute:true}))"); await pg.wait_for_timeout(100)
        await pg.wait_for_timeout(700); print('mit Kompass:', await pg.is_visible('#warn'))
        await ctx.set_geolocation({'latitude': 48.37001, 'longitude': 10.87, 'accuracy': 35})
        for _ in range(8):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:90, gamma:0, absolute:true}))"); await pg.wait_for_timeout(500)
        print('GPS ±35 m:', await pg.is_visible('#warn') and await pg.text_content('#warn span'))
        await pg.screenshot(path='test/shot-warn.png')
        await pg.click('#warn'); await pg.wait_for_timeout(700); print('nach Antippen:', await pg.is_visible('#warn'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
