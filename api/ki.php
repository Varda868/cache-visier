<?php
/* CacheVisier – KI-Auswertung der Logs.
   Der API-Schlüssel bleibt hier auf dem Server, die App kennt nur das APP_TOKEN.
   Anbieter-Kette in config.php ($PROVIDERS): der Reihe nach probieren, beim Fehler (Limit, Ausfall, kaputtes JSON) den nächsten.
   Typen: 'openai' (Groq, Gemini, OpenRouter, Z.ai, Mistral, GitHub Models, Ollama, LM Studio, eigener Router) und 'anthropic' (Claude). */
declare(strict_types=1);

require __DIR__ . '/inc.php'; // Konfiguration laden, Herkunft, Methode und Token prüfen

$raw = file_get_contents('php://input', false, null, 0, 400000);
$in = json_decode((string)$raw, true);
if (!is_array($in) || empty($in['geocode'])) out(400, ['ok' => false, 'error' => 'Ungültige Anfrage']);

if (!count_request()) out(429, ['ok' => false, 'error' => 'Tageslimit erreicht (' . DAILY_LIMIT . ')']);

$prompt = build_prompt($in);
$errors = [];
foreach (($PROVIDERS ?? []) as $p) {
  if (empty($p['on']) || (($p['type'] ?? 'openai') !== 'anthropic' && empty($p['base']))) continue;
  if (!empty($p['needs_key']) && empty($p['key'])) continue; // Schlüssel noch nicht eingetragen
  try {
    [$result, $usage, $model] = ($p['type'] ?? 'openai') === 'anthropic' ? call_anthropic($p, $prompt) : call_openai($p, $prompt);
    out(200, ['ok' => true, 'result' => normalize($result), 'usage' => $usage, 'model' => ($p['name'] ?? '?') . ' · ' . $model, 'fallbacks' => $errors]);
  } catch (Throwable $e) {
    $errors[] = ($p['name'] ?? '?') . ': ' . clip($e->getMessage(), 160);
  }
}
out(502, ['ok' => false, 'error' => $errors ? implode(' | ', $errors) : 'Kein Anbieter eingerichtet (config.php)']);

/* ------------------------------------------------------------------ */

function count_request(): bool {
  $dir = CV_DATA;
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f = $dir . '/zaehler-' . date('Y-m-d') . '.txt';
  $h = @fopen($f, 'c+');
  if (!$h) return true; // Zähler nicht schreibbar: nicht blockieren
  flock($h, LOCK_EX);
  $n = (int)stream_get_contents($h);
  $ok = $n < DAILY_LIMIT;
  if ($ok) { ftruncate($h, 0); rewind($h); fwrite($h, (string)($n + 1)); }
  flock($h, LOCK_UN); fclose($h);
  foreach (glob($dir . '/zaehler-*.txt') ?: [] as $old) if ($old !== $f && filemtime($old) < time() - 7 * 86400) @unlink($old);
  return $ok;
}

function clip(string $s, int $n): string {
  $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
  return mb_strlen($s) > $n ? mb_substr($s, 0, $n) . ' …' : $s;
}

