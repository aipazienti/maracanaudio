<?php
// api/list_sounds.php
// Returns JSON with available folders/files under ../sounds and a flat list of drums.
// Security: blocks path traversal, only lists .wav files.
header('Content-Type: application/json; charset=utf-8');

$base = realpath(__DIR__ . '/../sounds');
if ($base === false) {
  http_response_code(500);
  echo json_encode(['error' => 'sounds directory not found']);
  exit;
}

function is_safe_name($name) {
  return preg_match('/^[a-zA-Z0-9_\-\/]+$/', $name);
}

$folders = [];
$drums = [];

$rii = new RecursiveIteratorIterator(
  new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
  RecursiveIteratorIterator::SELF_FIRST
);

foreach ($rii as $file) {
  /** @var SplFileInfo $file */
  if ($file->isDir()) continue;
  $path = $file->getRealPath();
  if (!$path) continue;
  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  if ($ext !== 'wav') continue;

  $rel = str_replace('\\', '/', substr($path, strlen($base)+1)); // relative inside sounds
  // rel example: "bass/rawbass_C3.wav" or "drums/kick/kick_01.wav"
  $parts = explode('/', $rel);
  if (count($parts) < 2) continue;

  $top = $parts[0];
  if (!is_safe_name($top)) continue;

  // folder key: top-level folder OR top/sub for drums categories
  if ($top === 'drums') {
    // expose as full file path for direct fetch: sounds/<rel>
    $drums[] = 'sounds/' . $rel;
    continue;
  }

  $fname = $parts[count($parts)-1];
  if (!is_safe_name($fname)) continue;

  if (!isset($folders[$top])) $folders[$top] = [];
  $folders[$top][] = $fname;
}

// unique + sort
foreach ($folders as $k => $arr) {
  $arr = array_values(array_unique($arr));
  sort($arr, SORT_NATURAL | SORT_FLAG_CASE);
  $folders[$k] = $arr;
}
$drums = array_values(array_unique($drums));
sort($drums, SORT_NATURAL | SORT_FLAG_CASE);

echo json_encode([
  'folders' => $folders,
  'drums' => $drums,
  'generated' => date('c')
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
