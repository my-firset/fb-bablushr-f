<?php
/**
 * صفحة حساب المستخدم — بيانات · خطة · كلمة سر · دفع
 * PHP 8.0–8.3
 */
require __DIR__ . '/includes/bootstrap.php';
fbbf_require_install_or_redirect();

$config = fbbf_config();
$loggedEmail = fbbf_current_user_email();
$logged = $loggedEmail !== '';

if (isset($_GET['logout'])) {
    fbbf_user_logout_clear();
    fbbf_redirect('/login-download.php');
}

/* دخول من نفس الصفحة إن لم يكن مسجّلًا */
if (!$logged && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'login') {
    $emailIn = fbbf_normalize_email((string)($_POST['email'] ?? ''));
    $pass = (string)($_POST['password'] ?? '');
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $emailIn);
    if ($i === -1 || !password_verify($pass, (string)($users[$i]['password_hash'] ?? ''))) {
        fbbf_flash('بيانات الدخول غير صحيحة.', 'err');
    } else {
        fbbf_user_login_remember($emailIn);
        fbbf_flash('مرحبًا بعودتك.', 'ok');
    }
    fbbf_redirect('/account.php');
}

if ($logged && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $action = (string)($_POST['action'] ?? '');
    $email = fbbf_current_user_email();
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $email);
    if ($i === -1) {
        fbbf_user_logout_clear();
        fbbf_redirect('/account.php');
    }

    if ($action === 'change_password') {
        $cur = (string)($_POST['current_password'] ?? '');
        $new = (string)($_POST['new_password'] ?? '');
        if (!password_verify($cur, (string)($users[$i]['password_hash'] ?? ''))) {
            fbbf_flash('كلمة المرور الحالية خاطئة.', 'err');
        } elseif (strlen($new) < 4) {
            fbbf_flash('كلمة المرور الجديدة قصيرة.', 'err');
        } else {
            $users[$i]['password_hash'] = password_hash($new, PASSWORD_DEFAULT);
            $users[$i]['updated_at'] = fbbf_now();
            fbbf_save_users($users);
            fbbf_flash('تم تغيير كلمة المرور.', 'ok');
        }
        fbbf_redirect('/account.php');
    }

    if ($action === 'save_profile') {
        $display = trim((string)($_POST['display_name'] ?? ''));
        $users[$i]['display_name'] = function_exists('mb_substr') ? mb_substr($display, 0, 80) : substr($display, 0, 80);
        $users[$i]['updated_at'] = fbbf_now();
        fbbf_save_users($users);
        fbbf_flash('تم حفظ البيانات.', 'ok');
        fbbf_redirect('/account.php');
    }
}

$flash = fbbf_flash();
$user = null;
$state = null;
if ($logged) {
    $email = fbbf_current_user_email();
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $email);
    if ($i === -1) {
        fbbf_user_logout_clear();
        $logged = false;
    } else {
        // أي حساب فعّال للتجربة يُعتبر بريده جاهزًا (لا إيميل على الاستضافة المجانية)
        if (empty($users[$i]['email_verified'])) {
            $users[$i]['email_verified'] = true;
            fbbf_save_users($users);
        }
        $user = $users[$i];
        $state = fbbf_compute_user_state($user);
    }
}
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<link rel="icon" href="https://faset.xo.je/assets/icons/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="https://faset.xo.je/assets/icons/icon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="https://faset.xo.je/assets/icons/icon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="https://faset.xo.je/assets/icons/icon-180.png"/>
<link rel="manifest" href="https://faset.xo.je/site.webmanifest"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="fb Bablushr F"/>

