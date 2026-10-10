<?php
require_once dirname(__DIR__) . '/includes/bootstrap.php';
require_once dirname(__DIR__) . '/includes/telegram-bot.php';

header('Content-Type: text/plain; charset=utf-8');

// تيليجرام يرسل POST + JSON. طلبات GET للفحص فقط.
$raw = file_get_contents('php://input') ?: '';
if ($raw === '' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo 'telegram-webhook-ok';
    exit;
}

$config = fbbf_config();
$secret = trim((string)($config['telegram_webhook_secret'] ?? ''));
// تجاهل أسرار تالفة مثل "ok: true"
if ($secret !== '' && (stripos($secret, 'ok') !== false && stripos($secret, 'true') !== false || strpos($secret, '{') !== false)) {
    $secret = '';
}
if ($secret !== '') {
    $got = (string)($_GET['secret'] ?? '');
    if (!hash_equals($secret, $got)) {
        // نرجع 200 حتى لا يعيد تيليجرام المحاولة بلا فائدة على استضافة مجانية
        echo 'forbidden';
        exit;
    }
}

$update = json_decode($raw, true);
if (!is_array($update)) {
    echo 'ignored';
    exit;
}

try {
    fbbf_telegram_handle_update($update);
} catch (Throwable $e) {
    // silent
}
echo 'ok';
