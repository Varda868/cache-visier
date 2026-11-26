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
        await pg.evaluate("CV.caches.set('GC7GD1K', {geocode:'GC7GD1K', name:'Rosenau Multi', type:'multi', lat:48.3712, lon:10.8700, d:2, t:2, size:'Small', hint:'', logs:[], wpts:[], src:'gpx'})")
        await pg.click('#bList'); await pg.click('li.row'); await pg.wait_for_timeout(300)
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)")
        await pg.fill('[data-k="talkName"]', 'pfersee'); await pg.press('[data-k="talkName"]', 'Tab')
        await pg.check('[data-k="talkOn"]'); await pg.wait_for_timeout(2500)
        await pg.click('#sheetClose')
        print('Knopf sichtbar:', await pg.is_visible('#bTalk'))
        gk = await pg.evaluate("CVNostr.groupKey('GC7GD1K').then(g => g.kennung)")
        reqs = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'REQ').map(x => JSON.stringify(x.m.slice(2)))")
        print('Abo enthält Cache-Kanal:', any(gk in r for r in reqs), '| letztes Abo:', reqs[-1][:150])
        await pg.click('#bTalk'); await pg.wait_for_timeout(500)
        print('Status:', await pg.text_content('#talkStatus'))
        await pg.fill('#tText', 'Bin an Station 1'); await pg.click('#tSend'); await pg.wait_for_timeout(800)
        ev = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT').map(x => x.m[1]).pop()")
        print('Gesendet: kind', ev['kind'], '| tags', [t[0] + '=' + t[1][:16] for t in ev['tags']], '| verschlüsselt:', not ev['content'].startswith('{'))
        print('Signatur gültig:', await pg.evaluate("ev => CVNostr.verifyEvent(ev)", ev))
        print('Liste:', ' '.join((await pg.text_content('#talkList')).split())[:90])
        await pg.click('#sheetClose')
        # andere Cacher: am selben Cache (sichtbar), an einem anderen Cache (unsichtbar)
        await pg.evaluate("""async () => { const X = CVNostr, sk = X.randomBytes(32); sk[0] &= 0x7f;
          for (const [code, txt] of [['GC7GD1K', 'Station 2 ist hinter der Hecke 📍 N 48° 22.300 E 010° 52.100'], ['GC1234X', 'anderer Cache']]) { const g = await X.groupKey(code);
            const ev = await X.finishEvent({ kind: 4423, tags: [['L','bcon.gruppe'],['l',g.kennung,'bcon.gruppe'],['gruppe', g.kennung],['expiration', String(Math.floor(Date.now()/1000)+3600)]],
              content: await X.nip44Encrypt(g.ck, JSON.stringify({ n: 'LISA', t: txt, p: 0 })) }, sk);
            window._inject(ev); window._inject({ ...ev, sig: ev.sig.replace(/^./, c => c === 'a' ? 'b' : 'a') }); } }""")
        await pg.wait_for_timeout(4000)
        print('Ungelesen:', await pg.get_attribute('#bTalk', 'data-n'), '| Toast:', await pg.text_content('#toast'))
        print('anderer Cache sichtbar:', await pg.evaluate("CV.talk.msgs.some(m => m.text === 'anderer Cache')"), '| Position gemerkt:', await pg.evaluate("Object.values(CV.talk.pos).map(p => p.name)"))
        # Team-Passwort dazu
        await pg.click('#bList'); await pg.click('#lSet'); await pg.wait_for_timeout(200); await pg.evaluate("document.querySelectorAll('details.grp').forEach(d => d.open = true)")
        await pg.fill('[data-k="talkPw"]', 'geheim'); await pg.press('[data-k="talkPw"]', 'Tab'); await pg.wait_for_timeout(4000)
        await pg.click('#sheetClose')
        await pg.click('#bTalk'); await pg.wait_for_timeout(600)
        print('Kanäle:', await pg.text_content('#tChan'), '| Status:', await pg.text_content('#talkStatus'))
        await pg.check('input[name=tch][value=team]'); await pg.click('[data-q="pos"]'); await pg.wait_for_timeout(900)
        g = await pg.evaluate("_relaySent.filter(x => x.m[0] === 'EVENT').map(x => x.m[1]).pop()")
        team = await pg.evaluate("CVNostr.groupKey('geheim').then(g => g.kennung)")
        print('Team-Event mit Team-Kennung:', any(t[0] == 'gruppe' and t[1] == team for t in g['tags']))
        print('Liste:', ' '.join((await pg.text_content('#talkList')).split())[-160:])
        await pg.screenshot(path='/tmp/shot-talk.png')
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
