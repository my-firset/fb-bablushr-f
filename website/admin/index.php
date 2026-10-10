<?php
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_require_install_or_redirect();

$config = fbbf_config();
$plans = fbbf_plan_catalog();

if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: /admin/index.php');
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = $_POST['action'] ?? '';

    if ($action === 'login') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $password = (string)($_POST['password'] ?? '');
        $tsToken = $_POST['cf-turnstile-response'] ?? '';
        if (function_exists('fbbf_turnstile_enabled') && fbbf_turnstile_enabled() && !fbbf_verify_turnstile($tsToken)) {
            fbbf_flash('فشل التحقق من Cloudflare Turnstile.', 'err');
            fbbf_redirect('/admin/index.php');
        }
        if ($email === ($config['admin_email'] ?? '') && password_verify($password, (string)($config['admin_password_hash'] ?? ''))) {
            $_SESSION['fbbf_admin_logged_in'] = true;
            if (function_exists('fbbf_audit_log')) fbbf_audit_log('تسجيل دخول أدمن', $email);
            fbbf_flash('تم تسجيل الدخول بنجاح.', 'ok');
        } else {
            fbbf_flash('بيانات الأدمن غير صحيحة.', 'err');
        }
        fbbf_redirect('/admin/index.php');
    }

    if (!fbbf_admin_logged_in()) {
        fbbf_flash('سجّل دخول الأول.', 'err');
        fbbf_redirect('/admin/index.php');
    }

    $users = fbbf_users();
    $payments = fbbf_payments();

    $applyPlan = function (array &$user, string $planKey) use ($plans) {
        if (!isset($plans[$planKey])) return false;
        $days = (int)$plans[$planKey]['days'];
        $base = max(fbbf_now(), (int)($user['subscription_expires_at'] ?? 0));
        $user['plan_key'] = $planKey;
        $user['plan_label'] = $plans[$planKey]['label'];
        $user['subscription_expires_at'] = $base + ($days * 86400);
        $user['blocked'] = false;
        // تصفير قفل الأجهزة عند أي تفعيل يدوي من الأدمن — لو المستخدم مسح
        // الإضافة أو غيّر جهازه، القفل القديم كان بيفضل قايم حتى بعد التفعيل
        // فيتقفل تاني بـ device_limit_reached من غير أي داعي. بما إن الأدمن
        // بيمنح وصول جديد بوعي، الأصح إنه يقدر يدخل من أي جهاز فورًا.
        $user['devices'] = [];
        $user['last_login_device_id'] = '';
        $user['updated_at'] = fbbf_now();
        return true;
    };

    if ($action === 'add_user') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $password = (string)($_POST['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fbbf_flash('اكتب إيميل صحيح.', 'err');
        } elseif (strlen($password) < 4) {
            fbbf_flash('اكتب كلمة مرور 4 أحرف على الأقل.', 'err');
        } elseif (fbbf_find_user_index($users, $email) !== -1) {
            fbbf_flash('المستخدم موجود بالفعل.', 'err');
        } else {
            $users[] = [
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_DEFAULT),
                'created_at' => fbbf_now(),
                'updated_at' => fbbf_now(),
                'trial_started_at' => 0,
                'trial_ends_at' => 0,
                'subscription_expires_at' => 0,
                'plan_key' => '',
                'plan_label' => '',
                'blocked' => false,
                'access_token' => '',
                'last_login_at' => 0,
                'last_check_at' => 0,
            ];
            fbbf_save_users($users);
            fbbf_log_admin_action('إضافة مستخدم يدويًا', $email);
            fbbf_flash('تمت إضافة المستخدم بنجاح.', 'ok');
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'activate_user') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $planKey = (string)($_POST['plan_key'] ?? 'monthly');
        $i = fbbf_find_user_index($users, $email);
        if ($i === -1) {
            fbbf_flash('المستخدم غير موجود.', 'err');
        } else {
            $applyPlan($users[$i], $planKey);
            fbbf_save_users($users);
            fbbf_log_admin_action('تفعيل خطة', $email, $plans[$planKey]['label'] ?? $planKey);
            fbbf_flash('تم التفعيل بنجاح.', 'ok');
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'toggle_block') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $i = fbbf_find_user_index($users, $email);
        if ($i !== -1) {
            $users[$i]['blocked'] = empty($users[$i]['blocked']);
            $users[$i]['updated_at'] = fbbf_now();
            fbbf_save_users($users);
            fbbf_log_admin_action(!empty($users[$i]['blocked']) ? 'حظر مستخدم' : 'فك حظر مستخدم', $email);
            fbbf_flash(!empty($users[$i]['blocked']) ? 'تم حظر المستخدم.' : 'تم فك الحظر.', 'ok');
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'renew_trial') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $i = fbbf_find_user_index($users, $email);
        if ($i !== -1) {
            $now = fbbf_now();
            $users[$i]['trial_started_at'] = $now;
            $users[$i]['trial_ends_at'] = $now + (fbbf_trial_days() * 86400);
            // تجديد التجربة يدويًا من الأدمن قرار واعٍ منه، فبنشيل أي حظر
            // كان قايم عشان التفعيل يبان أثره فورًا للمستخدم
            $users[$i]['blocked'] = false;
            // نفس إصلاح applyPlan: تصفير قفل الأجهزة عشان المستخدم يقدر يدخل
            // فورًا من أي جهاز بعد التجديد، بدل ما يفضل واقف على جهاز قديم
            $users[$i]['devices'] = [];
            $users[$i]['last_login_device_id'] = '';
            $users[$i]['updated_at'] = $now;
            fbbf_save_users($users);
            fbbf_log_admin_action('تجديد تجربة مجانية', $email, fbbf_trial_days() . ' أيام');
            fbbf_flash('تم تفعيل تجربة مجانية جديدة (' . fbbf_trial_days() . ' أيام) للمستخدم.', 'ok');
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'test_whatsapp') {
        $sent = false;
        try { $sent = fbbf_send_whatsapp('🔔 رسالة اختبار من لوحة تحكم fb Bablushr F — لو وصلتك دي، الإعداد شغال صح.'); }
        catch (\Throwable $e) { /* silent */ }
        fbbf_flash($sent ? 'اتبعتت رسالة اختبار — تحقق من واتساب.' : 'فشل الإرسال — شوف "آخر رد فعلي من CallMeBot" تحت لمعرفة السبب.', $sent ? 'ok' : 'err');
        fbbf_redirect('/admin/index.php#settings');
    }

    if ($action === 'generate_download_link') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $i = fbbf_find_user_index($users, $email);
        if ($i === -1) {
            fbbf_flash('المستخدم غير موجود.', 'err');
        } else {
            $state = fbbf_compute_user_state($users[$i]);
            if (!$state['access_granted']) {
                fbbf_flash('لازم تفعّل خطة أو تجربة للمستخدم قبل توليد رابط تحميل له.', 'err');
            } else {
                // رابط تحميل مباشر يديه الأدمن للمستخدم — صالح 24 ساعة، استخدام
                // واحد (نفس آلية توكين التحميل العادي لكن بمهلة أطول تناسب
                // الإرسال اليدوي بدل ما يفتحه المستخدم فورًا). صفر باسورد بيتشارك.
                $downloadToken = fbbf_issue_download_token($email, 86400);
                $link = 'https://faset.xo.je/download.php?' . http_build_query([
                    'email' => $email,
                    'dtoken' => $downloadToken,
                ]);
                fbbf_log_admin_action('توليد رابط تحميل مباشر', $email);
                fbbf_flash($link, 'link');
            }
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'delete_user') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        if ($email !== '' && fbbf_delete_user_by_email($email)) {
            fbbf_log_admin_action('حذف مستخدم نهائيًا', $email);
            fbbf_flash('تم حذف المستخدم.', 'ok');
        } else {
            fbbf_flash('تعذر حذف المستخدم.', 'err');
        }
        fbbf_redirect('/admin/index.php#users');
    }

    if ($action === 'activate_payment') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        $paymentId = (string)($_POST['payment_id'] ?? '');
        $planKey = (string)($_POST['plan_key'] ?? 'monthly');
        $i = fbbf_find_user_index($users, $email);
        if ($i === -1) {
            fbbf_flash('المستخدم مش موجود. خليه يعمل تسجيل من الإضافة الأول.', 'err');
        } else {
            $applyPlan($users[$i], $planKey);
            foreach ($payments as &$payment) {
                if (($payment['id'] ?? '') === $paymentId) {
                    $payment['status'] = 'approved';
                    $payment['approved_at'] = fbbf_now();
                }
            }
            unset($payment);
            fbbf_save_users($users);
            fbbf_save_payments($payments);
            fbbf_log_admin_action('اعتماد طلب دفع وتفعيل خطة', $email, ($plans[$planKey]['label'] ?? $planKey) . ' — طلب #' . $paymentId);
            fbbf_flash('تم تفعيل الاشتراك واعتماد الطلب.', 'ok');
        }
        fbbf_redirect('/admin/index.php#payments');
    }


    if ($action === 'create_announcement') {
        $title = trim((string)($_POST['ann_title'] ?? ''));
        $body = trim((string)($_POST['ann_body'] ?? ''));
        $type = (string)($_POST['ann_type'] ?? 'info');
        if (!in_array($type, ['update', 'info', 'urgent'], true)) $type = 'info';
        $ctaLabel = trim((string)($_POST['ann_cta_label'] ?? ''));
        $ctaUrl = trim((string)($_POST['ann_cta_url'] ?? ''));
        $days = max(0, (int)($_POST['ann_days'] ?? 14));
        $sendEmail = isset($_POST['ann_send_email']);
        if ($title === '' || $body === '') {
            fbbf_flash('اكتب عنوان ونص الإشعار.', 'err');
            fbbf_redirect('/admin/index.php#announcements');
        }
        $id = bin2hex(random_bytes(8));
        $item = [
            'id' => $id,
            'title' => $title,
            'body' => $body,
            'type' => $type,
            'active' => true,
            'created_at' => fbbf_now(),
            'expires_at' => $days > 0 ? (fbbf_now() + ($days * 86400)) : 0,
            'cta_label' => $ctaLabel !== '' ? $ctaLabel : ($type === 'update' ? 'تحميل التحديث' : ''),
            'cta_url' => $ctaUrl !== '' ? $ctaUrl : 'https://faset.xo.je',
            'send_email' => $sendEmail,
            'email_sent' => 0,
            'email_failed' => 0,
            'seen_by' => [],
        ];
        $all = fbbf_announcements();
        array_unshift($all, $item);
        if (count($all) > 100) $all = array_slice($all, 0, 100);
        fbbf_save_announcements($all);
        $mailNote = '';
        if ($sendEmail) {
            $res = fbbf_broadcast_announcement_emails($item);
            // تحديث عدادات الإيميل
            $all = fbbf_announcements();
            foreach ($all as &$a) {
                if (($a['id'] ?? '') === $id) {
                    $a['email_sent'] = (int)($res['sent'] ?? 0);
                    $a['email_failed'] = (int)($res['failed'] ?? 0);
                    break;
                }
            }
            unset($a);
            fbbf_save_announcements($all);
            $mailNote = ' · إيميل: أُرسل ' . (int)$res['sent'] . ' / فشل ' . (int)$res['failed'];
        }
        fbbf_log_admin_action('نشر إشعار للمستخدمين', '', $title . $mailNote);
        fbbf_flash('تم نشر الإشعار بنجاح.' . $mailNote, 'ok');
        fbbf_redirect('/admin/index.php#announcements');
    }

    if ($action === 'toggle_announcement') {
        $id = trim((string)($_POST['ann_id'] ?? ''));
        $all = fbbf_announcements();
        foreach ($all as &$a) {
            if (($a['id'] ?? '') === $id) {
                $a['active'] = empty($a['active']);
                break;
            }
        }
        unset($a);
        fbbf_save_announcements($all);
        fbbf_flash('تم تحديث حالة الإشعار.', 'ok');
        fbbf_redirect('/admin/index.php#announcements');
    }

    if ($action === 'delete_announcement') {
        $id = trim((string)($_POST['ann_id'] ?? ''));
        $all = array_values(array_filter(fbbf_announcements(), fn($a) => ($a['id'] ?? '') !== $id));
        fbbf_save_announcements($all);
        fbbf_flash('تم حذف الإشعار.', 'ok');
        fbbf_redirect('/admin/index.php#announcements');
    }

    if ($action === 'mark_notifications_read') {
        $all = fbbf_notifications();
        foreach ($all as &$n) { $n['read'] = true; }
        unset($n);
        fbbf_write_json(FBBF_NOTIFICATIONS_FILE, $all);
        fbbf_redirect('/admin/index.php#dashboard');
    }



    if ($action === 'save_telegram_from_browser') {
        $token = trim((string)($_POST['telegram_bot_token'] ?? ''));
        if (function_exists('fbbf_normalize_telegram_token')) {
            $token = fbbf_normalize_telegram_token($token);
        }
        $chat = preg_replace('/\s+/', '', (string)($_POST['telegram_chat_id'] ?? ''));
        if ($token === '' || $chat === '') {
            fbbf_flash('التوكن أو Chat ID ناقص. الصق الاثنين ثم احفظ.', 'err');
            fbbf_redirect('/admin/index.php#settings');
        }
        $config['telegram_bot_token'] = $token;
        $config['telegram_chat_id'] = $chat;
        $config['telegram_bot_username'] = ltrim(trim((string)($_POST['telegram_bot_username'] ?? ($config['telegram_bot_username'] ?? 'fbpublisher_bot'))), '@');
        $secIn = trim((string)($_POST['telegram_webhook_secret'] ?? ($config['telegram_webhook_secret'] ?? '')));
        // منع لصق ردود JSON بالخطأ في خانة السر
        if ($secIn !== '' && (preg_match('/[{}\"ok\s*:\s*true]/i', $secIn) || stripos($secIn, 'Webhook') !== false)) {
            $secIn = '';
        }
        $config['telegram_webhook_secret'] = $secIn;
        $config['telegram_linked_at'] = fbbf_now();
        $config['telegram_link_mode'] = 'manual';
        if (!fbbf_save_config($config)) {
            fbbf_flash('فشل حفظ الملف على السيرفر. تحقق من صلاحيات مجلد data/.', 'err');
            fbbf_redirect('/admin/index.php#settings');
        }
        if (function_exists('fbbf_log_admin_action')) {
            fbbf_log_admin_action('حفظ تيليجرام يدوي', '', 'chat ' . $chat);
        }
        fbbf_flash('تم حفظ تيليجرام بنجاح. Chat ID: ' . $chat, 'ok');
        fbbf_redirect('/admin/index.php#settings');
    }


    if ($action === 'telegram_cmd') {
        require_once dirname(__DIR__) . '/includes/telegram-bot.php';
        $text = trim((string)($_POST['text'] ?? ''));
        $chat = trim((string)($config['telegram_chat_id'] ?? ''));
        if ($text === '') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => false, 'error' => 'empty'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $reply = fbbf_telegram_process_command($text, $chat);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true, 'reply' => $reply], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'discover_telegram_chat') {
        $token = trim((string)($_POST['telegram_bot_token'] ?? ($config['telegram_bot_token'] ?? '')));
        if ($token === '') {
            fbbf_flash('ضع Bot Token أولاً ثم اضغط اكتشاف Chat ID.', 'err');
            fbbf_redirect('/admin/index.php#settings');
        }
        $res = fbbf_telegram_discover_chat_id($token);
        if (empty($res['ok'])) {
            fbbf_flash((string)($res['error'] ?? 'فشل الاكتشاف'), 'err');
            fbbf_redirect('/admin/index.php#settings');
        }
        $config['telegram_bot_token'] = (string)($res['token'] ?? $token);
        $config['telegram_chat_id'] = (string)$res['chat_id'];
        fbbf_save_config($config);
        $label = (string)($res['label'] ?? '');
        fbbf_flash('تم اكتشاف Chat ID: ' . $res['chat_id'] . ($label !== '' ? ' (' . $label . ')' : '') . ' — احفظه تم تلقائياً.', 'ok');
        fbbf_redirect('/admin/index.php#settings');
    }
    if ($action === 'test_telegram') {
        $token = trim((string)($config['telegram_bot_token'] ?? ''));
        $chat = trim((string)($config['telegram_chat_id'] ?? ''));
        if ($token === '' || $chat === '') {
            fbbf_flash('أدخل التوكن واكتشف Chat ID أولاً.', 'err');
            fbbf_redirect('/admin/index.php#settings');
        }
        $res = fbbf_telegram_test_message($token, $chat);
        fbbf_flash(!empty($res['ok']) ? 'تم إرسال رسالة تجريبية على تيليجرام.' : ('فشل الاختبار: ' . ($res['error'] ?? '')), !empty($res['ok']) ? 'ok' : 'err');
        fbbf_redirect('/admin/index.php#settings');
    }

    if ($action === 'save_settings') {
        $config['support_whatsapp'] = trim((string)($_POST['support_whatsapp'] ?? ($config['support_whatsapp'] ?? '')));
        $config['vodafone_cash_number'] = trim((string)($_POST['vodafone_cash_number'] ?? ($config['vodafone_cash_number'] ?? '')));
        $config['trial_days'] = max(1, (int)($_POST['trial_days'] ?? ($config['trial_days'] ?? 3)));
        // Site theme
        if (!empty($_POST['site_theme'])) {
            $config['site_theme'] = (string)$_POST['site_theme'];
            $map = [
                'publisher' => 'publisher',
                'obsidian' => 'obsidian_aurora',
                'obsidian_aurora' => 'obsidian_aurora',
                'gold' => 'verdigris',
                'verdigris' => 'verdigris',
                'blue' => 'blue',
                'green' => 'verdigris',
                'purple' => 'purple',
                'red' => 'red',
            ];
            $st = $config['site_theme'];
            $config['theme'] = $map[$st] ?? (isset(fbbf_theme_presets()[$st]) ? $st : 'publisher');
            $config['site_theme'] = $config['theme'];
        }
        if (isset($_POST['theme_radius'])) {
            $r = preg_replace('/[^0-9]/', '', (string)$_POST['theme_radius']);
            $config['theme_radius'] = ($r !== '' ? $r : '14') . 'px';
        }
        if (isset($_POST['theme_btn_style'])) {
            $bs = (string)$_POST['theme_btn_style'];
            $config['theme_btn_style'] = in_array($bs, ['gradient','solid','outline'], true) ? $bs : 'gradient';
        }
        if (isset($_POST['theme_icon_set'])) {
            $is = (string)$_POST['theme_icon_set'];
            $config['theme_icon_set'] = in_array($is, ['modern','minimal','bold'], true) ? $is : 'modern';
        }
        if (isset($_POST['theme_form']) && $_POST['theme_form'] === '1') {
            $config['theme_apply_extension'] = isset($_POST['theme_apply_extension']);
            $config['theme_updated_at'] = time();
        }
        if (!empty($_POST['accent_color'])) {
            $config['accent_color'] = (string)$_POST['accent_color'];
        }
        if (!empty($_POST['new_admin_password'])) {
            $config['admin_password_hash'] = password_hash((string)$_POST['new_admin_password'], PASSWORD_DEFAULT);
        }
        if (($_POST['settings_form'] ?? '') === 'protection') {
            $config['device_trial_lock_enabled'] = isset($_POST['device_trial_lock_enabled']);
            $config['notify_on_register'] = isset($_POST['notify_on_register']);
            $config['notify_on_download'] = isset($_POST['notify_on_download']);
            $config['extension_globally_enabled'] = isset($_POST['extension_globally_enabled']);
        }
        $config['telegram_bot_token'] = trim((string)($_POST['telegram_bot_token'] ?? ($config['telegram_bot_token'] ?? '')));
        $config['telegram_chat_id'] = trim((string)($_POST['telegram_chat_id'] ?? ($config['telegram_chat_id'] ?? '')));
        $config['whatsapp_phone'] = trim((string)($_POST['whatsapp_phone'] ?? ($config['whatsapp_phone'] ?? '')));
        $config['whatsapp_callmebot_apikey'] = trim((string)($_POST['whatsapp_callmebot_apikey'] ?? ($config['whatsapp_callmebot_apikey'] ?? '')));
        // Cloudflare Turnstile + Google OAuth + mail
        if (isset($_POST['turnstile_site_key'])) {
            $config['turnstile_site_key'] = trim((string)$_POST['turnstile_site_key']);
            $config['turnstile_secret_key'] = trim((string)($_POST['turnstile_secret_key'] ?? ''));
            $config['google_client_id'] = trim((string)($_POST['google_client_id'] ?? ''));
            $config['google_client_secret'] = trim((string)($_POST['google_client_secret'] ?? ''));
            $config['mail_from'] = trim((string)($_POST['mail_from'] ?? ''));
        }
        fbbf_save_config($config);
        if (function_exists('fbbf_audit_log')) {
            fbbf_audit_log('حفظ الإعدادات', '', (string)($config['site_theme'] ?? ''));
        }
        fbbf_flash('تم حفظ الإعدادات.', 'ok');
        fbbf_redirect('/admin/index.php#settings');
    }

    if ($action === 'send_user_code') {
        $email = fbbf_normalize_email($_POST['email'] ?? '');
        if (filter_var($email, FILTER_VALIDATE_EMAIL) && function_exists('fbbf_issue_verification_code')) {
            $code = fbbf_issue_verification_code($email, 'welcome');
            fbbf_audit_log('إرسال كود ترحيب', $email, $code);
            fbbf_flash('كود الترحيب لـ ' . $email . ': ' . $code, 'ok');
        } else {
            fbbf_flash('إيميل غير صالح.', 'err');
        }
        fbbf_redirect('/admin/index.php#users');
    }
}


