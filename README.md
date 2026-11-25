# CacheVisier 0.1

PWA zum Cachen vor Ort.
- **Handy senkrecht:** Kamerabild mit Fadenkreuz, Markierung über dem Ziel, Abstand und Richtung.
- **Handy flach:** OSM-Karte mit dir, Ziel, Wegpunkten und KI-Suchzonen.

Dazu: Hint (verschwommen, ROT13), D/T, Größe, Logs zum Scrollen, Lampe, Fotos, Offline-Logs mit Feldnotiz-Export, KI-Auswertung der Logs.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `style.css`, `app.js` | die App |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Installation, Offline-Betrieb, Empfang über „Teilen“ |
| `api/inc.php`, `api/route.php` | gemeinsamer Start (Konfiguration, Token); Weiterleitung zu Valhalla |
| `api/ki.php` | KI-Skript auf deinem Server. Die Schlüssel bleiben dort, die App kennt nur ein Token. |
| `api/config.sample.php` | Vorlage für `api/config.php` |
| `test/` | Tests: `node test/test.js`; Browser-Test `smoke.py` mit Playwright |

## Einrichten

1. **Hochladen** auf einen Webspace mit **HTTPS**, z. B. nach `games.thai-klasse.de/cachevisier/`. Ohne HTTPS gibt es keine Kamera, kein GPS und keine Sensoren.
2. **KI-Skript:**
   - Im Plesk-Dateimanager neben dem Webroot einen Ordner `cachevisier-data` anlegen, also dort, wo auch `rosko-data` liegt.
   - `api/config.sample.php` als `config.php` hineinlegen und ausfüllen: `APP_TOKEN` auf ein langes Zufallswort setzen, Anbieter in `$PROVIDERS` einrichten (siehe unten).
   - Dort liegen auch die Tageszähler. Das Git-Deployment überschreibt den Ordner nie, und im Web ist er nicht erreichbar.
   - Ohne diesen Ordner sucht `ki.php` die Datei als `api/config.php`. Die `.htaccess` sperrt sie dann.
   - Voraussetzung: PHP 8.0 oder neuer mit curl und mbstring.
3. **Auf dem Handy:**
   - Adresse in Chrome öffnen, dann Menü → „Zum Startbildschirm hinzufügen“.
   - Starten und Kamera, Standort und Bewegungssensoren erlauben.
   - Unter ☰ → ⚙️ Einstellungen das KI-Token eintragen. Die KI-Adresse `./api/ki.php` stimmt, wenn das Skript im selben Ordner liegt.

## Caches laden

- **c:geo:**
  - Caches mit Logs offline speichern.
  - In c:geo ein Backup erstellen. Dabei die Zugangsdaten nicht mitsichern.
  - In CacheVisier ☰ → „📁 c:geo-Backup laden“ und einmal den Ordner `cgeo` wählen. Die App nimmt automatisch das neueste `*.sqlite` (bis 3 Ordner tief).
  - Kann der Browser keine Ordner öffnen, „📄 Datei wählen“ und `cgeo/backup/<Datum>/cgeo.sqlite` nehmen.
- **GPX:** Über „Datei wählen“ oder aus einer anderen App per „Teilen“ → CacheVisier.
  - GSAK-Wegpunkte werden dem Cache zugeordnet. Eigene Wegpunktdateien werden über den Code zugeordnet.
- **Opencaching:**
  - Consumer Key auf `opencaching.de/okapi/signup.html` holen und in den Einstellungen eintragen.
  - Optional deinen OC-Benutzernamen eintragen, dann werden gefundene Caches ausgeblendet.
  - „🟢 OC in der Nähe“ lädt Caches im eingestellten Umkreis samt Hint, Logs und Wegpunkten.

Mit Live-Daten der c:geo-App kann die PWA nicht arbeiten: c:geo hält seine Datenbank im eigenen, geschützten App-Speicher. Deshalb der Weg über das Backup.

## KI-Anbieter (`$PROVIDERS` in config.php)

`ki.php` probiert die Anbieter der Reihe nach. Bei Limit (429), Ausfall oder unbrauchbarer Antwort kommt der nächste dran. Die Antwort nennt, wer geantwortet hat.

