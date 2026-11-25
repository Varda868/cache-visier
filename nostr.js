'use strict';
/* CacheVisier – Nostr ohne fremde Bibliotheken:
   secp256k1 / BIP-340 (Schnorr), NIP-01 Events, NIP-44 v2 (ChaCha20 + HMAC), Relay-Verbindungen,
   b:con-talk Chat (Art 4423) und Sprech-Hinweise (Art 4420) über öffentliche Relays.
   Stand der b:con-Regeln: ANBINDUNG_bcon-talk_fuer_andere_Apps.md (25.11.2026). */
(function (root) {
  const P = 2n ** 256n - 0x1000003d1n;
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n, 1n];
  const INF = [0n, 1n, 0n];
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const rnd = n => { const b = new Uint8Array(n); (root.crypto || globalThis.crypto).getRandomValues(b); return b; };

  /* ---------- Bytes ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const utf8 = s => enc.encode(s);
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16); return b; };
  const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const b2n = b => BigInt('0x' + (hex(b) || '0'));
  const n2b = n => unhex(n.toString(16).padStart(64, '0'));
  const b64 = b => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  /* ---------- Hash ---------- */
  const sha256 = async b => new Uint8Array(await subtle.digest('SHA-256', b));
  async function hmac(key, data) {
    const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, data));
  }
  const tagCache = {};
  async function taggedHash(tag, ...m) {
    const th = tagCache[tag] || (tagCache[tag] = await sha256(utf8(tag)));
    return sha256(cat(th, th, ...m));
  }
  async function hkdfExpand(prk, info, len) {
    let t = new Uint8Array(0), out = new Uint8Array(0);
    for (let i = 1; out.length < len; i++) { t = await hmac(prk, cat(t, info, new Uint8Array([i]))); out = cat(out, t); }
    return out.slice(0, len);
  }

  /* ---------- secp256k1 ---------- */
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  function pow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  const inv = (a, m = P) => pow(a, m - 2n, m);
  function dbl(p) {
    const [X, Y, Z] = p; if (Z === 0n || Y === 0n) return INF;
    const A = mod(X * X), B = mod(Y * Y), C = mod(B * B);
    const D = mod(2n * (mod((X + B) * (X + B)) - A - C)), E = mod(3n * A), F = mod(E * E);
    const X3 = mod(F - 2n * D);
    return [X3, mod(E * (D - X3) - 8n * C), mod(2n * Y * Z)];
  }
  function add(p1, p2) {
    if (p1[2] === 0n) return p2; if (p2[2] === 0n) return p1;
    const [X1, Y1, Z1] = p1, [X2, Y2, Z2] = p2;
    const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2), U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1);
    const S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
    if (U1 === U2) return S1 === S2 ? dbl(p1) : INF;
    const H = mod(U2 - U1), I = mod(4n * H * H), J = mod(H * I), r = mod(2n * (S2 - S1)), V = mod(U1 * I);
    const X3 = mod(r * r - J - 2n * V);
    return [X3, mod(r * (V - X3) - 2n * S1 * J), mod((mod((Z1 + Z2) * (Z1 + Z2)) - Z1Z1 - Z2Z2) * H)];
  }
  function mul(k, p) { let r = INF, a = p; while (k > 0n) { if (k & 1n) r = add(r, a); a = dbl(a); k >>= 1n; } return r; }
  function affine(p) { if (p[2] === 0n) return null; const zi = inv(p[2]), z2 = mod(zi * zi); return [mod(p[0] * z2), mod(p[1] * z2 * zi)]; }
  function liftX(x) {
    if (x >= P) return null;
    const c = mod(x * x * x + 7n), y = pow(c, (P + 1n) / 4n, P);
    if (mod(y * y) !== c) return null;
    return [x, (y & 1n) ? P - y : y, 1n];
  }

  /* ---------- BIP-340 ---------- */
  function getPublicKey(sk) { const d = b2n(sk); if (d <= 0n || d >= N) throw new Error('Schlüssel ungültig'); return n2b(affine(mul(d, G))[0]); }
  async function schnorrSign(msg, sk, aux) {
    const d0 = b2n(sk); if (d0 <= 0n || d0 >= N) throw new Error('Schlüssel ungültig');
    const Pa = affine(mul(d0, G)), d = (Pa[1] & 1n) ? N - d0 : d0, px = n2b(Pa[0]);
    const ah = await taggedHash('BIP0340/aux', aux || rnd(32));
    const t = n2b(d).map((x, i) => x ^ ah[i]);
    const k0 = mod(b2n(await taggedHash('BIP0340/nonce', t, px, msg)), N); if (k0 === 0n) throw new Error('k = 0');
    const R = affine(mul(k0, G)), k = (R[1] & 1n) ? N - k0 : k0, rx = n2b(R[0]);
    const e = mod(b2n(await taggedHash('BIP0340/challenge', rx, px, msg)), N);
    return cat(rx, n2b(mod(k + e * d, N)));
  }
  async function schnorrVerify(sig, msg, pub) {
    try {
      const Pp = liftX(b2n(pub)); if (!Pp) return false;
      const r = b2n(sig.slice(0, 32)), s = b2n(sig.slice(32, 64)); if (r >= P || s >= N) return false;
      const e = mod(b2n(await taggedHash('BIP0340/challenge', sig.slice(0, 32), pub, msg)), N);
      const R = affine(add(mul(s, G), mul(N - e, Pp)));
      return !!R && !(R[1] & 1n) && R[0] === r;
    } catch (e) { return false; }
  }

  /* ---------- NIP-01 Events ---------- */
  const serialize = ev => JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
  async function finishEvent(t, sk) {
    const ev = { pubkey: hex(getPublicKey(sk)), created_at: t.created_at || Math.floor(Date.now() / 1000), kind: t.kind, tags: t.tags || [], content: t.content || '' };
    ev.id = hex(await sha256(utf8(serialize(ev))));
    ev.sig = hex(await schnorrSign(unhex(ev.id), sk));
    return ev;
  }
  async function verifyEvent(ev) {
    if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey || '')) return false;
    if (hex(await sha256(utf8(serialize(ev)))) !== ev.id) return false;
    return schnorrVerify(unhex(ev.sig), unhex(ev.id), unhex(ev.pubkey));
  }

  /* ---------- ChaCha20 (RFC 8439) ---------- */
  function chacha20(key, nonce, data, counter = 0) {
    const kv = new DataView(key.buffer, key.byteOffset, 32), nv = new DataView(nonce.buffer, nonce.byteOffset, 12);
    const st = new Uint32Array(16), x = new Uint32Array(16), out = new Uint8Array(data.length);
    const rotl = (v, c) => (v << c) | (v >>> (32 - c));
    const qr = (a, b, c, d) => {
      x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 16); x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 12);
      x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 8); x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 7);
    };
    for (let pos = 0, ctr = counter; pos < data.length; pos += 64, ctr++) {
      st[0] = 0x61707865; st[1] = 0x3320646e; st[2] = 0x79622d32; st[3] = 0x6b206574;
      for (let i = 0; i < 8; i++) st[4 + i] = kv.getUint32(4 * i, true);
      st[12] = ctr; st[13] = nv.getUint32(0, true); st[14] = nv.getUint32(4, true); st[15] = nv.getUint32(8, true);
      x.set(st);
      for (let i = 0; i < 10; i++) { qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15); qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14); }
      for (let i = 0; i < 16; i++) {
        const w = (x[i] + st[i]) >>> 0;
        for (let j = 0; j < 4; j++) { const p = pos + 4 * i + j; if (p < data.length) out[p] = data[p] ^ ((w >>> (8 * j)) & 255); }
      }
    }
    return out;
  }

  /* ---------- NIP-44 v2 ---------- */
  function padLen(len) {
    if (len <= 32) return 32;
    const np = 1 << (Math.floor(Math.log2(len - 1)) + 1), chunk = np <= 256 ? 32 : np / 8;
    return chunk * (Math.floor((len - 1) / chunk) + 1);
  }
  async function conversationKey(sk, pubHex) {
    const Pp = liftX(b2n(unhex(pubHex))); if (!Pp) throw new Error('Schlüssel des Empfängers ungültig');
    const shared = n2b(affine(mul(b2n(sk), Pp))[0]);
    return hmac(utf8('nip44-v2'), shared);
  }
  async function nip44Encrypt(ck, text, nonce) {
    nonce = nonce || rnd(32);
    const pt = utf8(text); if (pt.length < 1 || pt.length > 65535) throw new Error('Textlänge ungültig');
    const k = await hkdfExpand(ck, nonce, 76);
    const padded = new Uint8Array(2 + padLen(pt.length)); padded[0] = pt.length >> 8; padded[1] = pt.length & 255; padded.set(pt, 2);
    const ct = chacha20(k.slice(0, 32), k.slice(32, 44), padded);
    const mac = await hmac(k.slice(44, 76), cat(nonce, ct));
    return b64(cat(new Uint8Array([2]), nonce, ct, mac));
  }
  async function nip44Decrypt(ck, payload) {
    if (!payload || payload[0] === '#') throw new Error('Version nicht unterstützt');
    const d = unb64(payload); if (d.length < 99 || d[0] !== 2) throw new Error('Version nicht unterstützt');
    const nonce = d.slice(1, 33), ct = d.slice(33, d.length - 32), mac = d.slice(d.length - 32);
    const k = await hkdfExpand(ck, nonce, 76), m2 = await hmac(k.slice(44, 76), cat(nonce, ct));
    let diff = 0; for (let i = 0; i < 32; i++) diff |= m2[i] ^ mac[i]; if (diff) throw new Error('MAC falsch');
    const padded = chacha20(k.slice(0, 32), k.slice(32, 44), ct), len = (padded[0] << 8) | padded[1];
    if (len < 1 || 2 + len > padded.length || padded.length - 2 !== padLen(len)) throw new Error('Polsterung falsch');
    return dec.decode(padded.slice(2, 2 + len));
  }

  /* ---------- b:con-talk ---------- */
  const KIND_TALK = 4420, KIND_CHAT = 4423;
  function regionTags(plz) {
    const r = 'DE' + String(plz || '').replace(/\D/g, '');
    if (r.length < 3) return [];
    const t = [['L', 'bcon.plz']];
    for (let i = 3; i <= r.length; i++) t.push(['l', r.slice(0, i), 'bcon.plz']);
    return t;
  }
  async function groupKey(pw) {
    const k = await subtle.importKey('raw', utf8(String(pw).normalize('NFC')), 'PBKDF2', false, ['deriveBits']); // wie bcon-app
    const ck = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8('bcon-gruppe1'), iterations: 200000 }, k, 256));
    return { ck, kennung: hex((await sha256(cat(utf8('bcon-gruppe-kennung'), ck))).slice(0, 8)) };
  }
  const tagVal = (ev, name) => { const t = (ev.tags || []).find(x => x[0] === name); return t ? t[1] : null; };

  /* ---------- Relays ---------- */
  class Pool {
    constructor(urls, onEvent, onStatus) { this.urls = urls; this.onEvent = onEvent; this.onStatus = onStatus || (() => {}); this.ws = {}; this.subs = {}; this.wait = {}; this.closed = false; this.back = {}; }
    open() { this.closed = false; this.urls.forEach(u => this._connect(u)); }
    close() { this.closed = true; Object.values(this.ws).forEach(w => { try { w.close(); } catch (e) { /* egal */ } }); this.ws = {}; this.onStatus(this.status()); }
    status() { return { offen: Object.values(this.ws).filter(w => w.readyState === 1).length, gesamt: this.urls.length }; }
    _connect(u) {
      if (this.closed) return;
      let w; try { w = new WebSocket(u); } catch (e) { return this._retry(u); }
      this.ws[u] = w;
      w.onopen = () => { this.back[u] = 0; for (const [id, f] of Object.entries(this.subs)) w.send(JSON.stringify(['REQ', id, ...f])); this.onStatus(this.status()); };
      w.onmessage = m => {
        let d; try { d = JSON.parse(m.data); } catch (e) { return; }
        if (d[0] === 'EVENT' && d[2]) this.onEvent(d[2], u);
        else if (d[0] === 'OK' && this.wait[d[1]]) this.wait[d[1]](u, d[2], d[3]);
      };
      w.onclose = () => { if (this.ws[u] === w) { delete this.ws[u]; this.onStatus(this.status()); this._retry(u); } };
      w.onerror = () => { try { w.close(); } catch (e) { /* egal */ } };
    }
    _retry(u) { if (this.closed) return; const b = this.back[u] = Math.min(60000, (this.back[u] || 2500) * 2); setTimeout(() => { if (!this.ws[u]) this._connect(u); }, b); }
    sub(id, filters) { this.subs[id] = filters; Object.values(this.ws).forEach(w => { if (w.readyState === 1) w.send(JSON.stringify(['REQ', id, ...filters])); }); }
    publish(ev, ms = 6000) {
      return new Promise(res => {
        const results = [], open = Object.values(this.ws).filter(w => w.readyState === 1);
        if (!open.length) return res(results);
        const done = () => { delete this.wait[ev.id]; res(results); };
        this.wait[ev.id] = (u, ok, msg) => { results.push({ relay: u, ok, msg }); if (results.length >= open.length) done(); };
        open.forEach(w => w.send(JSON.stringify(['EVENT', ev])));
        setTimeout(done, ms);
      });
    }
  }

  const api = { hex, unhex, utf8, b64, unb64, sha256, hmac, taggedHash, getPublicKey, schnorrSign, schnorrVerify, finishEvent, verifyEvent, serialize,
    chacha20, padLen, conversationKey, nip44Encrypt, nip44Decrypt, regionTags, groupKey, tagVal, Pool, KIND_TALK, KIND_CHAT, randomBytes: rnd };
  if (typeof module !== 'undefined') module.exports = api;
  root.CVNostr = api;
})(typeof window !== 'undefined' ? window : globalThis);
