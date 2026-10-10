'use strict';

var LP_API_BASE = 'https://faset.xo.je/api';
var LP_KEY = 'fbpx_lp_session';
var LP_EMAIL_KEY = 'fbpx_lp_email';
var LP_TOKEN_KEY = 'fbpx_lp_token';
var LP_TRIAL_KEY = 'fbpx_trial_ends_at';
var LP_TRIAL_STARTED_KEY = 'fbpx_trial_started_at';
var LP_SUB_KEY = 'fbpx_subscription_ends_at';
var LP_STATUS_KEY = 'fbpx_access_status';
var LP_LAST_VER_KEY = 'fbpx_last_verified_at';
var LP_WALLET_KEY = 'fbpx_wallet_number';
var LP_WA_KEY = 'fbpx_support_whatsapp';
var LP_ACCESS_KEY = 'fbpx_access_granted';
var LP_DEVICE_KEY = 'fbpx_device_id';
var LP_DEVICE_LABEL_KEY = 'fbpx_device_label';
var lp_pollHandle = null;
var lpGateBootPromise = null;

function lp_storageGet(keys) { return new Promise(function(resolve){ chrome.storage.local.get(keys, resolve); }); }
function lp_storageSet(obj) { return new Promise(function(resolve){ chrome.storage.local.set(obj, resolve); }); }
function lp_storageRemove(keys) { return new Promise(function(resolve){ chrome.storage.local.remove(keys, resolve); }); }
function lp_normalizeTimestamp(value) {
  var n = Number(value || 0);
  if (!isFinite(n) || n <= 0) return 0;
  return n < 1000000000000 ? n * 1000 : n;
}
function lp_randomId(prefix) {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return String(prefix || 'dev') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    }
  } catch (e) {}
  return String(prefix || 'dev') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * بصمة متصفح تقريبية — مش بديل عن device_id (اللي بيفضل المُعرّف الأساسي)،
 * لكن طبقة إضافية أقوى ضد تكرار التجربة المجانية: بتعتمد على خصائص
 * المتصفح/الجهاز الفعلية (user agent، دقة الشاشة، المنطقة الزمنية، عدد
 * الأنوية، المنصة) اللي بتتغيّر أقل بكتير من device_id العشوائي حتى لو
 * المستخدم مسح بيانات الإضافة أو أعاد تثبيتها. مش مثالية (متصفح incognito
 * أو تعديل user-agent يدوي ممكن يتحايلوا عليها)، لكنها تحسين حقيقي.
 * الحساب بيحصل هنا بس، والسيرفر بيستقبل الناتج ويعمل hash إضافي بنفسه —
 * النص الخام نفسه ملوش قيمة حساسة، مجرد إشارة تعريف.
 */