function build_prompt(array $c): string {
  $logs = array_slice(is_array($c['logs'] ?? null) ? $c['logs'] : [], 0, 60);
  $lines = [];
  foreach ($logs as $i => $l) {
    $lines[] = sprintf('[%d] %s | %s | %s: %s', $i + 1, clip((string)($l['date'] ?? ''), 10), clip((string)($l['type'] ?? ''), 30),
      clip((string)($l['author'] ?? ''), 40), clip((string)($l['text'] ?? ''), 800));
  }
  $hint = clip((string)($c['hint'] ?? ''), 400);
  return "Du hilfst einem Geocacher, der JETZT vor Ort sucht. Werte die Logs aus (neueste zuerst, [Nr] Datum | Typ | Autor: Text).\n"
    . "Ziel: alles, was beim Finden hilft, und der aktuelle Zustand der Dose. Spoiler sind ausdrücklich erwünscht.\n\n"
    . 'Cache: ' . clip((string)$c['geocode'], 12) . ' – ' . clip((string)($c['name'] ?? ''), 120) . "\n"
    . 'Typ: ' . clip((string)($c['type'] ?? ''), 20) . ' · D' . ($c['d'] ?? '?') . '/T' . ($c['t'] ?? '?') . ' · Größe laut Listing: ' . clip((string)($c['size'] ?? ''), 20) . "\n"
    . 'Hint: ' . ($hint !== '' ? $hint : '–') . "\n\nLogs:\n" . implode("\n", $lines) . "\n\n"
    . "Regeln:\n"
    . "- Nur Konkretes aus Logs und Hint. Keine Allgemeinplätze wie 'schöner Cache', 'Danke', 'gut versteckt', 'Owner hat sich Mühe gegeben', keine Fundstatistik als Text.\n"
    . "- Nichts erfinden. Jeder Punkt mit kurzem wörtlichem Zitat, Lognummer und Datum des Logs (JJJJ-MM-TT).\n"
    . "- Neuere Logs haben Vorrang. Widerspricht ein alter Log einem neuen (z. B. Dose ersetzt, Versteck geändert), nimm den neuen und erwähne das alte nur, wenn es hilft.\n"
    . "- kurzfassung: 1–2 Sätze, nur das Wichtigste für die Suche jetzt (wo/wie versteckt, Zustand, Warnung). Kein Füllsatz.\n"
    . "- suchhilfe: jeder brauchbare Hinweis einzeln, möglichst wörtlich konkret. kategorie:\n"
    . "  versteck (wo genau: Höhe, Seite, unter/in/hinter was), behaelter (Art und Größe: Petling, Filmdose, magnetisch, Nano, Attrappe),\n"
    . "  werkzeug (Pinzette, Stift, Taschenlampe, UV-Lampe, Magnet, Handschuhe), zugang (Weg dorthin, Zaun, Hang, Gebüsch, nasse Füße),\n"
    . "  tarnung (wie getarnt, wonach aussehen), muggel (belebt, Tageszeit, Anwohner, Kameras), parken (Parkplatz, Startpunkt), sonstiges.\n"
    . "- zustand_details: konkrete Zustandsangaben mit Datum: Logbuch voll/nass/fehlt, Dose beschädigt/undicht/offen, Deckel, Stift fehlt,\n"
    . "  Ersatzdose gelegt, Owner-Wartung, Reviewer-Notiz, deaktiviert. letzte_wartung: Datum der letzten Owner-Wartung oder leer.\n"
    . "- zustand: gut, wartung_noetig, vermutlich_weg (mehrere DNF in Folge bei erfahrenen Findern o. ä.) oder unklar.\n"
    . "- dnf_serie: Anzahl 'Nicht gefunden' seit dem letzten Fund. letzter_fund: JJJJ-MM-TT oder leer.\n"
    . "- warnungen: Zecken, Brennnesseln, Dornen, Baustelle, Privatgelände, Hund, Jäger/Hochsitz, Verkehr, gesperrt, nachts nicht, Koordinaten daneben.\n"
    . "- stationen: nur bei Multi/Mystery/Wherigo: Hinweise zu Stationen oder Rätsel aus den Logs (z. B. 'Station 2: Schild hinter Hecke', 'Zahl ist schwer lesbar').\n"
    . "  Keine fertigen Finalkoordinaten erfinden.\n"
    . "- koordinaten_korrektur: nur wenn Logs sagen, dass die Koordinaten daneben liegen (z. B. '10 m nördlich'). Sonst meter = 0.\n"
    . "- positionen: Lagehinweise relativ zu Objekten wie '8 m neben der Bushaltestelle', 'am dritten Baum hinter der Bank'.\n"
    . "  anker = Bezugspunkt in Worten. osm_key/osm_value = passendes OpenStreetMap-Tag, z. B. highway=bus_stop, amenity=bench, amenity=waste_basket,\n"
    . "  highway=street_lamp, power=pole, natural=tree, leisure=playground, amenity=parking, highway=crossing, amenity=post_box,\n"
    . "  historic=wayside_cross, barrier=gate, man_made=bridge, bridge=yes, tourism=information, highway=traffic_signals.\n"
    . "  osm_value '*' = beliebiger Wert. Ist der Bezug die Listing-Koordinate oder gibt es kein Tag: osm_key und osm_value leer, anker 'Listing-Koordinaten'.\n"
    . "  abstand_m = 0 wenn unbekannt. richtung_grad = Himmelsrichtung in Grad (N=0, O=90, S=180, W=270), -1 wenn unbekannt oder nur 'links/rechts'.\n"
    . "  richtung_text = Richtung in Worten wie im Log. sicherheit: hoch, mittel oder niedrig.\n"
    . "- Leere Listen sind richtig, wenn die Logs nichts hergeben. Lieber nichts als Allgemeines.";
}