<meta name="viewport" content="width=device-width, initial-scale=1">
<title>حسابي — fb Bablushr F</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0e17;--s1:#121826;--t1:#f0f4ff;--t2:#a5b4d4;--t3:#7dd3fc;
  --p1:#4a6fa5;--p2:#7eb6d9;--p3:#a78bfa;--ok:#4ade80;
  --pg:linear-gradient(135deg,#3d5a8a,#6b7ab8,#7eb6d9);--font:'Cairo',sans-serif;
}
*{box-sizing:border-box}
body{font-family:var(--font);background:radial-gradient(ellipse 50% 30% at 70% 0%,rgba(96,130,180,.12),transparent),var(--bg);color:var(--t1);min-height:100vh;margin:0;padding:16px 12px 32px}
.wrap{width:min(960px,100%);margin:0 auto;padding:0 4px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;font-size:13px;flex-wrap:wrap;gap:8px}
.top a{color:var(--t3);text-decoration:none;margin-left:10px}
.card{background:var(--s1);border:1px solid rgba(96,130,180,.22);border-radius:18px;padding:clamp(16px,4vw,26px);margin-bottom:14px}
h1{font-size:clamp(20px,5vw,26px);margin:0 0 4px}
h2{font-size:16px;margin:0 0 12px;color:var(--t3)}
.muted{color:var(--t2);font-size:12px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:500px){.row{grid-template-columns:1fr}}
label{display:block;font-size:12px;font-weight:700;color:var(--t2);margin:10px 0 5px}
input{width:100%;padding:14px 14px;min-height:48px;border-radius:12px;border:1px solid rgba(96,130,180,.25);background:#0d121c;color:var(--t1);font-family:inherit;font-size:15px}
.btn{display:inline-flex;align-items:center;justify-content:center;padding:14px 18px;min-height:48px;border:none;border-radius:14px;font-family:inherit;font-weight:700;cursor:pointer;margin-top:12px;text-decoration:none;font-size:15px}
.btn-p{background:var(--pg);color:#0a0e17;width:100%}
.btn-g{background:transparent;border:1px solid rgba(96,130,180,.3);color:var(--t1);width:100%;margin-top:8px}
.btn-inline{display:inline-flex;width:auto;padding:9px 14px;margin:8px 6px 0 0;background:transparent;border:1px solid rgba(96,130,180,.35);color:var(--t3)}
.flash{padding:12px;border-radius:12px;margin-bottom:12px;font-size:13px}
.flash.ok{background:rgba(74,222,128,.1);color:var(--ok)}
.flash.err{background:rgba(251,113,133,.1);color:#fb7185}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;background:rgba(124,92,252,.15);color:#a78bfa}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <a href="index.php">← الرئيسية</a>
      <a href="login-download.php">تحميل</a>
      <a href="payment.php">الدفع</a>
      <a href="support.php">الدعم</a>
    </div>
    <?php if ($logged): ?>
      <a href="account.php?logout=1">خروج</a>
    <?php endif; ?>
  </div>

  <?php if (!empty($flash)): ?>
    <div class="flash <?= fbbf_h((string)($flash['type'] ?? 'ok')) ?>"><?= fbbf_h((string)($flash['message'] ?? '')) ?></div>
  <?php endif; ?>

  <?php if (!$logged): ?>
    <div class="card">
      <h1>تسجيل الدخول لحسابك</h1>
      <p class="muted">أو اذهب لصفحة <a href="login-download.php" style="color:var(--t3)">التسجيل / التحميل</a></p>
      <form method="post">
        <input type="hidden" name="action" value="login">
        <label>البريد</label>
        <input type="email" name="email" required>
        <label>كلمة المرور</label>
        <input type="password" name="password" required minlength="4">
        <button type="submit" class="btn btn-p">دخول</button>
      </form>
      <a class="btn btn-g" href="login-download.php?mode=register">إنشاء حساب جديد</a>
    </div>
  <?php else: ?>
    <div class="card">
      <h1>مرحبًا</h1>
      <div class="muted"><?= fbbf_h((string)$user['email']) ?></div>
      <div style="margin-top:8px"><span class="badge"><?= fbbf_h((string)($state['status_label'] ?? 'تجربة')) ?> · <?= fbbf_h((string)($user['plan_label'] ?? 'تجربة مجانية')) ?></span></div>
    </div>

    <div class="card">
      <h2>تفاصيل الاشتراك</h2>
      <div class="row">
        <div>
          <div class="muted">انتهاء الاشتراك</div>
          <strong><?= fbbf_h(fbbf_iso((int)($user['subscription_expires_at'] ?? 0))) ?></strong>
        </div>
        <div>
          <div class="muted">انتهاء التجربة</div>
          <strong><?= fbbf_h(fbbf_iso((int)($user['trial_ends_at'] ?? 0))) ?></strong>
        </div>
        <div>
          <div class="muted">الأجهزة</div>
          <strong style="direction:ltr;display:inline-block"><?= (int)count(function_exists('fbbf_user_devices') ? fbbf_user_devices($user) : []) ?> من <?= (int)fbbf_max_devices() ?></strong>
        </div>
        <div>
          <div class="muted">البريد</div>
          <strong>مؤكد ✓</strong>
        </div>
      </div>
      <a class="btn btn-inline" href="payment.php">تجديد / دفع الاشتراك</a>
      <a class="btn btn-inline" href="login-download.php">تحميل الإضافة</a>
      <a class="btn btn-inline" href="support.php">الدعم</a>
    </div>

    <div class="card">
      <h2>تعديل البيانات</h2>
      <form method="post">
        <input type="hidden" name="action" value="save_profile">
        <label>الاسم الظاهر</label>
        <input type="text" name="display_name" value="<?= fbbf_h((string)($user['display_name'] ?? $user['google_name'] ?? '')) ?>" maxlength="80">
        <button type="submit" class="btn btn-p">حفظ</button>
      </form>
    </div>

    <div class="card">
      <h2>تغيير كلمة المرور</h2>
      <p class="muted">مهمة لمستخدمي Google حتى يدخلوا للإضافة بنفس الإيميل وكلمة السر.</p>
      <form method="post">
        <input type="hidden" name="action" value="change_password">
        <label>كلمة المرور الحالية</label>
        <input type="password" name="current_password" required>
        <label>كلمة المرور الجديدة</label>
        <input type="password" name="new_password" required minlength="4">
        <button type="submit" class="btn btn-p">تغيير</button>
      </form>
    </div>
  <?php endif; ?>
</div>

<?php if (file_exists(__DIR__ . '/includes/floating-support.php')) include __DIR__ . '/includes/floating-support.php'; ?>
</body>
</html>
