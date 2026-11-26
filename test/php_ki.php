<?php
/* Lädt nur die Funktionen aus api/ki.php (ohne Ablauf) und ruft eine davon mit JSON von stdin auf – für den Abgleich mit ki.js */
$src = file_get_contents(__DIR__ . '/../api/ki.php');
$a = strpos($src, "require __DIR__"); $b = strpos($src, "/* Bilder:");
$src = substr($src, 0, $a) . substr($src, $b);
eval(preg_replace('/^<\?php/', '', $src));
$in = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($in as $job) $out[] = ($job['fn'])($job['arg']);
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
