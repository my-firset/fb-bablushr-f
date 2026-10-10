(function () {
  'use strict';

  var PLAN_KEY_MAP = {
    'الخطة الشهرية': 'monthly',
    'الخطة الربع سنوية': 'quarterly',
    'الخطة النصف سنوية': 'semiannual',
    'الخطة السنوية': 'annual'
  };
  var STORAGE_KEYS = ['fbpx_lp_email', 'fbpx_lp_token', 'fbpx_wallet_number', 'fbpx_support_whatsapp'];
  var API_BASE = 'https://faset.xo.je/api';
  var state = { name: '', price: '', key: 'monthly' };

  function setWalletDisplay(number) {
    var el = document.getElementById('vf-cash-num');
    if (el && number) el.textContent = number;
  }

  function openPayModal(planName, planPrice) {
    state.name = planName || '';
    state.price = String(planPrice || '');
    state.key = PLAN_KEY_MAP[planName] || 'monthly';
    var amountEl = document.getElementById('plan-amount-readonly');
    var planNameEl = document.getElementById('pay-modal-plan-name');
    var overlay = document.getElementById('pay-modal-overlay');
    var lsBtn = document.getElementById('pay-ls-btn');
    if (amountEl) amountEl.value = state.price + ' جنيه مصري';
    if (planNameEl) planNameEl.textContent = state.name;
    if (overlay) overlay.style.display = 'flex';
    if (lsBtn) lsBtn.style.display = 'none';
    chrome.storage.local.get(STORAGE_KEYS, function(r){ setWalletDisplay(r.fbpx_wallet_number || '01080236940'); });
  }

  function closePayModal() {
    var overlay = document.getElementById('pay-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function(resp){ return resp.json().then(function(data){ return { ok: resp.ok && data.ok, data: data || {} }; }).catch(function(){ return { ok: false, data: {} }; }); });
  }

  function sendPaymentDetailsToWhatsApp() {
    var snEl = document.getElementById('sender-number');
    var sender = snEl ? snEl.value.trim() : '';
    if (!sender) {
      alert('⚠️ اكتب رقم الهاتف اللي حولت منه أولاً.');
      return;
    }
    chrome.storage.local.get(STORAGE_KEYS, function(r) {
      var email = r.fbpx_lp_email || '';
      var token = r.fbpx_lp_token || '';
      if (!email || !token) {
        alert('⚠️ لازم تسجل دخول من الإضافة أولاً قبل طلب التفعيل.');
        return;
      }
      postJson('/payment-request.php', {
        email: email,
        token: token,
        sender_number: sender,
        plan_key: state.key,
        amount: state.price
      }).then(function(result) {
        if (!result.ok) {
          alert('⚠️ تعذر إرسال طلب التفعيل حالياً. حاول تاني بعد شوية.');
          return;
        }
        var wallet = result.data.wallet_number || r.fbpx_wallet_number || '01080236940';
        var waUrl = result.data.wa_url || ('https://wa.me/' + String(result.data.support_whatsapp || r.fbpx_support_whatsapp || '').replace(/\D+/g, ''));
        chrome.storage.local.set({ fbpx_wallet_number: wallet, fbpx_support_whatsapp: result.data.support_whatsapp || r.fbpx_support_whatsapp || '' });
        setWalletDisplay(wallet);
        if (waUrl) window.open(waUrl, '_blank');
        closePayModal();
      }).catch(function(){
        alert('⚠️ حصل خطأ أثناء حفظ طلب التفعيل.');
      });
    });
  }

  window.openPayModal = openPayModal;
  window.closePayModal = closePayModal;
  window.sendPaymentDetailsToWhatsApp = sendPaymentDetailsToWhatsApp;

  document.addEventListener('DOMContentLoaded', function () {
    chrome.storage.local.get(STORAGE_KEYS, function(r){ setWalletDisplay(r.fbpx_wallet_number || '01080236940'); });
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-pay-plan],[data-pay-close],[data-pay-send]') : null;
      if (!t) return;
      if (t.hasAttribute('data-pay-plan')) {
        openPayModal(t.getAttribute('data-pay-plan'), t.getAttribute('data-pay-price') || '');
      } else if (t.hasAttribute('data-pay-close')) {
        closePayModal();
      } else if (t.hasAttribute('data-pay-send')) {
        sendPaymentDetailsToWhatsApp();
      }
    });
    var overlay = document.getElementById('pay-modal-overlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closePayModal(); });
    var numEl = document.getElementById('vf-cash-num');
    if (numEl) numEl.addEventListener('dblclick', function () {
      var value = (numEl.textContent || '').trim();
      if (navigator.clipboard && value) navigator.clipboard.writeText(value).catch(function(){});
      numEl.classList.add('pm-copied');
      setTimeout(function(){ numEl.classList.remove('pm-copied'); }, 900);
    });
  });
}());
