<?php
/* CacheVisier – gemeinsamer Start für ki.php und route.php */
declare(strict_types=1);

function out(int $code, array $data): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

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

/* Aufruf aus dem Browser einer anderen Domain nur, wenn erlaubt */
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

