<?php
/**
 * check.php — تحقق الجلسة للإضافة
 * - التوكن الصحيح = جلسة صالحة
 * - فشل قراءة users.json → 503 storage_unavailable (ليس user_not_found)
 * - لا طرد بسبب جهاز جديد
 */
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();
if (!fbbf_is_installed()) {
    fbbf_json_response(['ok' => false, 'message' => 'server_not_configured', 'message_ar' => 'السيرفر غير مهيأ بعد.'], 503);
}
fbbf_enforce_rate_limit('check', 120, 60);

$data = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' ? fbbf_request_json() : $_GET;
$email = fbbf_normalize_email((string)($data['email'] ?? ''));
$token = (string)($data['token'] ?? '');
$deviceId = fbbf_normalize_device_id((string)($data['device_id'] ?? ''));
$deviceLabel = trim((string)($data['device_label'] ?? 'Browser'));
$extVersion = trim((string)($data['extension_version'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $token === '') {
    fbbf_json_response(['ok' => false, 'message' => 'missing_credentials', 'message_ar' => 'بيانات الدخول ناقصة.'], 422);
}

// قراءة تحت حماية: فشل التخزين ≠ حساب غير موجود
$users = fbbf_users();
if (function_exists('fbbf_users_read_failed') && fbbf_users_read_failed()) {
    fbbf_json_response(['ok' => false, 'message' => 'storage_unavailable', 'message_ar' => 'السيرفر مشغول لحظيًا. أعد المحاولة بعد ثوانٍ.', 'soft' => true], 503);
}
$idx = fbbf_find_user_index($users, $email);
if ($idx === -1) {
    usleep(80000);
    $users = fbbf_users();
    if (function_exists('fbbf_users_read_failed') && fbbf_users_read_failed()) {
        fbbf_json_response(['ok' => false, 'message' => 'storage_unavailable', 'message_ar' => 'السيرفر مشغول لحظيًا. أعد المحاولة بعد ثوانٍ.', 'soft' => true], 503);
    }
    $idx = fbbf_find_user_index($users, $email);
}
if ($idx === -1) {
    // قائمة فارغة مع ملف كان فيه بيانات → اعتبرها مشغولية لا حذف حساب
    if (is_file(FBBF_USERS_FILE) && @filesize(FBBF_USERS_FILE) > 10 && count($users) === 0) {
        fbbf_json_response(['ok' => false, 'message' => 'storage_unavailable', 'message_ar' => 'السيرفر مشغول لحظيًا. أعد المحاولة بعد ثوانٍ.', 'soft' => true], 503);
    }
    fbbf_json_response(['ok' => false, 'message' => 'user_not_found', 'message_ar' => 'الحساب غير موجود.'], 404);
}
$user = $users[$idx];

if ($token === '' || !hash_equals((string)($user['access_token'] ?? ''), $token)) {
    fbbf_json_response(['ok' => false, 'message' => 'invalid_token', 'message_ar' => 'انتهت جلسة الدخول. سجّل دخولك مرة واحدة من الإضافة.'], 401);
}
if (!empty($user['blocked'])) {
    fbbf_json_response(['ok' => false, 'message' => 'blocked', 'message_ar' => 'تم إيقاف هذا الحساب.'], 403);
}

// تحديث last_seen تحت قفل عبر save_users (reconcile)
if ($deviceId !== '') {
    if (fbbf_find_device_index($user, $deviceId) === -1) {
        if (!fbbf_can_attach_device($user, $deviceId)) {
            $devices = fbbf_user_devices($user);
            usort($devices, static fn($a, $b) => (int)($a['last_seen_at'] ?? 0) <=> (int)($b['last_seen_at'] ?? 0));
            if ($devices) {
                array_shift($devices);
                $user['devices'] = array_values($devices);
                $users[$idx] = $user;
            }
        }
    }
    $users[$idx] = fbbf_touch_device($users[$idx], $deviceId, $deviceLabel, $extVersion);
}
$users[$idx]['last_check_at'] = fbbf_now();
// فشل الحفظ لا يطرد — الجلسة ما زالت صالحة بالقراءة
$saved = fbbf_save_users($users);
if (!$saved) {
    // أعد الفهرس من القرص لو الحفظ فشل
    $users2 = fbbf_users();
    $idx2 = fbbf_find_user_index($users2, $email);
    if ($idx2 !== -1) {
        $users = $users2;
        $idx = $idx2;
    }
}

$state = fbbf_compute_user_state($users[$idx]);
$config = fbbf_config();

if (function_exists('fbbf_extension_globally_enabled') && !fbbf_extension_globally_enabled()) {
    fbbf_json_response(fbbf_sign_response([
        'ok' => true,
        'email' => $email,
        'status' => 'blocked',
        'access_granted' => false,
        'message' => 'extension_paused_by_admin',
        'message_ar' => 'تم إيقاف الإضافة مؤقتًا من الإدارة.',
        'trial_active' => false,
        'subscription_active' => false,
        'soft' => false,
    ]));
}
if (function_exists('fbbf_maybe_daily_telegram_report')) {
    try { fbbf_maybe_daily_telegram_report(); } catch (Throwable $e) {}
}

$latestVersion = (string)($config['extension_version'] ?? '');
$updateAvailable = $extVersion !== '' && $latestVersion !== '' && version_compare($latestVersion, $extVersion, '>');
$ann = function_exists('fbbf_active_announcements') ? fbbf_active_announcements($email) : [];
$annUnread = array_values(array_filter($ann, static fn($a) => empty($a['seen'])));

$messageAr = '';
if (!$state['access_granted']) {
    if (($state['status'] ?? '') === 'expired') {
        $messageAr = 'انتهت التجربة أو الاشتراك. جدّد من صفحة الدفع.';
    } elseif (($state['status'] ?? '') === 'pending') {
        $messageAr = 'الحساب بانتظار التفعيل.';
    } else {
        $messageAr = 'الوصول غير مفعّل حاليًا.';
    }
}

fbbf_json_response(fbbf_sign_response([
    'ok' => true,
    'email' => $email,
    'status' => $state['status'],
    'access_granted' => $state['access_granted'],
    'trial_active' => $state['trial_active'],
    'subscription_active' => $state['subscription_active'],
    'trial_started_at' => (int)($users[$idx]['trial_started_at'] ?? 0),
    'trial_ends_at' => $state['trial_ends_at'],
    'subscription_expires_at' => $state['subscription_expires_at'],
    'wallet_number' => $config['vodafone_cash_number'] ?? '',
    'support_whatsapp' => $config['support_whatsapp'] ?? '',
    'device_id' => $deviceId,
    'device_label' => $deviceLabel,
    'max_devices' => fbbf_max_devices(),
    'latest_version' => $latestVersion,
    'update_available' => $updateAvailable,
    'announcements' => $annUnread,
    'announcements_count' => count($annUnread),
    'message' => $state['access_granted'] ? 'ok' : ($state['status'] ?? 'denied'),
    'message_ar' => $messageAr,
    'soft' => false,
]));