$flash = fbbf_flash();

// ── Login page ──────────────────────────────────────────────────────
if (!fbbf_admin_logged_in()):
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<link rel="icon" href="/assets/icons/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/icon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/icon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/icon-180.png"/>
<link rel="manifest" href="/site.webmanifest"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="fb Bablushr F"/>

<meta name="viewport" content="width=device-width,initial-scale=1">
<title>دخول الأدمن — Bablushr F</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#0a0a0b;--s2:#111113;--b2:rgba(45,212,191,0.22);--p1:#2dd4bf;--p2:#5eead4;--pg:linear-gradient(135deg,#115e59 0%,#0f766e 35%,#14b8a6 72%,#2dd4bf 100%);--pglow:rgba(45,212,191,0.36);--t1:#f9f9f9;--t2:#a1a1aa;--ok:#4ade80;--err:#fb7185;--font:'Cairo',Tahoma,sans-serif;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--t1);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  background:radial-gradient(ellipse 60% 36% at 80% 0%,rgba(45,212,191,0.08),transparent),
             radial-gradient(ellipse 44% 28% at 12% 95%,rgba(20,184,166,0.05),transparent),#0a0a0b;}
.card{width:min(400px,100%);background:var(--s2);border:1px solid var(--b2);border-radius:24px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.logo{width:56px;height:56px;border-radius:16px;background:var(--pg);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 20px;box-shadow:0 6px 20px var(--pglow);}
h1{text-align:center;font-size:22px;font-weight:900;margin-bottom:6px;}
.sub{text-align:center;font-size:13px;color:var(--t2);margin-bottom:24px;}
label{display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px;margin-top:16px;}
input{width:100%;padding:13px 15px;border-radius:12px;border:1.5px solid rgba(45,212,191,0.2);background:#0d0d0f;color:#fff;box-sizing:border-box;font-family:var(--font);font-size:14px;outline:none;transition:border-color .2s;}
input:focus{border-color:rgba(94,214,201,0.5);}
button{margin-top:20px;width:100%;padding:14px;border:none;border-radius:14px;background:var(--pg);color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:var(--font);box-shadow:0 4px 16px var(--pglow);transition:filter .2s;}
button:hover{filter:brightness(1.1);}
.msg{padding:12px 14px;border-radius:12px;margin:12px 0;font-size:13px;}
.ok{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.25);color:var(--ok);}
.err{background:rgba(251,113,133,0.1);border:1px solid rgba(251,113,133,0.25);color:var(--err);}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🛡️</div>
  <h1>لوحة الإدارة</h1>
  <p class="sub">fb Bablushr F — دخول الأدمن فقط</p>
  <?php if($flash): ?>
  <div class="msg <?= fbbf_h($flash['type']) ?>"><?= fbbf_h($flash['message']) ?></div>
  <?php endif; ?>
  <form method="post">
    <input type="hidden" name="action" value="login">
    <label>البريد الإلكتروني</label>
          <label class="checkbox-line" style="display:flex;gap:8px;align-items:center;margin:10px 0;font-size:13px">
            <input type="checkbox" name="extension_globally_enabled" value="1" <?= !isset($config['extension_globally_enabled']) || !empty($config['extension_globally_enabled']) ? 'checked' : '' ?>>
            <span>الإضافة مفعّلة عالميًا (إلغاء التحديد = إيقاف عن بُعد لكل المستخدمين)</span>
          </label>

    <input type="email" name="email" required autocomplete="email" placeholder="admin@example.com">
    <label>كلمة المرور</label>
    <input type="password" name="password" required placeholder="••••••••">
    <?php if (function_exists('fbbf_turnstile_enabled') && fbbf_turnstile_enabled()): ?>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <div style="margin-top:16px" class="cf-turnstile" data-sitekey="<?= fbbf_h((string)($config['turnstile_site_key']??'')) ?>" data-theme="dark"></div>
    <?php endif; ?>
    <button type="submit">🔐 دخول</button>
  </form>
</div>

<script>
function fbbfTgNormToken(t) {
  t = String(t || '').replace(/\s+/g, '');
  var m = t.match(/^([A-Za-z0-9_-]{20,}):(\d{6,12})$/);
  if (m) t = m[2] + ':' + m[1];
  return t;
}
function fbbfTgStatus(msg, ok) {
  var el = document.getElementById('tgClientStatus');
  if (!el) return;
  el.style.color = ok === true ? '#4ade80' : (ok === false ? '#fb7185' : 'var(--t2)');
  el.textContent = msg || '';
}
async function fbbfTgDiscover() {
  var input = document.getElementById('tgTokenInput');
  var chatInput = document.getElementById('tgChatInput');
  var token = fbbfTgNormToken(input && input.value);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    fbbfTgStatus('صيغة التوكن غير صحيحة. يجب: 123456789:AAH...', false);
    return;
  }
  if (input) input.value = token;
  fbbfTgStatus('جاري الاتصال بتيليجرام من متصفحك...', null);
  try {
    var url = 'https://api.telegram.org/bot' + encodeURIComponent(token).replace(/%3A/gi, ':') + '/getUpdates?limit=30';
    // encodeURIComponent encodes colon — fix: build manually
    url = 'https://api.telegram.org/bot' + token + '/getUpdates?limit=30';
    var resp = await fetch(url);
    var data = await resp.json();
    if (!data || !data.ok) {
      fbbfTgStatus((data && data.description) || 'توكن غير صالح أو البوت غير متاح', false);
      return;
    }
    var updates = data.result || [];
    if (!updates.length) {
      fbbfTgStatus('لا رسائل بعد. افتح البوت في تيليجرام واضغط Start أو اكتب أي رسالة، ثم أعد المحاولة.', false);
      return;
    }
    var chatId = null, label = '';
    for (var i = updates.length - 1; i >= 0; i--) {
      var u = updates[i];
      var chat = (u.message && u.message.chat) || (u.edited_message && u.edited_message.chat) || (u.my_chat_member && u.my_chat_member.chat);
      if (chat && chat.id) {
        chatId = String(chat.id);
        label = [chat.first_name || '', chat.username || chat.title || ''].join(' ').trim();
        break;
      }
    }
    if (!chatId) {
      fbbfTgStatus('لم يُعثر على Chat ID. راسل البوت برسالة نصية ثم أعد المحاولة.', false);
      return;
    }
    if (chatInput) chatInput.value = chatId;
    fbbfTgStatus('تم الاكتشاف: ' + chatId + (label ? ' (' + label + ')' : '') + ' — جاري الحفظ...', true);
    document.getElementById('tgSaveToken').value = token;
    document.getElementById('tgSaveChat').value = chatId;
    document.getElementById('tgSaveForm').submit();
  } catch (e) {
    fbbfTgStatus('فشل من المتصفح: ' + (e && e.message ? e.message : e) + ' — تأكد من الإنترنت وأن تيليجرام غير محجوب.', false);
  }
}
async function fbbfTgTest() {
  var token = fbbfTgNormToken((document.getElementById('tgTokenInput') || {}).value);
  var chat = String((document.getElementById('tgChatInput') || {}).value || '').trim();
  if (!token || !chat) {
    fbbfTgStatus('أدخل التوكن واكتشف Chat ID أولاً.', false);
    return;
  }
  fbbfTgStatus('جاري إرسال رسالة تجريبية من المتصفح...', null);
  try {
    var text = encodeURIComponent('✅ fb Bablushr F\\nتم الربط بنجاح من المتصفح.\\n' + new Date().toLocaleString('ar-EG'));
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + encodeURIComponent(chat) + '&text=' + text;
    var resp = await fetch(url);
    var data = await resp.json();
    if (data && data.ok) {
      fbbfTgStatus('تم إرسال الرسالة التجريبية بنجاح ✓', true);
      document.getElementById('tgSaveToken').value = token;
      document.getElementById('tgSaveChat').value = chat;
      // لا نُرسل النموذج تلقائيًا هنا حتى لا يعيد تحميل الصفحة فجأة — المستخدم يضغط حفظ إن لزم
    } else {
      fbbfTgStatus((data && data.description) || 'فشل الإرسال', false);
    }
  } catch (e) {
    fbbfTgStatus('فشل الإرسال: ' + (e && e.message ? e.message : e), false);
  }
}
function fbbfTgSaveOnly() {
  var token = fbbfTgNormToken((document.getElementById('tgTokenInput') || {}).value);
  var chat = String((document.getElementById('tgChatInput') || {}).value || '').trim();
  if (!token || !chat) {
    fbbfTgStatus('التوكن وChat ID مطلوبان للحفظ.', false);
    return;
  }
  document.getElementById('tgSaveToken').value = token;
  document.getElementById('tgSaveChat').value = chat;
  document.getElementById('tgSaveForm').submit();
}
</script>


