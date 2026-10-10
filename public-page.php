<?php
/**
 * صفحات عامة: الشروط · الخصوصية · الدعم
 * PHP 8.0–8.3
 */
require __DIR__ . '/includes/bootstrap.php';
$config = fbbf_config();
$page = (string)($_GET['page'] ?? 'support');
$allowed = ['terms', 'privacy', 'support'];
if (!in_array($page, $allowed, true)) {
    $page = 'support';
}

$wa = preg_replace('/\D+/', '', (string)($config['support_whatsapp'] ?? '201277181217'));
$wallet = (string)($config['vodafone_cash_number'] ?? '');
$siteName = 'fb Bablushr F';

$titles = [
    'terms' => 'شروط الاستخدام',
    'privacy' => 'سياسة الخصوصية',
    'support' => 'الدعم والمساعدة',
];
$title = $titles[$page];
?>
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= fbbf_h($title) ?> — <?= fbbf_h($siteName) ?></title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0a0e17; --card:#121826; --line:rgba(96,130,180,.28);
  --text:#f0f4ff; --muted:#a5b4d4; --accent:#4a6fa5; --cyan:#7eb6d9; --ok:#4ade80;
  --pg:linear-gradient(135deg,#3d5a8a,#6b7ab8,#7eb6d9);
}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse 60% 40% at 80% 0%,rgba(96,130,180,.14),transparent),var(--bg);
  color:var(--text);font-family:Cairo,Tahoma,sans-serif;line-height:1.75;min-height:100vh}
.wrap{width:min(880px,calc(100% - 32px));margin:0 auto;padding:24px 0 48px}
.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
.brand{font-weight:900;color:#fff;text-decoration:none;font-size:18px}
.brand b{background:var(--pg);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.back{border:1px solid var(--line);padding:8px 14px;border-radius:12px;font-size:13px;color:#fff;text-decoration:none}
.back:hover{border-color:var(--accent)}
.hero{text-align:center;margin-bottom:28px}
.hero h1{margin:0 0 8px;font-size:clamp(26px,4vw,36px)}
.hero p{margin:0;color:var(--muted);font-size:14px}
.card{background:rgba(12,18,34,.92);border:1px solid var(--line);border-radius:20px;padding:24px 26px;margin-bottom:16px}
.card h2{margin:0 0 12px;font-size:18px;color:var(--cyan)}
.card h3{margin:18px 0 8px;font-size:15px;color:#fff}
.card p,.card li{color:var(--muted);font-size:14px}
.card ul,.card ol{padding-right:20px;margin:8px 0}
.card a{color:var(--cyan)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;border-radius:12px;
  background:var(--pg);color:#0a0e17;font-weight:900;text-decoration:none;border:0;font-family:inherit;cursor:pointer}
.btn-ghost{background:transparent;border:1px solid var(--line);color:#fff}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.actions .btn{flex:1 1 140px;min-width:140px;text-align:center}
footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);display:flex;gap:14px;flex-wrap:wrap;font-size:12px}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--cyan)}
@media(max-width:480px){
  .card{padding:16px}
  .actions .btn{flex:1 1 100%}
  .wallet{font-size:18px}
}
.wallet{font-size:22px;font-weight:900;letter-spacing:1px;color:var(--cyan);direction:ltr;text-align:center;
  padding:14px;background:#0d121c;border-radius:14px;border:1px solid var(--line)}
</style>
</head>
<body>
<div class="wrap">
  <nav class="nav">
    <a class="brand" href="index.php"><b>fb</b> Bablushr F</a>
    <a class="back" href="index.php">العودة للموقع</a>
  </nav>
  <header class="hero">
    <h1><?= fbbf_h($title) ?></h1>
    <p><?= fbbf_h($siteName) ?> · faset.xo.je</p>
  </header>

<?php if ($page === 'terms'): ?>
  <section class="card">
    <h2>1) قبول الشروط</h2>
    <p>باستخدامك لموقع <?= fbbf_h($siteName) ?> أو تحميل الإضافة أو إنشاء حساب، فإنك توافق على هذه الشروط. إن لم توافق، يُرجى عدم استخدام الخدمة.</p>
    <h2>2) وصف الخدمة</h2>
    <p>الإضافة أداة مساعدة للنشر وإدارة المحتوى على فيسبوك ضمن الحدود التي يسمح بها حسابك والمتصفح. أنت المسؤول عن محتوى ما تنشره وعن احترام سياسات فيسبوك والقوانين المحلية.</p>
    <h2>3) الحسابات والتجربة</h2>
    <ul>
      <li>التجربة المجانية محدودة المدة حسب إعدادات لوحة التحكم.</li>
      <li>يحق للإدارة إيقاف الحساب عند إساءة الاستخدام أو محاولة الاختراق.</li>
      <li>بيانات الدخول سرية؛ لا تشارك كلمة المرور مع أحد.</li>
    </ul>
    <h2>4) الاشتراكات والدفع</h2>
    <p>الاشتراك يُفعَّل بعد التحقق من الدفع. التحويلات عبر فودافون كاش أو الوسائل المعروضة في صفحة الدفع. لا تُرسل أرقام بطاقات بنكية عبر واتساب.</p>
    <h2>5) إخلاء المسؤولية</h2>
    <p>الخدمة تُقدَّم «كما هي». لا نضمن نتائج تسويقية محددة، ولا نتحمل مسؤولية حظر حسابات ناتج عن مخالفة سياسات المنصات أو الاستخدام المفرط.</p>
    <h2>6) التعديلات</h2>
    <p>قد نحدّث هذه الشروط من وقت لآخر. استمرار الاستخدام بعد التحديث يعني الموافقة على النسخة الأحدث.</p>
  </section>

