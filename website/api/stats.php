<?php
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();
if (!fbbf_is_installed()) { fbbf_json_response(['ok'=>false,'message'=>'server_not_configured'],503); }
if (!fbbf_admin_logged_in()) { fbbf_json_response(['ok'=>false,'message'=>'unauthorized'],401); }

$statsFile = FBBF_ROOT . '/data/download-stats.json';
$stats = file_exists($statsFile)
  ? (json_decode(file_get_contents($statsFile) ?: '{}', true) ?: [])
  : [];

// Last 7 days
$last7 = [];
for ($i = 6; $i >= 0; $i--) {
  $d = date('Y-m-d', strtotime("-$i days"));
  $last7[] = ['date' => $d, 'count' => (int)($stats['by_day'][$d] ?? 0)];
}

fbbf_json_response([
  'ok'       => true,
  'total'    => (int)($stats['total'] ?? 0),
  'today'    => (int)($stats['by_day'][date('Y-m-d')] ?? 0),
  'this_month' => (int)($stats['by_month'][date('Y-m')] ?? 0),
  'last_at'  => $stats['last_at'] ?? null,
  'last7'    => $last7,
]);
