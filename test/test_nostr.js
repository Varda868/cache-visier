'use strict';
const assert = require('assert');
const X = require('../nostr.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('✓', name); };
(async () => {
  await t('BIP-340 Testvektor 0', async () => {
    const sk = X.unhex('0000000000000000000000000000000000000000000000000000000000000003');
    assert.strictEqual(X.hex(X.getPublicKey(sk)).toUpperCase(), 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9');
    const sig = await X.schnorrSign(new Uint8Array(32), sk, new Uint8Array(32));
    assert.strictEqual(X.hex(sig).toUpperCase(), 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0');
    assert.ok(await X.schnorrVerify(sig, new Uint8Array(32), X.getPublicKey(sk)));
    const bad = sig.slice(); bad[63] ^= 1; assert.ok(!(await X.schnorrVerify(bad, new Uint8Array(32), X.getPublicKey(sk))));
  });
  await t('ChaCha20 RFC 8439 2.3.2', async () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i), nonce = X.unhex('000000090000004a00000000');
    const ks = X.chacha20(key, nonce, new Uint8Array(64), 1);
    assert.strictEqual(X.hex(ks), '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e');
  });
  await t('NIP-44 Polsterung', async () => {
    for (const [a, b] of [[16, 32], [32, 32], [33, 64], [37, 64], [45, 64], [49, 64], [64, 64], [65, 96], [100, 128], [111, 128], [200, 224], [250, 256], [320, 320], [383, 384], [384, 384], [400, 448], [500, 512], [512, 512], [515, 640], [700, 768], [800, 896], [900, 1024], [1020, 1024], [65536, 65536]])
      assert.strictEqual(X.padLen(a), b, `padLen(${a})`);
  });
  await t('NIP-44 Testvektor (sec 1/2, Nonce 1, "a")', async () => {
    const ck = await X.conversationKey(X.unhex('0000000000000000000000000000000000000000000000000000000000000001'), X.hex(X.getPublicKey(X.unhex('0000000000000000000000000000000000000000000000000000000000000002'))));
    assert.strictEqual(X.hex(ck), 'c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d');
    const nonce = X.unhex('0000000000000000000000000000000000000000000000000000000000000001');
    const p = await X.nip44Encrypt(ck, 'a', nonce);
    assert.strictEqual(p, 'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb');
    assert.strictEqual(await X.nip44Decrypt(ck, p), 'a');
    const p2 = await X.nip44Encrypt(ck, 'Grüße 🧭 ' + 'x'.repeat(300));
    assert.strictEqual(await X.nip44Decrypt(ck, p2), 'Grüße 🧭 ' + 'x'.repeat(300));
    const broken = p2.slice(0, 60) + (p2[60] === 'A' ? 'B' : 'A') + p2.slice(61);
    await assert.rejects(() => X.nip44Decrypt(ck, broken));
  });
  await t('Event signieren und prüfen', async () => {
    const sk = X.randomBytes(32); sk[0] &= 0x7f;
    const ev = await X.finishEvent({ kind: 4423, tags: [['alt', 'b:con-Chat'], ['l', 'DE86', 'bcon.plz']], content: '{"n":"TEST","t":"Hallo \\"Welt\\"\\nÄÖÜ 🧭","p":0}' }, sk);
    assert.ok(await X.verifyEvent(ev));
    assert.ok(!(await X.verifyEvent({ ...ev, content: ev.content + ' ' })));
    console.log('   ' + JSON.stringify({ sk: X.hex(sk), ev }));
  });
  await t('b:con: Region und Gruppe', async () => {
    assert.deepStrictEqual(X.regionTags('86157').map(t => t[1]), ['bcon.plz', 'DE8', 'DE86', 'DE861', 'DE8615', 'DE86157']);
    const g1 = await X.groupKey('geheim'), g2 = await X.groupKey('geheim'), g3 = await X.groupKey('anders');
    assert.strictEqual(X.hex(g1.ck), X.hex(g2.ck)); assert.notStrictEqual(g1.kennung, g3.kennung); assert.strictEqual(g1.kennung.length, 16);
    console.log('   Gruppe "geheim":', X.hex(g1.ck), g1.kennung);
  });
  console.log(`\n${n} Nostr-Tests bestanden`);
})().catch(e => { console.error(e); process.exit(1); });