function lp_computeFingerprint() {
  try {
    var parts = [
      navigator.userAgent || '',
      navigator.language || '',
      String((navigator.languages || []).join(',')),
      String(screen.width) + 'x' + String(screen.height),
      String(screen.colorDepth || ''),
      String(new Date().getTimezoneOffset()),
      String(navigator.hardwareConcurrency || ''),
      String(navigator.platform || '')
    ];
    return parts.join('|');
  } catch (e) { return ''; }
}
function lp_detectDeviceLabel() {
  try {
    var ua = (navigator.userAgent || '').toLowerCase();
    var platform = (navigator.platform || '').toLowerCase();
    var isAndroid = /android/.test(ua);
    var isIOS = /iphone|ipad|ipod/.test(ua);
    var isWin = /windows/.test(ua) || /win/.test(platform);
    var isMac = /mac os|macintosh/.test(ua) || /mac/.test(platform);
    var isLinux = /linux/.test(ua) && !isAndroid;
    var form = (isAndroid || isIOS || /mobile/.test(ua)) ? 'هاتف' : 'كمبيوتر';
    if (/ipad|tablet/.test(ua)) form = 'تابلت';
    var browser = 'Chrome';
    if (/kiwi/.test(ua)) browser = 'Kiwi';
    else if (/lemur/.test(ua)) browser = 'Lemur';
    else if (/quetta/.test(ua)) browser = 'Quetta';
    else if (/edg\//.test(ua)) browser = 'Edge';
    else if (/firefox|fxios/.test(ua)) browser = 'Firefox';
    else if (/brave/.test(ua)) browser = 'Brave';
    else if (/safari/.test(ua) && !/chrome|crios|chromium/.test(ua)) browser = 'Safari';
    var os = isAndroid ? 'Android' : (isIOS ? 'iOS' : (isWin ? 'Windows' : (isMac ? 'macOS' : (isLinux ? 'Linux' : 'OS'))));
    return browser + ' · ' + os + ' · ' + form;
  } catch (e) {
    return 'متصفح · جهاز';
  }
}
async function lp_getOrCreateDeviceIdentity() {
  var stored = await lp_storageGet([LP_DEVICE_KEY, LP_DEVICE_LABEL_KEY]);
  var deviceId = stored[LP_DEVICE_KEY] || '';
  var deviceLabel = stored[LP_DEVICE_LABEL_KEY] || '';
  if (!deviceId) deviceId = lp_randomId('dev');
  // حدّث التسمية دائمًا حسب الجهاز الحالي (لا تثبت "Kiwi Android" للأبد)
  var detected = lp_detectDeviceLabel();
  if (!deviceLabel || deviceLabel === 'Kiwi Android' || deviceLabel.indexOf('·') === -1) {
    deviceLabel = detected;
  } else {
    // حدّث بهدوء لو تغيّر نوع الجهاز
    deviceLabel = detected;
  }
  await lp_storageSet((function(){ var data = {}; data[LP_DEVICE_KEY] = deviceId; data[LP_DEVICE_LABEL_KEY] = deviceLabel; return data; })());
  return { deviceId: deviceId, deviceLabel: deviceLabel };
}

function lp_translateError(code, isRegister) {
  var map = {
    invalid_email: '⚠️ اكتب بريد إلكتروني صحيح.',
    weak_password: '⚠️ كلمة المرور لازم تكون 4 أحرف على الأقل.',
    email_exists: '⚠️ الإيميل ده مسجل بالفعل. استخدم تسجيل الدخول.',
    user_not_found: '⚠️ المستخدم غير موجود. اعمل إنشاء حساب أولاً.',
    wrong_password: '⚠️ كلمة المرور غير صحيحة.',
    password_not_set: '⚠️ الحساب بدون كلمة سر (Google). اضبط كلمة سر من حسابي على الموقع أو سجّل كإنشاء حساب.',
    timeout: '⚠️ الاتصال أخذ وقت طويل. تحقق من الإنترنت وحاول تاني.',
    network_error: '⚠️ تعذر الاتصال بالسيرفر. تحقق من الإنترنت.',
    blocked: '⛔ الحساب محظور. تواصل مع الدعم.',
    invalid_token: '⚠️ انتهت جلسة الدخول. سجّل دخولك مرة أخرى (مرة واحدة فقط).',
    unknown_device: '⚠️ الجهاز غير مربوط بعد. سجّل دخولك مرة واحدة لربط الجهاز.',
    expired: '⚠️ انتهت التجربة أو الاشتراك. جدّد من صفحة الدفع على الموقع.',
    extension_paused_by_admin: '⚠️ تم إيقاف الإضافة مؤقتًا من الإدارة.',
    missing_credentials: '⚠️ بيانات الجلسة ناقصة.',
    missing_fields: '⚠️ أكمل كل البيانات المطلوبة.',
    unauthorized: '⚠️ الجلسة غير صالحة. سجّل دخول من جديد.',
    // كان بيرجع رسالة عامة مبهمة قبل كده — ده بيحصل غالبًا لما المستخدم يمسح
    // الإضافة ويعيد تثبيتها (بيولّد جهاز جديد)، فيتصادم مع حد الأجهزة المسموح
    // بيه لحسابه. الرسالة الواضحة دي بتوجهه للحل الصح بدل ما يحس إنه "معلّق".
    device_limit_reached: '⚠️ وصلت للحد الأقصى من الأجهزة المسموح بيها لحسابك. لو مسحت الإضافة وثبّتها تاني، ده بيتحسب جهاز جديد. تواصل مع الدعم لإعادة ضبط جهازك القديم.',
    device_trial_used: '⚠️ هذا الجهاز استخدم تجربته المجانية من قبل بحساب آخر. لو ده حسابك الأصلي، سجّل دخول بدل إنشاء حساب جديد.'
  };
  return map[code] || (isRegister ? '⚠️ تعذر إنشاء الحساب حالياً.' : '⚠️ تعذر تسجيل الدخول حالياً.');
}

function lp_applyPaymentInfo(payload) {
  var wallet = payload && payload.wallet_number ? String(payload.wallet_number) : '';
  var wa = payload && payload.support_whatsapp ? String(payload.support_whatsapp) : '';
  if (wallet) {
    var el = document.getElementById('vf-cash-num');
    if (el) el.textContent = wallet;
  }
  var data = {};
  if (wallet) data[LP_WALLET_KEY] = wallet;
  if (wa) data[LP_WA_KEY] = wa;
  if (Object.keys(data).length) chrome.storage.local.set(data);
}

async function lp_fetchJson(path, bodyObj) {
  // مهلة 20 ثانية — يمنع تجمّد زر الدخول على الشبكات الضعيفة
  var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = controller ? setTimeout(function(){ try { controller.abort(); } catch(_){} }, 20000) : null;
  var resp;
  try {
    resp = await fetch(LP_API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj || {}),
      signal: controller ? controller.signal : undefined
    });
  } catch (netErr) {
    if (timer) clearTimeout(timer);
    var e = new Error((netErr && netErr.name === 'AbortError') ? 'timeout' : 'network_error');
    e.code = e.message;
    throw e;
  }
  if (timer) clearTimeout(timer);
  var data = {};
  try { data = await resp.json(); } catch (_) {}
  if (!resp.ok || !data.ok) {
    var err = new Error((data && (data.message_ar || data.message)) || ('http_' + resp.status));
    err.code = (data && (data.message_ar || data.message)) || ('http_' + resp.status);
    throw err;
  }
  return data;
}

