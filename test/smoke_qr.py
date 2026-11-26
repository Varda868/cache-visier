# QR im Kamerabild (BarcodeDetector nachgebaut) und NFC lesen/schreiben (NDEFReader nachgebaut)
import asyncio
from playwright.async_api import async_playwright
MOCK = """
window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; }
  async detect(v) { return window._qr ? [{ rawValue: window._qr, boundingBox: { x: 200, y: 150, width: 160, height: 160 } }] : []; } };
window.NDEFReader = class { async scan(o) { window._nfcReader = this; } async write(m) { window._nfcWritten = JSON.stringify(m); } };
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 4}, permissions=['geolocation', 'camera', 'clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(MOCK)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(900)
        await pg.evaluate("CV.caches.set('GC2', {geocode:'GC2', name:'Stationen-Multi', type:'multi', lat:48.3712, lon:10.8700, d:2, t:2, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'})")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        for _ in range(8):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:80, gamma:0, absolute:true}))"); await pg.wait_for_timeout(60)
        print('Modus:', await pg.evaluate('CV.mode'))
        await pg.evaluate("window._qr = 'Station 2: Final bei N 48° 22.300 E 010° 52.100'"); await pg.wait_for_timeout(1800)
        print('Karte:', ' '.join((await pg.text_content('#codeCard')).split()), '| Rahmen sichtbar:', await pg.is_visible('#qrBox'))
        await pg.screenshot(path='test/shot-qr.png')
        await pg.click('#codeCard [data-c="ziel"]'); await pg.wait_for_timeout(300)
        print('Ziel:', await pg.evaluate('JSON.stringify([CV.target.label, CV.target.lat.toFixed(5), CV.target.lon.toFixed(5)])'))
        await pg.evaluate("window._qr = 'https://example.org/stage?id=3'"); await pg.wait_for_timeout(1500)
        print('Link-Karte:', ' '.join((await pg.text_content('#codeCard')).split()))
        await pg.evaluate("window._qr = ''"); await pg.click('#codeCard [data-c="zu"]')
        # NFC
        await pg.click('#bList'); await pg.click('#lMore'); await pg.wait_for_timeout(200)
        print('NFC im Menü:', await pg.is_visible('#lNfc'))
        await pg.click('#lNfc'); await pg.wait_for_timeout(300); await pg.click('#nLesen'); await pg.wait_for_timeout(400)
        await pg.evaluate("window._nfcReader.onreading({ serialNumber: '04:aa', message: { records: [{ recordType: 'text', encoding: 'utf-8', data: new TextEncoder().encode('Final N 48 22.500 E 10 52.300') }] } })")
        await pg.wait_for_timeout(300)
        print('NFC-Karte:', ' '.join((await pg.text_content('#codeCard')).split()))
        await pg.fill('#nText', 'GC2 Station 3: N 48° 22.100 E 010° 52.000'); await pg.click('#nSchreib'); await pg.wait_for_timeout(400)
        print('Geschrieben:', await pg.evaluate('window._nfcWritten'))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
