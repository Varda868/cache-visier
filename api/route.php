<?php
/* CacheVisier – Routing über Valhalla. Leitet nur /route weiter, mit geprüften Werten.
   Nötig, weil die App über HTTPS läuft und Valhalla oft nur intern oder ohne HTTPS/CORS erreichbar ist.
   Standard: öffentliches FOSSGIS-Valhalla (valhalla1.openstreetmap.de). Dessen Regeln: kein Dauerbetrieb, sparsam nutzen.
   Deshalb hier eine Drossel (pro Minute und pro Tag); die App rechnet abseits der Route höchstens alle 20 s neu.
   Eigener Server später: in config.php const VALHALLA_URL = 'http://…:8002';  (ohne /route) */
declare(strict_types=1);
require __DIR__ . '/inc.php';

$base = defined('VALHALLA_URL') && VALHALLA_URL !== '' ? VALHALLA_URL : 'https://valhalla1.openstreetmap.de';
$perMin = defined('ROUTE_PER_MINUTE') ? (int)ROUTE_PER_MINUTE : 12;
$perDay = defined('ROUTE_PER_DAY') ? (int)ROUTE_PER_DAY : 400;
if (!route_quota($perMin, $perDay)) out(429, ['error' => 'Routing gedrosselt (höchstens ' . $perMin . '/min, ' . $perDay . '/Tag) – gleich nochmal']);

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

$url = rtrim($base, '/') . '/route';
$ua = 'CacheVisier/0.1 (+https://' . ($_SERVER['HTTP_HOST'] ?? 'games.thai-klasse.de') . '/cachevisier/)';
$code = 0; $res = false;
if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_USERAGENT => $ua,
    CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 6]);
  $res = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch); curl_close($ch);
  if ($res === false) out(502, ['error' => 'Valhalla nicht erreichbar: ' . $err]);
} else {
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\nUser-Agent: $ua", 'content' => $body, 'timeout' => 25, 'ignore_errors' => true]]);
  $res = @file_get_contents($url, false, $ctx);
  if ($res === false) out(502, ['error' => 'Valhalla nicht erreichbar']);
  foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
}
http_response_code($code ?: 502);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo $res;

/* Zähler in CV_DATA: Anfragen dieser Minute und dieses Tages */
function route_quota(int $perMin, int $perDay): bool {
  $dir = CV_DATA;
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $h = @fopen($dir . '/route-zaehler.json', 'c+');
  if (!$h) return true;
  flock($h, LOCK_EX);
  $d = json_decode((string)stream_get_contents($h), true) ?: [];
  $min = (int)floor(time() / 60); $day = date('Y-m-d');
  if (($d['min'] ?? 0) !== $min) { $d['min'] = $min; $d['nmin'] = 0; }
  if (($d['day'] ?? '') !== $day) { $d['day'] = $day; $d['nday'] = 0; }
  $ok = $d['nmin'] < $perMin && $d['nday'] < $perDay;
  if ($ok) { $d['nmin']++; $d['nday']++; ftruncate($h, 0); rewind($h); fwrite($h, json_encode($d)); }
  flock($h, LOCK_UN); fclose($h);
  return $ok;
}