async function lp_getLoginState() {
  var r = await lp_storageGet([LP_KEY, LP_EMAIL_KEY, LP_TOKEN_KEY, LP_TRIAL_KEY, LP_TRIAL_STARTED_KEY, LP_SUB_KEY, LP_STATUS_KEY, LP_LAST_VER_KEY, LP_WALLET_KEY, LP_WA_KEY, LP_ACCESS_KEY, LP_DEVICE_KEY, LP_DEVICE_LABEL_KEY]);
  return {
    loggedIn: r[LP_KEY] === true,
    email: r[LP_EMAIL_KEY] || '',
    token: r[LP_TOKEN_KEY] || '',
    trialEndsAt: lp_normalizeTimestamp(r[LP_TRIAL_KEY]),
    trialStartedAt: lp_normalizeTimestamp(r[LP_TRIAL_STARTED_KEY]),
    subscriptionEndsAt: lp_normalizeTimestamp(r[LP_SUB_KEY]),
    status: r[LP_STATUS_KEY] || '',
    lastVerifiedAt: lp_normalizeTimestamp(r[LP_LAST_VER_KEY]),
    walletNumber: r[LP_WALLET_KEY] || '',
    supportWhatsApp: r[LP_WA_KEY] || '',
    accessGranted: r[LP_ACCESS_KEY] === true,
    deviceId: r[LP_DEVICE_KEY] || '',
    deviceLabel: r[LP_DEVICE_LABEL_KEY] || ''
  };
}

function lp_deriveTrialEndsAt(state) {
  var direct = lp_normalizeTimestamp(state && state.trialEndsAt || state && state.trial_ends_at || 0);
  if (direct > 0) return direct;
  var start = lp_normalizeTimestamp(state && state.trialStartedAt || state && state.trial_started_at || 0);
  if (start > 0) return start + (3 * 24 * 60 * 60 * 1000);
  return 0;
}

