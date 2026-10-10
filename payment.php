<?php
/**
 * صفحة الدفع والتفعيل — طلب موثّق + إشعار أدمن
 * PHP 8.0–8.3 · InfinityFree
 */
require __DIR__ . '/includes/bootstrap.php';
fbbf_require_install_or_redirect();

$config = fbbf_config();
$plans = fbbf_plan_catalog();
$wa = preg_replace('/\D+/', '', (string)($config['support_whatsapp'] ?? '201277181217'));
$wallet = (string)($config['vodafone_cash_number'] ?? '01080236940');

$sessionEmail = '';
$sessionEmail = fbbf_current_user_email();

$error = '';
$success = '';
$paymentId = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'submit_payment') {
    $email = fbbf_normalize_email((string)($_POST['email'] ?? $sessionEmail));
    $sender = preg_replace('/\D+/', '', (string)($_POST['sender_number'] ?? ''));
    $planKey = (string)($_POST['plan_key'] ?? 'monthly');
    $amount = trim((string)($_POST['amount'] ?? ''));
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'أدخل بريدًا إلكترونيًا صحيحًا (نفس بريد حسابك).';
    } elseif (strlen($sender) < 10) {
        $error = 'أدخل رقم المحفظة التي حوّلتَ منها (10 أرقام على الأقل).';
    } elseif (!isset($plans[$planKey])) {
        $error = 'اختر خطة صحيحة.';
    } elseif (!fbbf_rate_limit_check('pay_form_' . $ip, 8, 300)) {
        $error = 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.';
    } else {
        $plan = $plans[$planKey];
        if ($amount === '') {
            $amount = (string)($plan['price'] ?? '');
        }

        $proofPath = '';
        if (!empty($_FILES['proof']['tmp_name']) && is_uploaded_file($_FILES['proof']['tmp_name'])) {
            $mime = 'image/jpeg';
            if (function_exists('finfo_open')) {
                $fi = finfo_open(FILEINFO_MIME_TYPE);
                if ($fi) {
                    $mime = (string)finfo_file($fi, $_FILES['proof']['tmp_name']);
                    finfo_close($fi);
                }
            } else {
                $mime = (string)($_FILES['proof']['type'] ?? 'image/jpeg');
            }
            $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
            if (!isset($allowed[$mime])) {
                $error = 'صورة الإثبات يجب أن تكون JPG أو PNG أو WebP.';
            } elseif (($_FILES['proof']['size'] ?? 0) > 4 * 1024 * 1024) {
                $error = 'حجم الصورة كبير جدًا (الحد 4 ميجا).';
            } else {
                $dir = FBBF_DATA . '/payment-proofs';
                if (!is_dir($dir)) {
                    @mkdir($dir, 0775, true);
                }
                $name = 'proof_' . bin2hex(random_bytes(8)) . '.' . $allowed[$mime];
                if (@move_uploaded_file($_FILES['proof']['tmp_name'], $dir . '/' . $name)) {
                    $proofPath = 'payment-proofs/' . $name;
                }
            }
        }

        if ($error === '') {
            $paymentId = bin2hex(random_bytes(8));
            $payments = fbbf_payments();
            $payments[] = [
                'id' => $paymentId,
                'email' => $email,
                'plan_key' => $planKey,
                'plan_label' => (string)($plan['label'] ?? $planKey),
                'amount' => $amount,
                'sender_number' => $sender,
                'wallet_to' => $wallet,
                'proof' => $proofPath,
                'status' => 'pending',
                'created_at' => fbbf_now(),
                'approved_at' => 0,
                'ip' => $ip,
            ];
            fbbf_save_payments($payments);

            $title = 'طلب دفع جديد';
            $body = $email . ' · ' . ($plan['label'] ?? $planKey) . ' · ' . $amount . ' ج · من ' . $sender;
            if (function_exists('fbbf_add_dashboard_notification')) {
                fbbf_add_dashboard_notification('payment', $title, $body, [
                    'email' => $email,
                    'plan_key' => $planKey,
                    'amount' => $amount,
                    'sender_number' => $sender,
                    'payment_id' => $paymentId,
                ]);
            }
            if (function_exists('fbbf_notify_owner')) {
                fbbf_notify_owner('payment', [
                    'email' => $email,
                    'device_id' => '',
                    'device_label' => 'دفع ' . ($plan['label'] ?? '') . ' · ' . $amount . 'ج من ' . $sender,
                ]);
            }
            if (function_exists('fbbf_audit_log')) {
                fbbf_audit_log('طلب دفع', $email, $planKey . ' ' . $amount);
            }

            $success = 'تم استلام طلبك بنجاح. سيُراجع الأدمن الطلب ويفعّل خطتك قريبًا. اضغط «تواصل الدعم» لإرسال إشعار فوري على واتساب.';
            $_SESSION['fbbf_last_payment_id'] = $paymentId;
            // حفظ بيانات الطلب لرسالة واتساب الكاملة (حتى لو الجلسة بدون إيميل)
            $_SESSION['fbbf_last_pay_email'] = $email;
            $_SESSION['fbbf_last_pay_plan'] = (string)($plan['label'] ?? $planKey);
            $_SESSION['fbbf_last_pay_amount'] = (string)$amount;
            $_SESSION['fbbf_last_pay_sender'] = $sender;
            fbbf_user_login_remember($email);
        }
    }
}

