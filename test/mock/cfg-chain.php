<?php
const APP_TOKEN = 'tok123'; const DAILY_LIMIT = 50; const ALLOWED_ORIGIN = '';
$ENV = env_file(__DIR__ . '/test.env');
$k = fn(string $n) => $ENV[$n] ?? (getenv($n) ?: '');
$PROVIDERS = [
  ['name' => 'OhneKey', 'on' => true, 'type' => 'openai', 'needs_key' => true, 'base' => 'http://127.0.0.1:8799/v1', 'key' => $k('EMPTY'), 'model' => 'x'],
  ['name' => 'Aus', 'on' => false, 'type' => 'openai', 'base' => 'http://127.0.0.1:8799/v1', 'key' => 'k', 'model' => 'x'],
  ['name' => 'Kaputt', 'on' => true, 'type' => 'openai', 'base' => 'http://127.0.0.1:8790/v1', 'key' => 'k', 'model' => 'x', 'timeout' => 3],
  ['name' => 'ClaudeFalsch', 'on' => true, 'type' => 'anthropic', 'base' => 'http://127.0.0.1:8799/v1/messages', 'key' => $k('GROQ_API_KEY'), 'model' => 'claude-haiku-5-5'],
  ['name' => 'Claude', 'on' => true, 'type' => 'anthropic', 'base' => 'http://127.0.0.1:8799/v1/messages', 'key' => $k('ANTHROPIC_API_KEY'), 'model' => 'claude-haiku-5-5'],
];
