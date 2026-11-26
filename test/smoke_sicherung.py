# Sicherung: auf Gerät A bauen, auf frischem Gerät B einspielen (Logs, Fotos mit neuer Nummer, Caches), zweites Einspielen ohne Doppelte
import asyncio, json
from playwright.async_api import async_playwright
ADD = """async () => { const db = await new Promise(r => { const q = indexedDB.open('cachevisier', 1); q.onsuccess = () => r(q.result); });
  const put = (s, v, k) => new Promise((res, rej) => { const t = db.transaction(s, 'readwrite'); const q = k === undefined ? t.objectStore(s).put(v) : t.objectStore(s).put(v, k); q.onsuccess = () => res(q.result); t.onerror = () => rej(t.error); });
  const blob = await (await fetch('icon-192.png')).blob();
  const pid = await put('photos', { geocode: 'GC1', name: 'Dose', ts: 111, blob });
  await put('photos', { geocode: 'GC1', name: 'Zweites', ts: 112, blob });
  await put('mylogs', { geocode: 'GC1', name: 'Test', type: 'found', text: 'TFTC mit Foto', ts: 222, photoIds: [pid] });
  await put('caches', { geocode: 'GC1', name: 'Test', type: 'tradi', lat: 48.37, lon: 10.87, logs: [] });
  await put('meta', { geocode: 'GC1', werte: { A: 23 } }, 'multi:GC1');
  await put('meta', 'deadbeef', 'nostrSk');
  CV.set.kiKey_gemini = 'GEHEIM'; CV.set.fovH = 61; await put('meta', CV.set, 'settings'); return pid; }"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        a = await (await b.new_context(viewport={'width': 390, 'height': 844})).new_page(); errs = []
        a.on('pageerror', lambda e: errs.append(str(e)))
        await a.goto('http://127.0.0.1:8797/index.html'); await a.wait_for_timeout(600)
        pid = await a.evaluate(ADD)
        d = await a.evaluate("async () => JSON.stringify(await CVB.baueSicherung({ logs: true, stand: true, schluessel: false, caches: true }))")
        j = json.loads(d)
        keys = [k for k, v in j['meta']]
        print('Datei:', round(len(d) / 1024), 'KB | meta:', keys, '| Schlüssel drin:', 'kiKey_gemini' in dict(j['meta'])['settings'], '| Fotos:', len(j['photos']), '| Logs:', len(j['mylogs']), '| Caches:', len(j['caches']))
        # Menü-Blatt öffnen
        await a.click('#bStart'); await a.wait_for_timeout(400); await a.click('#bList'); await a.click('#lMore'); await a.click('#lBackup'); await a.wait_for_timeout(400)
        print('Blatt:', ' '.join((await a.text_content('#sheetBody')).split())[:200])
        # frisches Gerät B
        bb = await (await b.new_context(viewport={'width': 390, 'height': 844})).new_page(); bb.on('pageerror', lambda e: errs.append(str(e)))
        await bb.goto('http://127.0.0.1:8797/index.html'); await bb.wait_for_timeout(600)
        await bb.evaluate("async () => { const db = await new Promise(r => { const q = indexedDB.open('cachevisier', 1); q.onsuccess = () => r(q.result); }); await new Promise(r => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put({ geocode: 'GC9', ts: 5, blob: new Blob(['x']) }); t.oncomplete = r; }); }")  # Gerät B hat schon ein Foto (Nummer 1 belegt)
        n1 = await bb.evaluate("d => CVB.spieleEin(JSON.parse(d))", d)
        res = await bb.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('cachevisier', 1); q.onsuccess = () => r(q.result); });
          const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
          const logs = await all('mylogs'), fotos = await all('photos');
          const f = fotos.find(x => x.id === logs[0].photoIds[0]);
          return { logs: logs.length, fotos: fotos.length, logFoto: f && f.name, blobGroesse: f && f.blob.size, caches: (await all('caches')).length, fov: CV.set.fovH, key: CV.set.kiKey_gemini, setup: CV.set.setupDone }; }""")
        print('Eingespielt:', n1, '|', res)
        n2 = await bb.evaluate("d => CVB.spieleEin(JSON.parse(d))", d)
        print('Zweites Mal:', n2)
        print('Fehler:', errs)
        await b.close()
asyncio.run(main())
