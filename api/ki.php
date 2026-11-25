<?php
/* CacheVisier – KI-Auswertung der Logs.
   Der API-Schlüssel bleibt hier auf dem Server, die App kennt nur das APP_TOKEN.
   Anbieter-Kette in config.php ($PROVIDERS): der Reihe nach probieren, beim Fehler (Limit, Ausfall, kaputtes JSON) den nächsten.
   Typen: 'openai' (Groq, Gemini, OpenRouter, Z.ai, Mistral, GitHub Models, Ollama, LM Studio, eigener Router) und 'anthropic' (Claude). */
declare(strict_types=1);

/* KEY=WERT-Datei (z. B. /opt/pirouter/.env) einlesen, damit Schlüssel nicht doppelt gepflegt werden */
function env_file(string $path): array {
  $out = [];
  if (!is_readable($path)) return $out;
  foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
    if (preg_match('/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $line, $m)) {
      $v = trim($m[2]);
      if (strlen($v) >= 2 && ($v[0] === '"' || $v[0] === "'") && substr($v, -1) === $v[0]) $v = substr($v, 1, -1);
      $out[$m[1]] = $v;
    }
  }
  return $out;
}

/* Konfiguration und Zähler liegen bevorzugt außerhalb des Webordners (cachevisier-data neben dem Webroot, wie rosko-data),
   damit ein Git-Deployment sie nie überschreibt und sie im Web nicht erreichbar sind. Rückfall: api/config.php und api/data. */
$outside = dirname(__DIR__, 3) . '/cachevisier-data';
$cfgFile = getenv('CV_CONFIG') ?: (is_file($outside . '/config.php') ? $outside . '/config.php' : __DIR__ . '/config.php');
define('CV_DATA', getenv('CV_DATA') ?: (is_dir($outside) ? $outside : __DIR__ . '/data'));
if (!is_file($cfgFile)) out(500, ['ok' => false, 'error' => 'config.php fehlt (Ordner cachevisier-data neben dem Webroot anlegen, config.sample.php als config.php hineinlegen)']);
require $cfgFile;

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (defined('ALLOWED_ORIGIN') && ALLOWED_ORIGIN !== '' && $origin !== '') {
  if ($origin === ALLOWED_ORIGIN) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, X-App-Token');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
  }
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['ok' => false, 'error' => 'Nur POST']);

$token = $_SERVER['HTTP_X_APP_TOKEN'] ?? '';
if (APP_TOKEN === '' || !hash_equals(APP_TOKEN, $token)) out(401, ['ok' => false, 'error' => 'Token falsch']);

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

function out(int $code, array $data): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

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
  return "Du hilfst beim Geocaching vor Ort. Werte die Logs dieses Caches aus (neueste zuerst).\n\n"
    . 'Cache: ' . clip((string)$c['geocode'], 12) . ' – ' . clip((string)($c['name'] ?? ''), 120) . "\n"
    . 'Typ: ' . clip((string)($c['type'] ?? ''), 20) . ' · D' . ($c['d'] ?? '?') . '/T' . ($c['t'] ?? '?') . ' · Größe: ' . clip((string)($c['size'] ?? ''), 20) . "\n"
    . 'Hint: ' . ($hint !== '' ? $hint : '–') . "\n\nLogs:\n" . implode("\n", $lines) . "\n\n"
    . "Regeln:\n"
    . "- Nur was in den Logs oder im Hint steht. Nichts erfinden. Jede Aussage mit wörtlichem Zitat (kurz) und Lognummer belegen.\n"
    . "- kurzfassung: 1–3 Sätze auf Deutsch: Wo und wie ist der Cache versteckt (ohne Spoiler über den Hint hinaus, wenn es keine gibt), Zustand, Besonderheiten (Muggel, Zecken, Brennnesseln, Taschenlampe nötig).\n"
    . "- zustand: einer von gut, wartung_noetig, vermutlich_weg, unklar.\n"
    . "- dnf_serie: Anzahl 'Nicht gefunden' seit dem letzten Fund. letzter_fund: Datum JJJJ-MM-TT oder leer.\n"
    . "- koordinaten_korrektur: nur wenn Logs sagen, dass die Koordinaten daneben liegen (z. B. '10 m nördlich'). Sonst meter = 0.\n"
    . "- positionen: Lagehinweise wie '8 m neben der Bushaltestelle', 'am dritten Baum hinter der Bank'.\n"
    . "  anker = Bezugspunkt in Worten. osm_key/osm_value = passendes OpenStreetMap-Tag, z. B. highway=bus_stop, amenity=bench, amenity=waste_basket,\n"
    . "  highway=street_lamp, power=pole, natural=tree, leisure=playground, amenity=parking, highway=crossing, amenity=post_box,\n"
    . "  historic=wayside_cross, barrier=gate, man_made=bridge, bridge=yes, tourism=information, highway=traffic_signals.\n"
    . "  osm_value '*' = beliebiger Wert. Ist der Bezug die Listing-Koordinate oder gibt es kein Tag: osm_key und osm_value leer, anker 'Listing-Koordinaten'.\n"
    . "  abstand_m = 0 wenn unbekannt. richtung_grad = Himmelsrichtung in Grad (N=0, O=90, S=180, W=270), -1 wenn unbekannt oder nur 'links/rechts'.\n"
    . "  richtung_text = Richtung in Worten wie im Log. sicherheit: hoch, mittel oder niedrig.\n"
    . "- Leere Listen sind erlaubt.";
}