async function lp_saveLoginState(payload) {
  var device = await lp_getOrCreateDeviceIdentity();
  var trialEndsAt = lp_normalizeTimestamp(payload.trial_ends_at || payload.trialEndsAt || 0);
  var trialStartedAt = lp_normalizeTimestamp(payload.trial_started_at || payload.trialStartedAt || 0);
  if (!trialEndsAt && trialStartedAt) trialEndsAt = trialStartedAt + (3 * 24 * 60 * 60 * 1000);
  await lp_storageSet({
    fbpx_lp_session: true,
    fbpx_lp_email: payload.email || '',
    fbpx_lp_token: payload.token || '',
    fbpx_trial_started_at: trialStartedAt,
    fbpx_trial_ends_at: trialEndsAt,
    fbpx_subscription_ends_at: lp_normalizeTimestamp(payload.subscription_expires_at || payload.subscriptionEndsAt || 0),
    fbpx_access_status: payload.status || '',
    fbpx_last_verified_at: Date.now(),
    fbpx_wallet_number: payload.wallet_number || '',
    fbpx_support_whatsapp: payload.support_whatsapp || '',
    fbpx_access_granted: !!payload.access_granted,
    fbpx_device_id: payload.device_id || device.deviceId,
    fbpx_device_label: payload.device_label || device.deviceLabel
  });
  lp_applyPaymentInfo(payload);
}

async function lp_clearLoginState() {
  await lp_storageRemove([LP_KEY, LP_EMAIL_KEY, LP_TOKEN_KEY, LP_TRIAL_KEY, LP_TRIAL_STARTED_KEY, LP_SUB_KEY, LP_STATUS_KEY, LP_LAST_VER_KEY, LP_WALLET_KEY, LP_WA_KEY, LP_ACCESS_KEY]);
}

function lp_setStatus(msg, type) {
  var el = document.getElementById('lpStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'lp-status' + (type ? ' ' + type : '');
}

function lp_showLanding() {
  var appEl = document.querySelector('.app');
  var landEl = document.getElementById('landingPage');
  if (appEl) appEl.style.display = 'none';
  if (landEl) landEl.style.display = 'flex';
}

function lp_showApp(withAnimation) {
  var appEl = document.querySelector('.app');
  var landEl = document.getElementById('landingPage');
  if (landEl) landEl.style.display = 'none';
  if (!appEl) return;
  appEl.style.display = 'flex';
  if (withAnimation) {
    appEl.classList.add('app-fade-in');
    setTimeout(function(){ appEl.classList.remove('app-fade-in'); }, 400);
  }
  setTimeout(lp_bindLogout, 120);
  setTimeout(lp_showTrialBar, 200);
  lp_startRemoteStatusPolling();
}


function lp_renderAnnouncements(list) {
  try {
    var host = document.getElementById('fbbfAnnBar');
    if (!host) {
      host = document.createElement('div');
      host.id = 'fbbfAnnBar';
      host.style.cssText = 'display:none;margin:8px 10px 0;padding:10px 12px;border-radius:12px;border:1px solid rgba(125,211,252,.35);background:rgba(15,42,60,.95);color:#e8f4ff;font-size:12px;line-height:1.55;direction:rtl;text-align:right';
      var app = document.querySelector('.app') || document.body;
      app.insertBefore(host, app.firstChild);
    }
    var items = Array.isArray(list) ? list.filter(function(a){ return a && !a.seen; }) : [];
    if (!items.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
    var a = items[0];
    var type = a.type || 'info';
    if (type === 'urgent') host.style.background = 'rgba(127,29,29,.95)';
    else if (type === 'update') host.style.background = 'rgba(30,58,95,.95)';
    else host.style.background = 'rgba(15,42,60,.95)';
    var cta = '';
    if (a.cta_url) {
      cta = '<div style="margin-top:6px"><a href="'+String(a.cta_url).replace(/"/g,'')+'" target="_blank" rel="noopener" style="color:#7dd3fc;font-weight:700">'+(a.cta_label || 'تفاصيل')+'</a></div>';
    }
    host.innerHTML = '<div style="font-weight:800;margin-bottom:4px">📢 '+(a.title || 'إشعار')+'</div><div>'+(a.body || '')+'</div>'+cta+
      '<button type="button" id="fbbfAnnDismiss" style="margin-top:8px;background:transparent;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:11px">إخفاء</button>';
    host.style.display = 'block';
    var btn = document.getElementById('fbbfAnnDismiss');
    if (btn) btn.onclick = function(){
      host.style.display = 'none';
      try {
        chrome.storage.local.get(['fbpx_lp_email','fbpx_lp_token'], function(s){
          if (!s.fbpx_lp_email || !s.fbpx_lp_token || !a.id) return;
          fetch('https://faset.xo.je/api/announcements.php', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ action:'mark_seen', email:s.fbpx_lp_email, token:s.fbpx_lp_token, id:a.id })
          }).catch(function(){});
        });
      } catch(e){}
    };
  } catch (e) {}
}

