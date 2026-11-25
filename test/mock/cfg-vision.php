<?php
const APP_TOKEN = 'tok123'; const DAILY_LIMIT = 50; const ALLOWED_ORIGIN = '';
$PROVIDERS = [
  ['name' => 'OhneBild', 'on' => true, 'type' => 'openai', 'base' => 'http://127.0.0.1:8799/v1', 'key' => 'k', 'model' => 'text', 'vision' => false],
  ['name' => 'Gemini-Mock', 'on' => true, 'type' => 'openai', 'base' => 'http://127.0.0.1:8799/v1', 'key' => 'k', 'model' => 'bild', 'vision' => true],
];
