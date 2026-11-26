# Akku: Kamera nach 3 s Karte aus, beim Aufrichten wieder an; mit Lampe bleibt sie an; abschaltbar
import asyncio
from playwright.async_api import async_playwright
FLACH = "window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:0, gamma:0, absolute:true}))"
HOCH = "window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:90, gamma:0, absolute:true}))"
async def halten(pg, js, ms):
    for _ in range(ms // 100): await pg.evaluate(js); await pg.wait_for_timeout(100)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(1200)
        st = "() => ({ modus: CV.mode, kamera: !!CV.stream && CV.stream.getVideoTracks()[0].readyState })"
        await halten(pg, HOCH, 800); print('senkrecht:', await pg.evaluate(st))
        await halten(pg, FLACH, 1500); print('flach 1,5 s:', await pg.evaluate(st))
        await halten(pg, FLACH, 2500); print('flach 4 s:', await pg.evaluate(st))
        await halten(pg, HOCH, 1500); print('wieder senkrecht:', await pg.evaluate(st), '| Neustart ms:', await pg.evaluate('CV.camRestartMs'))
        await pg.evaluate("CV.torch = true"); await halten(pg, FLACH, 4000); print('flach mit Lampe:', await pg.evaluate(st)); await pg.evaluate("CV.torch = false")
        await halten(pg, HOCH, 800); await pg.evaluate("CV.set.camSave = false"); await halten(pg, FLACH, 4000); print('flach, Sparen aus:', await pg.evaluate(st))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