async function lp_verifyRemoteAccess() {
  var s = await lp_getLoginState();
  var device = await lp_getOrCreateDeviceIdentity();
  if (!s.email || !s.token) throw new Error('missing_credentials');
  try {
    var data = await lp_fetchJson('/check.php', {
      email: s.email,
      token: s.token,
      device_id: s.deviceId || device.deviceId,
      device_label: s.deviceLabel || device.deviceLabel,
      extension_version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''
    });
    data.email = s.email;
    data.token = s.token;
    await lp_saveLoginState(data);
    try { await lp_storageSet({ fbpx_soft_fail_streak: 0 }); } catch (e0) {}
    return data;
  } catch (err) {
    var code = String((err && (err.code || err.message)) || '');
    var soft = /user_not_found|storage_unavailable|too_many_requests|http_503|http_429|network_error|timeout/i.test(code);
    if (soft && (s.accessGranted || s.loggedIn)) {
      // لا تمسح الجلسة — ردّ اصطناعي يبقي الوصول المحلي
      var streak = 0;
      try {
        var st = await lp_storageGet(['fbpx_soft_fail_streak']);
        streak = (parseInt(st.fbpx_soft_fail_streak, 10) || 0) + 1;
        await lp_storageSet({ fbpx_soft_fail_streak: streak });
      } catch (e1) {}
      // بعد 5 فشل متتالٍ فقط نعرض تنبيه دون مسح التوكن
      return {
        ok: true,
        access_granted: true,
        status: s.status || 'active',
        soft: true,
        soft_streak: streak,
        email: s.email,
        token: s.token,
        trial_ends_at: s.trialEndsAt,
        subscription_expires_at: s.subscriptionEndsAt,
        message: 'soft_storage',
        message_ar: 'تحقق مؤقت من السيرفر — نكمل بالجلسة المحلية'
      };
    }
    throw err;
  }
}

function lp_prefillEmail(value) {
  var emailInput = document.getElementById('lpEmail');
  if (emailInput && value) emailInput.value = value;
}

async function lp_initGate() {
  if (lpGateBootPromise) return lpGateBootPromise;
  lpGateBootPromise = (async function(){
    var appEl = document.querySelector('.app');
    if (appEl) appEl.style.display = 'none';
    lp_setupForm();
    var s = await lp_getLoginState();
    lp_prefillEmail(s.email || '');
    lp_applyPaymentInfo(s);

    // جلسة ناقصة فقط: لو فيه إيميل بدون توكن نعرض الدخول مع الإيميل محفوظ
    if (s.loggedIn && (!s.email || !s.token)) {
      lp_showLanding();
      lp_setStatus('⚠️ الجلسة ناقصة — سجّل دخول مرة واحدة (المنشور المحلي محفوظ).', 'error');
      return;
    }

    if (s.email && s.token) {
      try {
        var check = await lp_verifyRemoteAccess();
        if (check.access_granted) {
          lp_setStatus('', '');
          lp_showApp(false);
          lp_showTrialBar();
          lp_renderAnnouncements(check.announcements || []);
          return;
        }
        // منتهٍ أو غير مفعّل: ابقَ داخل التطبيق — لا تمسح توكن ولا ترجع للاندنج
        lp_showApp(false);
        lp_showTrialBar();
        var msg = (check.message_ar || 'انتهت التجربة أو الاشتراك — اختر باقة. عملك محفوظ داخل الإضافة.');
        lp_setStatus('⚠️ ' + msg, 'error');
        return;
      } catch (err) {
        var code = String((err && (err.code || err.message)) || '');
        // invalid_token / blocked فقط يمنعان العمل — وبدون مسح التوكن حتى يسجّل المستخدم يدويًا
        if (/invalid_token|blocked|unauthorized/i.test(code)) {
          lp_showLanding();
          lp_prefillEmail(s.email || '');
          lp_setStatus(lp_translateError(code, false), 'error');
          return;
        }
        // أي خطأ آخر (شبكة / تخزين / user_not_found مؤقت): افتح التطبيق بالجلسة المحلية
        lp_showApp(false);
        lp_showTrialBar();
        lp_setStatus('⚠️ تحقق السيرفر مؤقتًا غير متاح — نكمل بالجلسة الحالية دون فقدان المنشور.', 'loading');
        return;
      }
    }

    lp_showLanding();
  })();
  return lpGateBootPromise;
}

