<?php
if (!function_exists('fbbf_support_whatsapp_number')) {
    return;
}
$wa = fbbf_support_whatsapp_number();
$tg = function_exists('fbbf_telegram_support_url') ? fbbf_telegram_support_url() : 'https://t.me/fbpublisher_bot';
$waLink = 'https://wa.me/' . $wa . '?text=' . rawurlencode('مرحباً، أحتاج دعم بخصوص fb Bablushr F');
?>
<style>
.fbbf-fab-wrap{position:fixed;bottom:20px;left:16px;z-index:9998;display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.fbbf-fab{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:999px;font-family:Cairo,Tahoma,sans-serif;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);transition:transform .2s,box-shadow .2s;max-width:min(92vw,280px)}
.fbbf-fab:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(0,0,0,.45)}
.fbbf-fab .ico{font-size:18px;line-height:1}
.fbbf-fab-wa{background:linear-gradient(135deg,#128C7E,#25D366);color:#fff}
.fbbf-fab-tg{background:linear-gradient(135deg,#1d4ed8,#2AABEE);color:#fff}
@media(max-width:480px){
  .fbbf-fab span.lbl{display:none}
  .fbbf-fab{padding:14px;border-radius:50%}
  .fbbf-fab-wrap{bottom:16px;left:12px}
}
</style>
<div class="fbbf-fab-wrap" aria-label="دعم مباشر">
  <a class="fbbf-fab fbbf-fab-wa" href="<?= htmlspecialchars($waLink, ENT_QUOTES, 'UTF-8') ?>" target="_blank" rel="noopener" title="دعم واتساب">
    <span class="ico">💬</span><span class="lbl">دعم واتساب</span>
  </a>
  <a class="fbbf-fab fbbf-fab-tg" href="<?= htmlspecialchars($tg, ENT_QUOTES, 'UTF-8') ?>" target="_blank" rel="noopener" title="بوت تيليجرام">
    <span class="ico">✈️</span><span class="lbl">تيليجرام</span>
  </a>
</div>