<script>
async function fbbfTgPollCommands() {
  var st = document.getElementById('tgPollStatus');
  function status(m, ok) {
    if (!st) return;
    st.style.color = ok === true ? '#4ade80' : (ok === false ? '#fb7185' : 'var(--t2)');
    st.textContent = m;
  }
  var tokenEl = document.querySelector('input[name="telegram_bot_token"]');
  var chatEl = document.querySelector('input[name="telegram_chat_id"]');
  var token = (tokenEl && tokenEl.value || '').replace(/\s+/g,'').trim();
  var chatId = (chatEl && chatEl.value || '').replace(/\s+/g,'').trim();
  var m = token.match(/^([A-Za-z0-9_-]{20,}):(\d{6,12})$/);
  if (m) token = m[2] + ':' + m[1];
  if (!token || !chatId) {
    status('احفظ التوكن وChat ID أولاً.', false);
    return;
  }
  status('جاري جلب الرسائل من تيليجرام...', null);
  try {
    var up = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?limit=30&timeout=0');
    var data = await up.json();
    if (!data.ok) {
      status('فشل getUpdates: ' + (data.description || 'خطأ') + ' — إن ظهر conflict مع webhook اضغط deleteWebhook أولاً', false);
      return;
    }
    var updates = data.result || [];
    var cmds = [];
    for (var i = 0; i < updates.length; i++) {
      var msg = updates[i].message || updates[i].edited_message;
      if (!msg || !msg.text) continue;
      if (String(msg.chat && msg.chat.id) !== String(chatId)) continue;
      if (String(msg.text).charAt(0) !== '/') continue;
      cmds.push({text: msg.text, update_id: updates[i].update_id});
    }
    if (!cmds.length) {
      status('لا أوامر جديدة. اكتب للبوت /help ثم اضغط الزر خلال دقيقة.', false);
      return;
    }
    var last = cmds[cmds.length - 1];
    status('تنفيذ: ' + last.text + ' ...', null);
    var fd = new FormData();
    fd.append('action', 'telegram_cmd');
    fd.append('text', last.text);
    var resp = await fetch(window.location.pathname, { method: 'POST', body: fd, credentials: 'same-origin' });
    var js = await resp.json();
    if (!js.ok) {
      status('فشل التنفيذ على الموقع: ' + (js.error || resp.status), false);
      return;
    }
    var reply = js.reply || 'تم';
    var sendUrl = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + encodeURIComponent(chatId)
      + '&text=' + encodeURIComponent(reply) + '&parse_mode=HTML';
    var sent = await fetch(sendUrl);
    var sentJs = await sent.json();
    if (last.update_id != null) {
      try { await fetch('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + (last.update_id + 1) + '&limit=1'); } catch (e2) {}
    }
    if (sentJs && sentJs.ok) {
      status('✅ تم تنفيذ الأمر وإرسال الرد على تيليجرام.', true);
    } else {
      status('نُفّذ الأمر لكن الرد لم يُرسل: ' + ((sentJs && sentJs.description) || ''), false);
    }
  } catch (e) {
    status('خطأ: ' + (e && e.message ? e.message : e), false);
  }
}
</script>

</body>
</html>
<?php exit; endif;

// ── Prepare data ────────────────────────────────────────────────────
$config   = fbbf_config();
$users    = array_reverse(fbbf_users());
$payments = array_reverse(fbbf_payments());

$stats = ['all'=>count($users),'active'=>0,'trial'=>0,'expired'=>0,'blocked'=>0,'pending'=>0,'pending_payments'=>0];
foreach ($users as $u) {
    $s = $u['status'] ?? 'pending';
    $stats[$s] = ($stats[$s] ?? 0) + 1;
}
foreach ($payments as $p) {
    if (($p['status'] ?? 'pending') === 'pending') $stats['pending_payments']++;
}

// Download stats
$statsFile = FBBF_ROOT . '/data/download-stats.json';
$dlStats = file_exists($statsFile)
    ? (json_decode(file_get_contents($statsFile) ?: '{}', true) ?: [])
    : [];
$dlTotal  = (int)($dlStats['total'] ?? 0);
$dlToday  = (int)($dlStats['by_day'][date('Y-m-d')] ?? 0);
$dlMonth  = (int)($dlStats['by_month'][date('Y-m')] ?? 0);

// Extension version
$extVersion  = $config['extension_version'] ?? '16.5.22';
$extFilename = $config['extension_filename'] ?? 'fb-bablushr-f-v16.5.22-extension.zip';
$releaseLog  = array_reverse(array_slice($config['release_log'] ?? [], -20));

// Theme
$theme       = $config['site_theme'] ?? 'gold';
$accentColor = $config['accent_color'] ?? '#2dd4bf';

// Notifications
$notifications     = fbbf_notifications();
$unreadCount        = count(array_filter($notifications, fn($n) => empty($n['read'])));
$recentNotifications = array_slice($notifications, 0, 20);

// Admin activity log — نفس تخزين الإشعارات، مفلترة لنوع admin_action بس
$adminActivityLog = array_slice(array_values(array_filter(
    $notifications,
    fn($n) => ($n['type'] ?? '') === 'admin_action'
)), 0, 30);

// Last 7 days chart data for JS
$last7 = [];
for ($i=6;$i>=0;$i--) {
    $d = date('Y-m-d', strtotime("-$i days"));
    $last7[] = ['date'=>$d,'count'=>(int)($dlStats['by_day'][$d] ?? 0)];
}
$last7Json = json_encode($last7);

// Active tab
$tab = $_GET['tab'] ?? 'dashboard';
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة إدارة fb Bablushr F</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
:root{
  --bg:#12100e;--s2:#1c1916;--s3:#262220;--s4:#33302c;
  --b1:rgba(45,167,159,0.10);--b2:rgba(45,167,159,0.22);--b3:rgba(94,214,201,0.40);
  --t1:#f9f9f9;--t2:#a1a1aa;--t3:#99f6e4;--t4:#5eead4;
  --p1:#2dd4bf;--p2:#5eead4;--p3:#99f6e4;
  --pg:linear-gradient(135deg,#115e59 0%,#0f766e 35%,#14b8a6 72%,#2dd4bf 100%);
  --pglow:rgba(45,212,191,0.36);
  --ok:#4ade80;--okbg:rgba(74,222,128,0.10);--okb:rgba(74,222,128,0.26);
  --err:#fb7185;--errbg:rgba(251,113,133,0.10);--errb:rgba(251,113,133,0.28);
  --warn:#5eead4;--warnbg:rgba(94,214,201,0.10);
  --sidebar:220px;
  --font:'Cairo',-apple-system,sans-serif;
}
<?php
// Dynamic theme — includes Obsidian Aurora
if ($theme === 'publisher' || $theme === 'gold') {
    echo ":root{--bg:#050810;--s1:#0c1222;--s2:#121a30;--p1:#3b82f6;--p2:#60a5fa;--p3:#a78bfa;--pg:linear-gradient(135deg,#1e3a8a 0%,#2563eb 40%,#7c3aed 75%,#22d3ee 100%);--pglow:rgba(59,130,246,0.40);--b1:rgba(59,130,246,0.12);--b2:rgba(59,130,246,0.28);--t1:#f0f4ff;--t2:#a5b4d4;--t3:#7dd3fc;--t4:#60a5fa;}";
} elseif ($theme === 'obsidian') {
    echo ":root{--bg:#0B0F14;--s1:#12181F;--s2:#1A222D;--p1:#00C9A7;--p2:#7C5CFC;--p3:#2EE59D;--pg:linear-gradient(135deg,#0B0F14 0%,#12181F 40%,#00C9A7 100%);--pglow:rgba(0,201,167,0.25);--b1:rgba(0,201,167,0.10);--b2:rgba(124,92,252,0.22);--t1:#E8F0F7;--t2:#8B9BB0;--t3:#2EE59D;--t4:#00C9A7;}";
} elseif ($theme === 'blue') {
    echo ":root{--p1:#3b82f6;--p2:#60a5fa;--p3:#bfdbfe;--pg:linear-gradient(135deg,#1e3a8a,#1d4ed8,#3b82f6);--pglow:rgba(59,130,246,0.36);--b1:rgba(59,130,246,0.10);--b2:rgba(59,130,246,0.22);--t3:#bfdbfe;--t4:#60a5fa;}";
} elseif ($theme === 'green') {
    echo ":root{--p1:#10b981;--p2:#34d399;--p3:#a7f3d0;--pg:linear-gradient(135deg,#064e3b,#065f46,#10b981);--pglow:rgba(16,185,129,0.36);--b1:rgba(16,185,129,0.10);--b2:rgba(16,185,129,0.22);--t3:#a7f3d0;--t4:#34d399;}";
} elseif ($theme === 'purple') {
    echo ":root{--p1:#8b5cf6;--p2:#a78bfa;--p3:#ddd6fe;--pg:linear-gradient(135deg,#4c1d95,#6d28d9,#8b5cf6);--pglow:rgba(139,92,246,0.36);--b1:rgba(139,92,246,0.10);--b2:rgba(139,92,246,0.22);--t3:#ddd6fe;--t4:#a78bfa;}";
} elseif ($theme === 'red') {
    echo ":root{--p1:#ef4444;--p2:#f87171;--p3:#fecaca;--pg:linear-gradient(135deg,#7f1d1d,#991b1b,#ef4444);--pglow:rgba(239,68,68,0.36);--b1:rgba(239,68,68,0.10);--b2:rgba(239,68,68,0.22);--t3:#fecaca;--t4:#f87171;}";
}
?>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--t1);min-height:100vh;display:flex;}

/* ── Sidebar ── */
.sidebar{width:var(--sidebar);min-height:100vh;background:var(--s2);border-left:1px solid var(--b1);
  display:flex;flex-direction:column;position:fixed;top:0;right:0;bottom:0;z-index:100;
  transition:transform .3s;}
.sidebar-logo{padding:20px 18px;border-bottom:1px solid var(--b1);}
.sidebar-logo .logo-icon{width:42px;height:42px;border-radius:12px;background:var(--pg);
  display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 14px var(--pglow);margin-bottom:8px;}
.sidebar-logo .logo-name{font-size:14px;font-weight:900;color:var(--t1);}
.sidebar-logo .logo-sub{font-size:10px;color:var(--t2);margin-top:2px;}
nav{flex:1;padding:12px 10px;overflow-y:auto;}
.nav-section{font-size:9px;font-weight:800;color:var(--t2);text-transform:uppercase;letter-spacing:1.5px;
  padding:10px 8px 6px;margin-top:6px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;
  text-decoration:none;color:var(--t2);font-size:13px;font-weight:700;cursor:pointer;
  border:1px solid transparent;transition:all .2s;margin-bottom:2px;position:relative;}
.nav-item:hover,.nav-item.active{background:var(--b1);border-color:var(--b2);color:var(--t1);}
.nav-item.active{color:var(--p2);}
.nav-item .icon{font-size:16px;width:20px;text-align:center;flex-shrink:0;}
.nav-badge{margin-right:auto;background:var(--err);color:#fff;font-size:9px;font-weight:900;
  padding:2px 6px;border-radius:99px;min-width:18px;text-align:center;}
.nav-badge.gold{background:var(--p1);}
.sidebar-footer{
  padding:12px 10px 16px;border-top:1px solid var(--b1);
  flex-shrink:0;margin-top:auto;background:var(--s2);
  position:sticky;bottom:0;z-index:5;
}
.logout-btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 14px;border-radius:12px;
  text-decoration:none;color:#fecdd3;font-size:13px;font-weight:800;
  background:rgba(251,113,133,0.14);border:1px solid rgba(251,113,133,0.35);
  transition:all .2s;min-height:46px;width:100%;box-sizing:border-box;}
.logout-btn:hover{background:rgba(251,113,133,0.25);color:#fff;}
@media(max-width:900px){
  .sidebar-footer{padding-bottom:max(16px, env(safe-area-inset-bottom));}
}

/* ── Main ── */
.main{flex:1;margin-right:var(--sidebar);min-height:100vh;display:flex;flex-direction:column;}
.topbar{padding:16px 24px;border-bottom:1px solid var(--b1);display:flex;align-items:center;gap:14px;
  background:var(--s2);position:sticky;top:0;z-index:50;}
.topbar-title{font-size:18px;font-weight:900;color:var(--t1);}
.topbar-sub{font-size:12px;color:var(--t2);margin-top:2px;}
.topbar-right{margin-right:auto;display:flex;align-items:center;gap:10px;}
.topbar-time{font-size:11px;color:var(--t3);background:var(--b1);border:1px solid var(--b2);
  padding:6px 12px;border-radius:9px;}

.content{padding:24px;flex:1;}

/* ── Cards ── */
.card{background:var(--s2);border:1px solid var(--b1);border-radius:18px;padding:22px;margin-bottom:16px;}
.card-sm{padding:16px;}
.card-title{font-size:14px;font-weight:800;color:var(--t1);margin-bottom:16px;
  display:flex;align-items:center;gap:8px;}
.card-title .badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;
  background:rgba(45,212,191,0.12);border:1px solid rgba(94,214,201,0.25);color:var(--p3);}
.badge-live{background:rgba(74,222,128,0.12)!important;border-color:rgba(74,222,128,0.30)!important;color:var(--ok)!important;}

/* ── Stat Grid ── */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.stat-card{background:var(--s2);border:1px solid var(--b1);border-radius:16px;padding:18px;
  display:flex;flex-direction:column;gap:6px;transition:border-color .2s;}
.stat-card:hover{border-color:var(--b2);}
.stat-icon{font-size:22px;margin-bottom:2px;}
.stat-val{font-size:26px;font-weight:900;color:var(--p2);}
.stat-val.green{color:var(--ok);}
.stat-val.red{color:var(--err);}
.stat-val.warn{color:var(--warn);}
.stat-lbl{font-size:11px;color:var(--t2);font-weight:600;}

/* ── Forms ── */
label.field-label{display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px;margin-top:14px;}
label.field-label:first-child{margin-top:0;}
input[type=text],input[type=email],input[type=password],input[type=url],input[type=number],select,textarea{
  width:100%;padding:12px 14px;background:var(--s3);
  border:1.5px solid var(--b2);border-radius:12px;color:var(--t1);font-size:13px;
  font-family:var(--font);outline:none;transition:border-color .2s,box-shadow .2s;}
input:focus,select:focus,textarea:focus{border-color:rgba(94,214,201,0.55);box-shadow:0 0 0 3px rgba(45,212,191,0.12);}
select option{background:var(--s3);}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}

/* ── Buttons ── */
.btn{padding:11px 18px;border:none;border-radius:12px;font-size:13px;font-weight:800;
  cursor:pointer;font-family:var(--font);transition:filter .2s,transform .15s;
  display:inline-flex;align-items:center;gap:7px;text-decoration:none;}
.btn:hover{filter:brightness(1.1);transform:translateY(-1px);}
.btn:active{transform:scale(0.97);}
.btn:disabled{opacity:0.5;cursor:not-allowed;filter:none;transform:none;}
.btn-primary{background:var(--pg);color:#fff;box-shadow:0 4px 14px var(--pglow);}
.btn-ghost{background:var(--b1);border:1px solid var(--b2);color:var(--p3);}
.btn-danger{background:rgba(251,113,133,0.12);border:1px solid rgba(251,113,133,0.25);color:var(--err);}
.btn-ok{background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);color:var(--ok);}
.btn-sm{padding:7px 11px;font-size:11px;border-radius:9px;}
.btn-full{width:100%;justify-content:center;}
.btn-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}

/* ── Alerts ── */
.alert{border-radius:12px;padding:13px 15px;font-size:13px;line-height:1.6;margin-bottom:12px;
  display:flex;align-items:flex-start;gap:10px;}
.alert-ok{background:var(--okbg);border:1px solid var(--okb);color:var(--ok);}
.alert-err{background:var(--errbg);border:1px solid var(--errb);color:var(--err);}
.alert-warn{background:var(--warnbg);border:1px solid rgba(94,214,201,0.28);color:var(--warn);}
.alert-info{background:rgba(45,212,191,0.07);border:1px solid var(--b2);color:var(--p3);}
.alert-body{flex:1;}

/* ── Table ── */
.table-wrap{overflow-x:auto;border-radius:14px;border:1px solid var(--b1);}
table{width:100%;border-collapse:collapse;min-width:700px;}
th,td{padding:12px 14px;border-bottom:1px solid var(--b1);text-align:right;vertical-align:middle;}
th{font-size:11px;font-weight:800;color:var(--t2);background:var(--s3);white-space:nowrap;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:rgba(255,255,255,0.015);}
td{font-size:13px;}
.mini{font-size:11px;color:var(--t2);margin-top:3px;}