function lp_setupForm() {
  if (window.__fbbfFormBound) return;
  window.__fbbfFormBound = true;
  var tabLogin = document.getElementById('tabLogin');
  var tabRegister = document.getElementById('tabRegister');
  var submitBtn = document.getElementById('lpSubmitBtn');
  var btnLabel = document.getElementById('lpBtnLabel');
  var btnSpinner = document.getElementById('lpBtnSpinner');
  var emailInput = document.getElementById('lpEmail');
  var passInput = document.getElementById('lpPassword');
  var forgotBtn = document.getElementById('lpForgotBtn');
  var passToggle = document.getElementById('lpPassToggle');
  var eyeShow = document.getElementById('eyeShow');
  var eyeHide = document.getElementById('eyeHide');
  var isRegisterMode = false;

  function switchTab(toRegister) {
    isRegisterMode = toRegister;
    if (tabLogin) tabLogin.classList.toggle('active', !toRegister);
    if (tabRegister) tabRegister.classList.toggle('active', toRegister);
    if (btnLabel) btnLabel.textContent = toRegister ? 'إنشاء حساب وابدأ التجربة 🚀' : 'دخول وابدأ النشر 🚀';
    lp_setStatus('', '');
  }

  if (tabLogin) tabLogin.addEventListener('click', function(){ switchTab(false); });
  if (tabRegister) tabRegister.addEventListener('click', function(){ switchTab(true); });
  if (passToggle && passInput) {
    passToggle.addEventListener('click', function(){
      var isPassword = passInput.type === 'password';
      passInput.type = isPassword ? 'text' : 'password';
      if (eyeShow) eyeShow.style.display = isPassword ? 'none' : 'block';
      if (eyeHide) eyeHide.style.display = isPassword ? 'block' : 'none';
    });
  }
  if (forgotBtn) {
    forgotBtn.addEventListener('click', function(){
      lp_setStatus('ℹ️ لو نسيت كلمة المرور كلّمني على واتساب لإعادة التفعيل أو إعادة تعيينها.', 'loading');
    });
  }
  [emailInput, passInput].forEach(function(inp){
    if (!inp) return;
    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter' && submitBtn) submitBtn.click(); });
  });
  if (submitBtn) {
    submitBtn.addEventListener('click', function(){ lp_handleSubmit(emailInput, passInput, btnLabel, btnSpinner, submitBtn, isRegisterMode); });
  }
}