function schema(): array {
  $q = ['type' => 'string'];
  $n = ['type' => 'integer'];
  $sich = ['type' => 'string', 'enum' => ['hoch', 'mittel', 'niedrig']];
  $beleg = fn(array $extra, array $req) => ['type' => 'array', 'items' => ['type' => 'object',
    'properties' => $extra + ['datum' => $q, 'zitat' => $q, 'log_nr' => $n], 'required' => array_merge($req, ['zitat', 'log_nr'])]];
  return [
    'type' => 'object',
    'properties' => [
      'kurzfassung' => $q,
      'zustand' => ['type' => 'string', 'enum' => ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar']],
      'zustand_details' => $beleg(['punkt' => $q], ['punkt']),
      'letzter_fund' => $q,
      'letzte_wartung' => $q,
      'dnf_serie' => $n,
      'suchhilfe' => $beleg(['kategorie' => ['type' => 'string', 'enum' => ['versteck', 'behaelter', 'werkzeug', 'zugang', 'tarnung', 'muggel', 'parken', 'sonstiges']],
        'hinweis' => $q], ['kategorie', 'hinweis']),
      'warnungen' => $beleg(['hinweis' => $q], ['hinweis']),
      'stationen' => $beleg(['station' => $q, 'hinweis' => $q], ['station', 'hinweis']),
      'koordinaten_korrektur' => ['type' => 'object', 'properties' => [
        'meter' => ['type' => 'number'], 'richtung_grad' => ['type' => 'number'], 'zitat' => $q, 'log_nr' => $n, 'sicherheit' => $sich],
        'required' => ['meter', 'richtung_grad', 'zitat', 'log_nr']],
      'positionen' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
        'anker' => $q, 'osm_key' => $q, 'osm_value' => $q, 'abstand_m' => ['type' => 'number'], 'richtung_grad' => ['type' => 'number'],
        'richtung_text' => $q, 'zitat' => $q, 'log_nr' => $n, 'sicherheit' => $sich],
        'required' => ['anker', 'osm_key', 'osm_value', 'abstand_m', 'richtung_grad', 'zitat', 'log_nr', 'sicherheit']]],
    ],
    'required' => ['kurzfassung', 'zustand', 'zustand_details', 'dnf_serie', 'suchhilfe', 'warnungen', 'positionen'],
  ];
}

function http_post(string $url, array $headers, array $body, int $timeout = 60): array {
  $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  $headers[] = 'Content-Type: application/json';
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_HTTPHEADER => $headers,
      CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 10]);
    $res = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($res === false) throw new RuntimeException('Verbindung fehlgeschlagen: ' . $err);
  } else {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json,
      'timeout' => $timeout, 'ignore_errors' => true]]);
    $res = @file_get_contents($url, false, $ctx);
    if ($res === false) throw new RuntimeException('Verbindung fehlgeschlagen');
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
  }
  $data = json_decode((string)$res, true);
  if ($code < 200 || $code >= 300) {
    $msg = is_array($data) ? ($data['error']['message'] ?? $data['error'] ?? '') : '';
    throw new RuntimeException('KI-Anbieter HTTP ' . $code . ($msg ? ': ' . (is_string($msg) ? $msg : json_encode($msg)) : ''));
  }
  if (!is_array($data)) throw new RuntimeException('Antwort des KI-Anbieters nicht lesbar');
  return $data;
}

