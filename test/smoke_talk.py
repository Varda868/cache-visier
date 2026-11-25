import asyncio
from playwright.async_api import async_playwright
FAKE = """
window._relaySent = [];
class FakeWS { constructor(u) { this.url = u; this.readyState = 0; FakeWS.all.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30); }
  send(d) { const m = JSON.parse(d); window._relaySent.push({ url: this.url, m });
    if (m[0] === 'REQ') { this.sub = m[1]; this.filters = m.slice(2); setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(['EOSE', m[1]]) }), 10); }
    if (m[0] === 'EVENT') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(['OK', m[1].id, true, '']) }), 10); }
  close() { this.readyState = 3; this.onclose && this.onclose(); } }
FakeWS.all = []; window.WebSocket = FakeWS;
window._inject = ev => FakeWS.all.forEach(w => w.readyState === 1 && w.sub && w.onmessage({ data: JSON.stringify(['EVENT', w.sub, ev]) }));
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.3700, 'longitude': 10.8700, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(FAKE)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(600)
        await pg.click('#bStart'); await pg.wait_for_timeout(1000)
        print('Knopf vor dem Einschalten sichtbar:', await pg.is_visible('#bTalk'))
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.fill('[data-k="talkName"]', 'pfersee'); await pg.press('[data-k="talkName"]', 'Tab')
        await pg.fill('[data-k="talkPlz"]', '86157'); await pg.press('[data-k="talkPlz"]', 'Tab')
        await pg.check('[data-k="talkOn"]'); await pg.wait_for_timeout(1500)
        await pg.click('#sheetClose')
        print('Knopf sichtbar:', await pg.is_visible('#bTalk'))
        reqs = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'REQ').map(x => x.url + ' ' + JSON.stringify(x.m.slice(2)))")
        print('Abo:', reqs[:1], f'({len(reqs)} Relays)')
        await pg.click('#bTalk'); await pg.wait_for_timeout(300)
        print('Status:', await pg.text_content('#talkStatus'))
        await pg.fill('#tText', 'Hallo von CacheVisier'); await pg.click('#tSend'); await pg.wait_for_timeout(800)
        ev = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT').map(x => x.m[1])[0]")
        print('Gesendet: kind', ev['kind'], '| tags', [t[0] + '=' + t[1] for t in ev['tags']], '| content', ev['content'])
        print('Signatur gültig:', await pg.evaluate("ev => CVNostr.verifyEvent(ev)", ev))
        print('Liste:', ' '.join((await pg.text_content('#talkList')).split())[:90])
        await pg.click('#sheetClose')
        # Nachricht von jemand anderem (eigener Schlüssel, Region DE861..)
        await pg.evaluate("""async () => { const X = CVNostr, sk = X.randomBytes(32); sk[0] &= 0x7f;
          const ev = await X.finishEvent({ kind: 4423, tags: X.regionTags('86163').concat([['alt','b:con-Chat'],['expiration', String(Math.floor(Date.now()/1000)+3600)]]),
            content: JSON.stringify({ n: 'LISA', t: 'Bin am Brunnen 📍 N 48° 22.300 E 010° 52.100', p: 0 }) }, sk);
          window._inject(ev); const bad = { ...ev, content: ev.content.replace('LISA', 'MALLORY') }; window._inject(bad); }""")
        await pg.wait_for_timeout(800)
        print('Ungelesen:', await pg.get_attribute('#bTalk', 'data-n'), '| Toast:', await pg.text_content('#toast'))
        print('Position gemerkt:', await pg.evaluate("Object.values(CV.talk.pos).map(p => p.name + ' ' + p.lat.toFixed(5))"), '| Fälschung angezeigt:', await pg.evaluate("CV.talk.msgs.some(m => m.name === 'MALLORY')"))
        # Gruppe
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200)
        await pg.fill('[data-k="talkPw"]', 'geheim'); await pg.press('[data-k="talkPw"]', 'Tab'); await pg.wait_for_timeout(3500)
        await pg.click('#sheetClose')
        await pg.click('#bTalk'); await pg.wait_for_timeout(300)
        print('Status Gruppe:', await pg.text_content('#talkStatus'))
        await pg.click('[data-q="pos"]'); await pg.wait_for_timeout(1000)
        evs = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT').map(x => x.m[1])")
        g = evs[-1]
        print('Gruppen-Event: gruppe-Tag', [t for t in g['tags'] if t[0] == 'gruppe'], '| content verschlüsselt:', not g['content'].startswith('{'))
        print('Entschlüsselt (gleiches Passwort):', await pg.evaluate("async c => { const gk = await CVNostr.groupKey('geheim'); return CVNostr.nip44Decrypt(gk.ck, c); }", g['content']))
        # fremde Gruppe darf nicht erscheinen, eigene Gruppe von anderem Absender schon
        await pg.evaluate("""async () => { const X = CVNostr, sk = X.randomBytes(32); sk[0] &= 0x7f;
          for (const [pw, txt] of [['geheim', 'Gruppe: Station 2 hat A=7'], ['anders', 'fremde Gruppe']]) { const g = await X.groupKey(pw);
            const ev = await X.finishEvent({ kind: 4423, tags: X.regionTags('86157').concat([['gruppe', g.kennung]]), content: await X.nip44Encrypt(g.ck, JSON.stringify({ n: 'PETER', t: txt, p: 0 })) }, sk);
            window._inject(ev); } }""")
        await pg.wait_for_timeout(4000)
        print('Liste Gruppe:', ' '.join((await pg.text_content('#talkList')).split())[-140:])
        print('fremde Gruppe sichtbar:', await pg.evaluate("CV.talk.msgs.some(m => m.text === 'fremde Gruppe')"))
        print('Schlüssel nur lokal (IndexedDB), nicht in den Einstellungen:', await pg.evaluate("!JSON.stringify(CV.set).includes(CVNostr.hex(CV.talk.sk))"))
        await pg.screenshot(path='/tmp/shot-talk.png')
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
