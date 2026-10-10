<?php
/**
 * تسجيل دخول / إنشاء حساب / تحميل الإضافة
 * أزرار منفصلة · جلسة ثابتة · PHP 8.0–8.3
 */
require __DIR__ . '/includes/bootstrap.php';
fbbf_require_install_or_redirect();

$config = fbbf_config();
$error = '';
$info = '';
$mode = (string)($_GET['mode'] ?? $_POST['mode'] ?? 'login'); // login | register
if (!in_array($mode, ['login', 'register'], true)) {
    $mode = 'login';
}

$sessionEmail = fbbf_current_user_email();

/* تحميل مباشر — يعتمد على جلسة الموقع أولًا (أثبت على الموبايل) */
if (isset($_GET['go_download'])) {
    if ($sessionEmail === '') {
        $error = 'سجّل دخولك أولًا ثم اضغط تحميل الإضافة.';
    } else {
        $users = fbbf_users();
        $idx = fbbf_find_user_index($users, $sessionEmail);
        if ($idx === -1) {
            fbbf_user_logout_clear();
            $sessionEmail = '';
            $error = 'الحساب غير موجود. أنشئ حسابًا جديدًا.';
        } else {
            $state = fbbf_compute_user_state($users[$idx]);
            if (!empty($state['access_granted'])) {
                // توكين احتياطي + تحميل بالجلسة
                if (function_exists('fbbf_issue_download_token')) {
                    $downloadToken = fbbf_issue_download_token($sessionEmail, 900);
                    fbbf_redirect('download.php?' . http_build_query([
                        'email' => $sessionEmail,
                        'dtoken' => $downloadToken,
                    ]));
                }
                fbbf_redirect('download.php');
            }
            $error = 'حسابك غير مفعّل حاليًا (انتهت التجربة أو الاشتراك).';
        }
    }
}

if (isset($_GET['err']) && $_GET['err'] === 'session') {
    $error = $error !== '' ? $error : 'انتهت صلاحية الجلسة أو يلزم تسجيل الدخول قبل التحميل. سجّل دخولك ثم اضغط «تحميل الإضافة».';
}
if (isset($_GET['welcome'])) {
    $info = 'تم تسجيل الدخول بنجاح. اضغط «تحميل الإضافة الآن».';
}


