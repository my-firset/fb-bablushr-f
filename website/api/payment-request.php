<?php
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();
fbbf_require_install_or_redirect();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fbbf_json_response(['ok' => false, 'message' => 'POST only'], 405);
}
// حد أقصى 5 طلبات دفع في الدقيقة لكل IP — كافي جدًا (المستخدم بيبعت طلب واحد أو اتنين عادةً).
fbbf_enforce_rate_limit('payment_request', 5, 60);

$data = fbbf_request_json();
$email = fbbf_normalize_email((string)($data['email'] ?? ''));
$token = (string)($data['token'] ?? '');
$sender = trim((string)($data['sender_number'] ?? ''));
$planKey = (string)($data['plan_key'] ?? 'monthly');
$amount = (string)($data['amount'] ?? '');
$plans = fbbf_plan_catalog();
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $token === '' || $sender === '' || !isset($plans[$planKey])) {
    fbbf_json_response(['ok' => false, 'message' => 'missing_fields'], 422);
}
$users = fbbf_users();
$idx = fbbf_find_user_index($users, $email);
if ($idx === -1 || !hash_equals((string)($users[$idx]['access_token'] ?? ''), $token)) {
    fbbf_json_response(['ok' => false, 'message' => 'unauthorized'], 401);
}
$config = fbbf_config();
$plan = $plans[$planKey];
$payments = fbbf_payments();
$payment = [
    'id' => bin2hex(random_bytes(8)),
    'email' => $email,
    'plan_key' => $planKey,
    'plan_label' => $plan['label'],
    'amount' => $amount ?: (string)$plan['price'],
    'sender_number' => $sender,
    'status' => 'pending',
    'created_at' => fbbf_now(),
    'approved_at' => 0,
];
$payments[] = $payment;
fbbf_save_payments($payments);
// رسالة واتساب كاملة وواضحة للأدمن
$msg = rawurlencode(
    "مرحباً، تم الدفع للاشتراك في fb Bablushr F\n\n"
    . "📧 الإيميل: " . $email . "\n"
    . "📦 الخطة: " . $payment['plan_label'] . "\n"
    . "💰 المبلغ: " . $payment['amount'] . " جنيه\n"
    . "📱 المحفظة المُرسل منها: " . $sender . "\n"
    . "🔢 رقم الطلب: " . $payment['id'] . "\n\n"
    . "أرجو تفعيل الخطة في أقرب وقت. شكراً لكم."
);
$wa = 'https://wa.me/' . preg_replace('/\D+/', '', (string)($config['support_whatsapp'] ?? '201277181217')) . '?text=' . $msg;
fbbf_json_response([
    'ok' => true,
    'message' => 'payment_request_saved',
    'wa_url' => $wa,
    'wallet_number' => $config['vodafone_cash_number'] ?? '',
    'support_whatsapp' => $config['support_whatsapp'] ?? '',
]);