/* ── Status badges ── */
.badge-status{display:inline-block;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:800;}
.status-active{background:rgba(74,222,128,0.12);color:var(--ok);}
.status-trial{background:rgba(94,214,201,0.12);color:var(--warn);}
.status-expired{background:rgba(251,113,133,0.12);color:var(--err);}
.status-blocked{background:rgba(148,163,184,0.12);color:#94a3b8;}
.status-pending{background:rgba(99,118,210,0.12);color:#a5b4fc;}
.status-approved{background:rgba(74,222,128,0.12);color:var(--ok);}

/* ── Upload area ── */
.upload-area{border:2px dashed var(--b2);border-radius:14px;padding:28px 20px;text-align:center;
  cursor:pointer;transition:all .25s;background:var(--s3);position:relative;margin-top:14px;}
.upload-area:hover,.upload-area.drag{border-color:var(--p2);background:rgba(45,212,191,0.06);}
.upload-area input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
.upload-icon{font-size:32px;margin-bottom:8px;}
.upload-text{font-size:13px;font-weight:700;color:var(--t2);}
.upload-sub{font-size:11px;color:var(--t3);margin-top:4px;}
.upload-chosen{font-size:12px;color:var(--ok);margin-top:8px;font-weight:700;display:none;}

/* ── Progress ── */
.progress-wrap{margin-top:14px;display:none;}
.progress-bar{height:8px;background:var(--s4);border-radius:99px;overflow:hidden;}
.progress-fill{height:100%;background:var(--pg);border-radius:99px;width:0%;transition:width .3s;}
.progress-label{font-size:11px;color:var(--t3);margin-top:6px;text-align:center;}

/* ── Chart ── */
.chart-bars{display:flex;align-items:flex-end;gap:4px;height:70px;padding-top:8px;}
.chart-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;}
.chart-bar{width:100%;border-radius:4px 4px 0 0;transition:height .4s;min-height:4px;}
.chart-label{font-size:8px;color:var(--t2);}
.chart-val{font-size:9px;color:var(--t3);}

/* ── Log entry ── */
.log-entry{display:flex;align-items:flex-start;gap:10px;background:var(--s3);
  border:1px solid var(--b1);border-radius:10px;padding:12px 14px;margin-bottom:8px;}
.log-ver{background:var(--pg);color:#fff;font-size:10px;font-weight:800;padding:3px 8px;
  border-radius:20px;white-space:nowrap;flex-shrink:0;box-shadow:0 2px 8px var(--pglow);}
.log-notes{font-size:12px;color:var(--t2);flex:1;}
.log-date{font-size:10px;color:var(--t3);white-space:nowrap;flex-shrink:0;}

/* ── Steps ── */
.step-item{display:flex;align-items:flex-start;gap:12px;background:var(--s3);
  border:1px solid var(--b1);border-radius:12px;padding:14px 16px;margin-bottom:8px;}
.step-num{width:26px;height:26px;border-radius:50%;flex-shrink:0;background:var(--pg);color:#fff;
  font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;
  box-shadow:0 3px 10px var(--pglow);margin-top:1px;}
.step-title{font-size:13px;font-weight:800;color:var(--t1);margin-bottom:3px;}
.step-desc{font-size:12px;color:var(--t2);line-height:1.55;}
.step-desc code{background:rgba(45,212,191,0.12);border:1px solid rgba(94,214,201,0.20);
  color:var(--p3);border-radius:5px;padding:1px 6px;font-size:11px;}

/* ── Theme swatches ── */
.theme-grid{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
.theme-swatch{width:44px;height:44px;border-radius:12px;cursor:pointer;border:2px solid transparent;
  transition:all .2s;display:flex;align-items:center;justify-content:center;font-size:12px;}
.theme-swatch:hover,.theme-swatch.active{border-color:#fff;transform:scale(1.08);}
.theme-swatch input{display:none;}

/* ── Toast ── */
#toast{position:fixed;bottom:24px;left:24px;background:var(--s2);border:1px solid var(--ok);
  color:var(--ok);font-size:13px;font-weight:700;padding:12px 18px;border-radius:12px;
  box-shadow:0 8px 28px rgba(0,0,0,0.5);transform:translateY(20px);opacity:0;
  transition:all .3s;pointer-events:none;font-family:var(--font);z-index:9999;max-width:300px;}
#toast.show{transform:translateY(0);opacity:1;}

/* ── Mobile ── */
.hamburger{display:none;background:var(--s3);border:1px solid var(--b2);border-radius:10px;color:var(--t1);
  font-size:22px;cursor:pointer;padding:8px 12px;min-width:44px;min-height:44px;line-height:1;}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:90;
  -webkit-tap-highlight-color:transparent;}
.sidebar-close-mobile{display:none;position:absolute;top:12px;left:12px;background:var(--s3);border:1px solid var(--b2);
  color:var(--t1);border-radius:10px;width:40px;height:40px;font-size:18px;cursor:pointer;z-index:2;}

/* ── Section tabs ── */
.page-section{display:none;}
.page-section.active{display:block;}

/* جداول قابلة للتمرير أفقياً على الموبايل */
.table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px;}
.table-wrap table{min-width:640px;}

@media(max-width:900px){
  /* إخفاء القائمة جانبياً (RTL: يمين) حتى فتحها */
  .sidebar{
    width:min(280px,86vw);
    transform:translateX(110%);
    box-shadow:none;
    visibility:hidden;
    pointer-events:none;
  }
  .sidebar.open{
    transform:translateX(0);
    visibility:visible;
    pointer-events:auto;
    box-shadow:-8px 0 32px rgba(0,0,0,.45);
  }
  .sidebar-close-mobile{display:flex;align-items:center;justify-content:center;}
  .main{margin-right:0;width:100%;max-width:100vw;}
  .hamburger{display:inline-flex;align-items:center;justify-content:center;}
  .sidebar-overlay.open{display:block;}
  body.sidebar-open{overflow:hidden;touch-action:none;}
  .stat-grid{grid-template-columns:1fr 1fr;gap:10px;}
  .grid2,.grid3{grid-template-columns:1fr;}
  .topbar{padding:12px 14px;gap:10px;flex-wrap:wrap;}
  .topbar-title{font-size:16px;}
  .content{padding:12px;width:100%;overflow-x:hidden;}
  .card{padding:14px;border-radius:14px;}
  .notif-dropdown{left:auto;right:0;width:min(340px,92vw);}
}
@media(max-width:600px){
  .stat-grid{grid-template-columns:1fr 1fr;gap:8px;}
  .stat-card{padding:12px;}
  .content{padding:10px;}
  .topbar-sub{display:none;}
  .nav-item{padding:12px 14px;font-size:14px;min-height:48px;}
}

hr{border:none;border-top:1px solid var(--b1);margin:16px 0;}

.filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.filter-bar input[type=text]{flex:2;min-width:180px;margin:0;}
.filter-bar select{flex:1;min-width:120px;margin:0;}
@media(max-width:600px){.filter-bar{flex-direction:column;}.filter-bar input,.filter-bar select{width:100%;}}

/* Accent color input */
.color-input-wrap{display:flex;align-items:center;gap:10px;}
.color-input-wrap input[type=color]{width:40px;height:40px;border-radius:10px;border:2px solid var(--b2);
  background:var(--s3);cursor:pointer;padding:2px;}

/* Notification bell */
.notif-bell-wrap{position:relative;}
.notif-bell-btn{position:relative;background:var(--s3);border:1px solid var(--b2);border-radius:12px;
  width:42px;height:42px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:.15s;color:var(--t1);}
.notif-bell-btn:hover{background:var(--s4);border-color:var(--b3);}
.notif-badge{position:absolute;top:-4px;left:-4px;background:var(--err);color:#2a0a0a;font-size:10px;
  font-weight:800;border-radius:99px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center;
  padding:0 4px;border:2px solid var(--bg);}
.notif-dropdown{position:absolute;top:52px;left:0;width:340px;max-width:88vw;max-height:420px;overflow:hidden;
  background:var(--s2);border:1px solid var(--b2);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.6);
  display:none;flex-direction:column;z-index:200;}
.notif-dropdown.open{display:flex;}
.notif-dropdown-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;
  border-bottom:1px solid var(--b1);font-weight:800;color:var(--t1);}
.notif-mark-read{background:none;border:none;color:var(--p2);font-size:12px;cursor:pointer;font-family:inherit;
  padding:4px 8px;border-radius:8px;}
.notif-mark-read:hover{background:var(--b1);}
.notif-dropdown-list{overflow-y:auto;max-height:360px;}
.notif-empty{padding:30px 16px;text-align:center;color:var(--t3);font-size:13px;}
.notif-item{padding:12px 16px;border-bottom:1px solid var(--b1);}
.notif-item.unread{background:var(--b1);}
.notif-item-title{font-weight:700;font-size:13px;color:var(--t1);margin-bottom:3px;}
.notif-item-body{font-size:12px;color:var(--t2);line-height:1.6;white-space:pre-line;}
.notif-item-time{font-size:11px;color:var(--t3);margin-top:5px;}
</style>
</head>
<body>

<!-- Sidebar Overlay -->
<div class="sidebar-overlay" id="overlay" onclick="closeSidebar()"></div>

<!-- ── Sidebar ───────────────────────────────────────────── -->
<aside class="sidebar" id="sidebar">
  <button type="button" class="sidebar-close-mobile" onclick="closeSidebar()" aria-label="إغلاق القائمة">✕</button>
  <div class="sidebar-logo">
    <div class="logo-icon">🛡️</div>
    <div class="logo-name">Bablushr F</div>
    <div class="logo-sub">لوحة الإدارة الاحترافية</div>
  </div>

  <nav>
    <div class="nav-section">الرئيسية</div>
    <a class="nav-item active" onclick="showTab('dashboard',this)" href="#">
      <span class="icon">📊</span> لوحة التحكم
    </a>

    <div class="nav-section">المحتوى</div>
    <a class="nav-item" onclick="showTab('users',this)" href="#">
      <span class="icon">👥</span> المستخدمون
    <?php if(($stats['pending']??0)>0): ?>
      <span class="nav-badge gold"><?= (int)$stats['pending'] ?></span>
      <?php endif; ?>
    </a>
    <a class="nav-item" onclick="showTab('payments',this)" href="#">
      <span class="icon">💳</span> طلبات الدفع
      <?php if($stats['pending_payments']>0): ?>
      <span class="nav-badge"><?= $stats['pending_payments'] ?></span>
      <?php endif; ?>
    </a>
    <a class="nav-item" onclick="showTab('updates',this)" href="#">
      <span class="icon">🚀</span> التحديثات
    </a>
    <a class="nav-item" onclick="showTab('announcements',this)" href="#">
      <span class="icon">📢</span> إشعارات المستخدمين
    </a>

    <div class="nav-section">الإعدادات</div>
    <a class="nav-item" onclick="showTab('settings',this)" href="#">
      <span class="icon">⚙️</span> الإعدادات العامة
    </a>
    <a class="nav-item" onclick="showTab('theme',this)" href="#">
      <span class="icon">🎨</span> الثيم والمظهر
    </a>
  </nav>

  <div class="sidebar-footer">
    <a href="?logout=1" class="logout-btn">
      <span>🚪</span> تسجيل الخروج
    </a>
  </div>
</aside>

