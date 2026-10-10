<?php
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();
if (!fbbf_is_installed()) {
    fbbf_json_response(['ok' => false, 'message' => 'server_not_configured'], 503);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fbbf_json_response(['ok' => false, 'message' => 'POST only'], 405);
}

// حد أقصى 10 محاولات دخول/تسجيل في الدقيقة لكل IP — يمنع تخمين الباسورد الآلي
// من غير ما يأثر على استخدام طبيعي (شخص واحد بيحاول يدخل يدويًا).
fbbf_enforce_rate_limit('auth', 10, 60);

$data = fbbf_request_json();
$action = (string)($data['action'] ?? 'login');
$email = fbbf_normalize_email((string)($data['email'] ?? ''));
$password = (string)($data['password'] ?? '');
$deviceId = fbbf_normalize_device_id((string)($data['device_id'] ?? ''));
$deviceLabel = trim((string)($data['device_label'] ?? 'Kiwi Android'));
$extVersion = trim((string)($data['extension_version'] ?? ''));
$fingerprintHash = fbbf_normalize_fingerprint((string)($data['device_fingerprint'] ?? ''));
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fbbf_json_response(['ok' => false, 'message' => 'invalid_email'], 422);
}
$users = fbbf_users();
if (fbbf_users_read_failed()) {
    fbbf_json_response(['ok' => false, 'message' => 'storage_unavailable', 'message_ar' => 'السيرفر مشغول لحظيًا. أعد المحاولة.'], 503);
}
$idx = fbbf_find_user_index($users, $email);
$config = fbbf_config();

if ($deviceId === '') {
    fbbf_json_response(['ok' => false, 'message' => 'missing_device'], 422);
}

if ($action === 'register') {
    if (!fbbf_registration_enabled()) {
        fbbf_json_response(['ok' => false, 'message' => 'registration_disabled'], 403);
    }
    if ($idx !== -1) {
        fbbf_json_response(['ok' => false, 'message' => 'email_exists'], 409);
    }
    if (fbbf_device_trial_blocked($deviceId, $email, $fingerprintHash)) {
        fbbf_json_response(['ok' => false, 'message' => 'device_trial_used'], 403);
    }
    if (strlen($password) < 4) {
        fbbf_json_response(['ok' => false, 'message' => 'weak_password'], 422);
    }
    $token = fbbf_issue_token();
    $user = [
        'email' => $email,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'auth_provider' => 'email',
        'registered_via' => 'email',
        'created_at' => fbbf_now(),
        'updated_at' => fbbf_now(),
        'trial_started_at' => fbbf_now(),
        'trial_ends_at' => fbbf_now() + (fbbf_trial_days() * 86400),
        'subscription_expires_at' => 0,
        'plan_key' => 'trial',
        'plan_label' => 'تجربة مجانية',
        'blocked' => false,
        'access_token' => $token,
        'last_login_at' => fbbf_now(),
        'last_check_at' => fbbf_now(),
        'devices' => [[
            'id' => $deviceId,
            'label' => $deviceLabel !== '' ? $deviceLabel : 'Kiwi Android',
            'first_seen_at' => fbbf_now(),
            'last_seen_at' => fbbf_now(),
            'last_version' => $extVersion,
            'user_agent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
            'last_ip' => substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64),
        ]],
        'last_login_device_id' => $deviceId,
    ];
    $users[] = $user;
    fbbf_save_users($users);
    fbbf_record_device_trial($deviceId, $email, $fingerprintHash);
    fbbf_notify_owner('register', [
        'email' => $email,
        'device_id' => $deviceId,
        'device_label' => $deviceLabel,
    ]);
    $state = fbbf_compute_user_state($user);
    fbbf_json_response([
        'ok' => true,
        'message' => 'registered',
        'email' => $email,
        'token' => $token,
        'status' => $state['status'],
        'access_granted' => $state['access_granted'],
        'trial_ends_at' => $state['trial_ends_at'],
        'subscription_expires_at' => $state['subscription_expires_at'],
        'wallet_number' => $config['vodafone_cash_number'] ?? '',
        'support_whatsapp' => $config['support_whatsapp'] ?? '',
        'device_id' => $deviceId,
        'device_label' => $deviceLabel,
        'max_devices' => fbbf_max_devices(),
    ]);
}

if ($idx === -1) {
    fbbf_json_response(['ok' => false, 'message' => 'user_not_found'], 404);
}
$user = $users[$idx];
if (!empty($user['blocked'])) {
    fbbf_json_response(['ok' => false, 'message' => 'blocked'], 403);
}
$hash = (string)($user['password_hash'] ?? '');
$hasPass = $hash !== '' && strpos($hash, '$') === 0;
if (!$hasPass) {
    // حسابات Google بدون كلمة سر — لازم يضبطوا باسورد أو يسجّلوا من جديد بكلمة سر
    fbbf_json_response(['ok' => false, 'message' => 'password_not_set'], 401);
}
if (!password_verify($password, $hash)) {
    fbbf_json_response(['ok' => false, 'message' => 'wrong_password'], 401);
}

// لو وصل حد الأجهزة: استبدل الأقدم دائمًا (إعادة تثبيت شائعة — لا نطرد المستخدم)
if ($deviceId !== '' && !fbbf_can_attach_device($user, $deviceId)) {
    $devices = fbbf_user_devices($user);
    usort($devices, static function ($a, $b) {
        return (int)($a['last_seen_at'] ?? 0) <=> (int)($b['last_seen_at'] ?? 0);
    });
    if ($devices) {
        array_shift($devices);
        $user['devices'] = array_values($devices);
        $users[$idx] = $user;
    }
}

// استقرار جذري: لا ندوّر التوكن طالما موجود وصالح — نفس التوكن لكل أجهزة الحساب
// (تجديد التوكن كان يطرد الإضافة أثناء العمل لو حصل دخول من مكان آخر أو جهاز جديد)
$existingToken = (string)($user['access_token'] ?? '');
if ($existingToken !== '' && strlen($existingToken) >= 16) {
    $token = $existingToken;
} else {
    $token = fbbf_issue_token();
}
$users[$idx]['access_token'] = $token;
$users[$idx]['last_login_at'] = fbbf_now();
$users[$idx]['last_check_at'] = fbbf_now();
$users[$idx]['updated_at'] = fbbf_now();
$users[$idx] = fbbf_touch_device($users[$idx], $deviceId, $deviceLabel, $extVersion);
// حدّث IP على الجهاز
$devs = fbbf_user_devices($users[$idx]);
$di = fbbf_find_device_index($users[$idx], $deviceId);
if ($di !== -1) {
    $devs[$di]['last_ip'] = substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
    $devs[$di]['user_agent'] = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    $users[$idx]['devices'] = $devs;
}
fbbf_save_users($users);
$user = $users[$idx];
$state = fbbf_compute_user_state($user);
fbbf_json_response([
    'ok' => true,
    'message' => 'logged_in',
    'email' => $email,
    'token' => $token,
    'status' => $state['status'],
    'access_granted' => $state['access_granted'],
    'trial_ends_at' => $state['trial_ends_at'],
    'subscription_expires_at' => $state['subscription_expires_at'],
    'wallet_number' => $config['vodafone_cash_number'] ?? '',
    'support_whatsapp' => $config['support_whatsapp'] ?? '',
    'device_id' => $deviceId,
    'device_label' => $deviceLabel,
    'max_devices' => fbbf_max_devices(),
]);
