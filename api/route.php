<?php
/* CacheVisier – Routing über Valhalla. Leitet nur /route weiter, mit geprüften Werten.
   Nötig, weil die App über HTTPS läuft und Valhalla oft nur intern oder ohne HTTPS/CORS erreichbar ist.
   In config.php: const VALHALLA_URL = 'http://127.0.0.1:8002';  (ohne /route) */
declare(strict_types=1);
require __DIR__ . '/inc.php';

if (!defined('VALHALLA_URL') || VALHALLA_URL === '') out(500, ['error' => 'VALHALLA_URL fehlt in config.php']);

$in = json_decode((string)file_get_contents('php://input', false, null, 0, 20000), true);
if (!is_array($in)) out(400, ['error' => 'Ungültige Anfrage']);
$locs = [];
foreach (array_slice(is_array($in['locations'] ?? null) ? $in['locations'] : [], 0, 5) as $l) {
  if (!is_array($l) || !is_numeric($l['lat'] ?? null) || !is_numeric($l['lon'] ?? null)) continue;
  $lat = (float)$l['lat']; $lon = (float)$l['lon'];
  if (abs($lat) > 90 || abs($lon) > 180) continue;
  $locs[] = ['lat' => $lat, 'lon' => $lon, 'type' => 'break'];
}
if (count($locs) < 2) out(400, ['error' => 'Mindestens zwei Punkte nötig']);
$costing = in_array($in['costing'] ?? '', ['pedestrian', 'bicycle', 'auto', 'motor_scooter'], true) ? $in['costing'] : 'pedestrian';
$body = json_encode(['locations' => $locs, 'costing' => $costing,
  'directions_options' => ['units' => 'kilometers', 'language' => 'de-DE']], JSON_UNESCAPED_SLASHES);

$url = rtrim(VALHALLA_URL, '/') . '/route';
$code = 0; $res = false;
if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 6]);
  $res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  if ($res === false) out(502, ['error' => 'Valhalla nicht erreichbar: ' . $err]);
} else {
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => 'Content-Type: application/json', 'content' => $body, 'timeout' => 25, 'ignore_errors' => true]]);
  $res = @file_get_contents($url, false, $ctx);
  if ($res === false) out(502, ['error' => 'Valhalla nicht erreichbar']);
  foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
}
http_response_code($code ?: 502);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo $res;
