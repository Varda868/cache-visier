import asyncio
from playwright.async_api import async_playwright
# Nachgebautes Kamerabild: drei Reflektoren mit Handzittern, ein flackernder, dazu Pixelrauschen.
FAKE_CAM = """
(() => {
  const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640; const g = cv.getContext('2d'); let f = 0;
  const dots = [[100, 200, '#ffffff'], [250, 300, '#ffe040'], [180, 480, '#90ff90']];
  setInterval(() => {
    f++; g.fillStyle = '#101214'; g.fillRect(0, 0, 360, 640);
    for (const [x, y, c] of dots) { g.fillStyle = c; g.beginPath(); g.arc(x + (Math.random() - .5) * 8, y + (Math.random() - .5) * 8, 3, 0, 7); g.fill(); }
    if (Math.random() < .5) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(300, 120, 2.5, 0, 7); g.fill(); }   // flackert
    g.fillStyle = '#ffffff'; for (let i = 0; i < 25; i++) g.fillRect(Math.random() * 360 | 0, Math.random() * 640 | 0, 1, 1); // Rauschen
  }, 33);
  const s = cv.captureStream(30);
  navigator.mediaDevices.getUserMedia = async () => s;
})();
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 48.37, 'longitude': 10.87, 'accuracy': 5}, permissions=['geolocation', 'camera'])
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(FAKE_CAM)
        await pg.goto('http://127.0.0.1:8797/index.html'); await pg.wait_for_timeout(500)
        await pg.click('#bStart'); await pg.wait_for_timeout(1200)
        for _ in range(5):
            await pg.evaluate("window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), {alpha:0, beta:90, gamma:0, absolute:true}))"); await pg.wait_for_timeout(50)
        await pg.click('#bNight'); await pg.wait_for_timeout(1500)
        samples = await pg.evaluate("""async () => { const out = [];
          for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100));
            out.push({ raw: CV.spotRaw, n: CV.spots.length, ids: CV.spots.map(s => s.id), names: CV.spots.map(s => s.name), prim: (CV.spots.find(s => s.primary) || {}).id, x: CV.spots.map(s => s.fx) }); }
          return { mode: CV.mode, out }; }""")
        out = samples['out']; counts = [s['n'] for s in out]
        changes = sum(1 for a, c in zip(counts, counts[1:]) if a != c)
        allids = sorted({i for s in out for i in s['ids']}); prims = {s['prim'] for s in out}
        names = {}
        for s in out:
            for i, nm in zip(s['ids'], s['names']): names.setdefault(i, set()).add(nm)
        raw = [s['raw'] for s in out]; rch = sum(1 for a, c in zip(raw, raw[1:]) if a != c)
        pos = {}
        for s in out:
            for i, x in zip(s['ids'], s['x']): pos.setdefault(i, []).append(round(x, 3))
        print('Modus:', samples['mode'])
        print('Einzelbild (alt):  ', raw, '| Wechsel:', rch)
        print('Verfolgt (neu):    ', counts)
        print('Lage x je Reflektor (min–max):', {k: (min(v), max(v)) for k, v in pos.items()})
        print('Wechsel der Anzahl in 4 s:', changes, '| verschiedene Kennungen:', len(allids), '| Hervorhebung:', prims)
        print('Farben je Reflektor:', {k: sorted(v) for k, v in names.items()})
        print('Info:', await pg.text_content('#spotInfo'), '| Fehler:', errs)
        await pg.screenshot(path='test/shot-reflektor.png')
        await b.close()
asyncio.run(main())