<!-- ── Main ─────────────────────────────────────────────── -->
<div class="main">

  <!-- Topbar -->
  <div class="topbar">
    <button class="hamburger" onclick="toggleSidebar()">☰</button>
    <div>
      <div class="topbar-title" id="topbarTitle">لوحة التحكم</div>
      <div class="topbar-sub" id="topbarSub">مرحباً، تفضل بمتابعة كل شيء من هنا</div>
    </div>
    <div class="topbar-right">
        <a href="?logout=1" class="btn btn-ghost btn-sm topbar-logout" style="color:var(--err);border-color:rgba(251,113,133,.35);white-space:nowrap">🚪 خروج</a>

      <div class="notif-bell-wrap">
        <button type="button" class="notif-bell-btn" id="notifBellBtn" onclick="toggleNotifDropdown()" title="الإشعارات">
          🔔
          <?php if ($unreadCount > 0): ?>
            <span class="notif-badge"><?= $unreadCount > 99 ? '99+' : $unreadCount ?></span>
          <?php endif; ?>
        </button>
        <div class="notif-dropdown" id="notifDropdown">
          <div class="notif-dropdown-head">
            <span>الإشعارات</span>
            <?php if ($unreadCount > 0): ?>
            <form method="post" style="margin:0;">
              <input type="hidden" name="action" value="mark_notifications_read">
              <button type="submit" class="notif-mark-read">تعليم الكل كمقروء</button>
            </form>
            <?php endif; ?>
          </div>
          <div class="notif-dropdown-list">
            <?php if (!$recentNotifications): ?>
              <div class="notif-empty">لا توجد إشعارات بعد</div>
            <?php else: foreach ($recentNotifications as $n): ?>
              <div class="notif-item <?= empty($n['read']) ? 'unread' : '' ?>">
                <div class="notif-item-title"><?= fbbf_h($n['title'] ?? '') ?></div>
                <div class="notif-item-body"><?= nl2br(fbbf_h($n['body'] ?? '')) ?></div>
                <div class="notif-item-time"><?= date('Y-m-d H:i', (int)($n['created_at'] ?? 0)) ?></div>
              </div>
            <?php endforeach; endif; ?>
          </div>
        </div>
      </div>
      <div class="topbar-time" id="liveTime"></div>
    </div>
  </div>

  <script>
    function toggleNotifDropdown() {
      document.getElementById('notifDropdown').classList.toggle('open');
    }
    document.addEventListener('click', function(e) {
      var wrap = document.querySelector('.notif-bell-wrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('notifDropdown').classList.remove('open');
      }
    });
  </script>

  <div class="content">

    <?php if($flash): ?>
    <?php if ($flash['type'] === 'link'): ?>
    <div class="alert alert-ok" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div>✅ <span class="alert-body" style="display:inline;">رابط تحميل جاهز — انسخه وابعته للمستخدم (صالح 24 ساعة، استخدام واحد):</span></div>
      <input type="text" readonly value="<?= fbbf_h((string)$flash['message']) ?>" onclick="this.select()"
        style="width:100%;background:var(--s2);border:1px solid var(--okb);border-radius:8px;
        padding:8px 10px;color:var(--t1);font-size:12px;font-family:monospace;">
    </div>
    <?php else: ?>
    <div class="alert alert-<?= $flash['type']==='ok' ? 'ok' : ($flash['type']==='err' ? 'err' : 'warn') ?>">
      <?= $flash['type']==='ok' ? '✅' : ($flash['type']==='err' ? '❌' : '⚠️') ?>
      <div class="alert-body"><?= fbbf_h($flash['message']) ?></div>
    </div>
    <?php endif; ?>
    <?php endif; ?>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: DASHBOARD -->
    <!-- ══════════════════════════════════════════════════ -->
    <div class="page-section active" id="tab-dashboard">

      <!-- Stats Row -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-val"><?= number_format($stats['all']) ?></div>
          <div class="stat-lbl">إجمالي المستخدمين</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">✅</div>
          <div class="stat-val green"><?= number_format($stats['active']) ?></div>
          <div class="stat-lbl">مشتركون نشطون</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🕐</div>
          <div class="stat-val warn"><?= number_format($stats['trial']) ?></div>
          <div class="stat-lbl">في فترة التجربة</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💳</div>
          <div class="stat-val red"><?= number_format($stats['pending_payments']) ?></div>
          <div class="stat-lbl">طلبات دفع معلقة</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

        <!-- Download Counter Card -->
        <div class="card">
          <div class="card-title">📥 عداد التحميلات <span class="badge badge-live">مباشر</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">
            <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:22px;font-weight:900;color:var(--p2);"><?= number_format($dlTotal) ?></div>
              <div style="font-size:10px;color:var(--t3);margin-top:3px;">إجمالي</div>
            </div>
            <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:22px;font-weight:900;color:var(--ok);"><?= number_format($dlToday) ?></div>
              <div style="font-size:10px;color:var(--t3);margin-top:3px;">اليوم</div>
            </div>
            <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:12px;text-align:center;">
              <div style="font-size:22px;font-weight:900;color:var(--warn);"><?= number_format($dlMonth) ?></div>
              <div style="font-size:10px;color:var(--t3);margin-top:3px;">هذا الشهر</div>
            </div>
          </div>
          <!-- Mini chart -->
          <div class="chart-bars" id="dlChart"></div>
          <?php if(isset($dlStats['last_at'])): ?>
          <div style="font-size:11px;color:var(--t3);margin-top:10px;text-align:center;">
            آخر تحميل: <?= fbbf_h($dlStats['last_at']) ?>
          </div>
          <?php endif; ?>
        </div>

        <!-- Version Status Card -->
        <div class="card">
          <div class="card-title">🚀 حالة الإضافة</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:var(--t2);margin-bottom:4px;">الإصدار الحالي المنشور</div>
              <div style="font-size:24px;font-weight:900;color:var(--p2);">v<?= fbbf_h($extVersion) ?></div>
            </div>
            <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:14px;">
              <div style="font-size:11px;color:var(--t2);margin-bottom:4px;">ملف الإضافة</div>
              <div style="font-size:12px;color:var(--t3);word-break:break-all;"><?= fbbf_h($extFilename) ?></div>
            </div>
            <a href="/updates.xml" target="_blank" class="btn btn-ghost btn-sm">
              🔗 فتح updates.xml
            </a>
          </div>
        </div>

      </div>

      <!-- Users summary row -->
      <div class="card" style="margin-top:0;">
        <div class="card-title">📈 ملخص المستخدمين</div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
          <?php
          $statItems = [
            ['مفعّلون','active','var(--ok)',$stats['active']],
            ['تجربة','trial','var(--warn)',$stats['trial']],
            ['منتهية','expired','var(--err)',$stats['expired']],
            ['محظورون','blocked','#94a3b8',$stats['blocked']],
            ['معلّقون','pending','#a5b4fc',$stats['pending']],
          ];
          foreach($statItems as [$lbl,$key,$color,$val]): ?>
          <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:12px;text-align:center;">
            <div style="font-size:18px;font-weight:900;color:<?= $color ?>;"><?= $val ?></div>
            <div style="font-size:10px;color:var(--t2);margin-top:3px;"><?= $lbl ?></div>
          </div>
          <?php endforeach; ?>
        </div>
      </div>

      <!-- Admin Activity Log -->
      <div class="card">
        <div class="card-title">
          📋 سجل نشاط الأدمن
          <span class="badge"><?= count($adminActivityLog) ?></span>
        </div>
        <?php if (!$adminActivityLog): ?>
          <div class="mini" style="padding:16px;text-align:center;">لا يوجد نشاط مسجّل بعد.</div>
        <?php else: ?>
          <div class="table-wrap" style="max-height:340px;overflow-y:auto;">
            <table>
              <thead>
                <tr><th>الإجراء</th><th>المستهدف</th><th>الوقت</th></tr>
              </thead>
              <tbody>
                <?php foreach ($adminActivityLog as $log): ?>
                <tr>
                  <td><strong><?= fbbf_h((string)($log['title'] ?? '')) ?></strong></td>
                  <td><?= fbbf_h((string)($log['body'] ?? '')) ?></td>
                  <td class="mini"><?= fbbf_h(fbbf_iso((int)($log['created_at'] ?? 0))) ?></td>
                </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        <?php endif; ?>
      </div>

    </div>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: USERS -->
    <!-- ══════════════════════════════════════════════════ -->
    <div class="page-section" id="tab-users">

      <!-- Add User -->
      <div class="card">
        <div class="card-title">➕ إضافة مستخدم يدوياً</div>
        <form method="post">
          <input type="hidden" name="action" value="add_user">
          <div class="grid3">
            <div>
              <label class="field-label">البريد الإلكتروني</label>
              <input type="email" name="email" required placeholder="user@example.com">
            </div>
            <div>
              <label class="field-label">كلمة المرور</label>
              <input type="text" name="password" required placeholder="4 أحرف على الأقل">
            </div>
            <div style="display:flex;align-items:flex-end;">
              <button type="submit" class="btn btn-primary btn-full">➕ إضافة</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Users Table -->
      <div class="card">
        <div class="card-title">
          👥 كل المستخدمين
          <span class="badge"><?= count($users) ?></span>
        </div>

        <!-- Search & Filters -->
        <div class="filter-bar">
          <input type="text" id="userSearch" placeholder="🔍 بحث بالإيميل..."
            oninput="filterUsers()">
          <select id="statusFilter" onchange="filterUsers()">
            <option value="">كل الحالات</option>
            <option value="active">مفعّل</option>
            <option value="trial">تجربة</option>
            <option value="expired">منتهي</option>
            <option value="blocked">محظور</option>
            <option value="pending">معلّق</option>
          </select>
          <select id="planFilter" onchange="filterUsers()">
            <option value="">كل الخطط</option>
            <option value="none">بدون خطة</option>
            <?php foreach ($plans as $pKey => $pInfo): ?>
            <option value="<?= fbbf_h($pKey) ?>"><?= fbbf_h((string)$pInfo['label']) ?></option>
            <?php endforeach; ?>
          </select>
          <select id="sortOrder" onchange="filterUsers()">
            <option value="newest">الأحدث أولاً</option>
            <option value="oldest">الأقدم أولاً</option>
          </select>
          <button type="button" class="btn btn-ghost btn-sm" onclick="resetUserFilters()">↺ إعادة ضبط</button>
        </div>
        <div id="userFilterCount" class="mini" style="margin-bottom:10px;"></div>

        <div class="table-wrap">
          <table id="usersTable">
            <thead>
              <tr>
                <th>الإيميل</th>
                <th>الحالة</th>
                <th>الخطة</th>
                <th>انتهاء التجربة/الاشتراك</th>
                <th>آخر دخول</th>
                <th>الجهاز / النشاط</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              <?php if(!$users): ?>
              <tr><td colspan="7" style="text-align:center;color:var(--t2);padding:32px;">لا يوجد مستخدمون بعد.</td></tr>
              <?php endif; ?>
              <?php foreach($users as $u): ?>
              <tr class="user-row" data-email="<?= fbbf_h(strtolower((string)$u['email'])) ?>"
                data-status="<?= fbbf_h((string)$u['status']) ?>"
                data-plan="<?= fbbf_h((string)($u['plan_key']?:'none')) ?>"
                data-created="<?= (int)($u['created_at']??0) ?>">
                <td>
                  <strong style="word-break:break-all"><?= fbbf_h((string)$u['email']) ?></strong>
                  <?php
                    $via = (string)($u['registered_via'] ?? $u['auth_provider'] ?? '');
                    if ($via === '') {
                      $via = !empty($u['password_hash']) ? 'email' : 'unknown';
                    }
                    $viaLabel = [
                      'google' => '🔵 Google',
                      'email' => '📧 إيميل/كلمة سر',
                      'password' => '📧 إيميل/كلمة سر',
                      'admin' => '🛡️ من الأدمن',
                      'unknown' => '—',
                    ][$via] ?? ('مصدر: ' . $via);
                    $gname = trim((string)($u['google_name'] ?? $u['name'] ?? ''));
                  ?>
                  <div class="mini" style="margin-top:3px"><?= fbbf_h($viaLabel) ?><?= $gname !== '' ? ' · ' . fbbf_h($gname) : '' ?></div>
                  <div class="mini">إنشاء: <?= fbbf_h(fbbf_iso((int)($u['created_at']??0))) ?></div>
                  <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
                    <a class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:11px" href="mailto:<?= fbbf_h((string)$u['email']) ?>">✉️ راسل</a>
                    <?php
                      $wa = preg_replace('/\D+/', '', (string)($config['support_whatsapp'] ?? ''));
                      if ($wa !== ''):
                        $waMsg = rawurlencode('مرحباً، بخصوص حسابك على fb Bablushr F: ' . (string)$u['email']);
                    ?>
                    <a class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:11px" target="_blank" rel="noopener"
                      href="https://wa.me/<?= fbbf_h($wa) ?>?text=<?= $waMsg ?>">💬 واتساب دعم</a>
                    <?php endif; ?>
                  </div>
                </td>
                <td>
                  <span class="badge-status status-<?= fbbf_h((string)$u['status']) ?>">
                    <?= fbbf_h((string)$u['status_label']) ?>
                  </span>
                </td>
                <td><?= fbbf_h((string)($u['plan_label']?:'—')) ?></td>
                <td>
                  <?php
                    $trialEndsAt = (int)($u['trial_ends_at'] ?? 0);
                    $subEndsAt = (int)($u['subscription_expires_at'] ?? 0);
                    // نعرض تاريخ التجربة لو الحساب في حالة تجربة فعليًا أو
                    // منتهي وملوش اشتراك مدفوع خالص. لو عنده اشتراك مدفوع
                    // (حالي أو منتهي)، نعرض تاريخ الاشتراك. قبل كده كان
                    // العمود بيعرض subscription_expires_at بس، فأي مستخدم
                    // في تجربة (مش مشترك) كان بيظهر "—" بدل تاريخ انتهاء
                    // تجربته الفعلي.
                    if ($u['status'] === 'trial' || ($subEndsAt === 0 && $trialEndsAt > 0)) {
                        echo fbbf_h(fbbf_iso($trialEndsAt));
                        echo '<div class="mini">تجربة مجانية</div>';
                    } else {
                        echo fbbf_h(fbbf_iso($subEndsAt));
                        if ($subEndsAt > 0) echo '<div class="mini">اشتراك مدفوع</div>';
                    }
                  ?>
                </td>
                <td><?= fbbf_h(fbbf_iso((int)($u['last_login_at']??0))) ?></td>
                <td>
                  <?php
                    $devs = function_exists('fbbf_user_devices') ? fbbf_user_devices($u) : (is_array($u['devices']??null)?$u['devices']:[]);
                    $nowTs = time();
                    if (!$devs) {
                      echo '<span class="mini" style="color:var(--t2)">لا يوجد جهاز مسجّل — لم يفتح الإضافة بعد</span>';
                    } else {
                      foreach (array_slice($devs, 0, 4) as $d) {
                        $ua = (string)($d['user_agent'] ?? '');
                        $meta = function_exists('fbbf_parse_user_agent') ? fbbf_parse_user_agent($ua) : [];
                        $label = (string)($d['label'] ?? '');
                        if ($label === '' || strcasecmp($label, 'Kiwi Android') === 0) {
                          $label = (string)($meta['label'] ?? 'جهاز');
                        }
                        $form = (string)($d['form_factor'] ?? $meta['form_factor'] ?? '');
                        $browser = (string)($d['browser'] ?? $meta['browser'] ?? '');
                        $os = (string)($d['os'] ?? $meta['os'] ?? '');
                        $last = (int)($d['last_seen_at'] ?? 0);
                        $ver = (string)($d['last_version'] ?? $d['version'] ?? '');
                        $ip = (string)($d['last_ip'] ?? '');
                        $age = $last > 0 ? ($nowTs - $last) : PHP_INT_MAX;
                        if ($age < 3600) { $actTxt = 'متصل الآن'; $dot = '#22d3ee'; }
                        elseif ($age < 3*86400) { $actTxt = 'نشط'; $dot = '#4ade80'; }
                        else { $actTxt = 'غير نشط'; $dot = '#fb7185'; }
                        echo '<div style="margin-bottom:6px;padding:8px 10px;border-radius:10px;background:var(--s3);border:1px solid var(--b1);">';
                        echo '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;">';
                        echo '<span style="width:8px;height:8px;border-radius:50%;background:'.$dot.';display:inline-block;flex-shrink:0"></span>';
                        echo fbbf_h($label);
                        echo ' <span style="color:var(--t2);font-weight:600;font-size:11px">(' . $actTxt . ')</span>';
                        echo '</div>';
                        $bits = array_filter([$form, $browser, $os]);
                        if ($bits) {
                          echo '<div class="mini" style="margin-top:3px">' . fbbf_h(implode(' · ', $bits)) . '</div>';
                        }
                        echo '<div class="mini">آخر ظهور: ' . fbbf_h(fbbf_iso($last));
                        if ($ver !== '') echo ' · إضافة v' . fbbf_h($ver);
                        if ($ip !== '') echo ' · IP ' . fbbf_h($ip);
                        echo '</div>';
                        echo '</div>';
                      }
                      if (count($devs) > 4) echo '<div class="mini">+' . (count($devs)-4) . ' جهاز آخر</div>';
                    }
                    $checkAt = (int)($u['last_check_at'] ?? 0);
                    if ($checkAt > 0) {
                      $using = ($nowTs - $checkAt) < 86400;
                      echo '<div class="mini" style="margin-top:4px;color:'.($using?'#4ade80':'var(--t2)').'">';
                      echo $using ? '✓ يستخدم الإضافة فعلاً — آخر تحقق ' . fbbf_h(fbbf_iso($checkAt)) : 'آخر تحقق من الإضافة: ' . fbbf_h(fbbf_iso($checkAt));
                      echo '</div>';
                    } else {
                      echo '<div class="mini" style="margin-top:4px;color:var(--t2)">لم يُرصد استخدام للإضافة بعد</div>';
                    }
                  ?>
                </td>
                <td>
                  <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
                    <!-- Activate dropdown -->
                    <div style="position:relative;display:inline-block;">
                      <button class="btn btn-ok btn-sm" onclick="togglePlanMenu(this)">⚡ تفعيل ▾</button>
                      <div class="plan-menu" style="display:none;position:absolute;top:100%;right:0;
                        background:var(--s2);border:1px solid var(--b2);border-radius:12px;
                        padding:6px;z-index:100;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,0.4);margin-top:4px;">
                        <?php foreach($plans as $key=>$plan): ?>
                        <form method="post" style="margin:2px 0;">
                          <input type="hidden" name="action" value="activate_user">
                          <input type="hidden" name="email" value="<?= fbbf_h((string)$u['email']) ?>">
                          <input type="hidden" name="plan_key" value="<?= fbbf_h((string)$key) ?>">
                          <button class="btn btn-ghost btn-sm btn-full" type="submit" style="text-align:right;justify-content:flex-start;">
                            <?= fbbf_h((string)$plan['label']) ?>
                            <span style="margin-right:auto;font-size:10px;color:var(--t2);"><?= (int)$plan['days'] ?>يوم</span>
                          </button>
                        </form>
                        <?php endforeach; ?>
                      </div>
                    </div>

                    <!-- Block/Unblock -->
                    <form method="post" style="display:inline;">
                      <input type="hidden" name="action" value="toggle_block">
                      <input type="hidden" name="email" value="<?= fbbf_h((string)$u['email']) ?>">
                      <button type="submit" class="btn btn-ghost btn-sm">
                        <?= !empty($u['blocked']) ? '🔓 فك' : '🔒 حظر' ?>
                      </button>
                    </form>

                    <!-- Renew Trial -->
                    <form method="post" style="display:inline;" onsubmit="return confirm('تفعيل تجربة مجانية جديدة (3 أيام) لهذا المستخدم؟')">
                      <input type="hidden" name="action" value="renew_trial">
                      <input type="hidden" name="email" value="<?= fbbf_h((string)$u['email']) ?>">
                      <button type="submit" class="btn btn-ghost btn-sm" title="تفعيل تجربة مجانية جديدة 3 أيام">🔄 تجربة جديدة</button>
                    </form>

                    <!-- Generate Download Link -->
                    <form method="post" style="display:inline;">
                      <input type="hidden" name="action" value="generate_download_link">
                      <input type="hidden" name="email" value="<?= fbbf_h((string)$u['email']) ?>">
                      <button type="submit" class="btn btn-ghost btn-sm" title="توليد رابط تحميل مباشر (24 ساعة) للمستخدم">🔗 رابط تحميل</button>
                    </form>

                    <!-- Delete -->
                    <form method="post" style="display:inline;" onsubmit="return confirm('حذف المستخدم نهائياً؟')">
                      <input type="hidden" name="action" value="delete_user">
                      <input type="hidden" name="email" value="<?= fbbf_h((string)$u['email']) ?>">
                      <button type="submit" class="btn btn-danger btn-sm">🗑️</button>
                    </form>
                  </div>
                </td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: PAYMENTS -->
    <!-- ══════════════════════════════════════════════════ -->
    <div class="page-section" id="tab-payments">

      <?php if($stats['pending_payments']>0): ?>
      <div class="alert alert-warn">
        ⚠️ <div class="alert-body">يوجد <strong><?= $stats['pending_payments'] ?></strong> طلب دفع معلّق بانتظار المراجعة والتفعيل.</div>
      </div>
      <?php endif; ?>

      <div class="card">
        <div class="card-title">
          💳 طلبات الدفع من الإضافة
          <?php if($stats['pending_payments']>0): ?>
          <span class="badge" style="background:rgba(251,113,133,0.12);border-color:rgba(251,113,133,0.3);color:var(--err);">
            <?= $stats['pending_payments'] ?> معلّق
          </span>
          <?php endif; ?>
        </div>

        <?php if(!$payments): ?>
        <div style="text-align:center;padding:40px;color:var(--t2);">
          لا توجد طلبات دفع بعد.
        </div>
        <?php else: ?>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الإيميل</th>
                <th>الخطة</th>
                <th>المبلغ</th>
                <th>رقم المحوّل</th>
                <th>وقت الطلب</th>
                <th>الحالة</th>
                <th>تفعيل</th>
              </tr>
            </thead>
            <tbody>
              <?php foreach($payments as $p):
                $pStatus = ($p['status'] ?? 'pending');
                $planKey = (string)($p['plan_key'] ?? 'monthly');
              ?>
              <tr>
                <td><?= fbbf_h((string)($p['email']??'')) ?></td>
                <td><?= fbbf_h((string)($p['plan_label']??'')) ?></td>
                <td style="font-weight:800;color:var(--p2);"><?= fbbf_h((string)($p['amount']??'')) ?> جنيه</td>
                <td><code style="background:var(--s3);padding:2px 8px;border-radius:6px;font-size:12px;">
                  <?= fbbf_h((string)($p['sender_number']??'—')) ?>
                </code></td>
                <td><?= fbbf_h(fbbf_iso((int)($p['created_at']??0))) ?></td>
                <td>
                  <span class="badge-status status-<?= $pStatus==='approved'?'approved':'pending' ?>">
                    <?= $pStatus==='approved'?'تم الاعتماد':'معلّق' ?>
                  </span>
                </td>
                <td>
                  <?php if($pStatus !== 'approved'): ?>
                  <form method="post">
                    <input type="hidden" name="action" value="activate_payment">
                    <input type="hidden" name="payment_id" value="<?= fbbf_h((string)($p['id']??'')) ?>">
                    <input type="hidden" name="email" value="<?= fbbf_h((string)($p['email']??'')) ?>">
                    <input type="hidden" name="plan_key" value="<?= fbbf_h($planKey) ?>">
                    <button class="btn btn-ok btn-sm" type="submit">✅ فعّل</button>
                  </form>
                  <?php else: ?>
                  <span style="font-size:11px;color:var(--t2);">تم <?= fbbf_h(fbbf_iso((int)($p['approved_at']??0))) ?></span>
                  <?php endif; ?>
                </td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
        <?php endif; ?>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: UPDATES -->
    <!-- ══════════════════════════════════════════════════ -->
    <div class="page-section" id="tab-updates">

      <!-- Current Status -->
      <div class="card">
        <div class="card-title">📊 الحالة الحالية <span class="badge badge-live">مباشر</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:22px;font-weight:900;color:var(--p2);">v<?= fbbf_h($extVersion) ?></div>
            <div style="font-size:10px;color:var(--t3);margin-top:4px;">الإصدار المنشور</div>
          </div>
          <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:14px;text-align:center;">
            <div style="font-size:18px;font-weight:900;color:var(--ok);" id="updateStatusEl">نشط ✓</div>
            <div style="font-size:10px;color:var(--t3);margin-top:4px;">حالة التحديث</div>
          </div>
          <div style="background:var(--s3);border:1px solid var(--b1);border-radius:12px;padding:14px;text-align:center;">
            <?php
            $lastRelease = !empty($releaseLog) ? $releaseLog[0] : null;
            $lastDate = $lastRelease ? ($lastRelease['uploaded_at'] ?? '—') : '—';
            ?>
            <div style="font-size:14px;font-weight:900;color:var(--warn);"><?= fbbf_h(substr($lastDate,0,10)) ?></div>
            <div style="font-size:10px;color:var(--t3);margin-top:4px;">آخر تحديث</div>
          </div>
        </div>
        <div class="alert alert-ok">
          ✅ كروم وكيوي يفحصون <strong>updates.xml</strong> كل 5 ساعات — المستخدمون يتحدّثون تلقائياً بدون أي تدخّل
        </div>
        <div class="btn-row">
          <a href="/updates.xml" target="_blank" class="btn btn-ghost btn-sm">🔗 فتح /updates.xml</a>
          <a href="/download.php" class="btn btn-ghost btn-sm">📥 تحميل الإضافة الحالية</a>
        </div>
      </div>

      <!-- Publish New Version -->
      <div class="card">
        <div class="card-title">⚡ نشر تحديث جديد</div>

        <div class="alert alert-info">
          📌 ارفع ملف ZIP الجديد وعيّن رقم الإصدار — سيتم تحديث <code style="color:var(--p3)">updates.xml</code> تلقائياً وسيتحدّث كل المستخدمين خلال 5 ساعات
        </div>

        <div class="grid2" style="margin-top:14px;">
          <div>
            <label class="field-label">رقم الإصدار الجديد</label>
            <input type="text" id="pubVersion" placeholder="مثال: 16.3.0" value="">
          </div>
          <div>
            <label class="field-label">اسم ملف ZIP</label>
            <input type="text" id="pubFilename" placeholder="fb-bablushr-f-v16.3.0-extension.zip">
          </div>
        </div>

        <div>
          <label class="field-label">ملاحظات الإصدار</label>
          <input type="text" id="pubNotes" placeholder="مثال: إصلاح أخطاء + تحسينات الأداء">
        </div>

        <div class="upload-area" id="uploadArea">
          <input type="file" accept=".zip" id="zipFile" onchange="onFileChosen(this)">
          <div class="upload-icon">📦</div>
          <div class="upload-text">اسحب ملف ZIP هنا أو اضغط للاختيار</div>
          <div class="upload-sub">اختياري — إذا كنت تريد رفع الملف مباشرة</div>
          <div class="upload-chosen" id="chosenName"></div>
        </div>

        <div class="progress-wrap" id="progressWrap">
          <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
          <div class="progress-label" id="progressLabel">جاري الرفع…</div>
        </div>

        <div id="publishResult" style="margin-top:14px;display:none;"></div>

        <div class="btn-row">
          <button class="btn btn-primary" id="publishBtn" onclick="publishUpdate()">
            ⚡ نشر التحديث الآن — تحديث فوري لكل المستخدمين
          </button>
        </div>
      </div>

      <!-- Steps Guide -->
      <div class="card">
        <div class="card-title">📋 خطوات النشر</div>
        <div class="step-item">
          <div class="step-num">1</div>
          <div>
            <div class="step-title">جهّز ملف ZIP الجديد</div>
            <div class="step-desc">سمّه <code>fb-bablushr-f-v16.X-extension.zip</code> حيث X هو رقم الإصدار</div>
          </div>
        </div>
        <div class="step-item">
          <div class="step-num">2</div>
          <div>
            <div class="step-title">أدخل رقم الإصدار واسم الملف</div>
            <div class="step-desc">رقم الإصدار يجب أن يكون بصيغة <code>X.Y.Z</code> — مثال: <code>16.2.0</code></div>
          </div>
        </div>
        <div class="step-item">
          <div class="step-num">3</div>
          <div>
            <div class="step-title">ارفع الملف واضغط "نشر"</div>
            <div class="step-desc">سيتم تحديث <code>/updates.xml</code> تلقائياً ورفع الملف على الموقع</div>
          </div>
        </div>
        <div class="step-item">
          <div class="step-num">4</div>
          <div>
            <div class="step-title">المستخدمون يتحدّثون تلقائياً</div>
            <div class="step-desc">كروم وكيوي يفحصون كل 5 ساعات — بدون أي تدخّل منك</div>
          </div>
        </div>
      </div>

      <!-- Release Log -->
      <div class="card">
        <div class="card-title">📜 سجل الإصدارات</div>
        <?php if(!$releaseLog): ?>
        <div style="text-align:center;padding:24px;color:var(--t2);">لا توجد إصدارات منشورة بعد.</div>
        <?php else: ?>
        <?php foreach($releaseLog as $log): ?>
        <div class="log-entry">
          <span class="log-ver">v<?= fbbf_h((string)($log['version']??'')) ?></span>
          <span class="log-notes"><?= fbbf_h((string)($log['notes']?:'تحديث جديد')) ?></span>
          <span class="log-date"><?= fbbf_h(substr((string)($log['uploaded_at']??''),0,10)) ?></span>
        </div>
        <?php endforeach; ?>
        <?php endif; ?>
      </div>

    </div>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: SETTINGS -->
    <!-- ══════════════════════════════════════════════════ -->

    <!-- TAB: ANNOUNCEMENTS -->
    <div class="page-section" id="tab-announcements">
      <div class="card">
        <div class="card-title">📢 إشعار جديد للمستخدمين</div>
        <p style="font-size:12px;color:var(--t2);margin:0 0 14px;line-height:1.6">
          يظهر داخل الإضافة تلقائيًا (وموقعك عبر الـ API). يمكنك إرسال نسخة إيميل لكل المستخدمين المسجّلين.
          على InfinityFree قد يفشل بعض الإيميلات — الإشعار داخل الإضافة يعمل دائمًا.
        </p>
        <form method="post">
          <input type="hidden" name="action" value="create_announcement">
          <label class="field-label">العنوان</label>
          <input type="text" name="ann_title" required placeholder="مثال: تحديث مهم 16.5.22 — أصلح مسح الجروبات">
          <label class="field-label">نص الإشعار</label>
          <textarea name="ann_body" required rows="5" placeholder="اكتب التفاصيل وخطوات التحديث للمستخدم..." style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--b1);background:var(--s3);color:var(--t1);font:inherit;min-height:120px"></textarea>
          <div class="grid2" style="margin-top:10px">
            <div>
              <label class="field-label">النوع</label>
              <select name="ann_type">
                <option value="update">تحديث إضافة</option>
                <option value="info">معلومة عامة</option>
                <option value="urgent">عاجل</option>
              </select>
            </div>
            <div>
              <label class="field-label">مدة الظهور (أيام) — 0 = بلا انتهاء</label>
              <input type="number" name="ann_days" value="14" min="0" max="365">
            </div>
            <div>
              <label class="field-label">نص الزر (اختياري)</label>
              <input type="text" name="ann_cta_label" placeholder="تحميل التحديث">
            </div>
            <div>
              <label class="field-label">رابط الزر</label>
              <input type="url" name="ann_cta_url" value="https://faset.xo.je" placeholder="https://faset.xo.je">
            </div>
          </div>
          <label class="checkbox-line" style="display:flex;gap:8px;align-items:center;margin:14px 0;font-size:13px;color:var(--t1)">
            <input type="checkbox" name="ann_send_email" value="1">
            <span>إرسال نسخة إيميل لكل المستخدمين المسجّلين (قد يتأخر أو يُرفض على الاستضافة المجانية)</span>
          </label>
          <button type="submit" class="btn" style="margin-top:8px">نشر الإشعار الآن</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">الإشعارات المنشورة</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>العنوان</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>مشاهدات</th>
                <th>إيميل</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
            <?php
            $anns = function_exists('fbbf_announcements') ? fbbf_announcements() : [];
            if (!$anns): ?>
              <tr><td colspan="6" style="text-align:center;color:var(--t2)">لا توجد إشعارات بعد</td></tr>
            <?php else:
              foreach ($anns as $a):
                $seenN = is_array($a['seen_by'] ?? null) ? count($a['seen_by']) : 0;
                $active = !empty($a['active']);
            ?>
              <tr>
                <td>
                  <div style="font-weight:800"><?= fbbf_h((string)($a['title'] ?? '')) ?></div>
                  <div style="font-size:11px;color:var(--t2);max-width:280px;white-space:pre-wrap"><?= fbbf_h(mb_substr((string)($a['body'] ?? ''), 0, 120)) ?></div>
                </td>
                <td><?= fbbf_h((string)($a['type'] ?? 'info')) ?></td>
                <td><?= $active ? '<span style="color:var(--ok)">نشط</span>' : '<span style="color:var(--t2)">متوقف</span>' ?></td>
                <td><?= (int)$seenN ?></td>
                <td><?= (int)($a['email_sent'] ?? 0) ?> / <?= (int)($a['email_failed'] ?? 0) ?></td>
                <td>
                  <form method="post" style="display:inline">
                    <input type="hidden" name="action" value="toggle_announcement">
                    <input type="hidden" name="ann_id" value="<?= fbbf_h((string)($a['id'] ?? '')) ?>">
                    <button type="submit" class="btn btn-ghost btn-sm"><?= $active ? 'إيقاف' : 'تفعيل' ?></button>
                  </form>
                  <form method="post" style="display:inline" onsubmit="return confirm('حذف الإشعار؟')">
                    <input type="hidden" name="action" value="delete_announcement">
                    <input type="hidden" name="ann_id" value="<?= fbbf_h((string)($a['id'] ?? '')) ?>">
                    <button type="submit" class="btn btn-ghost btn-sm" style="color:var(--err)">حذف</button>
                  </form>
                </td>
              </tr>
            <?php endforeach; endif; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="page-section" id="tab-settings">

      <div class="card">
        <div class="card-title">⚙️ إعدادات الدفع والتجربة</div>
        <form method="post">
          <input type="hidden" name="action" value="save_settings">
          <div class="grid2">
            <div>
              <label class="field-label">📱 رقم واتساب للدعم</label>
              <input type="text" name="support_whatsapp"
                value="<?= fbbf_h((string)($config['support_whatsapp']??'')) ?>"
                placeholder="201234567890">
            </div>
            <div>
              <label class="field-label">💳 رقم فودافون كاش</label>
              <input type="text" name="vodafone_cash_number"
                value="<?= fbbf_h((string)($config['vodafone_cash_number']??'')) ?>"
                placeholder="01234567890">
            </div>
          </div>

          <div class="grid2" style="margin-top:2px;">
            <div>
              <label class="field-label">⏳ أيام الفترة التجريبية</label>
              <input type="number" name="trial_days" min="1" max="365"
                value="<?= (int)($config['trial_days']??3) ?>"
                placeholder="3">
            </div>
            <div>
              <label class="field-label">🔑 كلمة مرور أدمن جديدة (اختياري)</label>
              <input type="password" name="new_admin_password" placeholder="اتركه فارغاً للإبقاء على الحالية">
            </div>
          </div>

          <div class="btn-row">
            <button type="submit" class="btn btn-primary">💾 حفظ الإعدادات</button>
          </div>
        </form>
      </div>

      <!-- Protection & Notifications — بطاقات منفصلة بصريًا، فورم واحد
           موحّد (save_settings بيعتمد على isset() لبعض الحقول زي قفل
           التجربة، فتقسيمها لفورمات منفصلة فعليًا كان هيمسح القيم دي
           بالغلط لما تحفظ بطاقة من غيرها) -->
      <form method="post" id="testWhatsappForm" style="display:none;">
        <input type="hidden" name="action" value="test_whatsapp">
      </form>
      <form method="post" id="protectionSettingsForm">
        <input type="hidden" name="action" value="save_settings">
        <input type="hidden" name="settings_form" value="protection">
        <input type="hidden" name="support_whatsapp" value="<?= fbbf_h((string)($config['support_whatsapp']??'')) ?>">
        <input type="hidden" name="vodafone_cash_number" value="<?= fbbf_h((string)($config['vodafone_cash_number']??'')) ?>">
        <input type="hidden" name="trial_days" value="<?= (int)($config['trial_days']??3) ?>">

        <!-- Card 1: Device Lock -->
        <div class="card">
          <div class="card-title">🔒 قفل الأجهزة ومنع تكرار التجربة</div>
          <label class="field-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" name="device_trial_lock_enabled" <?= empty($config['device_trial_lock_enabled']) && isset($config['device_trial_lock_enabled']) ? '' : 'checked' ?> style="width:auto;">
            منع نفس الجهاز من فتح تجربة مجانية جديدة بإيميل آخر بعد انتهاء تجربته
          </label>
          <div class="alert alert-info" style="margin-top:8px;">
            لما يتفعّل ده، أي جهاز استخدم تجربته المجانية مرة (بأي إيميل) مش هيقدر يسجّل حساب جديد
            بإيميل مختلف على نفس الجهاز. الحساب الأصلي نفسه يقدر يدخل عادي في أي وقت. الحماية بتشتغل
            على 3 مستويات مع بعض: معرّف الجهاز، بصمة المتصفح (fingerprint)، وكشف تكرار عبر الـ IP.
          </div>
        </div>

        <!-- Card 2: Notification Channels -->
        <div class="card">
          <div class="card-title">🔔 قنوات الإشعارات</div>
          <div class="grid2">
            <label class="field-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" name="notify_on_register" <?= empty($config['notify_on_register']) && isset($config['notify_on_register']) ? '' : 'checked' ?> style="width:auto;">
              👤 إشعار عند تسجيل حساب جديد
            </label>
            <label class="field-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" name="notify_on_download" <?= empty($config['notify_on_download']) && isset($config['notify_on_download']) ? '' : 'checked' ?> style="width:auto;">
              ⬇️ إشعار عند تحميل الإضافة
            </label>
          </div>
          <div class="alert alert-info" style="margin-top:8px;">
            إشعار لوحة التحكم (🔔 فوق) بيشتغل دايمًا تلقائيًا بدون أي إعداد. تيليجرام وواتساب اختياريين
            للحصول على إشعار فوري على موبايلك كمان.
          </div>
        </div>

        <!-- تيليجرام نُقل لنموذج مستقل بالأسفل لتجنب مشكلة النماذج المتداخلة -->

        <!-- Card: Cloudflare Turnstile + Google OAuth + Mail -->
        <div class="card">
          <div class="card-title">🛡️ Cloudflare Turnstile + Google + البريد</div>
          <p style="font-size:13px;color:var(--t2);margin-bottom:12px;">اترك الحقول فارغة لتعطيل الميزة. Redirect URI لـ Google: <code style="color:var(--p3)">https://faset.xo.je/api/google-callback.php</code></p>
          <div class="grid2">
            <div>
              <label class="field-label">Turnstile Site Key</label>
              <input type="text" name="turnstile_site_key" value="<?= fbbf_h((string)($config['turnstile_site_key']??'')) ?>" placeholder="0x4AAAA...">
            </div>
            <div>
              <label class="field-label">Turnstile Secret Key</label>
              <input type="text" name="turnstile_secret_key" value="<?= fbbf_h((string)($config['turnstile_secret_key']??'')) ?>" placeholder="0x4AAAA...">
            </div>
            <div>
              <label class="field-label">Google Client ID</label>
              <input type="text" name="google_client_id" value="<?= fbbf_h((string)($config['google_client_id']??'')) ?>">
            </div>
            <div>
              <label class="field-label">Google Client Secret</label>
              <input type="text" name="google_client_secret" value="<?= fbbf_h((string)($config['google_client_secret']??'')) ?>">
            </div>
            <div>
              <label class="field-label">بريد المرسل (mail_from)</label>
              <input type="email" name="mail_from" value="<?= fbbf_h((string)($config['mail_from']??'')) ?>" placeholder="noreply@faset.xo.je">
            </div>
          </div>
          <p style="font-size:12px;color:var(--t2);margin-top:10px;">صفحة حساب المستخدم: <a href="/account.php" style="color:var(--p1)">/account.php</a> — أكواد الترحيب تُعرض هنا عند الإرسال وتُرسل للإيميل إن أمكن.</p>
        </div>

        <!-- Card 4: WhatsApp -->
        <div class="card">
          <div class="card-title">📲 واتساب (CallMeBot)</div>
          <details style="background:var(--s3);border:1px solid var(--b2);border-radius:12px;padding:12px 16px;">
            <summary style="cursor:pointer;font-weight:800;color:var(--p2);">إزاي أفعّل واتساب؟ (خطوات بسيطة)</summary>
            <ol style="margin:12px 0 4px;padding-inline-start:20px;line-height:2;color:var(--t2);font-size:13.5px;">
              <li>من رقم الواتساب اللي عايز تستقبل عليه الإشعارات، احفظ الرقم <code style="color:var(--p3)">+34 644 59 71 07</code> في جهات الاتصال</li>
              <li>ابعتله على واتساب الرسالة دي بالظبط (بالإنجليزي):<br>
                <code style="color:var(--p3)">I allow callmebot to send me messages</code></li>
              <li>خلال دقيقة أو دقيقتين هيردّلك برسالة فيها <strong style="color:var(--t1)">API Key</strong> (رقم زي <code style="color:var(--p3)">123456</code>)</li>
              <li>حط رقم واتساب بتاعك بالكود الدولي بدون + ولا صفر في الأول (مثال: مصر <code style="color:var(--p3)">201277181217</code>) في خانة "رقم واتساب" تحت</li>
              <li>حط الـ API Key اللي وصلك في الخانة التانية تحت واحفظ الإعدادات</li>
            </ol>
          </details>
          <div class="grid2" style="margin-top:12px;">
            <div>
              <label class="field-label">رقم واتساب للإشعارات</label>
              <input type="text" name="whatsapp_phone"
                value="<?= fbbf_h((string)($config['whatsapp_phone']??'')) ?>"
                placeholder="201277181217">
            </div>
            <div>
              <label class="field-label">CallMeBot API Key</label>
              <input type="text" name="whatsapp_callmebot_apikey"
                value="<?= fbbf_h((string)($config['whatsapp_callmebot_apikey']??'')) ?>"
                placeholder="123456">
            </div>
          </div>
          <div class="btn-row" style="margin-top:6px;">
            <button type="submit" form="testWhatsappForm" class="btn btn-ghost btn-sm">📲 اختبار واتساب الآن</button>
          </div>
          <?php if (!empty($config['whatsapp_last_result'])): ?>
          <div class="alert alert-info" style="margin-top:8px;">
            <strong>آخر رد فعلي من CallMeBot</strong>
            <?php if (!empty($config['whatsapp_last_attempt_at'])): ?>
              (<?= date('Y-m-d H:i', (int)$config['whatsapp_last_attempt_at']) ?>)
            <?php endif; ?>:
            <div style="margin-top:6px;font-family:monospace;font-size:12px;color:var(--t2);
              background:var(--s2);border-radius:8px;padding:8px 10px;word-break:break-word;">
              <?= fbbf_h((string)$config['whatsapp_last_result']) ?>
            </div>
            <div style="margin-top:6px;font-size:12px;color:var(--t3);">
              لو الرد فيه "APIKey is invalid" أو "not registered" — أعد تفعيل الرقم من واتساب
              بإرسال <code style="color:var(--p3)">I allow callmebot to send me messages</code>
              لرقم <code style="color:var(--p3)">+34 644 59 71 07</code> تاني، وهياخد API Key جديد.
            </div>
          </div>
          <?php endif; ?>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn btn-primary">💾 حفظ إعدادات الحماية والإشعارات</button>
        </div>
      </form>

      <!-- ═══ تيليجرام — نموذج مستقل (يعمل بدون جافاسكربت) ═══ -->
      <div class="card" id="telegram-settings-card">
        <div class="card-title">✈️ تيليجرام — لصق التوكن وChat ID يدويًا</div>
        <p style="font-size:13px;color:var(--t2);line-height:1.75;margin:0 0 12px">
          الاستضافة لا تتصل بتيليجرام من السيرفر. الصق القيم هنا واضغط <strong>حفظ</strong> فقط.
          الإشعارات التلقائية قد تعمل أو لا حسب استضافة InfinityFree.
        </p>
        <form method="post" action="/admin/index.php#settings" id="telegramStandaloneForm">
          <input type="hidden" name="action" value="save_telegram_from_browser">
          <div class="grid2">
            <div>
              <label class="field-label">Telegram Bot Token</label>
              <input type="text" name="telegram_bot_token" required
                value="<?= fbbf_h((string)($config['telegram_bot_token']??'')) ?>"
                placeholder="123456789:AAHxxxx..." autocomplete="off">
            </div>
            <div>
              <label class="field-label">Telegram Chat ID</label>
              <input type="text" name="telegram_chat_id" required
                value="<?= fbbf_h((string)($config['telegram_chat_id']??'')) ?>"
                placeholder="مثال: 987654321" autocomplete="off">
            </div>
            <div>
              <label class="field-label">يوزرنيم البوت (بدون @)</label>
              <input type="text" name="telegram_bot_username"
                value="<?= fbbf_h((string)($config['telegram_bot_username']??'fbpublisher_bot')) ?>"
                placeholder="fbpublisher_bot" autocomplete="off">
            </div>
            <div>
              <label class="field-label">سر الـ Webhook (اختياري)</label>
              <input type="text" name="telegram_webhook_secret"
                value="<?= fbbf_h((string)($config['telegram_webhook_secret']??'')) ?>"
                placeholder="اتركه فارغًا أو ضع كلمة سر" autocomplete="off">
            </div>
          </div>
          <div class="btn-row" style="margin-top:14px">
            <button type="submit" class="btn btn-primary">💾 حفظ تيليجرام الآن</button>
          </div>
        </form>
        <?php if (!empty($config['telegram_bot_token']) && !empty($config['telegram_chat_id'])): ?>
          <div class="alert alert-ok" style="margin-top:12px;font-size:13px">
            ✓ محفوظ حاليًا — Chat ID: <strong><?= fbbf_h((string)$config['telegram_chat_id']) ?></strong>
            <?php if (!empty($config['telegram_linked_at'])): ?>
              · آخر حفظ: <?= fbbf_h(fbbf_iso((int)$config['telegram_linked_at'])) ?>
            <?php endif; ?>
          </div>
          <div class="alert alert-info" style="margin-top:10px;font-size:12.5px;line-height:1.7">
            <strong>كيف تختبر فعليًا؟</strong><br>
            1) من متصفحك افتح هذا الرابط (يستبدل القيم تلقائيًا من الحفظ):<br>
            <a style="color:var(--p2);word-break:break-all" target="_blank" rel="noopener"
              href="https://api.telegram.org/bot<?= fbbf_h((string)$config['telegram_bot_token']) ?>/sendMessage?chat_id=<?= fbbf_h((string)$config['telegram_chat_id']) ?>&text=<?= rawurlencode('✅ اختبار fb Bablushr F من المتصفح') ?>">
              إرسال رسالة اختبار من المتصفح
            </a><br>
            2) لو وصلت الرسالة على تيليجرام = التوكن وChat ID صحيحان.<br>
            3) إشعارات السيرفر التلقائية تعتمد على استضافة InfinityFree؛ إن فشل DNS قد لا تصل رغم صحة الربط.
          </div>
        <?php else: ?>
          <div class="alert alert-info" style="margin-top:12px;font-size:12.5px">لم يُحفظ ربط تيليجرام بعد.</div>
        <?php endif; ?>
          <div class="alert alert-info" style="margin-top:14px;font-size:12.5px;line-height:1.8">
            <strong>⚠️ مهم على InfinityFree</strong><br>
            الاستضافة غالبًا تمنع تيليجرام من الوصول لملفك (تظهر JS Challenge) فيفشل الـ Webhook.<br>
            <strong>الحل الموثوق:</strong> شغّل الأوامر من المتصفح بالزر تحت (يتصل بتيليجرام من موبايلك مباشرة).
            <div class="btn-row" style="margin-top:10px">
              <button type="button" class="btn btn-primary" onclick="fbbfTgPollCommands()">⚡ تنفيذ أوامر البوت الآن من المتصفح</button>
            </div>
            <div id="tgPollStatus" style="margin-top:8px;color:var(--t2)"></div>
            <hr style="border:none;border-top:1px solid var(--b2);margin:12px 0">
            <strong>روابط يدوية (اختياري):</strong><br>
            <?php
              $tokRaw = trim((string)($config['telegram_bot_token'] ?? ''));
              $tokEnc = rawurlencode($tokRaw);
              $cleanHook = 'https://faset.xo.je/api/telegram-webhook.php';
              $delUrl = $tokRaw !== '' ? ('https://api.telegram.org/bot' . $tokRaw . '/deleteWebhook?drop_pending_updates=true') : '#';
              $setUrlClean = $tokRaw !== '' ? ('https://api.telegram.org/bot' . $tokRaw . '/setWebhook?url=' . rawurlencode($cleanHook)) : '#';
              $infoUrl = $tokRaw !== '' ? ('https://api.telegram.org/bot' . $tokRaw . '/getWebhookInfo') : '#';
            ?>
            1) امسح الويبهوك القديم (فيه سر تالف): <a href="<?= fbbf_h($delUrl) ?>" target="_blank" rel="noopener">deleteWebhook</a><br>
            2) اضبط النظيف: <a href="<?= fbbf_h($setUrlClean) ?>" target="_blank" rel="noopener">setWebhook نظيف</a><br>
            3) تحقق: <a href="<?= fbbf_h($infoUrl) ?>" target="_blank" rel="noopener">getWebhookInfo</a><br>
            <span style="color:var(--t3)">اترك خانة «سر الـ Webhook» فارغة. لا تلصق فيها ok: true</span>
          </div>
          </div>

      </div>

      <form method="post" id="tgDiscoverForm" style="display:none">
        <input type="hidden" name="action" value="discover_telegram_chat">
        <input type="hidden" name="telegram_bot_token" id="tgDiscoverToken" value="">
      </form>
      <form method="post" id="tgTestForm" style="display:none">
        <input type="hidden" name="action" value="test_telegram">
      </form>

      <!-- Plans Card -->
      <div class="card">
        <div class="card-title">💰 خطط الاشتراك</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>الخطة</th><th>المدة</th><th>السعر</th></tr>
            </thead>
            <tbody>
              <?php foreach($plans as $key=>$plan): ?>
              <tr>
                <td><strong><?= fbbf_h((string)$plan['label']) ?></strong></td>
                <td><?= (int)$plan['days'] ?> يوم</td>
                <td style="color:var(--p2);font-weight:800;"><?= (int)($plan['price']??0) ?> جنيه</td>
              </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
        <div class="alert alert-info" style="margin-top:12px;">
          💡 لتغيير الأسعار، عدّل <code style="color:var(--p3)">data/app-config.json</code> في مفتاح <code style="color:var(--p3)">plans</code>
        </div>
      </div>

      <!-- System Info -->
      <div class="card">
        <div class="card-title">🖥️ معلومات النظام</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <?php
          $sysItems = [
            ['موقع الإضافة','faset.xo.je'],
            ['App ID','dmcbokioicahkkemfjo'],
            ['الإصدار الحالي','v'.$extVersion],
            ['Update URL','faset.xo.je/updates.xml'],
            ['منصة الدفع','فودافون كاش / محافظ'],
            ['إصدار PHP',phpversion()],
          ];
          foreach($sysItems as [$label,$value]): ?>
          <div style="background:var(--s3);border:1px solid var(--b1);border-radius:10px;padding:12px;">
            <div style="font-size:10px;color:var(--t2);margin-bottom:4px;"><?= fbbf_h($label) ?></div>
            <div style="font-size:12px;color:var(--t3);font-weight:700;word-break:break-all;"><?= fbbf_h($value) ?></div>
          </div>
          <?php endforeach; ?>
        </div>
      </div>

    </div>

    <!-- ══════════════════════════════════════════════════ -->
    <!-- TAB: THEME -->
    <!-- ══════════════════════════════════════════════════ -->
    <div class="page-section" id="tab-theme">

      <div class="card">
        <div class="card-title">🎨 ثيم الموقع + الإضافة</div>
        <p style="font-size:12px;color:var(--t2);margin:0 0 14px;line-height:1.6">الثيم المختار يُطبَّق على صفحات الموقع، ولوحة الأدمن، والإضافة (عبر <code style="color:var(--p3)">/api/theme.php</code>).</p>
        <form method="post">
          <input type="hidden" name="action" value="save_settings">
          <input type="hidden" name="theme_form" value="1">
          <input type="hidden" name="support_whatsapp" value="<?= fbbf_h((string)($config['support_whatsapp']??'')) ?>">
          <input type="hidden" name="vodafone_cash_number" value="<?= fbbf_h((string)($config['vodafone_cash_number']??'')) ?>">
          <input type="hidden" name="trial_days" value="<?= (int)($config['trial_days']??3) ?>">

          <label class="field-label">لوحة الألوان</label>
          <div class="theme-grid">
            <?php
            $themes = [
              ['publisher','FB Publisher X','linear-gradient(135deg,#1e3a8a,#2563eb,#7c3aed,#22d3ee)'],
              ['blue','Ocean Blue','linear-gradient(135deg,#1e3a8a,#1d4ed8,#3b82f6)'],
              ['purple','Deep Purple','linear-gradient(135deg,#4c1d95,#6d28d9,#8b5cf6)'],
              ['verdigris','Verdigris','linear-gradient(135deg,#115e59,#14b8a6,#2dd4bf)'],
              ['obsidian_aurora','Obsidian Aurora','linear-gradient(135deg,#0B0F14,#00C9A7,#7C5CFC)'],
              ['red','Crimson','linear-gradient(135deg,#7f1d1d,#991b1b,#ef4444)'],
            ];
            $curTheme = (string)($config['site_theme'] ?? $config['theme'] ?? 'publisher');
            foreach($themes as [$tKey,$tLabel,$tGrad]): ?>
            <label style="text-align:center;cursor:pointer;">
              <div class="theme-swatch <?= $curTheme===$tKey?'active':'' ?>"
                style="background:<?= $tGrad ?>;"
                onclick="document.querySelectorAll('.theme-swatch').forEach(s=>s.classList.remove('active'));this.classList.add('active');document.getElementById('themeInput').value='<?= $tKey ?>';this.parentElement.querySelector('input[type=radio]').checked=true;">
                <?= $curTheme===$tKey?'✓':'' ?>
              </div>
              <div style="font-size:10px;color:var(--t2);margin-top:4px;"><?= $tLabel ?></div>
              <input type="radio" name="site_theme" value="<?= $tKey ?>" <?= $curTheme===$tKey?'checked':'' ?> style="display:none;">
            </label>
            <?php endforeach; ?>
          </div>
          <input type="hidden" id="themeInput" name="site_theme" value="<?= fbbf_h($curTheme) ?>">

          <label class="field-label" style="margin-top:18px">شكل الأزرار</label>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            <?php
            $btnStyle = (string)($config['theme_btn_style'] ?? 'gradient');
            foreach ([['gradient','تدرج'],['solid','صلب'],['outline','إطار']] as [$bv,$bl]): ?>
            <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid var(--b2);border-radius:12px;cursor:pointer;background:var(--s3);">
              <input type="radio" name="theme_btn_style" value="<?= $bv ?>" <?= $btnStyle===$bv?'checked':'' ?>>
              <span style="font-size:12px;font-weight:700;"><?= $bl ?></span>
            </label>
            <?php endforeach; ?>
          </div>

          <label class="field-label" style="margin-top:16px">استدارة الزوايا (px)</label>
          <input type="number" name="theme_radius" min="6" max="28" value="<?= (int)preg_replace('/\D/','',(string)($config['theme_radius']??'14')) ?>" style="max-width:140px">

          <label class="field-label" style="margin-top:16px">أسلوب الأيقونات</label>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            <?php
            $iconSet = (string)($config['theme_icon_set'] ?? 'modern');
            foreach ([['modern','حديث'],['minimal','بسيط'],['bold','بارز']] as [$iv,$il]): ?>
            <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid var(--b2);border-radius:12px;cursor:pointer;background:var(--s3);">
              <input type="radio" name="theme_icon_set" value="<?= $iv ?>" <?= $iconSet===$iv?'checked':'' ?>>
              <span style="font-size:12px;font-weight:700;"><?= $il ?></span>
            </label>
            <?php endforeach; ?>
          </div>

          <label style="display:flex;align-items:center;gap:10px;margin-top:18px;padding:14px;background:var(--s3);border:1px solid var(--b2);border-radius:12px;cursor:pointer;">
            <input type="checkbox" name="theme_apply_extension" value="1" <?= !isset($config['theme_apply_extension']) || !empty($config['theme_apply_extension']) ? 'checked' : '' ?>>
            <span style="font-size:13px;font-weight:700;">تطبيق الثيم على الإضافة تلقائيًا</span>
          </label>
          <p style="font-size:11px;color:var(--t2);margin:8px 0 0">عند التفعيل، لوحة 🌐 في الإضافة تسحب الألوان من السيرفر عند كل فتح.</p>

          <div class="btn-row" style="margin-top:16px">
            <button type="submit" class="btn btn-primary">💾 حفظ وتطبيق على الموقع والإضافة</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-title">👁️ معاينة الثيم الحالي</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <div style="padding:12px 20px;background:var(--pg);border-radius:12px;color:#fff;font-weight:800;font-size:13px;">
            زر رئيسي
          </div>
          <div style="padding:12px 20px;background:var(--b1);border:1px solid var(--b2);border-radius:12px;color:var(--p3);font-weight:800;font-size:13px;">
            زر ثانوي
          </div>
          <div style="padding:8px 14px;background:var(--pg);border-radius:99px;color:#fff;font-size:11px;font-weight:800;box-shadow:0 4px 12px var(--pglow);">
            v<?= fbbf_h($extVersion) ?>
          </div>
          <div style="width:40px;height:40px;border-radius:10px;background:var(--pg);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 12px var(--pglow);">
            🛡️
          </div>
        </div>
        <div style="margin-top:12px;padding:14px;background:var(--okbg);border:1px solid var(--okb);border-radius:12px;color:var(--ok);font-size:13px;">
          ✅ هذا شكل رسائل النجاح
        </div>
        <div style="margin-top:8px;padding:14px;background:var(--errbg);border:1px solid var(--errb);border-radius:12px;color:var(--err);font-size:13px;">
          ❌ هذا شكل رسائل الخطأ
        </div>
      </div>
    </div>

  </div><!-- /content -->