| Eintrag | Base-URL | Hinweis |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | Standardmodell `openai/gpt-oss-120b`, JSON-Modus an |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | Standardmodell `gemini-3.7-flash`, JSON-Modus an |
| OpenRouter | `https://openrouter.ai/api/v1` | Ein `:free`-Modell eintragen |
| Z.ai, Mistral, GitHub Models | wie in deinem Router | Vorbereitet, Modellname eintragen und `on => true` setzen |
| Ollama lokal | `http://127.0.0.1:11434/v1` | Nur, wenn `ki.php` im Heimnetz läuft |
| Claude | Anthropic-API | Kostenpflichtiger Rückfall, `claude-haiku-5-5` |

- **Schlüssel:**
  - Läuft `ki.php` auf dem Pi, liest `env_file('/opt/pirouter/.env')` die Schlüssel deines Routers mit. Du pflegst sie dann nur dort. Der Webserver-Benutzer braucht Leserecht auf die Datei.
  - Auf dem Webspace trägst du sie in `$ENV` ein.
- **Modellnamen ändern sich.** Bei „model not found“ den Namen in der Konsole des Anbieters nachsehen.
- **Ablauf:** Die App schickt Hint und bis zu 40 Logs (je 900 Zeichen) an `ki.php`. Zurück kommen eine Kurzfassung, der Zustand, die DNF-Serie, Versteckhinweise mit Zitat und Lagehinweise („8 m neben der Bushaltestelle“).
- **Suchzonen:** Die App sucht den Bezugspunkt in OpenStreetMap im Umkreis von 170 m um die Listing-Koordinaten und zeichnet daraus eine Suchzone. Jede Zone lässt sich als Ziel setzen.
- Das sind Vorschläge, keine Koordinaten. Das Zitat zeigt, worauf sie beruhen.

## Multi-Stationen und Foto → KI

- **🧩 Stationen** (im 💡- und im 🤖-Blatt oder im Kärtchen oben): Die KI liest aus Listing-Beschreibung und Wegpunkten:
  - die Stationen mit Aufgabe und den Variablen samt genauer Frage,
  - den Ort jeder Station (Listing, feste Koordinaten, Formel oder Peilung),
  - die Final-Formel.
  - Die Beschreibung kommt aus dem c:geo-Backup (Cache mit Details gespeichert), aus GPX oder aus Opencaching.
- **Kärtchen oben:**
  - Es zeigt immer die **nächste offene Station**: Aufgabe, gesuchte Variablen, Entfernung.
  - 🎯 setzt die Station als Ziel, sobald ihre Koordinaten berechenbar sind.
  - Antippen der Kopfzeile klappt das Kärtchen ein.
- **📸 Foto → KI:** öffnet die **Kamera-App des Handys** (volle Auflösung, Zoom). 🖼 nimmt ein Foto aus der Galerie.
  - Die KI liest die gesuchten Werte ab, bei Zählaufgaben mit Zählweise („links 12, rechts 11“).
  - Du übernimmst einen Wert mit „Übernehmen“. Nichts wird ungefragt eingetragen.
  - Das Foto wird auch für den Log gespeichert.
- **❓ Foto-Frage:** freie Frage zu einem Foto, z. B. „Wie viele Latten hat der Zaun?“. Das Ergebnis lässt sich direkt als Variable übernehmen.
  - 📸 neben jeder Variable stellt nur deren Frage.
- **Final:**
  - Wird aus den Werten berechnet, Peilungen (z. B. `A*10` m in `90`°) inklusive.
  - Liegt es mehr als 2 Meilen vom Start, warnt die App.
  - Formeln: `+ - * / % ^ ( )`, `QS()` (Quersumme), `IQS()` (einstellige Quersumme).
- **Bildfähiger Anbieter nötig:** Gemini oder Claude; in `$PROVIDERS` mit `'vision' => true` markierbar. Fotos gehen verkleinert (2048 px) an die KI.
- **Grenzen:** Die KI liest Listings und zählt auf Fotos nicht fehlerfrei. Formel und Zählung bitte gegenprüfen, das Final mit Logs oder Checker.

## Unterwegs

