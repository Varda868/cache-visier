<?php
/* Kopieren nach config.php und ausfüllen. config.php nie in die App oder ins Git legen. */

// Langes Zufallswort; dasselbe trägst du in der App unter Einstellungen → Token ein.
const APP_TOKEN = 'HIER-EIN-LANGES-ZUFALLSWORT';

// Höchstens so viele Auswertungen pro Tag (Bremse für Gratis-Kontingente)
const DAILY_LIMIT = 300;

// Nur diese Adresse darf das Skript aus dem Browser aufrufen, wenn App und Skript auf verschiedenen Domains liegen.
// Leer lassen, wenn beide auf derselben Domain liegen.
const ALLOWED_ORIGIN = '';

/* Schlüssel:
   - Läuft dieses Skript auf dem Pi, nimm die vorhandene Router-Datei, dann pflegst du die Schlüssel nur einmal:
       $ENV = env_file('/opt/pirouter/.env');   (der Webserver-Benutzer braucht Leserecht)
   - Auf dem Webspace: Schlüssel direkt eintragen, z. B. $ENV = ['GROQ_API_KEY' => 'gsk_...']; */
$ENV = env_file('/opt/pirouter/.env');
$k = fn(string $name) => $ENV[$name] ?? (getenv($name) ?: '');

/* Reihenfolge = Priorität. Fällt einer aus (Limit 429, Fehler, kein gültiges JSON), kommt der nächste dran.
   on => false schaltet einen Eintrag ab. needs_key => true überspringt ihn, solange kein Schlüssel da ist.
   json => true schickt response_format json_object (Groq und Gemini können das).
   Modellnamen ändern sich: bei Fehlern „model not found“ in der Konsole des Anbieters nachsehen. */
$PROVIDERS = [
  ['name' => 'Groq', 'on' => true, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://api.groq.com/openai/v1', 'key' => $k('GROQ_API_KEY'), 'model' => 'openai/gpt-oss-120b', 'json' => true, 'timeout' => 40],

  ['name' => 'Gemini', 'on' => true, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://generativelanguage.googleapis.com/v1beta/openai', 'key' => $k('GEMINI_API_KEY'), 'model' => 'gemini-3.7-flash', 'json' => true, 'timeout' => 60],

  ['name' => 'OpenRouter', 'on' => true, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://openrouter.ai/api/v1', 'key' => $k('OPENROUTER_API_KEY'), 'model' => 'NAME:free', 'json' => false, 'timeout' => 90],

  ['name' => 'Z.ai', 'on' => false, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://api.z.ai/api/paas/v4', 'key' => $k('ZAI_API_KEY'), 'model' => 'MODELLNAME', 'json' => false, 'timeout' => 90],

  ['name' => 'Mistral', 'on' => false, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://api.mistral.ai/v1', 'key' => $k('MISTRAL_API_KEY'), 'model' => 'MODELLNAME', 'json' => true, 'timeout' => 60],

  ['name' => 'GitHub Models', 'on' => false, 'type' => 'openai', 'needs_key' => true,
   'base' => 'https://models.github.ai/inference', 'key' => $k('GITHUB_MODELS_TOKEN'), 'model' => 'MODELLNAME', 'json' => false, 'timeout' => 60],

  // Nur wenn das Skript im Heimnetz läuft (z. B. auf dem Pi): lokales Ollama oder dein Router
  ['name' => 'Ollama lokal', 'on' => false, 'type' => 'openai',
   'base' => 'http://127.0.0.1:11434/v1', 'key' => '', 'model' => 'MODELLNAME', 'json' => true, 'timeout' => 180],

  // Claude als zuverlässiger, kostenpflichtiger Rückfall (sehr günstig mit Haiku)
  ['name' => 'Claude', 'on' => false, 'type' => 'anthropic', 'needs_key' => true,
   'base' => 'https://api.anthropic.com/v1/messages', 'key' => $k('ANTHROPIC_API_KEY'), 'model' => 'claude-haiku-5-5'],
];