<?php elseif ($page === 'privacy'): ?>
  <section class="card">
    <h2>1) ما نجمعه</h2>
    <ul>
      <li>البريد الإلكتروني وكلمة المرور المشفّرة عند التسجيل.</li>
      <li>بيانات الاشتراك وحالة التجربة.</li>
      <li>معرّفات الأجهزة المرتبطة بالحساب (عند استخدام الإضافة) لمنع إساءة التجربة المجانية.</li>
      <li>سجلات تقنية محدودة (مثل وقت آخر دخول) لتحسين الأمان والدعم.</li>
    </ul>
    <h2>2) ما لا نجمعه</h2>
    <p>لا نطلب كلمة مرور فيسبوك على السيرفر، ولا نبيع بياناتك لأطراف ثالثة لأغراض إعلانية.</p>
    <h2>3) التخزين والحماية</h2>
    <p>البيانات تُحفظ على استضافة الموقع في ملفات محمية. كلمات المرور تُخزَّن باستخدام دوال التجزئة الآمنة في PHP. مفاتيح Cloudflare وGoogle تُحفظ في إعدادات السيرفر ولا تُعرض للعامة.</p>
    <h2>4) تسجيل الدخول عبر Google</h2>
    <p>عند استخدام Google OAuth نحصل فقط على البريد والاسم الأساسي للتحقق من الهوية، وفق صلاحيات Google التي توافق عليها.</p>
    <h2>5) حقوقك</h2>
    <p>يمكنك طلب تعديل بياناتك من صفحة الحساب، أو التواصل مع الدعم لحذف الحساب عند الإمكان مع مراعاة السجلات القانونية الضرورية.</p>
    <h2>6) التواصل</h2>
    <p>للاستفسارات المتعلقة بالخصوصية: واتساب الدعم أو صفحة <a href="support.php">الدعم</a>.</p>
  </section>

<?php else: /* support */ ?>
  <section class="card">
    <h2>تواصل سريع</h2>
    <p>فريق الدعم يساعدك في التثبيت، التفعيل، ومشاكل الدخول.</p>
    <div class="actions">
      <a class="btn" href="https://wa.me/<?= fbbf_h($wa) ?>" target="_blank" rel="noopener">فتح واتساب</a>
      <a class="btn btn-ghost" href="payment.php">صفحة الدفع والتفعيل</a>
      <a class="btn btn-ghost" href="account.php">حسابي</a>
      <a class="btn btn-ghost" href="login-download.php">تحميل الإضافة</a>
    </div>
  </section>
  <section class="card">
    <h2>مشاكل شائعة</h2>
    <h3>لا يظهر التحديث</h3>
    <p>افتح <code>chrome://extensions</code> أو <code>kiwi://extensions</code> → Developer mode → Update.</p>
    <h3>انتهت التجربة</h3>
    <p>ادخل <a href="payment.php">صفحة الدفع</a> أو أرسل صورة التحويل عبر واتساب مع بريد حسابك.</p>
    <h3>سجّلت بـ Google ولا أستطيع الدخول للإضافة</h3>
    <p>من <a href="account.php">حسابي</a> عيّن كلمة مرور، ثم استخدم نفس الإيميل وكلمة المرور داخل الإضافة.</p>
    <?php if ($wallet !== ''): ?>
    <h3>رقم فودافون كاش</h3>
    <div class="wallet"><?= fbbf_h($wallet) ?></div>
    <?php endif; ?>
  </section>
<?php endif; ?>

  <footer>
    <a href="privacy.php">الخصوصية</a>
    <a href="terms.php">الشروط</a>
    <a href="support.php">الدعم</a>
    <a href="payment.php">الدفع</a>
    <span>© <?= date('Y') ?> <?= fbbf_h($siteName) ?></span>
  </footer>
</div>
</body>
</html>
