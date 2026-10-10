<?php
/**
 * ثيم عام للموقع + الإضافة (JSON)
 * CORS مفتوح لأن الإضافة تطلبه من chrome-extension://
 */
require dirname(__DIR__) . '/includes/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Cache-Control: public, max-age=60');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

echo json_encode(fbbf_public_theme_payload(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
