<?php
const APP_TOKEN = 'tok123'; const DAILY_LIMIT = 50; const ALLOWED_ORIGIN = ''; const VALHALLA_URL = 'http://127.0.0.1:8799/valhalla'; const ROUTE_PER_MINUTE = 2;
$PROVIDERS = [['name' => 'Groq', 'on' => true, 'type' => 'openai', 'base' => 'http://127.0.0.1:8799/v1', 'key' => 'gsk', 'model' => 'openai/gpt-oss-120b', 'json' => true]];
