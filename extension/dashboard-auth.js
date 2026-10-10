'use strict';
(function(){
  var API = 'https://faset.xo.je/api/check.php';
  var DEVICE_KEY = 'fbpx_device_id';
  var DEVICE_LABEL_KEY = 'fbpx_device_label';
  function redirectOut(){ window.location.href = chrome.runtime.getURL('popup.html'); }
  function normalizeTimestamp(value){
    var timestamp = Number(value || 0);
    return timestamp > 0 && timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }
  function hasFreshActiveAccess(state){
    var now = Date.now();
    var verifiedAt = normalizeTimestamp(state.fbpx_last_verified_at);
    var expiresAt = Math.max(
      normalizeTimestamp(state.fbpx_subscription_ends_at),
      normalizeTimestamp(state.fbpx_trial_ends_at)
    );
    return state.fbpx_access_granted === true
      && verifiedAt > 0
      && verifiedAt <= now + 60000
      && now - verifiedAt <= 6 * 60 * 60 * 1000
      && expiresAt > now;
  }
  function randomId(){
    try { if (crypto && crypto.randomUUID) return 'dev-' + crypto.randomUUID().replace(/-/g,'').slice(0,24); } catch(e){}
    return 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
  }
  function ensureDevice(cb){
    chrome.storage.local.get([DEVICE_KEY, DEVICE_LABEL_KEY], function(r){
      var deviceId = r[DEVICE_KEY] || ''; if (!deviceId) { deviceId = randomId(); }
      var deviceLabel = r[DEVICE_LABEL_KEY] || 'Browser';
      var patch = {}; patch[DEVICE_KEY] = deviceId; patch[DEVICE_LABEL_KEY] = deviceLabel;
      chrome.storage.local.set(patch, function(){ cb(deviceId, deviceLabel); });
    });
  }
  function showBanner(msg){
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#7c2d12;color:#fff;padding:10px 14px;text-align:center;font-family:Cairo,Tahoma,sans-serif;font-size:14px';
    div.textContent = msg;
    document.body.appendChild(div);
  }
  document.addEventListener('DOMContentLoaded', function(){
    chrome.storage.local.get([
      'fbpx_lp_email', 'fbpx_lp_token', 'fbpx_access_granted',
      'fbpx_last_verified_at', 'fbpx_subscription_ends_at', 'fbpx_trial_ends_at'
    ], function(r){
      r = r || {};
      if (!r.fbpx_lp_email || !r.fbpx_lp_token) { redirectOut(); return; }
      ensureDevice(function(deviceId, deviceLabel){
        fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email:r.fbpx_lp_email, token:r.fbpx_lp_token, device_id: deviceId, device_label: deviceLabel, extension_version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '' }) })
          .then(function(resp){ return resp.json().then(function(data){ return { status: resp.status, data: data || {} }; }); })
          .then(function(result){
            var data = result.data || {};
            var code = (data.error_code || data.code || data.message || data.status || '') + '';
            if (code === 'blocked' || data.status === 'blocked') {
              showBanner('انتهت جلسة الدخول أو الحساب محظور. سجّل دخولك من واجهة الإضافة.');
              setTimeout(redirectOut, 1500);
              return;
            }
            if (result.status === 401 || code === 'invalid_token') {
              if (hasFreshActiveAccess(r)) {
                showBanner('تعذرت مزامنة الجلسة مع السيرفر مؤقتًا؛ اشتراكك النشط محفوظ ولن يتم إخراجك من لوحة التحكم.');
                return;
              }
              showBanner('انتهت جلسة الدخول. سجّل دخولك من واجهة الإضافة.');
              setTimeout(redirectOut, 1500);
              return;
            }
            if (result.status === 429 || result.status >= 500 || result.status === 408) {
              showBanner('السيرفر غير متاح مؤقتًا؛ ستظل لوحة التحكم مفتوحة ويمكن إعادة المحاولة لاحقًا.');
              return;
            }
            if (!result.status || result.status < 200 || result.status >= 300) {
              showBanner('تعذر التحقق من السيرفر مؤقتًا؛ ستظل لوحة التحكم مفتوحة.');
              return;
            }
            if (!data.access_granted) {
              // منتهية التجربة: ابقَ في الصفحة مع تنبيه — لا تحويل قسري
              showBanner('التجربة/الاشتراك غير مفعّل حاليًا — يمكنك مراجعة المحتوى. جدّد من الموقع.');
            }
          })
          .catch(function(){
            showBanner('تعذر الاتصال بالسيرفر مؤقتًا؛ ستظل لوحة التحكم مفتوحة ولن تُمسح جلستك.');
          });
      });
    });
  });
}());