// رسالة واتساب كاملة وواضحة — أولوية لبيانات آخر طلب ناجح ثم الجلسة ثم النموذج
$waEmail = (string)($_SESSION['fbbf_last_pay_email'] ?? '');
if ($waEmail === '') {
    $waEmail = $sessionEmail !== '' ? $sessionEmail : (string)($_POST['email'] ?? '');
}
$waPlan = (string)($_SESSION['fbbf_last_pay_plan'] ?? '');
if ($waPlan === '') {
    $pk = (string)($_POST['plan_key'] ?? 'monthly');
    $waPlan = (string)(($plans[$pk]['label'] ?? '') ?: $pk);
}
$waAmount = (string)($_SESSION['fbbf_last_pay_amount'] ?? ($_POST['amount'] ?? ''));
$waSender = (string)($_SESSION['fbbf_last_pay_sender'] ?? ($_POST['sender_number'] ?? ''));
$waPayId = (string)($_SESSION['fbbf_last_payment_id'] ?? $paymentId ?? '');

$waLines = [
    'مرحباً، تم الدفع للاشتراك في fb Bablushr F',
    '',
    '📧 الإيميل: ' . ($waEmail !== '' ? $waEmail : 'غير مسجّل — يرجى كتابته يدوياً'),
    '📦 الخطة: ' . ($waPlan !== '' ? $waPlan : 'غير محددة'),
    '💰 المبلغ: ' . ($waAmount !== '' ? $waAmount . ' جنيه' : 'غير محدد'),
    '📱 المحفظة المُرسل منها: ' . ($waSender !== '' ? $waSender : 'غير محدد'),
];
if ($waPayId !== '') {
    $waLines[] = '🔢 رقم الطلب: ' . $waPayId;
}
$waLines[] = '';
$waLines[] = 'أرجو تفعيل الخطة في أقرب وقت. شكراً لكم.';
$waText = rawurlencode(implode("\n", $waLines));

$postPlan = (string)($_POST['plan_key'] ?? 'monthly');
$postAmount = (string)($_POST['amount'] ?? '');
$postSender = (string)($_POST['sender_number'] ?? '');
$postEmail = (string)($_POST['email'] ?? $sessionEmail);
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/assets/icons/favicon.ico" sizes="any"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/icon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/icon-16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/icon-180.png"/>
<link rel="manifest" href="/site.webmanifest"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="fb Bablushr F"/>

<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>الدفع والتفعيل — fb Bablushr F</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0e17; --card:#121826; --line:rgba(96,130,180,.28);
  --text:#f0f4ff; --muted:#a5b4d4; --accent:#4a6fa5; --cyan:#7eb6d9; --ok:#4ade80; --warn:#fbbf24; --err:#fb7185;
  --pg:linear-gradient(135deg,#3d5a8a,#6b7ab8,#7eb6d9);
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse 60% 40% at 85% 0%,rgba(96,130,180,.14),transparent),var(--bg);
  color:var(--text);font-family:Cairo,Tahoma,sans-serif;line-height:1.7;min-height:100vh}
