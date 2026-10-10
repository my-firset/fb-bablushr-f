<?php
require __DIR__ . '/includes/bootstrap.php';

// إعادة التهيئة فقط إن حُذف app-config أو طُلب force مع عدم وجود أدمن
if (fbbf_is_installed() && empty($_GET['force'])) {
    header('Location: /admin/index.php');
    exit;
}
if (!empty($_GET['force']) && fbbf_is_installed()) {
    // حماية: لا تمسح تثبيتًا قائمًا من الرابط فقط
    header('Location: /admin/index.php');
    exit;
}

$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $adminEmail = fbbf_normalize_email($_POST['admin_email'] ?? '');
    $adminPassword = (string)($_POST['admin_password'] ?? '');
    $adminPassword2 = (string)($_POST['admin_password_confirm'] ?? '');
    $whatsapp = trim((string)($_POST['whatsapp'] ?? '201277181217'));
    $wallet = trim((string)($_POST['wallet'] ?? '01080236940'));
    $siteName = trim((string)($_POST['site_name'] ?? 'fb Bablushr F'));

    if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
        $error = 'أدخل بريد أدمن صحيح.';
    } elseif (strlen($adminPassword) < 6) {
        $error = 'كلمة مرور الأدمن لازم 6 أحرف على الأقل.';
    } elseif ($adminPassword !== $adminPassword2) {
        $error = 'تأكيد كلمة المرور غير مطابق.';
    } else {
        $defaults = fbbf_read_json(FBBF_ROOT . '/data/app-config-default.json', []);
        if (!is_array($defaults)) $defaults = [];
        $config = array_merge($defaults, [
            'installed' => true,
            'site_name' => $siteName,
            'admin_email' => $adminEmail,
            'admin_password_hash' => password_hash($adminPassword, PASSWORD_DEFAULT),
            'support_whatsapp' => $whatsapp,
            'vodafone_cash_number' => $wallet,
            'trial_days' => 3,
            'max_devices_per_user' => 1,
            'registration_enabled' => true,
            'site_theme' => 'publisher',
            'plans' => fbbf_plan_catalog(),
            'installed_at' => fbbf_now(),
        ]);
        // تأكد مجلد data قابل للكتابة
        if (!is_dir(FBBF_DATA)) @mkdir(FBBF_DATA, 0775, true);
        if (!fbbf_save_config($config)) {
            $error = 'تعذّر حفظ الإعدادات. تأكد أن مجلد data/ قابل للكتابة على الاستضافة.';
        } else {
            if (!file_exists(FBBF_USERS_FILE)) fbbf_save_users([]);
            if (!file_exists(FBBF_PAYMENTS_FILE)) fbbf_save_payments([]);
            $_SESSION['fbbf_admin_logged_in'] = true;
            header('Location: /admin/index.php');
            exit;
        }
    }
}
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>تهيئة لوحة الإدارة</title>
  <style>
    body{font-family:Cairo,Tahoma,sans-serif;background:#0b1020;color:#eef2ff;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{width:min(560px,100%);background:#121a2f;border:1px solid rgba(99,118,210,.22);border-radius:24px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    h1{margin:0 0 8px;font-size:28px} p{color:#a8b4d4;line-height:1.7}
    label{display:block;margin:14px 0 6px;color:#cfe0ff;font-weight:700}
    input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid rgba(99,118,210,.25);background:#0b1222;color:#fff;box-sizing:border-box}
    button{margin-top:18px;width:100%;padding:15px 18px;border:none;border-radius:16px;background:linear-gradient(135deg,#3a52d8,#5b72f5,#8ba4ff);color:#fff;font-size:16px;font-weight:800;cursor:pointer}
    .err{background:rgba(240,80,104,.12);border:1px solid rgba(240,80,104,.28);padding:12px 14px;border-radius:14px;color:#ffb3bf;margin:10px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:640px){.grid{grid-template-columns:1fr}}
  </style>

<link rel="icon" href="/assets/icons/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/icon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/icon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/icon-180.png"/>
<link rel="manifest" href="/site.webmanifest"/>
<meta name="theme-color" content="#0a0e17"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="fb Bablushr F"/>

</head>
<body>
  <div class="card">
    <h1>تهيئة أول مرة</h1>
    <p>أنشئ حساب الأدمن وحدد رقم فودافون كاش ورقم واتساب اللي هيستقبل طلبات التفعيل. بعد الحفظ هتدخل مباشرة على لوحة الإدارة.</p>
    <?php if ($error): ?><div class="err"><?= fbbf_h($error) ?></div><?php endif; ?>
    <form method="post">
      <div class="grid">
        <div>
          <label>بريد الأدمن</label>
          <input type="email" name="admin_email" required>
        </div>
        <div>
          <label>اسم الموقع</label>
          <input type="text" name="site_name" value="fb Bablushr F" required>
        </div>
      </div>
      <div class="grid">
        <div>
          <label>كلمة المرور</label>
          <input type="password" name="admin_password" required>
        </div>
        <div>
          <label>تأكيد كلمة المرور</label>
          <input type="password" name="admin_password_confirm" required>
        </div>
      </div>
      <div class="grid">
        <div>
          <label>رقم واتساب للدعم</label>
          <input type="text" name="whatsapp" value="201277181217" required>
        </div>
        <div>
          <label>رقم فودافون كاش</label>
          <input type="text" name="wallet" value="01080236940" required>
        </div>
      </div>
      <button type="submit">إنشاء لوحة الإدارة</button>
    </form>
  </div>
</body>
</html>
