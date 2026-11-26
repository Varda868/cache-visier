# Wettersonden: SondeHub nachgebaut – Liste, Landepunkt als Ziel, Fundmeldung, Karte, Ziel zieht mit
import asyncio, json, time
from playwright.async_api import async_playwright
NOW = time.time()
iso = lambda dt: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(NOW - dt))
SONDES = {
  'X3514173': {'serial': 'X3514173', 'type': 'RS41', 'subtype': 'RS41-SGP', 'lat': 48.30, 'lon': 11.05, 'alt': 780, 'vel_v': -3.4, 'datetime': iso(1500), 'frequency': 404.5},
  'Y0552888': {'serial': 'Y0552888', 'type': 'RS41', 'lat': 48.62, 'lon': 9.85, 'alt': 878, 'vel_v': -10.3, 'datetime': iso(4000)},
  'W1': {'serial': 'W1', 'type': 'DFM17', 'lat': 48.45, 'lon': 10.80, 'alt': 18000, 'vel_v': 5.2, 'datetime': iso(60)}}
LANDE = {'lat': 48.2950, 'lon': 11.0600}
def preds(): return [{'vehicle': 'X3514173', 'data': json.dumps([{'time': 1, 'lat': 48.30, 'lon': 11.05, 'alt': 780}, {'time': 2, 'lat': LANDE['lat'], 'lon': LANDE['lon'], 'alt': 480}])}]
REC = [{'serial': 'Y0552888', 'recovered': True, 'recovered_by': 'XR61 + XR287', 'datetime': iso(3000)[:-1], 'description': 'Waldlandung, geborgen'}]
SITES = {'10868': {'station_name': 'Muenchen-Oberschleissheim (Germany)', 'position': [11.5525, 48.2442], 'times': ['0:00:00']},
         '10954': {'station_name': 'Altenstadt (Germany)', 'position': [10.8667, 47.8342], 'times': ['2:03:00']}}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.89, 'accuracy': 6}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); anfragen = []
        async def api(route):
            u = route.request.url; anfragen.append(u.split('?')[0].rsplit('/', 1)[-1])
            body = SONDES if '/sondes?' in u else preds() if '/predictions' in u else REC if '/recovered' in u else SITES if u.endswith('/sites') else {}
            await route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(body))
        await ctx.route('https://api.v2.sondehub.org/**', api)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(900)
        await pg.click('#bList'); print('Menü ohne Schalter:', await pg.is_visible('#lSonde'))
        await pg.click('#lSet'); await pg.wait_for_timeout(200); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)")
        await pg.check('[data-k="sonden"]'); await pg.click('#sheetClose')
        await pg.click('#bList'); print('Menü mit Schalter:', await pg.is_visible('#lSonde'))
        await pg.click('#lSonde'); await pg.wait_for_timeout(1200)
        txt = ' '.join((await pg.text_content('#sheetBody')).split())
        print('Blatt:', txt[:520])
        print('Anfragen:', anfragen)
        await pg.screenshot(path='test/shot-sonden.png')
        await pg.click('[data-l="X3514173"]'); await pg.wait_for_timeout(300)
        print('Ziel:', await pg.text_content('#tName'), '|', await pg.text_content('#tSub'))
        LANDE.update({'lat': 48.2900, 'lon': 11.0700})
        await pg.evaluate('CVSonden.sondenLaden()'); await pg.wait_for_timeout(500)
        print('Ziel nachgezogen:', await pg.evaluate('CV.target.lat.toFixed(4) + " " + CV.target.lon.toFixed(4)'))
        for _ in range(3):
            if await pg.evaluate("document.body.dataset.mode") == 'map': break
            await pg.click('#bMode'); await pg.wait_for_timeout(500)
        await pg.wait_for_timeout(1200)
        print('Karte: Sonden', await pg.evaluate("document.querySelectorAll('.sondeM').length"), '| Landepunkte', await pg.evaluate("document.querySelectorAll('.sondeL').length"))
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
