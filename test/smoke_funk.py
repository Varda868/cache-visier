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
        await pg.evaluate("CV.caches.set('GC7GD1K', {geocode:'GC7GD1K', name:'Rosenau Multi', type:'multi', lat:48.3712, lon:10.8700, d:2, t:2, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'})")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.fill('[data-k="talkName"]', 'pfersee'); await pg.press('[data-k="talkName"]', 'Tab')
        await pg.select_option('[data-k="talkLive"]', 'cache+team')
        await pg.check('[data-k="talkOn"]'); await pg.wait_for_timeout(2500); await pg.click('#sheetClose')
        await pg.click('#bTalk'); await pg.wait_for_timeout(2500)
        print('Bausteine geladen:', await pg.evaluate("typeof Codec2Modul + ' / ' + typeof Sprechfunk"))
        box = await pg.locator('#tPtt').bounding_box()
        await pg.mouse.move(box['x'] + 50, box['y'] + 20); await pg.mouse.down(); await pg.wait_for_timeout(600)
        print('Taste während Sprechen:', await pg.text_content('#tPtt'))
        await pg.wait_for_timeout(1800); await pg.mouse.up(); await pg.wait_for_timeout(2500)
        evs = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT' && x.m[1].kind === 4420).map(x => x.m[1])")
        print('Sprech-Events:', len(evs) // 3, 'Teil(e) je Relay | tags:', [t[0] for t in evs[0]['tags']] if evs else None, '| Toast:', await pg.text_content('#toast'))
        chk = await pg.evaluate("""async ev => { const B = await CVT.bconVoice(), g = await CVNostr.groupKey('GC7GD1K');
          const i = await B.netz.teilLesen(ev, null, new Map([[g.kennung, g]])), s = new B.netz.Sammler(), k = await s.teil(i), d = k && await B.netz.kompaktLesen(k);
          return d ? { name: d.kopf.name, codec: d.kopf.codec, pakete: d.pakete.length, bytes: d.pakete.reduce((n, p) => n + p.length, 0), signatur: d.signatur } : null; }""", evs[0])
        print('Von b:con-Code gelesen:', chk)
        print('Liste:', ' '.join((await pg.text_content('#talkList')).split())[-80:])
        # Sprachnachricht von LISA (mit den b:con-Bausteinen gebaut) kommt an und wird abgespielt
        await pg.evaluate("""async () => { const B = await CVT.bconVoice(), X = CVNostr, sk = X.randomBytes(32); sk[0] &= 0x7f, g = await X.groupKey('GC7GD1K');
          const c = new B.SF.Codec(3), zeit = Math.floor(Date.now()/1000), a = new B.netz.Aufnahme(sk, { codec: 3, flags: 0, ziel: B.netz.ALLE, zeit, name: 'LISA', region: '', gruppe: 0 }, c.nb);
          for (let n = 0; n < 40; n++) { const pcm = new Int16Array(c.n); for (let i = 0; i < c.n; i++) pcm[i] = Math.sin((n * c.n + i) / 8000 * 2 * Math.PI * 440) * 8000; a.rahmen(c.kodieren(pcm)); }
          const k = await a.fertig(), kenn = await B.netz.kennung(k);
          window._lisaPk = X.hex(X.getPublicKey(sk));
          const ev = await X.finishEvent({ kind: 4420, created_at: zeit, tags: [['talk', kenn, '0', '1'], ['alt','b:con-Sprechfunk'], ['L','bcon.gruppe'], ['l', g.kennung, 'bcon.gruppe'], ['gruppe', g.kennung]], content: await B.netz.versiegeln(g.ck, k) }, sk);
          window._inject(ev);
          const lp = await X.finishEvent({ kind: 20442, tags: [['L','bcon.gruppe'], ['l', g.kennung, 'bcon.gruppe'], ['gruppe', g.kennung]], content: await X.nip44Encrypt(g.ck, JSON.stringify({ n: 'LISA', lat: 48.37030, lon: 10.87010, acc: 4 })) }, sk);
          window._inject(lp); }""")
        await pg.wait_for_timeout(1500)
        print('Wiedergabe läuft:', await pg.evaluate("CV.talk.playing"), '| Liste:', ' '.join((await pg.text_content('#talkList')).split())[-60:])
        print('Mitcacher:', await pg.text_content('#talkMates'))
        await pg.wait_for_timeout(2500)
        await pg.evaluate("CVT.liveSenden()"); await pg.wait_for_timeout(800)
        live = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT' && x.m[1].kind === 20442).map(x => x.m[1].tags.map(t => t[0]).join(','))")
        print('Eigene Live-Position gesendet:', len(live) // 3, 'Kanal | tags', live[:1])
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