</div><!-- /main -->

<div id="toast"></div>

<script>
// ── Tab switching ──────────────────────────────────────
var tabTitles = {
  dashboard: ['لوحة التحكم','نظرة عامة على كل الإحصاءات'],
  users: ['إدارة المستخدمين','إضافة وتفعيل وحظر المشتركين'],
  payments: ['طلبات الدفع','مراجعة وتفعيل طلبات الدفع الواردة'],
  updates: ['إدارة التحديثات','نشر تحديثات الإضافة تلقائياً'],
  announcements: ['إشعارات المستخدمين','تنبيهات داخل الإضافة والبريد'],
  settings: ['الإعدادات العامة','إعدادات الدفع والنظام'],
  theme: ['الثيم والمظهر','تخصيص ألوان ومظهر لوحة الإدارة'],
};

function showTab(name, el) {
  document.querySelectorAll('.page-section').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  var t = tabTitles[name]||[name,''];
  document.getElementById('topbarTitle').textContent = t[0];
  document.getElementById('topbarSub').textContent = t[1];
  closeSidebar();
  location.hash = name;
}

// Auto open tab from hash
(function(){
  var h = location.hash.replace('#','');
  if(h && document.getElementById('tab-'+h)){
    var navItem = Array.from(document.querySelectorAll('.nav-item')).find(function(el){
      return el.getAttribute('onclick') && el.getAttribute('onclick').indexOf("'"+h+"'")!==-1;
    });
    showTab(h, navItem);
  }
})();