function call_anthropic(array $p, string $prompt): array {
  $url = $p['base'] ?? 'https://api.anthropic.com/v1/messages';
  $model = $p['model'] ?? 'claude-haiku-5-5';
  $data = http_post($url, ['x-api-key: ' . ($p['key'] ?? ''), 'anthropic-version: 2023-06-01'], [
    'model' => $model,
    'max_tokens' => 3000,
    'tools' => [['name' => 'auswertung', 'description' => 'Strukturierte Auswertung der Cache-Logs', 'input_schema' => schema()]],
    'tool_choice' => ['type' => 'tool', 'name' => 'auswertung'],
    'messages' => [['role' => 'user', 'content' => $prompt]],
  ]);
  foreach ($data['content'] ?? [] as $b) {
    if (($b['type'] ?? '') === 'tool_use' && is_array($b['input'] ?? null)) return [$b['input'], $data['usage'] ?? null, $data['model'] ?? $model];
  }
  throw new RuntimeException('Claude hat keine strukturierte Antwort geliefert');
}

function call_openai(array $p, string $prompt): array {
  $base = rtrim($p['base'], '/');
  $headers = [];
  if (!empty($p['key'])) $headers[] = 'Authorization: Bearer ' . $p['key'];
  foreach ($p['headers'] ?? [] as $h) $headers[] = $h;
  $body = [
    'model' => $p['model'],
    'temperature' => 0.2,
    'max_tokens' => (int)($p['max_tokens'] ?? 3000), // Denkmodelle (gpt-oss, Qwen) verbrauchen einen Teil davon fürs Nachdenken
    'messages' => [
      ['role' => 'system', 'content' => 'Antworte ausschließlich mit einem JSON-Objekt nach diesem Schema, ohne weiteren Text: '
        . json_encode(schema(), JSON_UNESCAPED_UNICODE)],
      ['role' => 'user', 'content' => $prompt],
    ],
  ];
  if (!empty($p['json'])) $body['response_format'] = ['type' => 'json_object'];
  foreach ($p['extra'] ?? [] as $k => $v) $body[$k] = $v;
  $data = http_post($base . '/chat/completions', $headers, $body, (int)($p['timeout'] ?? 60));
  $text = (string)($data['choices'][0]['message']['content'] ?? '');
  $obj = extract_json($text);
  if ($obj === null) throw new RuntimeException('Modell lieferte kein gültiges JSON');
  return [$obj, $data['usage'] ?? null, $data['model'] ?? $p['model']];
}

function extract_json(string $t): ?array {
  $t = preg_replace('/<think>.*?<\/think>/s', '', $t) ?? $t; // Denk-Ausgabe mancher lokaler Modelle
  $t = trim(preg_replace('/^```(?:json)?|```$/m', '', trim($t)) ?? $t);
  $d = json_decode($t, true);
  if (is_array($d)) return $d;
  $a = strpos($t, '{'); $b = strrpos($t, '}');
  if ($a === false || $b === false || $b <= $a) return null;
  $d = json_decode(substr($t, $a, $b - $a + 1), true);
  return is_array($d) ? $d : null;
}

