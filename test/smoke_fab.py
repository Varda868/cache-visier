import asyncio
from playwright.async_api import async_playwright
FAKE = open('/home/claude/cachevisier/test/smoke_talk.py').read().split('FAKE = """')[1].split('"""')[0]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.3700, 'longitude': 10.8700, 'accuracy': 5}, permissions=['geolocation', 'camera', 'microphone'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
        await pg.add_init_script(FAKE)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(1000)
        print('Knopf vor talk sichtbar:', await pg.is_visible('#fPtt'))
        await pg.evaluate("CV.caches.set('GC7GD1K', {geocode:'GC7GD1K', name:'Rosenau Multi', type:'multi', lat:48.3712, lon:10.8700, d:2, t:2, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'})")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.fill('[data-k="talkName"]', 'pfersee'); await pg.press('[data-k="talkName"]', 'Tab')
        await pg.check('[data-k="talkOn"]'); await pg.wait_for_timeout(2500)
        print('Knopf bei offenem Blatt sichtbar:', await pg.is_visible('#fPtt'))
        await pg.click('#sheetClose'); await pg.wait_for_timeout(1500)
        print('Knopf nach Schließen sichtbar:', await pg.is_visible('#fPtt'), '| Kanal:', await pg.text_content('#fPttCh'))
        await pg.screenshot(path='test/shot-fab-karte.png')
        box = await pg.locator('#fPtt').bounding_box()
        await pg.mouse.move(box['x'] + 37, box['y'] + 37); await pg.mouse.down(); await pg.wait_for_timeout(900)
        print('Während Sprechen: Klasse', await pg.get_attribute('#fPtt', 'class'), '| Text', await pg.text_content('#fPttT'))
        await pg.screenshot(path='test/shot-fab-spricht.png')
        await pg.wait_for_timeout(1300); await pg.mouse.up(); await pg.wait_for_timeout(2500)
        evs = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT' && x.m[1].kind === 4420).length")
        print('Sprech-Events gesendet:', evs, '| Toast:', await pg.text_content('#toast'), '| Klasse danach:', await pg.get_attribute('#fPtt', 'class'))
        # Loslassen, während das Mikrofon noch aufgeht (Freigabe-Dialog simuliert) -> keine hängende Aufnahme
        await pg.evaluate("""async () => { const B = await CVT.bconVoice(), o = B.mic.oeffnen.bind(B.mic); B.mic.oeffnen = async n => { await new Promise(r => setTimeout(r, 800)); B.mic.oeffnen = o; return o(n); }; }""")
        await pg.mouse.move(box['x'] + 37, box['y'] + 37); await pg.mouse.down(); await pg.wait_for_timeout(200); await pg.mouse.up(); await pg.wait_for_timeout(1500)
        evs2 = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT' && x.m[1].kind === 4420).length")
        print('Schnell losgelassen: Aufnahme', await pg.evaluate("!!CV.talk.rec"), '| neue Events', evs2 - evs, '| Toast:', await pg.text_content('#toast'))
        # Peilleiste offen -> Knopf rutscht hoch
        y1 = (await pg.locator('#fPtt').bounding_box())['y']
        await pg.evaluate("document.querySelector('#peilbar').hidden = false; document.querySelector('#peilbar').textContent = 'Peilung 123°'")
        y2 = (await pg.locator('#fPtt').bounding_box())['y']
        print('Mit Peilleiste nach oben:', round(y1 - y2), 'px')
        await pg.evaluate("document.querySelector('#peilbar').hidden = true")
        # Empfang: Knopf pulsiert
        await pg.evaluate("""async () => { const B = await CVT.bconVoice(), X = CVNostr, sk = X.randomBytes(32), g = await X.groupKey('GC7GD1K');
          const c = new B.SF.Codec(3), zeit = Math.floor(Date.now()/1000), a = new B.netz.Aufnahme(sk, { codec: 3, flags: 0, ziel: B.netz.ALLE, zeit, name: 'LISA', region: '', gruppe: 0 }, c.nb);
          for (let n = 0; n < 50; n++) { const pcm = new Int16Array(c.n); for (let i = 0; i < c.n; i++) pcm[i] = Math.sin((n * c.n + i) / 8000 * 2 * Math.PI * 440) * 8000; a.rahmen(c.kodieren(pcm)); }
          const k = await a.fertig(), kenn = await B.netz.kennung(k);
          window._inject(await X.finishEvent({ kind: 4420, created_at: zeit, tags: [['talk', kenn, '0', '1'], ['alt','b:con-Sprechfunk'], ['L','bcon.gruppe'], ['l', g.kennung, 'bcon.gruppe'], ['gruppe', g.kennung]], content: await B.netz.versiegeln(g.ck, k) }, sk)); }""")
        await pg.wait_for_timeout(700)
        print('Bei Empfang:', await pg.get_attribute('#fPtt', 'class'))
        await pg.click('#bMode'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='test/shot-fab-kamera.png')
        await pg.evaluate("CV.set.talkOn = false"); await pg.evaluate("CVT.initTalk && CVT.initTalk()")
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