- **🌙 Nachtmodus** (oben):
  - Die ganze Anzeige wird rot und gedimmt, damit die Augen an die Dunkelheit gewöhnt bleiben.
  - Im Kamerabild sucht die App kleine, sehr helle Flecken vor dunklem Grund (Reflektoren/Firetacks), markiert sie mit Ringen in ihrer echten Farbe (weiß, grün, rot, blau …) und nennt die Farbe. Das läuft auf dem Handy, ohne KI und ohne Netz. Am besten mit 🔦 Lampe an.
  - Die Ringe liegen über dem roten Schleier, damit die Farbe erkennbar bleibt.
  - Große helle Flächen wie Laternen werden ignoriert. Dicht beieinanderliegende Flecken zählen als ein Reflektor, mit Anzahl in Klammern.
  - **Reflektor antippen:** Die Richtung vom Standort zum Reflektor kommt als Peilung ins 📐-Blatt (Entfernung selbst eintragen oder schätzen). Auf der Karte erscheint ein weißer Peilstrahl (300 m), löschbar im 📐-Blatt.
- **Ansagen und Vibration:**
  - Abstände zum Ziel bei 2 km, 1 km, 500, 200, 100, 50, 20 und 10 m, mit Route über den Restweg gerechnet.
  - Abzweigungen etwa 120 m vorher und „Jetzt“ bei 20 m, bei Tempo über 6 m/s bei 300 und 40 m.
  - Vibration: links zweimal kurz, rechts einmal lang. Kurzer Tick, wenn das Fadenkreuz grün wird.
  - Beides in ⚙️ abschaltbar.
- **📐 Peilung** (☰ und 💡):
  - Entfernung in Metern, Schritten (Schrittlänge einstellbar), km oder Fuß, dazu die Richtung in Grad.
  - Startpunkt: dein Standort, das aktuelle Ziel oder eingegebene Koordinaten.
  - „Kompasswert (missweisend)“ rechnet die Missweisung aus den Einstellungen dazu (Standard 4°, für deinen Ort prüfen).
  - **Mit der Kamera peilen:** Fadenkreuz auf das Ziel, die Richtung kommt vom Kompass. Die Entfernung schätzt die App aus der Neigung, wenn du auf den Fuß des Ziels zielst (Handyhöhe einstellbar, ungenau über 50 m).
  - Ergebnis als Ziel, zum Kopieren oder als Wegpunkt beim Cache.
- **✅ Gefunden & weiter** (✍️ Log):
  - Speichert den Fund-Log und nimmt den nächsten Cache der **Tour**, mit Route, wenn sie an ist.
  - Gibt es noch keine Tour, plant die App eine.
- **🗺️ Tour** (☰):
  - Plant die Reihenfolge durch die passenden Caches im Umkreis (1–5 km, höchstens 40): erst der nächste Nachbar, dann werden Kreuzungen und Umwege entfernt (2-opt). So läuft man nicht hin und her.
  - Wahlweise als Rundtour zurück zum Start.
  - Auf der Karte lila mit Nummern, in der Kopfzeile „🗺️ 3/12“.
  - Gerechnet wird mit Luftlinie; Wege, Flüsse und Zäune kennt die Planung nicht.
  - Übersprungen werden ungelöste Mysterys (ohne korrigierte Koordinaten) und Caches, für die dir laut Einstellungen Ausrüstung fehlt.