if (isset($_GET['logout'])) {
    fbbf_user_logout_clear();
    $sessionEmail = '';
    $info = 'تم تسجيل الخروج.';
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = (string)($_POST['action'] ?? 'login');
    $email = fbbf_normalize_email((string)($_POST['email'] ?? ''));
    $password = (string)($_POST['password'] ?? '');
    $password2 = (string)($_POST['password2'] ?? '');
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $tsToken = (string)($_POST['cf-turnstile-response'] ?? '');
    $mode = $action === 'register' ? 'register' : 'login';

    if (function_exists('fbbf_turnstile_enabled') && fbbf_turnstile_enabled() && !fbbf_verify_turnstile($tsToken)) {
        $error = 'أكمل تحقق Cloudflare (المربع) ثم أعد المحاولة. لو مش ظاهر حدّث الصفحة أو عطّل مانع الإعلانات.';
    } elseif (!fbbf_rate_limit_check('login_download_' . $ip, 12, 60)) {
        $error = 'محاولات كثيرة جدًا، حاول بعد دقيقة.';
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'أدخل بريدًا إلكترونيًا صحيحًا.';
    } elseif (strlen($password) < 4) {
        $error = 'كلمة السر 4 أحرف على الأقل.';
    } else {
        $users = fbbf_users();
        $idx = fbbf_find_user_index($users, $email);

        if ($action === 'register') {
            if ($password !== $password2) {
                $error = 'تأكيد كلمة السر غير مطابق.';
            } elseif ($idx !== -1) {
                $error = 'هذا البريد مسجّل بالفعل. استخدم «تسجيل الدخول».';
                $mode = 'login';
            } elseif (!fbbf_registration_enabled()) {
                $error = 'التسجيل مغلق مؤقتًا.';
            } else {
                $token = fbbf_issue_token();
                $user = [
                    'email' => $email,
                    'password_hash' => password_hash($password, PASSWORD_DEFAULT),
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
                    'devices' => [],
                    'last_login_device_id' => '',
                    'registered_via' => 'website',
                    'auth_provider' => 'email',
                    // الاستضافة المجانية لا توصل الإيميل — نعتبر الحساب جاهزًا للتجربة
                    'email_verified' => true,
                ];
                $users[] = $user;
                fbbf_save_users($users);

                if (function_exists('fbbf_notify_owner')) {
                    fbbf_notify_owner('register', [
                        'email' => $email,
                        'device_id' => '',
                        'device_label' => 'تسجيل جديد من الموقع',
                    ]);
                }
                if (function_exists('fbbf_audit_log')) {
                    fbbf_audit_log('تسجيل مستخدم', $email, $ip);
                }

                fbbf_user_login_remember($email);
                // PRG: إعادة توجيه بعد POST حتى تُحفظ الكوكي قبل عرض الصفحة (يحل حلقة الدخول على الموبايل)
                fbbf_redirect('login-download.php?welcome=1');
            }
        } else { // login
            if ($idx === -1) {
                $error = 'لا يوجد حساب بهذا البريد. اختر «إنشاء حساب».';
                $mode = 'register';
            } else {
                $hash = (string)($users[$idx]['password_hash'] ?? '');
                $hasPass = $hash !== '' && str_starts_with($hash, '$');
                // حسابات Google بدون كلمة سر
                if (!$hasPass) {
                    $error = 'هذا الحساب سُجّل عبر Google بدون كلمة سر. اضغط «دخول Google» أو أنشئ كلمة سر من صفحة حسابي بعد الدخول بجوجل.';
                } elseif (!password_verify($password, $hash)) {
                    $error = 'كلمة السر غير صحيحة.';
                } elseif (!empty($users[$idx]['blocked'])) {
                    $error = 'الحساب محظور. تواصل مع الدعم.';
                } else {
                    $users[$idx]['last_login_at'] = fbbf_now();
                    $users[$idx]['updated_at'] = fbbf_now();
                    // تسجيل جهاز ويب بسيط للمتابعة في الأدمن
                    if (function_exists('fbbf_touch_device')) {
                        $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? 'web'), 0, 80);
                        $users[$idx] = fbbf_touch_device($users[$idx], 'web-' . substr(md5($ip . $ua), 0, 12), 'متصفح الموقع', 'web');
                    }
                    fbbf_save_users($users);
                    fbbf_user_login_remember($email);
                    if (function_exists('fbbf_notify_owner')) {
                        fbbf_notify_owner('login', [
                            'email' => $email,
                            'device_id' => '',
                            'device_label' => 'دخول من الموقع',
                        ]);
                    }
                    fbbf_redirect('login-download.php?welcome=1');
                }
            }
        }
    }
}

$sessionUser = null;
$sessionState = null;
if ($sessionEmail !== '') {
    $users = fbbf_users();
    $idx = fbbf_find_user_index($users, $sessionEmail);
    if ($idx !== -1) {
        $sessionUser = $users[$idx];
        $sessionState = fbbf_compute_user_state($sessionUser);
    } else {
        fbbf_user_logout_clear();
        $sessionEmail = '';
    }
}

$googleUrl = '';
if (function_exists('fbbf_google_oauth_enabled') && fbbf_google_oauth_enabled()) {
    $_SESSION['fbbf_oauth_next'] = 'download';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    if ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') $scheme = 'https';
    $host = $_SERVER['HTTP_HOST'] ?? 'faset.xo.je';
    $googleUrl = fbbf_google_auth_url($scheme . '://' . $host . '/api/google-callback.php');
}
?>
<!DOCTYPE html>
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

