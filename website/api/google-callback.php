<?php
/**
 * Google OAuth callback — PHP 8.0+ compatible
 * ?next=download → بعد النجاح يوجّه للتحميل
 */
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_require_install_or_redirect();

$config = fbbf_config();
if (!fbbf_google_oauth_enabled()) {
    http_response_code(503);
    echo 'Google OAuth غير مفعّل. أضف Client ID/Secret من لوحة الأدمن.';
    exit;
}

$code = (string)($_GET['code'] ?? '');
$error = (string)($_GET['error'] ?? '');
$next = (string)($_GET['next'] ?? '');
// Google أحيانًا يرجع state فقط؛ نقرأ next من session إن وُجد
if ($next === '' && !empty($_SESSION['fbbf_oauth_next'])) {
    $next = (string)$_SESSION['fbbf_oauth_next'];
}
unset($_SESSION['fbbf_oauth_next']);

if ($error !== '' || $code === '') {
    header('Location: /login-download.php?err=google');
    exit;
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $scheme = 'https';
}
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
// يجب أن يطابق Redirect URI المسجّل في Google حرفيًا (بدون query)
$redirectUri = $scheme . '://' . $host . '/api/google-callback.php';

$info = fbbf_google_exchange_code($code, $redirectUri);
if (!$info || empty($info['email'])) {
    header('Location: /login-download.php?err=google_token');
    exit;
}

$email = fbbf_normalize_email($info['email']);
$users = fbbf_users();
$i = fbbf_find_user_index($users, $email);
$isNew = false;

if ($i === -1) {
    if (!fbbf_registration_enabled()) {
        header('Location: /login-download.php?err=reg_disabled');
        exit;
    }
    $now = fbbf_now();
    $token = fbbf_issue_token();
    $users[] = [
        'email' => $email,
        'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
        'created_at' => $now,
        'updated_at' => $now,
        'trial_started_at' => $now,
        'trial_ends_at' => $now + (fbbf_trial_days() * 86400),
        'subscription_expires_at' => 0,
        'plan_key' => 'trial',
        'plan_label' => 'تجربة مجانية',
        'blocked' => false,
        'access_token' => $token,
        'last_login_at' => $now,
        'devices' => [],
        'last_login_device_id' => '',
        'email_verified' => true,
        'auth_provider' => 'google',
        'google_name' => (string)($info['name'] ?? ''),
        'registered_via' => 'google',
    ];
    fbbf_save_users($users);
    $isNew = true;
    if (function_exists('fbbf_issue_verification_code')) {
        fbbf_issue_verification_code($email, 'welcome');
    }
    if (function_exists('fbbf_notify_owner')) {
        fbbf_notify_owner('register', [
            'email' => $email,
            'device_id' => '',
            'device_label' => 'تسجيل Google من الموقع',
        ]);
    }
    if (function_exists('fbbf_audit_log')) {
        fbbf_audit_log('تسجيل Google جديد', $email);
    }
} else {
    $users[$i]['email_verified'] = true;
    $users[$i]['auth_provider'] = 'google';
    $users[$i]['updated_at'] = fbbf_now();
    $users[$i]['last_login_at'] = fbbf_now();
    if (empty($users[$i]['access_token'])) {
        $users[$i]['access_token'] = fbbf_issue_token();
    }
    if (empty($users[$i]['google_name']) && !empty($info['name'])) {
        $users[$i]['google_name'] = (string)$info['name'];
    }
    fbbf_save_users($users);
    if (function_exists('fbbf_notify_owner')) {
        fbbf_notify_owner('download', [
            'email' => $email,
            'device_id' => '',
            'device_label' => 'دخول Google من الموقع',
        ]);
    }
    if (function_exists('fbbf_audit_log')) {
        fbbf_audit_log('دخول Google', $email);
    }
}

fbbf_user_login_remember($email);

// دائمًا نعود لصفحة التسجيل/التحميل داخل نفس الموقع لعرض حالة الدخول
header('Location: /login-download.php');
exit;