async function lp_handleSubmit(emailInput, passInput, btnLabel, btnSpinner, submitBtn, isRegister) {
  var email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  var pass = passInput ? passInput.value.trim() : '';
  if (!email || email.indexOf('@') === -1) { lp_setStatus('⚠️ اكتب بريد إلكتروني صحيح.', 'error'); if (emailInput) emailInput.focus(); return; }
  if (!pass || pass.length < 4) { lp_setStatus('⚠️ كلمة المرور لازم تكون 4 أحرف على الأقل.', 'error'); if (passInput) passInput.focus(); return; }
  if (submitBtn) submitBtn.disabled = true;
  if (btnLabel) btnLabel.style.display = 'none';
  if (btnSpinner) btnSpinner.style.display = 'inline-block';
  lp_setStatus(isRegister ? 'جارٍ إنشاء الحساب...' : 'جارٍ التحقق...', 'loading');
  try {
    var device = await lp_getOrCreateDeviceIdentity();
    var data = await lp_fetchJson('/auth.php', { action: isRegister ? 'register' : 'login', email: email, password: pass, device_id: device.deviceId, device_label: device.deviceLabel, extension_version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '', device_fingerprint: lp_computeFingerprint() });
    data.email = email;
    await lp_saveLoginState(data);
    if (data.access_granted) {
      await lp_onLoginSuccess(data, isRegister, submitBtn, btnLabel, btnSpinner);
      return;
    }
    if (submitBtn) submitBtn.disabled = false;
    if (btnLabel) btnLabel.style.display = 'inline';
    if (btnSpinner) btnSpinner.style.display = 'none';
    // الحساب موجود لكن منتهي: افتح الواجهة مع تنبيه بدل طرد كامل
    try { await lp_saveLoginState(Object.assign({}, data, { access_granted: false })); } catch (e) {}
    lp_showApp(false);
    lp_showTrialBar();
    lp_setStatus('⚠️ الحساب موجود لكن الاشتراك غير مفعّل — اختر باقة. لن يُمسح عملك.', 'error');
  } catch (err) {
    if (submitBtn) submitBtn.disabled = false;
    if (btnLabel) btnLabel.style.display = 'inline';
    if (btnSpinner) btnSpinner.style.display = 'none';
    lp_setStatus(lp_translateError(err.code || err.message, isRegister), 'error');
  }
}

async function lp_onLoginSuccess(data, isRegister, submitBtn, btnLabel, btnSpinner) {
  lp_setStatus(isRegister ? '✅ تم إنشاء الحساب وبدأت التجربة المجانية 3 أيام.' : '✅ تم التحقق بنجاح.', 'success');
  if (submitBtn) submitBtn.disabled = false;
  if (btnLabel) btnLabel.style.display = 'inline';
  if (btnSpinner) btnSpinner.style.display = 'none';
  setTimeout(function(){ lp_showApp(true); try{lp_renderAnnouncements(data.announcements||[]);}catch(e){} }, 700);
}

function lp_bindLogout() {
  var logoutBtn = document.getElementById('logoutBtn');
  if (!logoutBtn || logoutBtn.__fbbfBound) return;
  logoutBtn.__fbbfBound = true;
  logoutBtn.addEventListener('click', async function(){
    if (!confirm('هل تريد تسجيل الخروج؟')) return;
    await lp_clearLoginState();
    window.location.reload();
  });
}

