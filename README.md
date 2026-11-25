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
   - Voraussetzung: PHP 7.4 oder neuer mit curl und mbstring.
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

## Bedienung

| Knopf | Funktion |
|---|---|
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