- **💬 b:con talk** (⚙️ einschalten, Knopf oben):
  - Chat über die öffentlichen Nostr-Relays (`wss://nos.lol`, `wss://relay.primal.net`, `wss://nostr.mom`), ohne Funkgerät, nach dem b:con-Protokoll (Art 4423, NIP-44, `gruppe`-Tag).
  - **🧩 Cache-Kanal:** Gruppen-Passwort ist der GC/OC-Code des aktuellen Ziels. Alle, die diesen Cache als Ziel haben und b:con talk an, sind automatisch im selben Kanal. Wechselt das Ziel, wechselt der Kanal mit. Nicht geheim: lesen kann, wer den Code kennt.
  - **🔒 Team:** eigenes Passwort, eigener Kanal, zusätzlich.
  - Schlüssel wie bei b:con-Gruppen: PBKDF2, 200 000 Runden, Salz „bcon-gruppe1“. Gefunden werden die Nachrichten über das Label `bcon.gruppe` mit der Gruppenkennung, weil Relays nur nach einbuchstabigen Tags filtern. Keine PLZ nötig.
  - Private Nachrichten an dich (Tag `p`) werden entschlüsselt.
  - Schnellknöpfe: 📍 Standort, ✅ Gefunden, 🎯 Ziel teilen, 🙋 Hilfe. Koordinaten in Nachrichten lassen sich als Ziel setzen, und die letzten Positionen anderer erscheinen auf der Karte (3 h).
  - Jedes Event wird geprüft (Signatur, Ablauf 24 h).
  - Der eigene Schlüssel wird im Handy erzeugt und bleibt dort (IndexedDB).
  - Sprechfunk (Art 4420) erscheint nur als Hinweis; Hören und Sprechen bräuchten Codec2 aus der b:con-App.
  - Krypto ohne fremde Bibliothek (`nostr.js`), geprüft gegen die offiziellen Testvektoren von BIP-340, RFC 8439 und NIP-44 und gegen eine Python-Referenz.
- **Attribute und Ausrüstung:**
  - Attribute kommen aus c:geo (`cg_attributes`), GPX und Opencaching.
  - Liste der üblichen Cacher-Ausrüstung (Grundausstattung und erweiterte Cache-Ausrüstung): 🔦 Taschenlampe, 🟣 UV-Lampe/UV-Stift, ✏️ Stift, 🥢 Pinzette, 🧲 Magnet/Teleskopmagnet, 🪞 Inspektionsspiegel, 🧤 Handschuhe, 🔧 Schraubendreher/Inbus/Torx, 💧 Wasser zum Einfüllen, 📏 Zollstock, 🪜 Leiter, 🎣 Teleskopstange/Angel, 🥾 Wathose sowie Klettern, Boot und Tauchen aus den Attributen.
  - In Kopfzeile, Liste und Infoblatt: ❗ = ohne das geht es nicht (die Tour überspringt den Cache), 🎒 = hilfreich, einpacken.
  - Die Tour zeigt eine Packliste für alle ihre Caches.
  - Unter ⚙️ → „Meine Ausrüstung“ einstellen.
  - Aus Text erkannt: Hint und KI-Suchhilfe direkt, im Listing nur mit Bedarfswort in der Nähe („mitbringen“, „nötig“, „hilfreich“ …). Eine magnetische Dose zählt nicht als „Magnet nötig“. So erkannte Teile stehen mit „(aus Text)“ da.
  - Die KI bekommt die Attribute mit und soll sie mit den Logs konkretisieren, z. B. welches Spezialwerkzeug genau.
- **📦 Offline** (☰):
  - Lädt die App-Bausteine (Karte, SQLite) in den Speicher, wertet die Logs der ungefundenen Caches im Umkreis aus und liest auf Wunsch die Multi-Stationen.
  - Zeigt, wie viel der Karte im Umkreis schon gespeichert ist.
  - Kartenkacheln von openstreetmap.org dürfen laut Nutzungsregeln nicht vorab in Masse geladen werden. Offline da ist, was du dir angesehen hast. Ein eigener Kachelserver würde das lösen.
  - 📴 in der Statuszeile zeigt, dass das Handy offline ist.

## Routing (Valhalla)

- **🧭 oben rechts** schaltet das Routing an und aus.
- **Mit Route:**
  - Die Markierung im Kamerabild und die Nadel zeigen auf einen Punkt etwa 25 m voraus auf dem Weg.
  - Unten stehen die nächste Anweisung („In 89 m: Links abbiegen auf …“), der Restweg und die Luftlinie.
  - Auf der Karte erscheint die Route blau.
  - Auf den letzten 30–40 m schaltet die App auf Luftlinie zum Ziel um. Die Route endet am nächsten Weg, der Cache liegt oft daneben.
  - Liegst du zweimal hintereinander mehr als 30 m neben der Route, berechnet die App sie neu (höchstens alle 20 s).