.wrap{width:min(960px,calc(100% - 16px));margin:0 auto;padding:16px 0 48px}
.nav{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.brand{font-weight:900;color:#fff;text-decoration:none;font-size:17px}
.brand b{background:var(--pg);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.back{border:1px solid var(--line);padding:8px 14px;border-radius:12px;font-size:13px;color:#fff;text-decoration:none}
.hero{text-align:center;margin-bottom:18px}
.hero h1{margin:0 0 6px;font-size:clamp(26px,6vw,36px)}
.hero p{margin:0;color:var(--muted);font-size:14px}
.notice{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:#fde68a;
  border-radius:14px;padding:14px 16px;font-size:13px;margin-bottom:16px;line-height:1.65}
.card{background:rgba(12,18,34,.95);border:1px solid var(--line);border-radius:18px;padding:clamp(16px,4vw,26px);margin-bottom:14px}
.card h2{margin:0 0 12px;font-size:17px;color:var(--cyan)}
.wallets{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 4px}
.wicon{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;
  background:rgba(255,255,255,.04);border:1px solid var(--line);font-size:12px;font-weight:700;color:var(--text)}
.wicon span{width:10px;height:10px;border-radius:50%;display:inline-block}
.wallet-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.wallet-num{flex:1;min-width:160px;font-size:clamp(18px,5vw,26px);font-weight:900;letter-spacing:1px;color:var(--cyan);
  direction:ltr;text-align:center;padding:14px;background:#0d121c;border-radius:12px;border:1px solid var(--line)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 18px;min-height:48px;border-radius:14px;
  border:0;font:inherit;font-weight:900;cursor:pointer;text-decoration:none;color:#0a0e17;background:var(--pg);font-size:15px}
.btn-ghost{background:transparent;border:1px solid var(--line);color:#fff}
.btn-full{width:100%}
.btn-copy{padding:10px 14px;font-size:13px}
label{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:12px 0 6px}
input,select{width:100%;padding:14px;min-height:48px;border-radius:12px;border:1px solid var(--line);
  background:#0d121c;color:#fff;font:inherit;font-size:15px}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(96,130,180,.15)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:560px){.grid2{grid-template-columns:1fr}}
.alert{border-radius:12px;padding:14px;margin-bottom:14px;font-size:13px}
.alert-ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);color:var(--ok)}
.alert-err{background:rgba(251,113,133,.1);border:1px solid rgba(251,113,133,.3);color:var(--err)}
.hint{font-size:12px;color:var(--muted);margin-top:6px}
.actions{display:flex;flex-direction:column;gap:10px;margin-top:14px}
footer{margin-top:28px;padding-top:14px;border-top:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap;font-size:12px}
footer a{color:var(--muted);text-decoration:none}
#toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(40px);opacity:0;
  background:#121826;border:1px solid var(--ok);color:var(--ok);padding:12px 18px;border-radius:12px;
  font-weight:800;font-size:13px;transition:.25s;z-index:99;pointer-events:none}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="wrap">
  <nav class="nav">
    <a class="brand" href="index.php"><b>fb</b> Bablushr F</a>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="back" href="account.php">حسابي</a>
      <a class="back" href="index.php">الموقع</a>
    </div>
  </nav>

  <header class="hero">
    <h1>الدفع والتفعيل</h1>
    <p>حوّل من محفظتك ثم أرسل الطلب هنا — التفعيل من لوحة الأدمن بعد المراجعة</p>
  </header>

  <div class="notice">
    <strong>ضمان استرداد:</strong> عند عدم تفعيل الخطة بعد التحقق من التحويل، يمكن استرداد المبلغ كاملًا.
    لا ترسل أرقام بطاقات أو كلمات مرور عبر واتساب.
  </div>

  <?php if ($success): ?>
    <div class="alert alert-ok"><?= fbbf_h($success) ?></div>
    <div class="card">
      <h2>الخطوة التالية — أبلغ الدعم فورًا</h2>
      <p class="hint">اضغط الزر لفتح واتساب برسالة جاهزة ليتم التفعيل بسرعة.</p>
      <div class="actions">
        <a class="btn btn-full" href="https://wa.me/<?= fbbf_h($wa) ?>?text=<?= $waText ?>" target="_blank" rel="noopener">
          فتح واتساب الدعم · 01277181217
        </a>
        <a class="btn btn-ghost btn-full" href="account.php">العودة لحسابي</a>
      </div>
    </div>
  <?php else: ?>

  <?php if ($error): ?>
    <div class="alert alert-err"><?= fbbf_h($error) ?></div>
  <?php endif; ?>

  <div class="card">
    <h2>طرق الدفع — المحافظ الإلكترونية</h2>
    <p class="hint">حوّل إلى الرقم أدناه من أي محفظة مصرية:</p>
    <div class="wallets">
      <div class="wicon"><span style="background:#e60000"></span> فودافون كاش</div>
      <div class="wicon"><span style="background:#ff6600"></span> أورانج كاش</div>
      <div class="wicon"><span style="background:#4caf50"></span> اتصالات كاش</div>
      <div class="wicon"><span style="background:#6b7ab8"></span> WE Pay</div>
    </div>
    <div class="wallet-row">
      <div class="wallet-num" id="walletNum"><?= fbbf_h($wallet) ?></div>
      <button type="button" class="btn btn-copy" onclick="copyWallet()">نسخ الرقم</button>
    </div>
    <p class="hint">تحقق من الرقم قبل التحويل. بعد التحويل املأ النموذج.</p>
  </div>

  <div class="card">
    <h2>إرسال طلب التفعيل</h2>
    <form method="post" enctype="multipart/form-data">
      <input type="hidden" name="action" value="submit_payment">

      <label>بريد حسابك</label>
      <input type="email" name="email" required value="<?= fbbf_h($postEmail) ?>" placeholder="same@email.com">

      <label>رقم المحفظة التي حوّلتَ منها</label>
      <input type="text" name="sender_number" required inputmode="numeric" placeholder="01xxxxxxxxx" value="<?= fbbf_h($postSender) ?>">

      <div class="grid2">
        <div>
          <label>الخطة</label>
          <select name="plan_key" id="planKey" onchange="syncAmount()">
            <?php foreach ($plans as $key => $plan): ?>
              <option value="<?= fbbf_h($key) ?>" data-price="<?= fbbf_h((string)($plan['price'] ?? '')) ?>"
                <?= $postPlan === $key ? 'selected' : '' ?>>
                <?= fbbf_h((string)($plan['label'] ?? $key)) ?> — <?= fbbf_h((string)($plan['price'] ?? '')) ?> ج
              </option>
            <?php endforeach; ?>
          </select>
        </div>
        <div>
          <label>المبلغ المحوَّل (جنيه)</label>
          <input type="text" name="amount" id="amountField" inputmode="decimal" value="<?= fbbf_h($postAmount) ?>" placeholder="99">
        </div>
      </div>

      <label>صورة إثبات التحويل (مستحسن)</label>
      <input type="file" name="proof" accept="image/jpeg,image/png,image/webp,image/gif">

      <div class="actions">
        <button type="submit" class="btn btn-full">إتمام طلب الدفع والتفعيل</button>
      </div>
      <p class="hint">بعد الإرسال يظهر تأكيد هنا، ويصل إشعار للأدمن في لوحة التحكم مع بياناتك.</p>
    </form>
  </div>

  <div class="card">
    <h2>بعد الدفع مباشرة</h2>
    <a class="btn btn-ghost btn-full" href="https://wa.me/<?= fbbf_h($wa) ?>?text=<?= $waText ?>" target="_blank" rel="noopener">
      زر الدعم الفوري على واتساب
    </a>
  </div>
  <?php endif; ?>

  <footer>
    <a href="support.php">الدعم</a>
    <a href="privacy.php">الخصوصية</a>
    <a href="terms.php">الشروط</a>
    <a href="account.php">حسابي</a>
  </footer>
</div>
<div id="toast">تم نسخ الرقم</div>
<script>
function copyWallet(){
  var n = document.getElementById('walletNum').textContent.trim();
  if(navigator.clipboard){ navigator.clipboard.writeText(n); }
  else {
    var i=document.createElement('input'); i.value=n; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove();
  }
  var t=document.getElementById('toast'); t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2000);
}
function syncAmount(){
  var s=document.getElementById('planKey');
  if(!s) return;
  var opt=s.options[s.selectedIndex];
  var p=opt.getAttribute('data-price')||'';
  var f=document.getElementById('amountField');
  if(f) f.value=p;
}
syncAmount();
</script>


<div style="margin:16px 0;padding:14px;border-radius:14px;border:1px solid rgba(37,211,102,.3);background:rgba(37,211,102,.07)">
  <div style="font-weight:900;margin-bottom:6px">بعد التحويل — أبلغنا فورًا</div>
  <p style="font-size:12.5px;line-height:1.65;margin:0 0 10px">اضغط لإرسال واتساب جاهز ببيانات اشتراكك.</p>
  <?php
    $em = function_exists('fbbf_current_user_email') ? fbbf_current_user_email() : '';
    $waPay = function_exists('fbbf_user_whatsapp_ready_link')
      ? fbbf_user_whatsapp_ready_link($em !== '' ? $em : 'غير مسجل', '', 'الدفع وطلب تفعيل الاشتراك')
      : 'https://wa.me/201277181217';
  ?>
  <a href="<?= fbbf_h($waPay) ?>" target="_blank" rel="noopener" class="btn" style="display:inline-flex;gap:8px;align-items:center;padding:12px 16px;border-radius:12px;background:linear-gradient(135deg,#128C7E,#25D366);color:#fff;text-decoration:none;font-weight:800">💬 إبلاغ الإدارة بالدفع</a>
</div>

<?php if (file_exists(__DIR__ . '/includes/floating-support.php')) include __DIR__ . '/includes/floating-support.php'; ?>
</body>
</html>
