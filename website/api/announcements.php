<?php
/**
 * إشعارات المستخدمين — قراءة عامة + تعليم كمقروء للمستخدم المسجّل
 * GET  → قائمة الإشعارات النشطة
 * POST → mark_seen { id, email, token }
 */
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();
if (!fbbf_is_installed()) {
    fbbf_json_response(['ok' => false, 'message' => 'server_not_configured'], 503);
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
fbbf_enforce_rate_limit('announcements_' . strtolower($method), 40, 60);

if ($method === 'GET') {
    $email = fbbf_normalize_email((string)($_GET['email'] ?? ''));
    $token = (string)($_GET['token'] ?? '');
    $extVersion = trim((string)($_GET['extension_version'] ?? ''));

    // لو معاه توكن صالح نربط الإيميل لمعرفة المقروء
    if ($email !== '' && $token !== '') {
        $users = fbbf_users();
        $idx = fbbf_find_user_index($users, $email);
        if ($idx === -1 || !hash_equals((string)($users[$idx]['access_token'] ?? ''), $token)) {
            $email = ''; // تجاهل إيميل غير موثّق
        }
    } else {
        $email = '';
    }

    $list = fbbf_active_announcements($email !== '' ? $email : null);
    $unread = array_values(array_filter($list, static function ($a) {
        return empty($a['seen']);
    }));

    $config = fbbf_config();
    $latestVersion = (string)($config['extension_version'] ?? '');
    $updateAvailable = $extVersion !== '' && $latestVersion !== '' && version_compare($latestVersion, $extVersion, '>');

    fbbf_json_response([
        'ok' => true,
        'announcements' => $list,
        'unread' => $unread,
        'unread_count' => count($unread),
        'latest_version' => $latestVersion,
        'update_available' => $updateAvailable,
        'download_url' => 'https://faset.xo.je/' . (string)($config['extension_filename'] ?? 'fb-bablushr-f-extension.zip'),
    ]);
}

if ($method === 'POST') {
    $data = fbbf_request_json();
    $action = (string)($data['action'] ?? 'mark_seen');
    $email = fbbf_normalize_email((string)($data['email'] ?? ''));
    $token = (string)($data['token'] ?? '');
    $id = trim((string)($data['id'] ?? ''));

    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $token === '' || $id === '') {
        fbbf_json_response(['ok' => false, 'message' => 'missing_fields'], 422);
    }
    $users = fbbf_users();
    $idx = fbbf_find_user_index($users, $email);
    if ($idx === -1 || !hash_equals((string)($users[$idx]['access_token'] ?? ''), $token)) {
        fbbf_json_response(['ok' => false, 'message' => 'unauthorized'], 401);
    }
    if ($action === 'mark_seen') {
        $ok = fbbf_mark_announcement_seen($id, $email);
        fbbf_json_response(['ok' => $ok, 'message' => $ok ? 'marked' : 'not_found']);
    }
    fbbf_json_response(['ok' => false, 'message' => 'unknown_action'], 400);
}

fbbf_json_response(['ok' => false, 'message' => 'method_not_allowed'], 405);