- **Adresse** (⚙️ → Routing):
  - `./api/route.php` (Standard): Dein Server leitet weiter, ohne Einstellung an das öffentliche FOSSGIS-Valhalla (`https://valhalla1.openstreetmap.de`). Das Skript prüft das Token, leitet nur `/route` mit geprüften Werten weiter und schickt einen eigenen User-Agent.
    - **Drossel für FOSSGIS** (kein Dauerbetrieb): höchstens 12 Routen pro Minute und 400 pro Tag (`ROUTE_PER_MINUTE`, `ROUTE_PER_DAY`).
    - Die App wartet beim Zielwechsel 1,5 s, damit schnelles Durchklicken nur eine Anfrage auslöst. Abseits der Route rechnet sie höchstens alle 20 s neu.
    - **Eigener Valhalla-Server später:** `const VALHALLA_URL = 'http://…:8002';` in `config.php`.
  - Oder direkt die Valhalla-Adresse (`https://…/`). Das geht nur, wenn Valhalla über HTTPS erreichbar ist. Die App fragt dann per GET `…/route?json=…`, ohne Preflight.
- **Fortbewegung:** zu Fuß, Fahrrad, Roller oder Auto. Die Anweisungen kommen auf Deutsch von Valhalla.

## Bedienung

| Knopf | Funktion |
|---|---|
| 🌙 (oben) | Nachtmodus: rot, Reflektorsuche |
| 🧭 (oben) | Routing an/aus |
| 🔄 | Auto (senkrecht = Kamera, flach = Karte) → Kamera fest → Karte fest |
| 🔦 | Lampe an/aus. Geht nur, wenn Handy und Browser das Licht über die Kamera schalten lassen (Diagnose zeigt es). |
| 📸 | Foto zum aktuellen Ziel speichern, im Handy, nicht in der Galerie |
| 💡 | Cache-Infos, Hint, Wegpunkte (antippen = Ziel) |
| 📜 | Logs, farbig nach Typ, mit DNF-Serie seit dem letzten Fund |
| 🤖 | KI-Auswertung, Suchzonen als Ziel |
| ✍️ | Offline-Log mit Typ, Text und Fotos; Export als `geocache_visits.txt` |

- **Fadenkreuz:** Es wird grün, wenn das Ziel in der Bildmitte liegt.
- **Rand-Pfeil:** Liegt das Ziel außerhalb des Bildes, zeigt ein Pfeil am Rand die Richtung.
- **Nahbereich:** Unter etwa dem 1,3-fachen der GPS-Genauigkeit erscheint „Nahbereich“. Dort sagen Pfeil und Markierung nichts mehr aus, dann zählen Hint und Logs.

**Kalibrieren** (⚙️ Einstellungen):
- „Bildwinkel“ so einstellen, dass die Markierung bei einem bekannten, entfernten Punkt auf dem Punkt sitzt.
- „Kompass-Korrektur“ verwenden, wenn die Richtung dauerhaft schief ist.
- In der Nähe von Autos, Geländern und Stahlbeton liegt jeder Handykompass oft deutlich daneben. Eine Acht in der Luft kalibriert ihn neu.

## Offen und ungeprüft

- **Ordnerzugriff auf Android-Chrome:** Ob `showDirectoryPicker` geht, ist widersprüchlich dokumentiert. Die Diagnose zeigt es, sonst „Datei wählen“.
- **Feldnotizen:** Ob geocaching.com `geocache_visits.txt` noch annimmt, habe ich nicht geprüft. Text kopieren und Fotos teilen geht in jedem Fall.
- **Modellnamen:** `openai/gpt-oss-120b` (Groq) und `gemini-3.7-flash` stammen aus der aktuellen Doku der Anbieter. Ob sie in deinem Gratis-Kontingent laufen, habe ich nicht getestet.
- **iPhone:** ungetestet.
- **Ungetestet ohne echtes Gerät:** Kamera, Lampe und echte Sensoren. Getestet sind die Rechnungen (Unit-Tests), die Oberfläche (Headless-Browser mit simuliertem Sensor) und `ki.php` gegen nachgebaute Anbieter.
- **Karte offline:** Nur Kacheln, die du schon einmal angesehen hast, sind offline da (bis 3.000).
