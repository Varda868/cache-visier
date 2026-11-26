# Team-Suche: zwei Handys über einen nachgebauten Relay – Plan, Sektoren, abgesuchte Felder, Ende
import asyncio, json
from playwright.async_api import async_playwright
FAKE = open('test/smoke_talk.py').read().split('FAKE = """')[1].split('"""')[0]
CACHE = "CV.caches.set('GC1', {geocode:'GC1', name:'Hecken-Tradi', type:'tradi', lat:48.37010, lon:10.87000, d:2, t:1.5, size:'Micro', hint:'', logs:[], wpts:[], src:'gpx'})"
async def handy(b, name, lat):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': lat, 'longitude': 10.87, 'accuracy': 4}, permissions=['geolocation', 'camera'])
    pg = await ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.gesendet = 0
    await pg.add_init_script(FAKE)
    await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
    await pg.click('#bStart'); await pg.wait_for_timeout(800)
    await pg.evaluate(CACHE); await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
    await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)")
    await pg.fill('[data-k="talkName"]', name); await pg.press('[data-k="talkName"]', 'Tab')
    await pg.check('[data-k="talkOn"]'); await pg.wait_for_timeout(2000); await pg.click('#sheetClose')
    return pg
async def funk(von, zu):  # alles Neue, was "von" gesendet hat, bei "zu" ankommen lassen
    evs = await von.evaluate("i => _relaySent.filter(x => x.m[0] === 'EVENT').map(x => x.m[1]).filter((e, k, a) => a.findIndex(y => y.id === e.id) === k)")
    neu = evs[von.gesendet:]; von.gesendet = len(evs)
    for ev in neu: await zu.evaluate("ev => window._inject(ev)", ev)
    await zu.wait_for_timeout(600); return [e['kind'] for e in neu]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        A = await handy(b, 'anna', 48.37000); B = await handy(b, 'ben', 48.37022)
        await funk(A, B); await funk(B, A)
        await B.click('#bTalk'); await B.wait_for_timeout(400); await B.click('[data-q="pos"]'); await B.wait_for_timeout(800); await B.click('#sheetClose')
        print('B → A:', await funk(B, A))
        await A.click('#bTalk'); await A.wait_for_timeout(400)
        print('Knopf da:', await A.is_visible('[data-q="team"]'))
        await A.click('[data-q="team"]'); await A.wait_for_timeout(1000); await A.click('#sheetClose')
        print('A → B:', await funk(A, B))
        print('A Leiste:', ' '.join((await A.text_content('#teamBar')).split()))
        print('B Leiste:', ' '.join((await B.text_content('#teamBar')).split()))
        print('Chattext bei B:', await B.evaluate("CV.talk.msgs.filter(m => m.text.startsWith('👥')).map(m => m.text).pop()"))
        await B.click('#teamBar [data-t="mit"]'); await B.wait_for_timeout(2500)
        for pg in (A, B): await pg.evaluate("() => { CVTeam.teamTick(); return CVTeam.teamSenden(); }")
        print('Felder senden:', await funk(A, B), await funk(B, A))
        print('Felder A/B:', await A.evaluate('CV.team.zellen.size'), await B.evaluate('CV.team.zellen.size'))
        print('A Leiste:', ' '.join((await A.text_content('#teamBar')).split()))
        for _ in range(10):
            await A.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:80, gamma:0, absolute:true}))"); await A.wait_for_timeout(60)
        await A.wait_for_timeout(300); print('A Kamerabild Team-Elemente:', await A.evaluate('CV.zonenAR'))
        await A.screenshot(path='test/shot-team-cam.png')
        for _ in range(3):
            if await A.evaluate("document.body.dataset.mode") == 'map': break
            await A.click('#bMode'); await A.wait_for_timeout(500)
        await A.wait_for_timeout(1500)
        if not await A.evaluate('!!window.L'): print('Karte: Leaflet fehlt lokal (kommt erst im Build) – übersprungen')
        else: print('Karte Beschriftungen:', await A.evaluate("document.querySelectorAll('.teamLbl').length"), '| Felder:', await A.evaluate("document.querySelectorAll('.leaflet-overlay-pane path').length"))
        await A.screenshot(path='test/shot-team-map.png')
        await B.click('#teamBar [data-t="gef"]'); await B.wait_for_timeout(900)
        print('B → A:', await funk(B, A))
        print('A Leiste weg:', await A.is_hidden('#teamBar'), '| B weg:', await B.is_hidden('#teamBar'), '| Toast A:', await A.text_content('#toast'))
        print('Fehler:', A.errs, B.errs)
        await b.close()
asyncio.run(main())
