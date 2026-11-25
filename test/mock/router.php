<?php
$in = json_decode(file_get_contents('php://input'), true);
file_put_contents(__DIR__ . '/last.json', json_encode($in, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
file_put_contents(__DIR__ . '/last-ua.txt', $_SERVER['HTTP_USER_AGENT'] ?? '');
header('Content-Type: application/json');
$res = ['kurzfassung' => 'Magnetischer Petling unten am Brückengeländer, Ostseite. Logbuch seit Oktober nass.', 'zustand' => 'wartung_noetig',
  'zustand_details' => [['punkt' => 'Logbuch nass', 'datum' => '2026-10-30', 'zitat' => 'Logbuch klatschnass', 'log_nr' => 1]],
  'letzter_fund' => '2026-11-20', 'letzte_wartung' => '', 'dnf_serie' => 0,
  'suchhilfe' => [['kategorie' => 'versteck', 'hinweis' => 'Unterseite Geländer, Ostseite', 'datum' => '2026-11-20', 'zitat' => 'unten am Geländer', 'log_nr' => 1],
                  ['kategorie' => 'werkzeug', 'hinweis' => 'Pinzette mitnehmen', 'datum' => '2026-10-02', 'zitat' => 'ohne Pinzette keine Chance', 'log_nr' => 2],
                  ['kategorie' => 'unsinn', 'hinweis' => 'x', 'zitat' => 'y', 'log_nr' => 'abc', 'datum' => 'gestern']],
  'warnungen' => [['hinweis' => 'Zecken im hohen Gras', 'datum' => '2026-06-01', 'zitat' => 'drei Zecken', 'log_nr' => 2]],
  'stationen' => [],
  'koordinaten_korrektur' => ['meter' => 0, 'richtung_grad' => -1, 'zitat' => '', 'log_nr' => 0],
  'positionen' => [['anker' => 'Bushaltestelle', 'osm_key' => 'highway', 'osm_value' => 'bus_stop', 'abstand_m' => 8, 'richtung_grad' => -1,
    'richtung_text' => 'neben', 'zitat' => '8 m neben der Bushaltestelle', 'log_nr' => 1, 'sicherheit' => 'hoch']]];
$promptText = json_encode($in['messages'] ?? []);
file_put_contents(__DIR__ . '/last-hasimg.txt', str_contains($promptText, 'image_url') || str_contains($promptText, '"type":"image"') ? 'ja' : 'nein');
if (str_contains($promptText, 'Lies aus dem Listing')) {
  $res = ['stationen' => [
      ['nr' => 1, 'name' => 'Brunnen', 'art' => 'listing', 'vorlage' => '', 'von' => '', 'distanz' => '', 'winkel' => '', 'aufgabe' => 'Zähle die Latten am Zaun = A', 'variablen' => [['name' => 'A', 'frage' => 'Anzahl Latten']]],
      ['nr' => 2, 'name' => 'Tafel', 'art' => 'projektion', 'von' => '1', 'distanz' => 'A*10', 'winkel' => '90', 'vorlage' => '', 'aufgabe' => 'Jahreszahl auf der Tafel, Quersumme = B', 'variablen' => [['name' => 'b!', 'frage' => 'QS Jahreszahl']]]],
    'final' => ['art' => 'formel', 'vorlage' => 'N 48° 22.{A}{B} E 010° 53.{A+B}0', 'text' => 'N 48 22.AB E 010 53.(A+B)0'], 'regeln' => ''];
} elseif (str_contains($promptText, 'Das Foto zeigt')) {
  $res = ['gelesen' => '23 senkrechte Latten', 'werte' => [['name' => 'A', 'wert' => '23', 'begruendung' => 'links 12, rechts 11', 'sicherheit' => 'mittel']]];
}
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