function schema(): array {
  $q = ['type' => 'string'];
  return [
    'type' => 'object',
    'properties' => [
      'kurzfassung' => $q,
      'zustand' => ['type' => 'string', 'enum' => ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar']],
      'letzter_fund' => $q,
      'dnf_serie' => ['type' => 'integer'],
      'versteck_hinweise' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
        'hinweis' => $q, 'zitat' => $q, 'log_nr' => ['type' => 'integer']], 'required' => ['hinweis', 'zitat', 'log_nr']]],
      'koordinaten_korrektur' => ['type' => 'object', 'properties' => [
        'meter' => ['type' => 'number'], 'richtung_grad' => ['type' => 'number'], 'zitat' => $q, 'log_nr' => ['type' => 'integer'],
        'sicherheit' => ['type' => 'string', 'enum' => ['hoch', 'mittel', 'niedrig']]], 'required' => ['meter', 'richtung_grad', 'zitat', 'log_nr']],
      'positionen' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
        'anker' => $q, 'osm_key' => $q, 'osm_value' => $q, 'abstand_m' => ['type' => 'number'], 'richtung_grad' => ['type' => 'number'],
        'richtung_text' => $q, 'zitat' => $q, 'log_nr' => ['type' => 'integer'],
        'sicherheit' => ['type' => 'string', 'enum' => ['hoch', 'mittel', 'niedrig']]],
        'required' => ['anker', 'osm_key', 'osm_value', 'abstand_m', 'richtung_grad', 'zitat', 'log_nr', 'sicherheit']]],
    ],
    'required' => ['kurzfassung', 'zustand', 'dnf_serie', 'versteck_hinweise', 'positionen'],
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
    'max_tokens' => 1500,
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
  $out = [
    'kurzfassung' => $s($r['kurzfassung'] ?? '', 800),
    'zustand' => in_array($r['zustand'] ?? '', ['gut', 'wartung_noetig', 'vermutlich_weg', 'unklar'], true) ? $r['zustand'] : 'unklar',
    'letzter_fund' => $s($r['letzter_fund'] ?? '', 20),
    'dnf_serie' => max(0, (int)$f($r['dnf_serie'] ?? 0, 0)),
    'versteck_hinweise' => [],
    'koordinaten_korrektur' => null,
    'positionen' => [],
  ];
  foreach (array_slice(is_array($r['versteck_hinweise'] ?? null) ? $r['versteck_hinweise'] : [], 0, 8) as $h) {
    if (!is_array($h) || $s($h['hinweis'] ?? '') === '') continue;
    $out['versteck_hinweise'][] = ['hinweis' => $s($h['hinweis']), 'zitat' => $s($h['zitat'] ?? '', 300), 'log_nr' => (int)$f($h['log_nr'] ?? 0, 0)];
  }
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