<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تسجيل وتحميل — fb Bablushr F</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<?php if (function_exists('fbbf_turnstile_enabled') && fbbf_turnstile_enabled()): ?>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<?php endif; ?>
<style>
:root{
  --bg:#0a0e17; --card:#121826; --line:rgba(96,130,180,.28);
  --text:#f0f4ff; --muted:#a5b4d4; --p1:#4a6fa5; --cyan:#7eb6d9; --ok:#4ade80; --err:#fb7185;
  --pg:linear-gradient(135deg,#3d5a8a,#6b7ab8,#7eb6d9);
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:12px;
  font-family:Cairo,Tahoma,sans-serif;background:radial-gradient(ellipse 60% 40% at 80% 0%,rgba(96,130,180,.14),transparent),var(--bg);color:var(--text)}
.card{width:min(560px,100%);background:rgba(12,18,34,.96);border:1px solid var(--line);border-radius:22px;padding:clamp(18px,4vw,28px);box-shadow:0 24px 60px rgba(0,0,0,.45)}
.logo{text-align:center;margin-bottom:14px}
.logo .name{font-weight:900;font-size:18px}
.logo .name b{background:var(--pg);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo .sub{font-size:10px;letter-spacing:2px;color:var(--cyan);font-weight:700}
h1{margin:0 0 6px;font-size:22px;text-align:center}
.sub{text-align:center;color:var(--muted);font-size:13px;margin:0 0 16px;line-height:1.6}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.tab{padding:10px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--muted);font:inherit;font-weight:800;cursor:pointer;text-align:center;text-decoration:none}
.tab.active{background:rgba(96,130,180,.15);border-color:rgba(96,130,180,.45);color:#fff}
label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:10px 0 5px}
input{width:100%;padding:14px;min-height:48px;border-radius:12px;border:1px solid var(--line);background:#0d121c;color:#fff;font:inherit;font-size:15px}
input:focus{outline:none;border-color:var(--p1);box-shadow:0 0 0 3px rgba(96,130,180,.15)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;min-height:48px;border:0;border-radius:14px;font:inherit;font-weight:900;cursor:pointer;margin-top:12px;text-decoration:none;font-size:15px}
.btn-primary{background:var(--pg);color:#0a0e17}
.btn-ghost{background:transparent;border:1px solid var(--line);color:#fff}
.btn-ok{background:linear-gradient(135deg,#059669,#34d399);color:#04110a}
.error{background:rgba(251,113,133,.1);border:1px solid rgba(251,113,133,.3);color:var(--err);padding:10px 12px;border-radius:12px;font-size:13px;margin-bottom:12px}
.info{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);color:var(--ok);padding:10px 12px;border-radius:12px;font-size:13px;margin-bottom:12px}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(96,130,180,.15);color:var(--cyan);font-size:11px;font-weight:800}
.status{background:rgba(16,24,48,.8);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0;text-align:center}
.divider{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:14px 0}
.divider:before,.divider:after{content:'';flex:1;height:1px;background:var(--line)}
.links{text-align:center;margin-top:14px;font-size:12px}
.links a{color:var(--cyan);text-decoration:none;margin:0 6px}
.links a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="name"><b>fb</b> Bablushr F</div>
    <div class="sub">STEALTH ENGINE</div>
  </div>

  <?php if ($sessionUser && $sessionState): ?>
    <h1>أنت مسجّل الدخول</h1>
    <?php if ($info): ?><div class="info"><?= fbbf_h($info) ?></div><?php endif; ?>
    <?php if ($error): ?><div class="error"><?= fbbf_h($error) ?></div><?php endif; ?>
    <div class="status">
      <span class="badge"><?= fbbf_h((string)($sessionState['status_label'] ?? 'تجربة')) ?></span><br>
      <strong style="display:block;margin-top:8px"><?= fbbf_h((string)$sessionUser['email']) ?></strong>
      <div style="color:var(--muted);font-size:12px;margin-top:6px">
        <?= fbbf_h((string)($sessionUser['plan_label'] ?? 'تجربة مجانية')) ?>
      </div>
    </div>
    <?php if (!empty($sessionState['access_granted'])): ?>
      <a class="btn btn-ok" href="login-download.php?go_download=1" style="font-size:16px;padding:14px 18px">⬇️ تحميل الإضافة الآن</a>
      <a class="btn btn-ghost" href="download.php">رابط تحميل مباشر (نفس الجلسة)</a>
    <?php else: ?>
      <div class="error">الحساب غير مفعّل. جدّد الاشتراك من صفحة الدفع.</div>
      <a class="btn btn-primary" href="payment.php">الدفع والتفعيل</a>
    <?php endif; ?>
    <a class="btn btn-ghost" href="account.php">حسابي · البيانات والخطة</a>
    <a class="btn btn-ghost" href="payment.php">الدفع والاشتراكات</a>
    <div class="links">
      <a href="index.php">الصفحة الرئيسية</a>
      <a href="login-download.php?logout=1">خروج</a>
    </div>

  <?php else: ?>
    <h1><?= $mode === 'register' ? 'إنشاء حساب جديد' : 'تسجيل الدخول' ?></h1>
    <p class="sub">نفس البريد وكلمة السر تُستخدم داخل الإضافة بعد التحميل.</p>

    <div class="tabs">
      <a class="tab <?= $mode === 'login' ? 'active' : '' ?>" href="login-download.php?mode=login">تسجيل الدخول</a>
      <a class="tab <?= $mode === 'register' ? 'active' : '' ?>" href="login-download.php?mode=register">إنشاء حساب</a>
    </div>

    <?php if ($error): ?><div class="error"><?= fbbf_h($error) ?></div><?php endif; ?>
    <?php if ($info): ?><div class="info"><?= fbbf_h($info) ?></div><?php endif; ?>

    <form method="post" action="login-download.php">
      <input type="hidden" name="action" value="<?= $mode === 'register' ? 'register' : 'login' ?>">
      <input type="hidden" name="mode" value="<?= fbbf_h($mode) ?>">

      <label>البريد الإلكتروني</label>
      <input type="email" name="email" required autocomplete="email" value="<?= fbbf_h((string)($_POST['email'] ?? '')) ?>">

      <label>كلمة السر</label>
      <input type="password" name="password" required autocomplete="<?= $mode === 'register' ? 'new-password' : 'current-password' ?>" minlength="4">

      <?php if ($mode === 'register'): ?>
        <label>تأكيد كلمة السر</label>
        <input type="password" name="password2" required autocomplete="new-password" minlength="4">
      <?php endif; ?>

      <?php if (function_exists('fbbf_turnstile_enabled') && fbbf_turnstile_enabled()): ?>
        <div style="margin:10px 0" class="cf-turnstile" data-sitekey="<?= fbbf_h((string)($config['turnstile_site_key'] ?? '')) ?>" data-theme="dark"></div>
      <?php endif; ?>

      <?php if ($mode === 'register'): ?>
        <button class="btn btn-primary" type="submit">إنشاء الحساب</button>
      <?php else: ?>
        <button class="btn btn-primary" type="submit">تسجيل الدخول</button>
      <?php endif; ?>
    </form>

    <?php if ($googleUrl !== ''): ?>
      <div class="divider">أو</div>
      <a class="btn btn-ghost" href="<?= fbbf_h($googleUrl) ?>">الدخول عبر Google</a>
    <?php endif; ?>

    <div class="links">
      <a href="payment.php">الدفع</a>
      <a href="account.php">حسابي</a>
      <a href="index.php">الرئيسية</a>
    </div>
  <?php endif; ?>
</div>

<?php if (file_exists(__DIR__ . '/includes/floating-support.php')) include __DIR__ . '/includes/floating-support.php'; ?>

<?php
$uEmail = function_exists('fbbf_current_user_email') ? fbbf_current_user_email() : '';
if ($uEmail !== '' && function_exists('fbbf_user_whatsapp_ready_link')):
  $waReady = fbbf_user_whatsapp_ready_link($uEmail, '', 'التسجيل وبدء التجربة');
?>
<div style="margin:18px auto;max-width:420px;padding:14px 16px;border-radius:14px;border:1px solid rgba(37,211,102,.35);background:rgba(37,211,102,.08)">
  <div style="font-weight:900;margin-bottom:8px">📢 أخبرنا أنك سجّلت</div>
  <a class="btn" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#25D366;color:#fff;text-decoration:none;font-weight:800" target="_blank" rel="noopener" href="<?= fbbf_h($waReady) ?>">💬 واتساب جاهز</a>
</div>
<?php endif; ?>
</body>
</html>