/* Antwort in eine feste Form bringen, egal welches Modell */
function normalize(array $r): array {
  $s = fn($v, $n = 600) => is_scalar($v) ? clip((string)$v, $n) : '';
  $f = fn($v, $d) => is_numeric($v) ? (float)$v : $d;
  $sich = fn($v) => in_array($v, ['hoch', 'mittel', 'niedrig'], true) ? $v : 'niedrig';
  $datum = fn($v) => preg_match('/^\d{4}-\d{2}-\d{2}/', is_scalar($v) ? (string)$v : '', $m) ? $m[0] : '';
  // Liste mit Belegen (Zitat, Lognummer, Datum); $felder = Pflicht-Textfelder
  $liste = function ($v, array $felder, int $max, array $extra = []) use ($s, $f, $datum): array {
    $out = [];
    foreach (array_slice(is_array($v) ? $v : [], 0, $max) as $x) {
      if (!is_array($x)) continue;
      $e = [];
      foreach ($felder as $k) { $e[$k] = $s($x[$k] ?? '', 300); }
      if (implode('', $e) === '') continue;
      foreach ($extra as $k => $erlaubt) $e[$k] = in_array($x[$k] ?? '', $erlaubt, true) ? $x[$k] : $erlaubt[count($erlaubt) - 1];
      $e['datum'] = $datum($x['datum'] ?? '');
      $e['zitat'] = $s($x['zitat'] ?? '', 300);
      $e['log_nr'] = (int)$f($x['log_nr'] ?? 0, 0);
      $out[] = $e;
    }
    return $out;
  };
  $out = [
    'kurzfassung' => $s($r['kurzfassung'] ?? '', 600),
    'zustand' => in_array($r['zustand'] ?? '', ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar'], true) ? $r['zustand'] : 'unklar',
    'zustand_details' => $liste($r['zustand_details'] ?? null, ['punkt'], 10),
    'letzter_fund' => $datum($r['letzter_fund'] ?? ''),
    'letzte_wartung' => $datum($r['letzte_wartung'] ?? ''),
    'dnf_serie' => max(0, (int)$f($r['dnf_serie'] ?? 0, 0)),
    'suchhilfe' => $liste($r['suchhilfe'] ?? ($r['versteck_hinweise'] ?? null), ['hinweis'], 14,
      ['kategorie' => ['versteck', 'behaelter', 'werkzeug', 'zugang', 'tarnung', 'muggel', 'parken', 'sonstiges']]),
    'warnungen' => $liste($r['warnungen'] ?? null, ['hinweis'], 8),
    'stationen' => $liste($r['stationen'] ?? null, ['station', 'hinweis'], 12),
    'koordinaten_korrektur' => null,
    'positionen' => [],
  ];
  $k = $r['koordinaten_korrektur'] ?? null;
  if (is_array($k) && $f($k['meter'] ?? 0, 0) > 0 && $f($k['meter'], 0) < 2000) {
    $out['koordinaten_korrektur'] = ['meter' => $f($k['meter'], 0), 'richtung_grad' => fmod($f($k['richtung_grad'] ?? -1, -1), 360),
      'zitat' => $s($k['zitat'] ?? '', 300), 'log_nr' => (int)$f($k['log_nr'] ?? 0, 0), 'sicherheit' => $sich($k['sicherheit'] ?? '')];
  }
  foreach (array_slice(is_array($r['positionen'] ?? null) ? $r['positionen'] : [], 0, 8) as $p) {
    if (!is_array($p) || $s($p['anker'] ?? '') === '') continue;
    $rg = $f($p['richtung_grad'] ?? -1, -1);
    $out['positionen'][] = [
      'anker' => $s($p['anker'], 120), 'osm_key' => preg_replace('/[^a-z0-9_:]/', '', strtolower($s($p['osm_key'] ?? '', 40))),
      'osm_value' => $s($p['osm_value'] ?? '', 60), 'abstand_m' => max(0, min(500, $f($p['abstand_m'] ?? 0, 0))),
      'richtung_grad' => $rg < 0 ? -1 : fmod($rg, 360), 'richtung_text' => $s($p['richtung_text'] ?? '', 60),
      'zitat' => $s($p['zitat'] ?? '', 300), 'log_nr' => (int)$f($p['log_nr'] ?? 0, 0), 'sicherheit' => $sich($p['sicherheit'] ?? ''),
    ];
  }
  return $out;
}
