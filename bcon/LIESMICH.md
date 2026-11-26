# b:con-Bausteine (aus bcon-app, App 65, Commit 78eab39)

Unverändert übernommen, damit CacheVisier bytegleich zur b:con-App spricht und hört:

| Datei | Zweck | Lizenz |
|---|---|---|
| `codec2.js` | Codec2 als WebAssembly (Emscripten, `Codec2Modul()`), bitgleich zu drowe67/codec2 310777b | Codec2: LGPL-2.1 (Projekt drowe67/codec2, `LICENSE-codec2`) |
| `sprechfunk.js` | Codec2-Hülle, Mikrofon (AudioWorklet 8 kHz), Wiedergabe mit Jitterpuffer | bcon-app: AGPL-3.0 (`LICENSE-bcon-app-AGPL-3.0`) |
| `netz.js` | Kompaktform, Strom-Signatur „bcon-talk1“, Art 4420 in Teilen, NIP-44 | bcon-app: AGPL-3.0 |
| `secp256k1.js` | noble-secp256k1 (Schnorr, ECDH) | MIT (`LICENSE-noble-secp256k1`) |

Aktualisieren: Dateien aus `bcon-app/talk/` und `bcon-app/nostr/` erneut hierher kopieren.
Lizenztext von Codec2 (LGPL-2.1): `LICENSE-codec2`.
