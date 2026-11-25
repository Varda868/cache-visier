<?php
$in = json_decode(file_get_contents('php://input'), true);
file_put_contents(__DIR__ . '/last.json', json_encode($in, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
header('Content-Type: application/json');
$res = ['kurzfassung' => 'Magnetisch am Geländer der Brücke.', 'zustand' => 'gut', 'letzter_fund' => '2026-11-20', 'dnf_serie' => 0,
  'versteck_hinweise' => [['hinweis' => 'Magnet', 'zitat' => 'magnetisch', 'log_nr' => 2]],
  'koordinaten_korrektur' => ['meter' => 0, 'richtung_grad' => -1, 'zitat' => '', 'log_nr' => 0],
  'positionen' => [['anker' => 'Bushaltestelle', 'osm_key' => 'highway', 'osm_value' => 'bus_stop', 'abstand_m' => 8, 'richtung_grad' => -1,
    'richtung_text' => 'neben', 'zitat' => '8 m neben der Bushaltestelle', 'log_nr' => 1, 'sicherheit' => 'hoch']]];
if (str_contains($_SERVER['REQUEST_URI'], '/valhalla/route')) {
  if (($in['costing'] ?? '') === 'auto' ) { http_response_code(400); echo '{"error_code":442,"error":"No path could be found for input","status_code":400}'; exit; }
  echo json_encode(['trip' => ['legs' => [['shape' => 'mock', 'maneuvers' => [['instruction' => 'Nach Osten gehen.', 'begin_shape_index' => 0]]]],
    'summary' => ['length' => 0.21, 'time' => 170], 'echo' => $in]]);
  exit;
}
if (str_contains($_SERVER['REQUEST_URI'], '/v1/messages')) {
  if (($_SERVER['HTTP_X_API_KEY'] ?? '') !== 'test-key') { http_response_code(401); echo '{"error":{"message":"bad key"}}'; exit; }
  echo json_encode(['model' => $in['model'], 'content' => [['type' => 'tool_use', 'name' => 'auswertung', 'input' => $res]], 'usage' => ['input_tokens' => 1234, 'output_tokens' => 210]]);
} else {
  echo json_encode(['model' => $in['model'], 'choices' => [['message' => ['content' => "<think>hmm</think>\n```json\n" . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n```"]]], 'usage' => ['total_tokens' => 999]]);
}