function lp_showTrialBar() {
  chrome.storage.local.get([LP_TRIAL_KEY, LP_TRIAL_STARTED_KEY, LP_SUB_KEY, LP_STATUS_KEY, LP_LAST_VER_KEY, LP_ACCESS_KEY], function(d) {
    var trialStartedAt = lp_normalizeTimestamp(d[LP_TRIAL_STARTED_KEY] || 0);
    var trialEndsAt = lp_normalizeTimestamp(d[LP_TRIAL_KEY] || 0);
    var subEndsAt = lp_normalizeTimestamp(d[LP_SUB_KEY] || 0);
    var status = d[LP_STATUS_KEY] || '';
    var lastVerifiedAt = lp_normalizeTimestamp(d[LP_LAST_VER_KEY] || 0);
    var accessGranted = d[LP_ACCESS_KEY] === true;
    if (!trialEndsAt && trialStartedAt) trialEndsAt = trialStartedAt + (3 * 24 * 60 * 60 * 1000);

    var bar = document.getElementById('trialBar');
    var txt = document.getElementById('trialBarText');
    var closeBtn = document.getElementById('trialBarClose');
    var upgradeBtn = document.getElementById('trialUpgradeLink');
    if (!bar || !txt) return;
    bar.style.display = 'flex';

    if (upgradeBtn && !upgradeBtn.__fbbfBound) {
      upgradeBtn.__fbbfBound = true;
      upgradeBtn.addEventListener('click', function(e){
        e.preventDefault();
        var plansBtn = document.querySelector('[data-tab="plans"]');
        if (plansBtn) plansBtn.click();
      });
    }
    if (closeBtn && !closeBtn.__fbbfBound) {
      closeBtn.__fbbfBound = true;
      closeBtn.addEventListener('click', function(){ bar.style.display = 'none'; });
    }

    function updateCountdown() {
      var now = Date.now();
      bar.classList.remove('trial-bar--urgent');
      var left = 0;
      if (subEndsAt > now) {
        left = subEndsAt - now;
        status = 'active';
        accessGranted = true;
      } else if (trialEndsAt > now) {
        left = trialEndsAt - now;
        if (status !== 'active') status = 'trial';
      }

      if (left > 0) {
        var days = Math.floor(left / 86400000);
        var hours = Math.floor((left % 86400000) / 3600000);
        var minutes = Math.floor((left % 3600000) / 60000);
        if (status === 'active' || subEndsAt > now) {
          txt.textContent = '✅ الاشتراك ساري لمدة: ' + days + 'ي ' + hours + 'س ' + minutes + 'د';
        } else {
          txt.textContent = '⏳ التجربة المتبقية: ' + days + 'ي ' + hours + 'س ' + minutes + 'د';
          if (left < 12 * 3600000) bar.classList.add('trial-bar--urgent');
        }
        return;
      }

      if (status === 'trial' && (!trialEndsAt || trialEndsAt <= 0) && lastVerifiedAt && (now - lastVerifiedAt) < 15 * 60 * 1000) {
        txt.textContent = '⏳ تم تفعيل التجربة — جارِ مزامنة العداد...';
        return;
      }
      if (accessGranted && status === 'active') {
        txt.textContent = '✅ الحساب مفعّل — جارِ مزامنة مدة الاشتراك...';
        return;
      }
      txt.textContent = '⚠️ انتهت التجربة أو الاشتراك — اختر باقة من الموقع (لن تفقد نص المنشور)';
      bar.classList.add('trial-bar--urgent');
    }

    updateCountdown();
    clearInterval(window.__fbbfTrialTimer);
    window.__fbbfTrialTimer = setInterval(updateCountdown, 30000);
  });
}

function lp_startRemoteStatusPolling() {
  if (lp_pollHandle) return;
  lp_pollHandle = setInterval(async function(){
    try {
      var data = await lp_verifyRemoteAccess();
      lp_showTrialBar();
      try { lp_renderAnnouncements(data.announcements || []); } catch (e) {}
      if (!data.access_granted) {
        var st = (data.status || data.message || '') + '';
        if (st === 'blocked' || data.message === 'extension_paused_by_admin') {
          lp_setStatus('⛔ الحساب/الإضافة متوقفة من الإدارة.', 'error');
        } else if (st === 'expired') {
          lp_setStatus('⚠️ انتهت التجربة أو الاشتراك — جدّد من الموقع دون فقدان عملك.', 'error');
          lp_showTrialBar();
        }
      }
    } catch (_) {}
  }, 180000);
}

document.addEventListener('DOMContentLoaded', function () {
  try {
    var chip = document.getElementById('lpVersionChip');
    if (chip && chrome.runtime && chrome.runtime.getManifest) {
      chip.textContent = 'v' + (chrome.runtime.getManifest().version || '');
    }
  } catch (e0) {}

  lp_initGate().catch(function (err) {
    console.error('[AuthGate] init failed:', err);
    try {
      chrome.storage.local.get(['fbpx_lp_email','fbpx_lp_token'], function(r){
        if (r.fbpx_lp_email && r.fbpx_lp_token) {
          var appEl = document.querySelector('.app');
          var landEl = document.getElementById('landingPage');
          if (landEl) landEl.style.display = 'none';
          if (appEl) appEl.style.display = 'flex';
          lp_setStatus('⚠️ خطأ تهيئة مؤقت — الجلسة محفوظة.', 'loading');
        } else {
          lp_showLanding();
          lp_setStatus('⚠️ حدث خطأ أثناء تهيئة الدخول.', 'error');
        }
      });
    } catch (e) {
      lp_showLanding();
      lp_setStatus('⚠️ حدث خطأ أثناء تهيئة الدخول.', 'error');
    }
  });
}, { capture: true });