// ── Mobile sidebar ─────────────────────────────────────
function toggleSidebar(){
  var sb = document.getElementById('sidebar');
  var ov = document.getElementById('overlay');
  var open = !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  ov.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.body.classList.remove('sidebar-open');
}

// ── Live clock ─────────────────────────────────────────
function updateClock(){
  var now = new Date();
  var h=String(now.getHours()).padStart(2,'0');
  var m=String(now.getMinutes()).padStart(2,'0');
  var s=String(now.getSeconds()).padStart(2,'0');
  document.getElementById('liveTime').textContent = h+':'+m+':'+s;
}
setInterval(updateClock,1000); updateClock();

// ── Download chart ─────────────────────────────────────
(function(){
  var data = <?= $last7Json ?>;
  if(!data.length) return;
  var max = Math.max.apply(null, data.map(function(r){return r.count;})) || 1;
  var today = new Date().toISOString().slice(0,10);
  var html = data.map(function(r){
    var pct = Math.round((r.count/max)*100);
    var isToday = r.date===today;
    return '<div class="chart-bar-wrap">'+
      '<div class="chart-val">'+(r.count||'')+'</div>'+
      '<div class="chart-bar" style="height:'+Math.max(pct,4)+'%;background:'+(isToday?'var(--p1)':'rgba(45,212,191,0.35)')+'"></div>'+
      '<div class="chart-label">'+r.date.slice(5)+'</div>'+
      '</div>';
  }).join('');
  document.getElementById('dlChart').innerHTML = html;
})();

// ── User search ────────────────────────────────────────
function filterUsers(){
  var q = (document.getElementById('userSearch').value||'').toLowerCase();
  var statusVal = document.getElementById('statusFilter').value;
  var planVal = document.getElementById('planFilter').value;
  var sortVal = document.getElementById('sortOrder').value;

  var tbody = document.querySelector('#usersTable tbody');
  var rows = Array.prototype.slice.call(document.querySelectorAll('.user-row'));

  var visibleCount = 0;
  rows.forEach(function(row){
    var email = row.getAttribute('data-email')||'';
    var status = row.getAttribute('data-status')||'';
    var plan = row.getAttribute('data-plan')||'';
    var matches = (q==='' || email.indexOf(q)!==-1)
      && (statusVal==='' || status===statusVal)
      && (planVal==='' || plan===planVal);
    row.style.display = matches ? '' : 'none';
    if (matches) visibleCount++;
  });

  // الترتيب بيتطبق على كل الصفوف (حتى المخفية) عشان الترتيب يفضل صحيح
  // لو المستخدم غيّر الفلتر تاني بعد كده
  rows.sort(function(a,b){
    var ca = parseInt(a.getAttribute('data-created')||'0', 10);
    var cb = parseInt(b.getAttribute('data-created')||'0', 10);
    return sortVal === 'oldest' ? (ca-cb) : (cb-ca);
  });
  rows.forEach(function(row){ tbody.appendChild(row); });

  var countEl = document.getElementById('userFilterCount');
  if (countEl) countEl.textContent = 'عرض ' + visibleCount + ' من ' + rows.length + ' مستخدم';
}

function resetUserFilters(){
  document.getElementById('userSearch').value = '';
  document.getElementById('statusFilter').value = '';
  document.getElementById('planFilter').value = '';
  document.getElementById('sortOrder').value = 'newest';
  filterUsers();
}

// ── Plan menu toggle ───────────────────────────────────
function togglePlanMenu(btn){
  var menu = btn.nextElementSibling;
  var allMenus = document.querySelectorAll('.plan-menu');
  allMenus.forEach(function(m){ if(m!==menu) m.style.display='none'; });
  menu.style.display = menu.style.display==='none' ? 'block' : 'none';
}
document.addEventListener('click', function(e){
  if(!e.target.closest('.plan-menu') && !e.target.closest('.btn-ok')){
    document.querySelectorAll('.plan-menu').forEach(function(m){ m.style.display='none'; });
  }
});

// ── Upload area ────────────────────────────────────────
function onFileChosen(input){
  var chosen = document.getElementById('chosenName');
  if(input.files && input.files[0]){
    var name = input.files[0].name;
    chosen.textContent = '✅ تم اختيار: ' + name;
    chosen.style.display = 'block';
    // Auto-fill filename
    if(!document.getElementById('pubFilename').value)
      document.getElementById('pubFilename').value = name;
  }
}

var dropArea = document.getElementById('uploadArea');
if(dropArea){
  ['dragenter','dragover'].forEach(function(ev){
    dropArea.addEventListener(ev,function(e){e.preventDefault();dropArea.classList.add('drag');});
  });
  ['dragleave','drop'].forEach(function(ev){
    dropArea.addEventListener(ev,function(e){e.preventDefault();dropArea.classList.remove('drag');});
  });
}

// ── Publish update ─────────────────────────────────────
function publishUpdate(){
  var version  = document.getElementById('pubVersion').value.trim();
  var filename = document.getElementById('pubFilename').value.trim();
  var notes    = document.getElementById('pubNotes').value.trim();
  var fileInput = document.getElementById('zipFile');

  if(!version){ showToast('⚠️ أدخل رقم الإصدار', 'warn'); return; }
  if(!filename){ showToast('⚠️ أدخل اسم ملف ZIP', 'warn'); return; }
  if(!/^\d+\.\d+\.\d+$/.test(version)){ showToast('⚠️ الإصدار يجب أن يكون بصيغة 1.0.0', 'warn'); return; }

  var btn = document.getElementById('publishBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ جاري النشر…';

  var fd = new FormData();
  fd.append('version', version);
  fd.append('filename', filename);
  fd.append('notes', notes);
  if(fileInput.files && fileInput.files[0])
    fd.append('zipfile', fileInput.files[0]);

  var pWrap = document.getElementById('progressWrap');
  var pFill  = document.getElementById('progressFill');
  var pLabel = document.getElementById('progressLabel');
  pWrap.style.display='block'; pFill.style.width='10%'; pLabel.textContent='جاري الإرسال…';

  var rd = document.getElementById('publishResult');
  rd.style.display='none';

  var xhr = new XMLHttpRequest();
  xhr.open('POST','/api/set-version.php',true);

  xhr.upload.onprogress = function(e){
    if(e.lengthComputable){
      var pct = Math.round((e.loaded/e.total)*90);
      pFill.style.width = pct + '%';
      pLabel.textContent = 'جاري الرفع… ' + pct + '%';
    }
  };

  xhr.onload = function(){
    pFill.style.width='100%';
    var res;
    try{ res=JSON.parse(xhr.responseText); }
    catch(e){ res={ok:false,message:'استجابة غير متوقعة'}; }

    rd.style.display='block';

    if(res.ok){
      pLabel.textContent='اكتمل ✓';
      rd.innerHTML='<div class="alert alert-ok">'+
        '<span style="font-size:22px;">🎉</span>'+
        '<div class="alert-body">'+
          '<strong>تم النشر بنجاح!</strong><br/>'+
          '• الإصدار الجديد: <strong>v'+esc(res.version)+'</strong><br/>'+
          '• الملف: '+esc(res.filename)+'<br/>'+
          (res.zip_uploaded?'• تم رفع الـ ZIP ✓<br/>':'')+
          '• <a href="/updates.xml" target="_blank" style="color:var(--ok)">فتح /updates.xml ←</a>'+
        '</div></div>';
      showToast('🎉 تم نشر v'+res.version+' بنجاح!');
    } else {
      pLabel.textContent='فشل ✗';
      rd.innerHTML='<div class="alert alert-err">⚠️ '+esc(res.message||'حدث خطأ')+'</div>';
      showToast('❌ '+(res.message||'فشل النشر'),'err');
    }
    btn.disabled=false;
    btn.innerHTML='⚡ نشر التحديث الآن — تحديث فوري لكل المستخدمين';
  };

  xhr.onerror=function(){
    pLabel.textContent='فشل الاتصال';
    rd.style.display='block';
    rd.innerHTML='<div class="alert alert-err">❌ تعذّر الاتصال بالسيرفر</div>';
    btn.disabled=false;
    btn.innerHTML='⚡ نشر التحديث الآن';
    showToast('❌ فشل الاتصال','err');
  };

  xhr.send(fd);
}

// ── Helpers ────────────────────────────────────────────
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(msg,type){
  var t=document.getElementById('toast');
  t.textContent=msg;
  t.style.borderColor=type==='err'?'var(--err)':type==='warn'?'var(--warn)':'var(--ok)';
  t.style.color=type==='err'?'var(--err)':type==='warn'?'var(--warn)':'var(--ok)';
  t.classList.add('show');
  clearTimeout(t._t);
  t._t=setTimeout(function(){t.classList.remove('show');},3500);
}
</script>
</body>
</html>
