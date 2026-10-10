"use strict";
// ═══════════════════════════════════════════════════════════════════
//  LANDING PAGE GATE — FB Publisher X
//  ─────────────────────────────────────────────────────────────────
//  القواعد الصارمة:
//    ✅ لا يُعدَّل أي سطر من كود النشر الأصلي أدناه.
//    ✅ كل دوال هذا القسم تبدأ بـ lp_ لمنع أي تعارض.
//    ✅ إذا فشلت البوابة لأي سبب، الإضافة تُفتح بشكل طبيعي.
//    ✅ التحقق من الإيميل والباسورد هو Dummy فقط (لا قاعدة بيانات).
// ═══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  نقطة الدخول — { capture: true } يضمن التنفيذ قبل كل المستمعين
// ══════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", function () {
  lp_initGate().catch(function (err) {
    console.error("[LandingGate] init failed — failing open:", err);
    lp_showApp(true);
  });

  /* ── UPDATE BANNER CHECK ──────────────────────────────────────────
     Reads pendingUpdate from chrome.storage, shows the teal update
     banner if a newer version is available and user hasn't dismissed
     in the last hour.
     ──────────────────────────────────────────────────────────────── */
  chrome.storage.local.get(['pendingUpdate', 'updateBannerDismissedAt'], function(r) {
    var upd = r.pendingUpdate;
    if (!upd || !upd.version) return;
    var dismissedAt = r.updateBannerDismissedAt || 0;
    /* Don't re-show for 1 hour after user dismisses */
    if (Date.now() - dismissedAt < 60 * 60 * 1000) return;
    var banner = document.getElementById('updateBanner');
    var sub    = document.getElementById('updateBannerSub');
    if (!banner) return;
    if (sub) {
      var txt = 'الإصدار v' + upd.version + ' جاهز';
      if (upd.notes) txt += ' — ' + upd.notes;
      sub.textContent = txt;
    }
    banner.style.display = 'flex';
  });

  /* زرار إغلاق البانر — كان inline onclick قبل كده وده بيتعارض مع CSP
     (script-src 'self')، فبيتفشل بصمت. اتحول لـ addEventListener عادي. */
  var dismissBtn = document.getElementById('updateBannerDismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      var banner = document.getElementById('updateBanner');
      if (banner) banner.style.display = 'none';
      chrome.storage.local.set({ updateBannerDismissedAt: Date.now() });
    });
  }
}, { capture: true });

// ══════════════════════════════════════════════════════════════════
//  المنسّق الرئيسي
// ══════════════════════════════════════════════════════════════════
async function lp_initGate() {
  var appEl   = document.querySelector(".app");
  var landEl  = document.getElementById("landingPage");

  // أخفِ الإضافة الأصلية فوراً لتجنب الوميض
  if (appEl) appEl.style.display = "none";

  // اقرأ حالة الجلسة من التخزين المحلي
  var isLoggedIn = await lp_getLoginState();

  if (isLoggedIn) {
    // ✅ مسجّل دخوله — أخفِ صفحة الهبوط وأظهر الإضافة مباشرة
    if (landEl) landEl.style.display = "none";
    lp_showApp(false);
  } else {
    // ❌ غير مسجّل — أظهر صفحة الهبوط
    if (appEl)  appEl.style.display  = "none";
    if (landEl) landEl.style.display = "flex";
    lp_setupForm();
  }
}

// ══════════════════════════════════════════════════════════════════
//  إعداد أحداث صفحة الهبوط
// ══════════════════════════════════════════════════════════════════
function lp_setupForm() {
  var tabLogin    = document.getElementById("tabLogin");
  var tabRegister = document.getElementById("tabRegister");
  var submitBtn   = document.getElementById("lpSubmitBtn");
  var btnLabel    = document.getElementById("lpBtnLabel");
  var btnSpinner  = document.getElementById("lpBtnSpinner");
  var emailInput  = document.getElementById("lpEmail");
  var passInput   = document.getElementById("lpPassword");
  var forgotBtn   = document.getElementById("lpForgotBtn");
  var passToggle  = document.getElementById("lpPassToggle");
  var eyeShow     = document.getElementById("eyeShow");
  var eyeHide     = document.getElementById("eyeHide");

  var isRegisterMode = false;

  // ── تبديل التبويبات دخول / تسجيل ────────────────────────────
  function lp_switchTab(toRegister) {
    isRegisterMode = toRegister;
    if (tabLogin)    tabLogin.classList.toggle("active",    !toRegister);
    if (tabRegister) tabRegister.classList.toggle("active",  toRegister);
    if (btnLabel)    btnLabel.textContent = toRegister
      ? "إنشاء حساب والبدء 🚀"
      : "دخول وابدأ النشر 🚀";
    lp_setStatus("", "");
    // أزل حالة الخطأ عن الحقول
    if (emailInput) emailInput.classList.remove("error-field");
    if (passInput)  passInput.classList.remove("error-field");
  }

  if (tabLogin)    tabLogin.addEventListener("click",    function () { lp_switchTab(false); });
  if (tabRegister) tabRegister.addEventListener("click", function () { lp_switchTab(true);  });

  // ── إظهار/إخفاء كلمة المرور ──────────────────────────────────
  if (passToggle) {
    passToggle.addEventListener("click", function () {
      var isPassword = passInput.type === "password";
      passInput.type = isPassword ? "text" : "password";
      if (eyeShow) eyeShow.style.display = isPassword ? "none"  : "block";
      if (eyeHide) eyeHide.style.display = isPassword ? "block" : "none";
    });
  }

  // ── نسيت كلمة المرور ─────────────────────────────────────────
  if (forgotBtn) {
    forgotBtn.addEventListener("click", function () {
      lp_setStatus("📧 سيتم إرسال رابط التعيين على بريدك قريباً.", "loading");
    });
  }

  // ── إرسال الفورم بـ Enter ─────────────────────────────────────
  [emailInput, passInput].forEach(function (inp) {
    if (!inp) return;
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && submitBtn) submitBtn.click();
    });
  });

  // ── زر تسجيل الدخول ──────────────────────────────────────────
  if (submitBtn) {
    submitBtn.addEventListener("click", function () {
      lp_handleSubmit(emailInput, passInput, btnLabel, btnSpinner, submitBtn, isRegisterMode);
    });
  }
}

// ══════════════════════════════════════════════════════════════════
//  معالجة الإرسال — Dummy Validation
// ══════════════════════════════════════════════════════════════════
function lp_handleSubmit(emailInput, passInput, btnLabel, btnSpinner, submitBtn, isRegister) {
  var email = emailInput ? emailInput.value.trim() : "";
  var pass  = passInput  ? passInput.value.trim()  : "";

  // ── التحقق من البريد — أي بريد أو اسم مستخدم (3 أحرف على الأقل) ──
  if (!email || email.length < 3) {
    lp_setStatus("⚠️ أدخل بريدك الإلكتروني أو اسم المستخدم (3 أحرف على الأقل)", "error");
    if (emailInput) {
      emailInput.classList.add("error-field");
      emailInput.focus();
      setTimeout(function () { emailInput.classList.remove("error-field"); }, 800);
    }
    return;
  }

  // ── التحقق من كلمة المرور — أي كلمة مرور ─────────────────────
  if (!pass) {
    lp_setStatus("⚠️ كلمة المرور لا يمكن أن تكون فارغة", "error");
    if (passInput) {
      passInput.classList.add("error-field");
      passInput.focus();
      setTimeout(function () { passInput.classList.remove("error-field"); }, 800);
    }
    return;
  }

  // ── حالة التحميل ─────────────────────────────────────────────
  if (submitBtn)  submitBtn.disabled = true;
  if (btnLabel)   btnLabel.style.display   = "none";
  if (btnSpinner) btnSpinner.style.display = "inline-block";
  lp_setStatus(isRegister ? "جارٍ إنشاء الحساب..." : "جارٍ التحقق...", "loading");

  // ── محاكاة تأخير الشبكة (Dummy - لا يتصل بسيرفر حقيقي) ───────
  setTimeout(function () {
    lp_onLoginSuccess(email, isRegister, submitBtn, btnLabel, btnSpinner);
  }, 1200);
}

// ══════════════════════════════════════════════════════════════════
//  بعد نجاح تسجيل الدخول
// ══════════════════════════════════════════════════════════════════
async function lp_onLoginSuccess(email, isRegister, submitBtn, btnLabel, btnSpinner) {
  await lp_saveLoginState(email);

  lp_setStatus(
    isRegister ? "✅ تم إنشاء الحساب! مرحباً بك 🎉" : "✅ أهلاً بك! جارٍ التحميل...",
    "success"
  );

  if (submitBtn)  submitBtn.disabled = false;
  if (btnLabel)   btnLabel.style.display   = "inline";
  if (btnSpinner) btnSpinner.style.display = "none";

  // ── STEP 2: Show onboarding for first-time users ─────────────────
  if (isRegister) {
    await chrome.storage.local.set({ onboardingDone: false });
  }

  setTimeout(function () {
    var landEl = document.getElementById("landingPage");
    if (landEl) {
      landEl.classList.add("lp-fade-out");
      setTimeout(async function () {
        landEl.style.display = "none";
        // Check if onboarding needed
        const d = await chrome.storage.local.get('onboardingDone');
        if (d.onboardingDone === false) {
          showOnboarding();
        } else {
          lp_showApp(true);
        }
      }, 360);
    } else {
      lp_showApp(true);
    }
  }, 900);
}

// ── STEP 2: Onboarding overlay ────────────────────────────────────
var ONBOARDING_STEPS = [
  { icon:'⚡', title:'النشر الجماعي الذكي', desc:'انشر في 500+ مجموعة دفعةً واحدة. المحرك يعمل في الخلفية بينما تتصفح بشكل طبيعي.' },
  { icon:'🤖', title:'الذكاء الاصطناعي مدمج', desc:'اضغط "توليد بـ AI" لكتابة منشور احترافي تلقائياً. أضف مفتاح Gemini مجاناً من groq.com.' },
  { icon:'🔍', title:'اكتشف المجموعات', desc:'في تبويب "جروبات" — ابحث وأضف مئات المجموعات بكلمة مفتاحية واحدة بنقرة.' },
  { icon:'📅', title:'جدول حملاتك', desc:'افتح التبويب المنفصل (Dashboard) وجدّل حملاتك بالتاريخ والوقت — تنفيذ تلقائي بدون تدخل.' },
  { icon:'🚀', title:'ابدأ الآن!', desc:'كل شيء جاهز. اختر مجموعاتك، اكتب المنشور، واضغط "ابدأ". نتمنى لك حملات ناجحة! 🎉', last:true },
];

function showOnboarding() {
  var el = document.getElementById('onboardingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'onboardingOverlay';
    el.innerHTML = buildOnboardingHTML();
    document.body.appendChild(el);
    bindOnboarding(el);
  }
  el.style.display = 'flex';
}

function buildOnboardingHTML() {
  return '<div class="ob-wrap"><div class="ob-card" id="obCard">' +
    '<div class="ob-dots" id="obDots"></div>' +
    '<div class="ob-body" id="obBody"></div>' +
    '<div class="ob-actions">' +
      '<button class="ob-skip" id="obSkip">تخطي</button>' +
      '<button class="ob-next btn-primary" id="obNext">التالي →</button>' +
    '</div></div></div>';
}

function bindOnboarding(el) {
  var step = 0;
  var dots = el.querySelector('#obDots');
  var body = el.querySelector('#obBody');
  var next = el.querySelector('#obNext');
  var skip = el.querySelector('#obSkip');

  function render() {
    var s = ONBOARDING_STEPS[step];
    dots.innerHTML = ONBOARDING_STEPS.map(function(_,i) {
      return '<span class="ob-dot' + (i===step?' ob-dot-active':'') + '"></span>';
    }).join('');
    body.innerHTML = '<div class="ob-icon">' + s.icon + '</div>' +
      '<h3 class="ob-title">' + s.title + '</h3>' +
      '<p class="ob-desc">' + s.desc + '</p>';
    next.textContent = s.last ? 'ابدأ الآن 🚀' : 'التالي →';
  }

  function finish() {
    chrome.storage.local.set({ onboardingDone: true });
    el.style.display = 'none';
    lp_showApp(true);
  }

  next.onclick = function() { if (step < ONBOARDING_STEPS.length - 1) { step++; render(); } else { finish(); } };
  skip.onclick = finish;
  render();
}


// ══════════════════════════════════════════════════════════════════
//  إظهار الإضافة الأصلية
// ══════════════════════════════════════════════════════════════════
function lp_showApp(withAnimation) {
  var appEl = document.querySelector(".app");
  if (!appEl) return;

  appEl.style.display = "flex";
  if (withAnimation) {
    appEl.classList.add("app-fade-in");
    setTimeout(function () { appEl.classList.remove("app-fade-in"); }, 400);
  }

  // أضف زر الخروج وشريط العد التنازلي بعد عرض الإضافة
  setTimeout(lp_bindLogout,    150);
  setTimeout(lp_showTrialBar,  250);
}

// ══════════════════════════════════════════════════════════════════
//  زر تسجيل الخروج
// ══════════════════════════════════════════════════════════════════
function lp_bindLogout() {
  var logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn) return;

  // إزالة أي listener قديم أولاً
  var newBtn = logoutBtn.cloneNode(true);
  logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);

  newBtn.addEventListener("click", async function () {
    if (!confirm("هل تريد تسجيل الخروج؟")) return;
    await lp_clearLoginState();
    window.location.reload();
  });
}

// ══════════════════════════════════════════════════════════════════
//  شريط العد التنازلي للتجربة المجانية
// ══════════════════════════════════════════════════════════════════
function lp_showTrialBar() {
  // تفويض لنسخة auth-gate الأحدث إن وُجدت (تقرأ الاشتراك وليس التجربة فقط)
  if (typeof window !== 'undefined' && window.lp_showTrialBar && window.lp_showTrialBar !== lp_showTrialBar) {
    try { return window.lp_showTrialBar(); } catch (e) {}
  }
  chrome.storage.local.get(["fbpx_trial_ends_at", "fbpx_subscription_ends_at", "fbpx_access_status", "fbpx_access_granted"], function (d) {
    var trialEndsAt = Number(d["fbpx_trial_ends_at"] || 0);
    if (trialEndsAt > 0 && trialEndsAt < 1e12) trialEndsAt *= 1000;
    var subEndsAt = Number(d["fbpx_subscription_ends_at"] || 0);
    if (subEndsAt > 0 && subEndsAt < 1e12) subEndsAt *= 1000;
    var status = d["fbpx_access_status"] || "";
    var access = d["fbpx_access_granted"] === true;
    var bar = document.getElementById("trialBar");
    var txt = document.getElementById("trialBarText");
    if (!bar || !txt) return;
    bar.style.display = "flex";
    var now = Date.now();
    if (subEndsAt > now) {
      var left = subEndsAt - now;
      txt.textContent = "✅ الاشتراك ساري: " + Math.floor(left/86400000) + "ي " + Math.floor((left%86400000)/3600000) + "س";
      return;
    }
    if (trialEndsAt > now) {
      var left2 = trialEndsAt - now;
      txt.textContent = "⏳ التجربة: " + Math.floor(left2/86400000) + "ي " + Math.floor((left2%86400000)/3600000) + "س";
      return;
    }
    if (access && status === "active") {
      txt.textContent = "✅ الحساب مفعّل — جارِ مزامنة المدة...";
      return;
    }
    txt.textContent = "⚠️ انتهت التجربة أو الاشتراك — اختر باقة (المنشور محفوظ)";
  });
}

// ══════════════════════════════════════════════════════════════════
//  رسالة الحالة
// ══════════════════════════════════════════════════════════════════
function lp_setStatus(msg, type) {
  var el = document.getElementById("lpStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "lp-status" + (type ? " " + type : "");
}

// ══════════════════════════════════════════════════════════════════
//  chrome.storage helpers
// ══════════════════════════════════════════════════════════════════
var LP_KEY = "fbpx_lp_session";

function lp_getLoginState() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([LP_KEY], function (r) {
      resolve(r[LP_KEY] === true);
    });
  });
}

function lp_saveLoginState(email) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(["fbpx_trial_ends_at"], function (existing) {
      var trialEndsAt = existing["fbpx_trial_ends_at"] ||
                        (Date.now() + 3 * 24 * 60 * 60 * 1000);
      var data = {};
      data[LP_KEY] = true;
      data["fbpx_lp_email"]       = email || "";
      data["fbpx_trial_ends_at"]  = trialEndsAt;
      chrome.storage.local.set(data, resolve);
    });
  });
}

function lp_clearLoginState() {
  return new Promise(function (resolve) {
    chrome.storage.local.remove([LP_KEY, "fbpx_lp_email"], resolve);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  نهاية Landing Page Gate — الكود الأصلي يبدأ من هنا دون أي تعديل
// ═══════════════════════════════════════════════════════════════════
"use strict";
// ═══════════════════════════════════════════════════════════════════
//  POPUP.JS — FB Auto Poster V4.2 (Smart Extraction)
//
//  Fixes over V4.1:
//  ① Link always at end (before hashtags) — removed "start" option
//  ② Added "Randomize" button for spintax preview
//  ③ Double-space cleaning in generateContent
//  ④ WhatsApp link URL encoding
//  ⑤ Broken character cleanup
//
//  New in V4.2 — Smart Extraction AI Pipeline:
//  ⑥ generateAIContent() now accepts existingContent + fixedLink params
//  ⑦ Link Decoupling: link extracted via extractFirstLink() BEFORE any API call
//  ⑧ Clean AI Request: only topic/tone sent to AI — no URLs, no stale hashtags
//  ⑨ Deterministic Final Assembly: [AI Body] + [Link CTA] + [Hashtags] — always
//  ⑩ Change-Text idempotency: stripMetadata() resets state before every re-generate
//  ⑪ Graceful error handling: API failure never clears existing user content
// ═══════════════════════════════════════════════════════════════════

// ─── SPINTAX ──────────────────────────────────────────────────────
// Resolves nested {a|b|c} patterns to a random option each call.
// Trims whitespace inside options and supports up to 12 levels of nesting.
function processSpintax(text, seed) {
  if (text == null) return "";
  // If seed provided, use it as deterministic offset for each group variation
  var useSeed = (seed !== undefined && seed !== null);
  var seedVal = useSeed ? (Number(seed) || 0) : 0;
  let out = String(text), prev = "", guard = 0;
  var _callCount = 0;
  while (prev !== out && guard++ < 12) {
    prev = out;
    out  = out.replace(/\{([^{}]+)\}/g, function(_, opts) {
      const arr = opts.split("|");
      var idx;
      if (useSeed) {
        // deterministic pick: rotate through options using seed + call position
        idx = (seedVal + _callCount) % arr.length;
        _callCount++;
      } else {
        idx = Math.floor(Math.random() * arr.length);
      }
      const pick = arr[idx];
      return (pick == null ? "" : String(pick)).replace(/^\s+|\s+$/g, "");
    });
  }
  return out;
}

// ─── LINK UTILS ───────────────────────────────────────────────────
const URL_RX = /https?:\/\/[^\s"'<>]+/gi;
const SMART_VARIATION_CHARS = ["\u200B", "\u200C", "\u200D", "\u2060", "\u2063", "\uFEFF"];
const RANDOMIZER_EMOJIS = ["✨", "🙂", "🚀", "🌟", "🔥", "✅"];

// CTA label prefixes we inject — must be stripped before re-processing
const CTA_PREFIX_RX = /📲[^\n]*\n?/g;

function extractFirstLink(text) {
  const m = String(text || "").match(URL_RX);
  return m ? m[0] : null;
}

function stripLinks(text) {
  return String(text || "").replace(URL_RX, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * stripMetadata — THE SANITIZER
 *
 * Strips ALL metadata that generateContent() would (re-)append:
 *   • Every URL (via URL_RX)
 *   • Every WhatsApp/CTA label prefix (📲 …)
 *   • Every hashtag line (lines that are ONLY hashtags / spaces)
 *   • Invisible smart-variation characters
 *   • Anti-spam randomizer lines we may have injected previously
 *
 * Returns ONLY the "Core Message" — the human-readable body copy.
 * This function is idempotent: calling it N times yields the same result.
 */
function stripMetadata(text) {
  var s = String(text || "");

  // 1. Remove invisible smart-variation chars
  s = s.replace(/[\u200B\u200C\u200D\u2060\u2063\uFEFF]/g, "");

  // 2. Remove CTA label prefixes (📲 تواصل معنا…\n  or  📲 Contact us…\n)
  s = s.replace(CTA_PREFIX_RX, "");

  // 3. Remove all URLs
  s = s.replace(URL_RX, "");

  // 4. Remove pure-hashtag lines (a line whose non-space content is all #tags)
  s = s.split("\n").filter(function(line) {
    var trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for now; will collapse later
    // A "hashtag-only line" contains only tokens that start with #
    return !trimmed.split(/\s+/).every(function(tok) { return tok.charAt(0) === "#"; });
  }).join("\n");

  // 5. Remove anti-spam randomizer lines  (emoji + "تحديث خفيف NNNN" or "Quick update NNNN")
  s = s.replace(/[✨🙂🚀🌟🔥✅]\s+(تحديث خفيف|Quick update)\s+\d+/g, "");

  // 6. Collapse 3+ newlines, strip trailing special chars, trim
  s = s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\n\s]+$/, "")
    .trim();

  return s;
}

function detectLang(text) {
  text = String(text || "");
  const ar = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return ar / (text.replace(/\s/g, "").length || 1) > 0.25 ? "ar" : "en";
}

function normalizeText(text) {
  return String(text || "").replace(/\r\n?/g, "\n");
}

function parseHashtagParts(text, extraTags) {
  text = normalizeText(text).replace(/([^\s])#/g, "$1 #");
  var tags = [];

  // Collect extra tags first
  (extraTags || []).forEach(function(tag) {
    tag = String(tag || "").trim();
    if (!tag) return;
    if (tag[0] !== "#") tag = "#" + tag.replace(/^#+/, "");
    if (!tags.find(function(x){ return x.toLowerCase() === tag.toLowerCase(); })) tags.push(tag);
  });

  // Extract ALL hashtags from text (no limit)
  text = text.replace(/(^|\s)#([\u0600-\u06FFA-Za-z0-9_]+)/g, function(match, lead, tag) {
    var full = "#" + String(tag || "").replace(/^#+/, "");
    if (!tags.find(function(x){ return x.toLowerCase() === full.toLowerCase(); })) tags.push(full);
    return lead;
  });

  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Each hashtag on its own line for clean formatting
  var hashtagLine = tags.length ? tags.join("\n") : "";
  return { body: text, hashtagLine: hashtagLine };
}

function FormatHashtags(text, extraTags) {
  var parsed = parseHashtagParts(text, extraTags);
  return parsed.hashtagLine ? [parsed.body, parsed.hashtagLine].filter(Boolean).join("\n\n") : parsed.body;
}

function createInvisibleVariation() {
  var count = 2 + Math.floor(Math.random() * 4);
  var suffix = "";
  for (var i = 0; i < count; i++) {
    suffix += SMART_VARIATION_CHARS[Math.floor(Math.random() * SMART_VARIATION_CHARS.length)];
  }
  return suffix;
}

function createAntiSpamLine(lang) {
  // Use ONLY invisible zero-width characters — no visible text like "تحديث خفيف"
  // This prevents the spam line from appearing in the post
  const ZW = ["\u200B", "\u200C", "\u200D", "\uFEFF"];
  const serial = 1000 + Math.floor(Math.random() * 9000);
  // Build an invisible string: 3-5 zero-width chars encoding the serial
  let invisible = "";
  String(serial).split("").forEach(function(d) {
    invisible += ZW[parseInt(d) % ZW.length];
  });
  return invisible; // completely invisible, no visible characters
}

// ─── CLEAN TEXT ───────────────────────────────────────────────────
// ③ Remove double spaces, broken chars, normalize whitespace
function cleanText(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")           // non-breaking space → normal space
    .replace(/[\u200E\u200F]/g, "")    // LTR/RTL marks
    .replace(/\uFFFD/g, "")            // replacement character
    .replace(/ {2,}/g, " ")            // double+ spaces → single
    .replace(/[ \t]+\n/g, "\n")        // trailing spaces on lines
    .replace(/\n{3,}/g, "\n\n")        // triple+ newlines → double
    .trim();
}

// ─── STRIP MARKDOWN ───────────────────────────────────────────────────────
// Removes all markdown symbols the AI might return so the FB post looks clean
function stripMarkdown(text) {
  return String(text || "")
    // **bold** or __bold__
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // *italic* or _italic_
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    // ~~strikethrough~~
    .replace(/~~(.+?)~~/g, "$1")
    // `inline code`
    .replace(/`(.+?)`/g, "$1")
    // ### Headings → just the text
    .replace(/^#{1,6}\s+/gm, "")
    // --- or *** horizontal rules
    .replace(/^[-*]{3,}\s*$/gm, "")
    // > blockquotes
    .replace(/^>\s*/gm, "")
    // Unordered list bullets: - item / * item / • item
    .replace(/^[\-\*•]\s+/gm, "")
    // Ordered list: 1. item
    .replace(/^\d+\.\s+/gm, "")
    // [link text](url) → link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // bare *** or ** or * leftover
    .replace(/\*{1,3}/g, "")
    // clean up extra blank lines created by removals
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── SANITIZE FOR FACEBOOK ────────────────────────────────────────
// Removes hidden control characters and zero-width spaces that
// survive cleanText() and can cause Facebook's editor to silently
// collapse line breaks.
function sanitizeForFB(text) {
  return String(text || "")
    // Zero-width & invisible Unicode that Facebook strips silently
    .replace(/[\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF]/g, "")
    // Soft-hyphen, word-joiner, and other invisible format chars
    .replace(/[\u00AD\u2028\u2029\u202A-\u202F\u2066-\u206F]/g, "")
    // Normalise all line endings to Unix \n
    .replace(/\r\n?/g, "\n")
    // Collapse 3+ newlines → exactly 2 (our double-line-break unit)
    .replace(/\n{3,}/g, "\n\n")
    // Trim trailing whitespace per-line (Facebook collapses it)
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ④ URL-encode for WhatsApp sharing
function encodeForWhatsApp(text) {
  return encodeURIComponent(String(text || ""));
}

/**
 * generateContent — idempotent content assembler
 *
 * Architecture (State Decoupling):
 *   ┌──────────────────────────────────────────────┐
 *   │  INPUT  rawTemplate (may contain old metadata)│
 *   │         fixedLink   (authoritative link)       │
 *   └────────────────┬─────────────────────────────┘
 *                    │
 *          stripMetadata()  ← SANITIZE FIRST — removes URLs, CTA
 *                             labels, hashtag lines, invisible chars,
 *                             and anti-spam lines from prior runs.
 *                    │
 *          ┌─────────▼──────────┐
 *          │   CORE MESSAGE     │  (pure body text only)
 *          └─────────┬──────────┘
 *                    │
 *        processSpintax / antiSpam
 *                    │
 *          ┌─────────▼──────────────────────────┐
 *          │  REASSEMBLE (always from scratch)  │
 *          │  Body → CTA link → Hashtag line    │
 *          └────────────────────────────────────┘
 *
 * Calling this on the same textarea value 10 times yields
 * EXACTLY the same result — no duplication ever.
 */
function generateContent(rawTemplate, fixedLink, options) {
  options = options || {};
  var useSmartVariation     = !!options.smartVariation;
  var useAntiSpamRandomizer = !!options.antiSpamRandomizer;
  var applySpin             = options.processSpintax !== false;

  // ── STEP 1: Normalise raw input ───────────────────────────────────
  var raw = normalizeText(rawTemplate);

  // ── STEP 2: Resolve the authoritative link BEFORE sanitising ──────
  // Priority: explicit fixedLink field > any URL already in the raw text.
  // We capture it first so URL-stripping later does not lose it.
  var link = String(fixedLink || extractFirstLink(raw) || "").trim();

  // ── STEP 3a: Harvest hashtags BEFORE sanitising ───────────────────
  // stripMetadata removes standalone hashtag lines to prevent duplication.
  // But those tags may have been user-authored or moved there by a prior
  // generateContent() call. We preserve them here so they survive the wipe
  // and get re-injected cleanly in Step 5.
  var preStrip     = parseHashtagParts(raw);
  var savedTagList = preStrip.hashtagLine
    ? preStrip.hashtagLine.split(/\s+/).filter(function(t){ return t.charAt(0) === "#"; })
    : [];

  // ── STEP 3b: SANITIZE — wipe ALL previously injected metadata ─────
  // sanitizeForFB() runs AFTER stripMetadata() to remove hidden chars
  // that survive the metadata strip and cause Facebook to collapse \n\n.
  var coreText = sanitizeForFB(stripMetadata(raw));

  // ── STEP 4: Apply spintax on the clean core only ──────────────────
  if (applySpin) coreText = processSpintax(coreText);

  // ── STEP 5: Re-collect hashtags (inline from body + saved from 3a) ─
  // parseHashtagParts pulls inline #tags out of prose AND merges the
  // savedTagList so nothing the user wrote ever gets silently dropped.
  var parsed = parseHashtagParts(coreText, savedTagList);
  var lang   = detectLang(parsed.body || coreText);

  // ── STEP 6: Format the CTA / link block ───────────────────────────
  // SURGICAL FIX: The link is ALWAYS wrapped in an explicit block so
  // sections.join("\n\n") produces a clean double-break before it.
  // Plain URLs get the same treatment as WhatsApp CTAs — no bare URL
  // sitting flush against the body.
  var formattedLink = "";
  if (link) {
    var isWa = /wa\.me|whatsapp/i.test(link);
    if (isWa) {
      formattedLink = lang === "ar"
        ? "📲 تواصل معنا عبر واتساب:\n" + link
        : "📲 Contact us on WhatsApp:\n" + link;
    } else {
      // Plain link — still isolated in its own section string
      formattedLink = link;
    }
  }

  // ── STEP 7: Compose final output ──────────────────────────────────
  var finalBody = sanitizeForFB(parsed.body || "");

  // Anti-spam: inject invisible zero-width chars INSIDE the body (not as visible line)
  if (useAntiSpamRandomizer) {
    finalBody = finalBody + createAntiSpamLine(lang);
  }

  var sections = [];
  if (finalBody)          sections.push(finalBody);
  if (formattedLink)      sections.push(sanitizeForFB(formattedLink));
  if (parsed.hashtagLine) sections.push(sanitizeForFB(parsed.hashtagLine));

  // SURGICAL FIX: join with explicit double-newline (canonical separator)
  var finalText = sections.filter(Boolean).join("\n\n");

  // ── STEP 8: Final cleanup gate ─────────────────────────────────────
  // cleanText() normalises whitespace; sanitizeForFB() removes anything
  // that would make Facebook silently strip our \n\n boundaries.
  finalText = sanitizeForFB(cleanText(finalText));

  // ── STEP 9: Optional invisible smart-variation suffix ─────────────
  if (useSmartVariation) finalText += createInvisibleVariation();

  return finalText;
}

// ─── VIRAL CONTENT TEMPLATES ──────────────────────────────────────
function generateLocalContent(topic, tone, type, lang) {
  const isAr  = lang === "ar" || (lang === "auto" && detectLang(topic) === "ar");
  const tag   = topic.replace(/\s+/g, "_");
  if (isAr) {
    const hooks = {
      post:         `{لن تصدق|هذا ما لا يخبرك به أحد عن|السر الحقيقي في} ${topic}! 👇`,
      announcement: `🚨 توقف الآن — هذا يخصك مباشرة إذا كنت مهتماً بـ ${topic}`,
      promotion:    `💣 قبل أن تشتري أي شيء في مجال ${topic} — اقرأ هذا أولاً`,
      question:     `🤫 سؤال جريء لأهل ${topic} — {هل جربت|هل سمعت|هل تعرف} هذا؟`
    };
    const values = {
      post:         `\nكثيرون يبحثون عن {أفضل|أسرع|أذكى} طريقة في ${topic} — لكنهم يقعون في نفس الأخطاء.\n\n✅ الفرق الحقيقي:\n— {النجاح|التقدم|النتائج} لا يأتي بالصدفة\n— يأتي بـ {المنهج الصحيح|الخطوات الواضحة|الأداة المناسبة}\n\n💎 {آلاف|مئات الآلاف} استفادوا — الآن دورك`,
      announcement: `\n📌 ما سأشاركه اليوم {غيّر|أحدث فرقاً|أضاف قيمة} لكل من جربه في ${topic}.\n\n🔑 ثلاثة أشياء ستعرفها:\n١. لماذا {كثيرون} يفشلون في ${topic}\n٢. الخطوة الوحيدة التي تحتاجها الآن\n٣. كيف {تبدأ|تتقدم} بدون {مخاطرة|تعقيد}`,
      promotion:    `\n⚡ العرض محدود والوقت ينفد:\n\n✔ {أسعار|نتائج} لا مثيل لها في ${topic}\n✔ بدون {التزامات مخفية|رسوم إضافية}\n✔ ضمان الرضا الكامل أو استرداد كامل\n\n🔥 من جرّب — يعود دائماً`,
      question:     `\nدعني أكون صريحاً:\n\nفي مجال ${topic} — الجميع يعد لكن القليل يُنجز.\n\n❓ سؤالي:\n— ما أكبر تحدٍّ تواجهه في ${topic}؟\n— ماذا جربت حتى الآن؟\n\n👇 الإجابات في التعليقات — سأرد على الجميع`
    };
    const ctas = {
      post:         `\n\n📲 تواصل الآن — الرد {فوري|سريع}`,
      announcement: `\n\n📩 أرسل رسالة مباشرة لمعرفة التفاصيل`,
      promotion:    `\n\n🛒 احجز مكانك الآن — الأماكن {محدودة|تنفد}`,
      question:     `\n\n💬 اكتب رأيك — منشور اليوم للتفاعل`
    };
    const tags = {
      post:         `\n\n #${tag} #نصائح_مجانية #قيمة_حقيقية #جربها_الآن #شارك_مع_أصدقائك`,
      announcement: `\n\n #${tag} #إعلان_مهم #فرصة_ذهبية #لا_تفوتها #اقرأ_بتمعن`,
      promotion:    `\n\n #${tag} #عرض_خاص #وفّر_الآن #اشتري_بذكاء #لا_تتأخر`,
      question:     `\n\n #${tag} #نقاش_مفتوح #رأيك_يهمني #تجارب_حقيقية #شاركنا`
    };
    const t = type in hooks ? type : "post";
    return FormatHashtags((hooks[t] || "") + (values[t] || "") + (ctas[t] || "") + (tags[t] || ""));
  }
  // English
  const hooks = {
    post:         `Nobody tells you this about ${topic} 👇`,
    announcement: `🚨 READ THIS if you're serious about ${topic}`,
    promotion:    `💣 Before you spend another dollar on ${topic} — read this first`,
    question:     `🤫 Honest question for people in ${topic}: does this sound familiar?`
  };
  const values = {
    post:         `\nMost people approach ${topic} wrong — and wonder why results don't come.\n\n✅ The real difference:\n— Results don't happen by accident\n— They come from {the right system|the right tools|the right steps}\n\n💎 {Thousands|Hundreds} have benefited — now it's your turn`,
    announcement: `\n📌 What I'm sharing today has made a real difference for everyone who tried it in ${topic}.\n\n🔑 Three things you'll know:\n1. Why most people fail at ${topic}\n2. The one step you need right now\n3. How to win without risk or complexity`,
    promotion:    `\n⚡ Limited offer:\n\n✔ {Prices|Results} you won't find elsewhere in ${topic}\n✔ No hidden fees or empty promises\n✔ Full satisfaction guarantee or full refund\n\n🔥 People who tried us — always come back`,
    question:     `\nLet me be honest:\n\nIn ${topic} — everyone promises but few deliver.\n\n❓ My question:\n— What's your biggest challenge in ${topic}?\n— What have you already tried?\n\n👇 Drop answers below — I'll reply to every one`
  };
  const ctas = {
    post:         `\n\n📲 Message now — instant response`,
    announcement: `\n\n📩 DM us for full details`,
    promotion:    `\n\n🛒 Reserve your spot — filling fast`,
    question:     `\n\n💬 Write below — all about the conversation`
  };
  const tags = {
    post:         `\n\n #${tag} #FreeTips #RealValue #TryItNow #ShareWithFriends`,
    announcement: `\n\n #${tag} #MustRead #GoldenOpportunity #DontMissThis #Exclusive`,
    promotion:    `\n\n #${tag} #SpecialOffer #SaveNow #SmartBuy #DontWait`,
    question:     `\n\n #${tag} #OpenDiscussion #YourOpinionMatters #RealExperiences #Community`
  };
  const t = type in hooks ? type : "post";
  return FormatHashtags((hooks[t] || "") + (values[t] || "") + (ctas[t] || "") + (tags[t] || ""));
}

// ══════════════════════════════════════════════════════════════════
//  SMART MARKETING VARIATION ENGINE v2
//  كل جروب يحصل على نسخة تسويقية مختلفة فعلاً:
//  ① hook مختلف (افتتاحية مختلفة من مكتبة جاهزة أو مشتقة من النص)
//  ② CTA مختلف (دعوة للتصرف بصياغة أخرى)
//  ③ ترتيب الفقرات يتحرك (الجسم الوسطي يُدار، الـ hook ثابت)
//  ④ مرادفات تسويقية بـ seed مختلف لكل جروب
//  ⑤ جملة ختامية متنوعة تضاف عشوائياً
//  ⑥ processSpintax بـ seed فريد يضمن اختيارات مختلفة لكل جروب
// ══════════════════════════════════════════════════════════════════
var SMART_VAR_HOOKS_AR = [
  ["⚡ أهم شيء ممكن تقرأه اليوم:", "🔥 لا تتجاهل هذا:", "💡 سؤال مهم ليك:"],
  ["هل سبق وفكرت في", "معظم الناس لا تعرف أن", "الحقيقة التي لا يقولها أحد عن"],
  ["🚀 خبر يستحق وقفة:", "📌 تفصيل مهم يغيب عن كثيرين:", "🎯 مباشرةً لصلب الموضوع:"],
  ["اسمعني جيداً...", "قبل أن تتجاوز هذا المنشور —", "شيء واحد فقط أريدك تعرفه:"],
  ["💎 القيمة الحقيقية هنا:", "✅ جرّب هذا بنفسك:", "📍 ملاحظة لا تنساها:"]
];
var SMART_VAR_HOOKS_EN = [
  ["⚡ Most important thing you'll read today:", "🔥 Don't scroll past this:", "💡 Quick question for you:"],
  ["Did you know that", "Most people don't realize", "The truth nobody tells you about"],
  ["🚀 Worth a pause:", "📌 Detail most people miss:", "🎯 Straight to the point:"],
  ["Listen carefully...", "Before you scroll away —", "One thing I want you to know:"],
  ["💎 Real value right here:", "✅ Try this yourself:", "📍 Note you won't forget:"]
];
var SMART_VAR_CTAS_AR = [
  "📲 راسلنا الآن وهنرد فوراً",
  "💬 اكتب 'أريد التفاصيل' في التعليقات",
  "📩 أرسل رسالة مباشرة للمزيد",
  "👇 اضغط المشاركة لو الموضوع أفادك",
  "🔔 تابعنا لا تفوتك التحديثات",
  "⬇️ اترك تعليقك واحصل على رد شخصي"
];
var SMART_VAR_CTAS_EN = [
  "📲 Message us now — instant reply",
  "💬 Comment 'Details' below",
  "📩 DM us for the full breakdown",
  "👇 Share if this helped you",
  "🔔 Follow us so you don't miss updates",
  "⬇️ Leave a comment for a personal reply"
];
var SMART_VAR_ENDINGS_AR = [
  "\n\n✨ هل هذا ينطبق عليك؟ أخبرنا في التعليقات.",
  "\n\n💭 ما رأيك؟ شاركنا تجربتك.",
  "\n\n🙋 لو عندك سؤال — الرد جاهز.",
  "\n\n📌 احفظ هذا المنشور قبل ما تنسى.",
  ""
];
var SMART_VAR_ENDINGS_EN = [
  "\n\n✨ Does this apply to you? Let us know below.",
  "\n\n💭 What do you think? Share your experience.",
  "\n\n🙋 Got a question? We're ready to answer.",
  "\n\n📌 Save this post before you forget.",
  ""
];

function buildVariations(rawTemplate, fixedLink, count, options) {
  options = options || {};
  var lang     = detectLang(rawTemplate);
  var isAr     = (lang === "ar");
  var preParsed = parseHashtagParts(rawTemplate);
  var savedTags = preParsed.hashtagLine
    ? preParsed.hashtagLine.split(/\s+/).filter(function(t){ return t.charAt(0) === "#"; })
    : [];
  var body = stripMetadata(rawTemplate);
  var link = String(fixedLink || extractFirstLink(rawTemplate) || "").trim();

  // ── Synonym pools ───────────────────────────────────────────────
  var SYNONYMS = isAr
    ? [
        ["مميز","احترافي","فاخر","قوي","استثنائي","رائع"],
        ["احجز","تواصل","ابدأ","راسلنا","اطلب","تفضّل"],
        ["الآن","اليوم","فوراً","حالاً","في أسرع وقت","بدون تأخير"],
        ["عرض","فرصة","خدمة","حل","ميزة","قيمة"],
        ["سريع","مرن","سلس","ذكي","عملي","فعّال"],
        ["أفضل","أقوى","أذكى","أنسب","أجمد","الأمثل"],
        ["كبير","ضخم","مؤثر","فارق","استثنائي","لا يُصدَّق"],
        ["يساعدك","يدعمك","يحميك","يُقدمك","يُطورك","يُغير حياتك"]
      ]
    : [
        ["premium","professional","elevated","refined","exceptional","outstanding"],
        ["contact","message","reach out","connect","book","get in touch"],
        ["now","today","right away","immediately","ASAP","without delay"],
        ["offer","opportunity","service","solution","advantage","value"],
        ["fast","smooth","smart","flexible","practical","efficient"],
        ["best","strongest","smartest","ideal","top-tier","optimal"],
        ["massive","huge","impactful","game-changing","incredible","transformative"],
        ["helps you","supports you","protects you","elevates you","transforms you","changes your life"]
      ];

  function escapeRegExp(v) { return String(v||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

  function rotateSynonyms(text, seed) {
    var out = String(text || "");
    SYNONYMS.forEach(function(pool, pi) {
      var chosen = pool[(seed * 3 + pi * 7) % pool.length];
      pool.forEach(function(word) {
        var rx = new RegExp(escapeRegExp(word), "gi");
        out = out.replace(rx, function(match, offset) {
          return ((offset + seed + pi) % 4 === 0) ? chosen : match;
        });
      });
    });
    return out;
  }

  function reorderBlocks(text, seed) {
    var t = String(text || "").trim();
    if (!t) return t;
    var blocks = t.split(/\n\n+/).map(function(b){ return b.trim(); }).filter(Boolean);
    if (blocks.length <= 2) return t;
    var head = blocks[0];
    var tail  = blocks.slice(1, -1);  // keep last block (CTA/hashtags) fixed too
    var last  = blocks[blocks.length - 1];
    if (tail.length > 1) {
      var shift = (seed * 2) % tail.length;
      tail = tail.slice(shift).concat(tail.slice(0, shift));
    }
    return [head].concat(tail).concat(last).join("\n\n");
  }

  function pickHook(seed) {
    var pool = isAr ? SMART_VAR_HOOKS_AR : SMART_VAR_HOOKS_EN;
    var row  = pool[(seed * 3) % pool.length];
    return row[(seed * 5) % row.length];
  }

  function pickCTA(seed) {
    var pool = isAr ? SMART_VAR_CTAS_AR : SMART_VAR_CTAS_EN;
    return pool[(seed * 7 + 2) % pool.length];
  }

  function pickEnding(seed) {
    var pool = isAr ? SMART_VAR_ENDINGS_AR : SMART_VAR_ENDINGS_EN;
    return pool[(seed * 11 + 3) % pool.length];
  }

  function injectHookVariation(text, seed) {
    // Replace the first line/sentence with a hook prefix if text starts with plain text
    var lines = String(text || "").split("\n");
    var first = (lines[0] || "").trim();
    // Only add hook if first line doesn't already start with emoji
    if (!/^[\u{1F300}-\u{1FFFF}🔥✅❌📌⚡💡🚀💎📲💬📩👇🔔⬇️]/u.test(first)) {
      var hook = pickHook(seed);
      lines[0] = hook + " " + first;
    }
    return lines.join("\n");
  }

  function injectCTAVariation(text, seed) {
    var cta = pickCTA(seed);
    var ending = pickEnding(seed);
    // Replace any existing CTA-like lines or append
    var ctaRx = /📲[^\n]*|📩[^\n]*|💬[^\n]*|👇[^\n]*|🔔[^\n]*/g;
    if (ctaRx.test(text)) {
      return text.replace(/📲[^\n]*|📩[^\n]*|💬[^\n]*/g, cta) + ending;
    }
    return text + "\n\n" + cta + ending;
  }

  return Array.from({ length: count }, function(_, i) {
    var seed = (i + 1) * 13;  // spread seeds widely for maximum variation

    // ① Spintax with unique seed
    var expanded = processSpintax(body, seed);

    // ② Synonym rotation with seed
    expanded = rotateSynonyms(expanded, seed);

    // ③ Block reorder (keeps hook fixed, rotates middle paragraphs)
    expanded = reorderBlocks(expanded, seed);

    // ④ Reconstruct with tags then run generateContent for link/hashtag assembly.
    //    NOTE: hook & CTA injection must happen AFTER generateContent because
    //    generateContent's internal stripMetadata() erases 📲 CTA lines.
    var withTags = savedTags.length
      ? [expanded, savedTags.join(" ")].filter(Boolean).join("\n\n")
      : expanded;

    var groupOptions = Object.assign({}, options, { seed: seed });
    var base = generateContent(withTags, link, groupOptions);

    // ⑤ Hook variation — runs AFTER generateContent so it is never stripped.
    //    Works even when the first line starts with an emoji: in that case the
    //    hook is inserted as a NEW opening line above the original first line.
    if (count > 1) {
      var hookPool = isAr ? SMART_VAR_HOOKS_AR : SMART_VAR_HOOKS_EN;
      var hookRow  = hookPool[(seed * 3) % hookPool.length];
      var hookText = hookRow[(seed * 5) % hookRow.length];
      var baseLines = base.split("\n");
      var firstLine = (baseLines[0] || "").trim();
      // Regex covers common emoji ranges + specific social-post emoji
      var startsWithEmoji = /^[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}🔥✅❌📌⚡💡🚀💎📲💬📩👇🔔⬇️✨💭🙋]/u.test(firstLine);
      if (startsWithEmoji) {
        baseLines.unshift(hookText);        // new opening line above the emoji line
      } else {
        baseLines[0] = hookText + " " + firstLine;
      }
      base = baseLines.join("\n");
    }

    // ⑥ CTA & ending variation — appended after all content.
    //    Removes any existing 📲/💬/📩 emoji-CTA lines first to avoid duplicates.
    if (count > 1) {
      var ctaPool    = isAr ? SMART_VAR_CTAS_AR    : SMART_VAR_CTAS_EN;
      var endingPool = isAr ? SMART_VAR_ENDINGS_AR  : SMART_VAR_ENDINGS_EN;
      var ctaText    = ctaPool   [(seed * 7  + 2) % ctaPool.length];
      var endText    = endingPool[(seed * 11 + 3) % endingPool.length];
      // Strip any existing CTA emoji lines (avoid duplicates from link assembly)
      base = base.replace(/\n+(📲|💬|📩|👇|🔔|⬇️)[^\n]*/g, "").trimEnd();
      base = base + "\n\n" + ctaText + endText;
    }

    return base;
  });
}

// ─── STORAGE ──────────────────────────────────────────────────────
const storageGet = keys => new Promise(r => chrome.storage.local.get(keys, r));
const storageSet = obj  => new Promise(r => chrome.storage.local.set(obj, r));

// ══════════════════════════════════════════════════════════════════════════
//  AI PROVIDERS — Gemini 1.5 Flash (أساسي) + HuggingFace Inference (بديل)
//  Gemini: https://aistudio.google.com/apikey  (مجاني ويدعم العربية)
//  HuggingFace: https://huggingface.co/settings/tokens  (رمز hf_...)
// ══════════════════════════════════════════════════════════════════════════
const GEMINI_BASE   = "https://generativelanguage.googleapis.com/v1beta/models/";
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.0-flash", "gemini-2.0-flash-lite"];
function geminiUrl(model, key) {
  return GEMINI_BASE + model + ":generateContent?key=" + encodeURIComponent(key);
}

// HuggingFace Inference API — موديلات مجانية تدعم العربية
const HF_ENDPOINT = "https://api-inference.huggingface.co/models/";
const HF_MODELS = [
  "Qwen/Qwen2.5-7B-Instruct",
  "google/gemma-2-2b-it",
  "HuggingFaceH4/zephyr-7b-beta"
];

const GEMINI_DEFAULT_MODEL = GEMINI_MODELS[0];
let   currentAIProvider    = "gemini";

function getDefaultAIEndpoint() { return geminiUrl(GEMINI_DEFAULT_MODEL, ""); }
function getDefaultAIModel()    { return GEMINI_DEFAULT_MODEL; }

function normalizeProvider(v) {
  v = String(v || "gemini").toLowerCase().trim();
  if (v === "hf" || v === "huggingface" || v === "hugging_face") return "huggingface";
  if (v === "groq") return "gemini"; // ترحيل قديم → Gemini
  return "gemini";
}

function getAIProviderSelectEl() {
  return $("aiProvider") || $("aiModelSelect");
}

function getAPIKeyInputEl() {
  return $("apiKey") || $("aiApiKey");
}

function getAPIKeyLabelEl() {
  return $("apiKeyLabel") || $("aiApiKeyLabel");
}

function getProviderKeyHintEl() {
  return $("providerKeyHint") || $("apiKeyHelpText");
}

function getStoredAIProvider(data) {
  if (data && data.aiProvider) return normalizeProvider(data.aiProvider);
  return "gemini";
}

function getStoredAPIKeyForProvider(data, provider) {
  if (!data) return "";
  provider = normalizeProvider(provider || data.aiProvider || "gemini");
  if (provider === "huggingface") {
    return String(data.hfApiKey || data.huggingfaceApiKey || data.apiKey || "").trim();
  }
  return String(data.geminiApiKey || data.apiKey || data.aiApiKey || "").trim();
}

function getLiveAIProvider() {
  var select = getAIProviderSelectEl();
  return normalizeProvider(select && select.value ? select.value : currentAIProvider);
}

function formatHttpStatus(status, statusText) {
  var text = String(statusText || "").trim();
  return String(status || 0) + (text ? " " + text : "");
}

function normalizeAIErrorMessage(message) {
  var msg = String(message || "").trim();
  if (!msg) return "خطأ غير معروف";
  if (/failed to fetch|networkerror|load failed|refused to connect|err_connection_refused/i.test(msg)) {
    return "❌ تعذّر الاتصال — تحقق من الإنترنت أو VPN.";
  }
  if (/invalid api key|invalid_api_key|no api key|401/i.test(msg)) {
    return "❌ مفتاح Gemini غير صالح.\n👉 تأكد من نسخه كاملاً من: aistudio.google.com/apikey → API Keys";
  }
  if (/permission denied|403/i.test(msg)) {
    return "❌ مفتاح مرفوض — تأكد إنك نسخت المفتاح كاملاً من aistudio.google.com/apikey";
  }
  if (/quota|exceeded|rate.?limit|429|413|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "⚠️ انتهت الحصة المجانية على كل الموديلات.\nانتظر دقيقة وحاول تاني — أو احصل على مفتاح جديد من:\nhttps://aistudio.google.com/apikey";
  }
  return msg;
}

function extractAIErrorMessage(errorPayload, fallbackStatus) {
  if (!errorPayload) return normalizeAIErrorMessage(fallbackStatus || "Unknown AI error");
  if (typeof errorPayload === "string") return normalizeAIErrorMessage(errorPayload || fallbackStatus);

  var details = errorPayload.error && Array.isArray(errorPayload.error.details) ? errorPayload.error.details : [];
  var structuredDetail = details.map(function(item) {
    if (!item) return "";
    return item.reason || item.message || item.domain || item['@type'] || "";
  }).filter(Boolean).join(" | ");

  var promptBlock = errorPayload.promptFeedback && errorPayload.promptFeedback.blockReason
    ? "Safety Filter Blocked: " + errorPayload.promptFeedback.blockReason
    : "";

  var candidateFinishReason = errorPayload.candidates && errorPayload.candidates[0] && errorPayload.candidates[0].finishReason
    ? String(errorPayload.candidates[0].finishReason)
    : "";

  if (/SAFETY/i.test(candidateFinishReason) && !promptBlock) {
    promptBlock = "Safety Filter Blocked";
  }

  var msg = promptBlock
    || (errorPayload.error && errorPayload.error.message)
    || errorPayload.message
    || (errorPayload.error && errorPayload.error.status)
    || structuredDetail
    || fallbackStatus
    || "Unknown AI error";

  return normalizeAIErrorMessage(msg);
}

async function persistProviderApiKey(provider, key) {
  provider = normalizeProvider(provider);
  key = String(key || "").trim();
  var payload = {
    aiProvider: provider,
    aiModelSelect: provider,
    apiKey: key,
    aiApiKey: key,
    aiEndpoint: provider === "huggingface" ? HF_ENDPOINT : getDefaultAIEndpoint(),
    aiModel: provider === "huggingface" ? HF_MODELS[0] : getDefaultAIModel()
  };
  if (provider === "huggingface") {
    payload.hfApiKey = key;
    payload.huggingfaceApiKey = key;
  } else {
    payload.geminiApiKey = key;
  }
  await storageSet(payload);
}

async function persistCurrentAIConfig() {
  var provider = getLiveAIProvider();
  var apiKeyInput = getAPIKeyInputEl();
  var apiKey = String(apiKeyInput && apiKeyInput.value || "").trim();
  await persistProviderApiKey(provider, apiKey);
  currentAIProvider = provider;
  return { provider: provider, apiKey: apiKey };
}

async function syncAIProviderUI(provider, opts) {
  opts = opts || {};
  provider = normalizeProvider(provider);
  currentAIProvider = provider;

  var select = getAIProviderSelectEl();
  var apiKeyLabel = getAPIKeyLabelEl();
  var apiKeyInput = getAPIKeyInputEl();
  var providerHint = getProviderKeyHintEl();
  var data = opts.data || await storageGet(["apiKey", "aiApiKey", "geminiApiKey", "aiProvider", "aiModelSelect"]);
  var storedProviderKey = getStoredAPIKeyForProvider(data, provider);

  if (select) select.value = provider;
  if (apiKeyLabel) {
    apiKeyLabel.textContent = provider === "huggingface" ? "HuggingFace Token" : "Gemini API Key";
  }
  if (apiKeyInput) {
    apiKeyInput.placeholder = provider === "huggingface"
      ? "hf_xxxxxxxxxxxxxxxx"
      : "AIzaSy... (من Google AI Studio)";
    apiKeyInput.setAttribute("data-provider", provider);
    if (!opts.keepInputValue) {
      apiKeyInput.value = storedProviderKey;
    }
  }
  if (providerHint) {
    providerHint.textContent = provider === "huggingface"
      ? "موصى به: Qwen2.5 أو Gemma-2 عبر Inference API — https://huggingface.co/settings/tokens"
      : "موصى به: gemini-1.5-flash — احصل على مفتاح مجاني: https://aistudio.google.com/apikey";
  }
}

// ─── AI GENERATION ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
//  PRO-MASTER: generateAIContent
//  — Dynamic tone-based prompts
//  — Smart hashtag generator (3-5 tags auto-appended by AI)
//  — WhatsApp CTA always formatted as "تواصل معنا: [link]" / "Contact us: [link]"
//  — Spintax in 4-6 places, AIDA/PAS structure randomised per call
// ═══════════════════════════════════════════════════════════════════════
/**
 * generateAIContent — Smart-Extraction AI pipeline
 *
 * Flow:
 *  1. Strip existingContent → pure Core Message (not sent to AI)
 *  2. Send ONLY topic + tone/style to Gemini → clean AI body (no URLs, no hashtags)
 *  3. Reassemble: [AI Body] + "\n\n" + [formattedLink] + "\n\n" + [hashtagLine]
 *
 * Re-clicking "Generate" / "Change Text" is always safe:
 *   — existingContent is sanitized fresh every call via stripMetadata()
 *   — The link is extracted once from fixedLink (authoritative) or existingContent
 *   — Hashtags are harvested before sanitisation, so user tags survive the wipe
 *
 * @param {string} topic           — AI generation topic
 * @param {string} tone            — Tone key (professional | aggressive_sales | …)
 * @param {string} type            — Content type (post | announcement | promotion | question)
 * @param {string} lang            — Language (auto | ar | en)
 * @param {string} apiKey          — Gemini API key
 * @param {string} endpoint        — Gemini endpoint URL
 * @param {string} model           — Gemini model name
 * @param {string} aiProvider      — gemini
 * @param {string} [existingContent=""] — Current textarea value (used for link + hashtag extraction)
 * @param {string} [fixedLink=""]       — Explicit link from the fixedLink input field
 * @param {string} [extraHashtags=""]   — Any additional hashtags to always append
 */
async function generateAIContent(topic, tone, type, lang, existingContent, fixedLink, extraHashtags) {
  if (!String(topic || "").trim()) return null;

  var cfg = {};
  try {
    cfg = await storageGet(["apiKey", "aiApiKey", "aiProvider", "aiModelSelect", "aiEndpoint", "aiModel", "geminiApiKey"]);
  } catch (_) {}

  var provider = normalizeProvider(
    (getAIProviderSelectEl() && getAIProviderSelectEl().value) || cfg.aiProvider || currentAIProvider || "gemini"
  );
  currentAIProvider = provider;
  var liveApiKey = String((getAPIKeyInputEl() && getAPIKeyInputEl().value) || "").trim();
  var apiKey = liveApiKey || getStoredAPIKeyForProvider(Object.assign({}, cfg, { hfApiKey: cfg.hfApiKey }), provider);
  // وسّع قراءة المفتاح
  if (!apiKey) {
    try {
      var more = await storageGet(["geminiApiKey", "hfApiKey", "huggingfaceApiKey", "groqApiKey"]);
      apiKey = getStoredAPIKeyForProvider(more, provider) || String(more.apiKey || "").trim();
    } catch (_) {}
  }

  try {
    await persistProviderApiKey(provider, apiKey);
  } catch (_) {}

  if (!apiKey) return generateLocalContent(topic, tone, type, lang);

  var _existing = normalizeText(existingContent || "");
  var _fixedLnk = String(fixedLink || "").trim();
  var _resolvedLink = _fixedLnk || extractFirstLink(_existing) || "";
  var _preStripParsed = parseHashtagParts(_existing);
  var _savedTags = _preStripParsed.hashtagLine
    ? _preStripParsed.hashtagLine.split(/\s+/).filter(function(t){ return t.charAt(0) === "#"; })
    : [];

  if (extraHashtags && String(extraHashtags).trim()) {
    String(extraHashtags).trim().split(/\s+/).forEach(function(t) {
      t = t.trim();
      if (!t) return;
      if (t.charAt(0) !== "#") t = "#" + t;
      if (!_savedTags.find(function(x){ return x.toLowerCase() === t.toLowerCase(); })) {
        _savedTags.push(t);
      }
    });
  }

  const isAr = lang === "ar" || (lang === "auto" && detectLang(topic) === "ar");

  const TONE_BLUEPRINTS = {
    professional: {
      label_ar: "مهني واحترافي",
      label_en: "authoritative and professional",
      style_ar: "استخدم لغة راقية ورسمية. ابنِ مصداقية بالأرقام والحقائق. اجعل القارئ يثق بك كخبير.",
      style_en: "Use polished, authoritative language. Build credibility with facts and data. Position yourself as the trusted expert in the space.",
      structure_ar: "AIDA: افتح بحقيقة مدهشة → اشرح القيمة بالتفصيل → عزّز بدليل اجتماعي → CTA واضح",
      structure_en: "AIDA: Open with a compelling fact → Detail the value proposition → Reinforce with social proof → Clear CTA",
      temp: 0.75
    },
    aggressive_sales: {
      label_ar: "مبيعات عدواني وحماسي",
      label_en: "aggressive, high-energy sales",
      style_ar: "استخدم لغة شديدة الإلحاح. أضف ندرة حقيقية (عدد محدود، وقت محدود). اضغط على FOMO بشكل صريح. CTA مباشر وعدواني.",
      style_en: "Maximum urgency language. Real scarcity (limited spots, deadline). Hammer FOMO hard. Direct, aggressive CTA that demands action NOW.",
      structure_ar: "PAS المضخّم: مشكلة مؤلمة → تضخيم العواقب → الحل الوحيد أنت → عرض لا يُردّ مع FOMO → CTA عدواني",
      structure_en: "Amplified PAS: Painful problem → Agitate consequences → YOU are the only solution → Irresistible offer with FOMO → Aggressive CTA",
      temp: 0.92
    },
    friendly: {
      label_ar: "ودود واجتماعي",
      label_en: "warm, friendly and conversational",
      style_ar: "تحدث كصديق لا كبائع. استخدم الفكاهة بخفة. اجعل القارئ يشعر بالانتماء لمجتمع.",
      style_en: "Talk like a trusted friend, not a salesperson. Light humor welcome. Make the reader feel part of a community.",
      structure_ar: "قصة شخصية قصيرة → ربط بتجربة القارئ → قيمة عملية → CTA دافئ",
      structure_en: "Short personal story → Connect to reader's experience → Practical value → Warm CTA",
      temp: 0.88
    },
    storytelling: {
      label_ar: "سرد قصصي درامي",
      label_en: "dramatic storytelling / narrative",
      style_ar: "ابدأ بمنتصف القصة (in medias res). اخلق توتراً درامياً. اجعل القارئ يرى نفسه في القصة. الحل يأتي كنهاية طبيعية للقصة.",
      style_en: "Start in the middle of the action (in medias res). Build dramatic tension. Make the reader see themselves in the story. The solution arrives as the natural story resolution.",
      structure_ar: "مشهد درامي → صراع ← تحوّل → دروس مستفادة → CTA",
      structure_en: "Dramatic scene → Conflict → Turning point → Lesson learned → CTA",
      temp: 0.9
    },
    urgent: {
      label_ar: "عاجل وآني",
      label_en: "urgent and time-sensitive",
      style_ar: "كل جملة تُشعر بالضغط الزمني. استخدم أرقاماً تنازلية أو مواعيد نهائية. لا مكان للتردد.",
      style_en: "Every sentence creates time pressure. Use countdown language and hard deadlines. Zero room for hesitation.",
      structure_ar: "تحذير عاجل → السبب → ما ستخسره → CTA فوري",
      structure_en: "Urgent warning → The reason why → What they'll lose → Immediate CTA",
      temp: 0.82
    },
    persuasive: {
      label_ar: "إقناع منطقي",
      label_en: "logical persuasion and reason",
      style_ar: "بنِ حجةً لا تُردّ خطوة بخطوة. استخدم منطق سببية (لأن... لذلك...). أجب على الاعتراضات مسبقاً.",
      style_en: "Build an irrefutable case step by step. Use causal logic (because... therefore...). Pre-answer objections before they arise.",
      structure_ar: "ادعاء جريء → 3 أدلة → رد على الاعتراض الرئيسي → CTA منطقي",
      structure_en: "Bold claim → 3 proofs → Refute the main objection → Logical CTA",
      temp: 0.78
    }
  };

  const bp = TONE_BLUEPRINTS[tone] || TONE_BLUEPRINTS.professional;

  const promptAr = `اكتب منشور فيسبوك عن: ${topic}

الأسلوب: ${bp.label_ar} — ${bp.style_ar}
الهيكل: ${bp.structure_ar}
النوع: ${type}

القواعد الصارمة:
١. أول كلمة في ردك = أول كلمة في المنشور — بدون أي مقدمة.
٢. لا تكتب الموضوع أو الطلب في البداية.
٣. Hook يوقف التمرير في أول سطر.
٤. سطر فارغ بين كل فقرة.
٥. إيموجي في الأماكن المؤثرة فقط — مش كل سطر.
٦. CTA قوي في الآخر (اتواصل / علّق / شير).
٧. الطول: 180-250 كلمة.
٨. Spintax: {خيار_أ|خيار_ب|خيار_ج} في 5 مواضع على الأقل.
٩. كلمات بحث رائجة مدمجة طبيعياً في النص.
١٠. سطر فارغ ثم بالضبط 5 هاشتاجات كل واحد على سطر منفصل.
١١. ممنوع: ** أو * أو # في النص أو Markdown أو روابط.`;

  const promptEn = `Write a Facebook post about: ${topic}

Tone: ${bp.label_en} — ${bp.style_en}
Structure: ${bp.structure_en}
Type: ${type}

Strict rules:
1. First word of your response = first word of the post. No intro whatsoever.
2. Do NOT restate the topic or request at the start.
3. Scroll-stopping hook on line 1.
4. Blank line between every paragraph.
5. Emojis at impactful moments only — not every line.
6. Strong CTA at the end (contact / comment / share).
7. Length: 180-250 words.
8. Spintax: {optA|optB|optC} in at least 5 positions.
9. Embed 3-4 trending search keywords naturally.
10. Blank line then EXACTLY 5 hashtags each on its own line.
11. FORBIDDEN: **, *, # in body text, Markdown, URLs.`;

  var promptText = isAr ? promptAr : promptEn;

  // ── System message — يمنع الموديل من تكرار الطلب أو كتابة مقدمة ──
  var systemMsg = isAr
    ? "أنت خبير تسويق رقمي مصري. اكتب منشور فيسبوك بصيغة Spintax دقيقة (مثال: {مرحباً|أهلاً} {يا أصدقاء|يا جماعة}) مع تنويع الـ Hook والـ CTA، لضمان عدم تكرار المحتوى وتجنب حظر فيسبوك. النبرة حسب طلب المستخدم. ابدأ ردك بأول كلمة من المنشور مباشرةً بدون أي مقدمة."
    : "You are an elite Egyptian digital marketer. Write a Facebook post in precise Spintax ({Hi|Hello} {friends|everyone}), vary Hook and CTA to avoid Facebook bans. Match the user tone. Start with the first word of the post — no preamble.";

  // ── دالة تشيل أي مقدمة تسرّبت من الموديل ──────────────────────────
  function removePreamble(text) {
    if (!text) return text;
    // أنماط المقدمات الشائعة التي قد يكتبها الموديل
    var preamblePatterns = [
      /^(بالطبع|طبعاً|إليك|هذا هو|فيما يلي|ها هو|تفضل|حسناً)[،:!\s]*/i,
      /^(Sure[!,.]?|Here(?:'s| is)|Of course[!,.]?|Below is|Here you go)[:\s]*/i,
      /^الطلب[:\s]*"[^"]*"[:\s]*/i,
      /^Request[:\s]*"[^"]*"[:\s]*/i,
      /^(منشور فيسبوك|Facebook Post|Post)[:\s-]*/i,
    ];
    var cleaned = text;
    var changed = true;
    while (changed) {
      changed = false;
      preamblePatterns.forEach(function(rx) {
        var after = cleaned.replace(rx, "");
        if (after !== cleaned) { cleaned = after.trimStart(); changed = true; }
      });
    }
    return cleaned;
  }

  var requestHeaders = { "Content-Type": "application/json" };
  var combinedPrompt = systemMsg + "\n\n" + promptText;
  var tempVal = typeof bp.temp === "number" ? bp.temp : 0.7;

  // ── استدعاء Gemini أو HuggingFace مع معالجة أخطاء واضحة ──────────────
  async function fetchGemini(model) {
    var body = {
      contents: [{ role: "user", parts: [{ text: combinedPrompt }] }],
      generationConfig: { temperature: tempVal, maxOutputTokens: 2048, topP: 0.95 }
    };
    return fetch(geminiUrl(model, apiKey), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body)
    });
  }

  async function fetchHuggingFace(model) {
    // صيغة chat-style عبر Inference API
    var body = {
      inputs: combinedPrompt,
      parameters: { max_new_tokens: 1024, temperature: tempVal, return_full_text: false }
    };
    return fetch(HF_ENDPOINT + model, {
      method: "POST",
      headers: Object.assign({}, requestHeaders, { "Authorization": "Bearer " + apiKey }),
      body: JSON.stringify(body)
    });
  }

  var res = null;
  var lastErr = null;
  var lastQuotaErr = null;
  var models = provider === "huggingface" ? HF_MODELS : GEMINI_MODELS;
  try {
    for (var _mi = 0; _mi < models.length; _mi++) {
      try {
        var _r = provider === "huggingface"
          ? await fetchHuggingFace(models[_mi])
          : await fetchGemini(models[_mi]);
        if (_r.ok) { res = _r; break; }
        if (_r.status === 404) { continue; }
        if (_r.status === 429 || _r.status === 503) { lastQuotaErr = _r; continue; }
        res = _r; break;
      } catch (e) { lastErr = e; }
    }
    if (!res) res = lastQuotaErr;
    if (!res && lastErr) throw lastErr;
  } catch (networkErr) {
    throw new Error(normalizeAIErrorMessage(
      networkErr && networkErr.message ? networkErr.message : "تعذّر الاتصال بمزوّد الذكاء الاصطناعي. تحقق من الإنترنت."
    ));
  }

  var rawText = "";
  var data = null;
  try {
    rawText = await res.text();
    data = rawText ? JSON.parse(rawText) : null;
  } catch (_) { data = null; }

  if (!res || !res.ok) {
    var statusHint = res ? formatHttpStatus(res.status, res.statusText) : "لا استجابة";
    throw new Error(extractAIErrorMessage(data || rawText, statusHint));
  }

  // ── استخراج الرد حسب المزوّد ────────────────────────────────────────
  var aiRaw = "";
  try {
    if (provider === "huggingface") {
      if (Array.isArray(data) && data[0] && data[0].generated_text) {
        aiRaw = String(data[0].generated_text).trim();
      } else if (data && data.generated_text) {
        aiRaw = String(data.generated_text).trim();
      } else if (typeof data === "string") {
        aiRaw = data.trim();
      }
    } else {
      // Gemini generateContent
      var cand = data && data.candidates && data.candidates[0];
      var parts = cand && cand.content && cand.content.parts;
      if (parts && parts.length) {
        aiRaw = parts.map(function(pt){ return pt.text || ""; }).join("\n").trim();
      }
    }
  } catch (parseErr) {
    throw new Error(normalizeAIErrorMessage(
      parseErr && parseErr.message ? parseErr.message : "خطأ في قراءة رد الذكاء الاصطناعي"
    ));
  }

  if (!aiRaw) {
    throw new Error(extractAIErrorMessage(data, "رد فارغ من مزوّد الذكاء الاصطناعي"));
  }

  // ── تنظيف رموز Markdown قبل أي معالجة ───────────────────────────────
  aiRaw = stripMarkdown(aiRaw);

  // ── إزالة أي مقدمة تسرّبت من الموديل ────────────────────────────────
  aiRaw = removePreamble(aiRaw);

  // FIX: حفظ هاشتاجات الـ AI قبل stripMetadata يمسحها
  var _aiTagsParsed = parseHashtagParts(aiRaw);
  var _aiTags = _aiTagsParsed.hashtagLine
    ? _aiTagsParsed.hashtagLine.split(/\s+/).filter(function(t){ return t.charAt(0) === "#"; })
    : [];
  _aiTags.forEach(function(tag) {
    if (!_savedTags.find(function(x){ return x.toLowerCase() === tag.toLowerCase(); }))
      _savedTags.push(tag);
  });

  var _aiBody = stripMetadata(aiRaw);
  var _lang = detectLang(_aiBody);
  var _ctaBlock = "";
  if (_resolvedLink) {
    var _isWa = /wa\.me|whatsapp/i.test(_resolvedLink);
    if (_isWa) {
      _ctaBlock = _lang === "ar"
        ? "📲 تواصل معنا عبر واتساب:\n" + _resolvedLink
        : "📲 Contact us on WhatsApp:\n" + _resolvedLink;
    } else {
      _ctaBlock = _resolvedLink;
    }
  }

  var _aiFinalParsed = parseHashtagParts(_aiBody, _savedTags);
  var _finalBody = _aiFinalParsed.body;
  var _hashtagLine = _aiFinalParsed.hashtagLine;
  var _sections = [];
  if (_finalBody) _sections.push(_finalBody);
  if (_ctaBlock) _sections.push(_ctaBlock);
  if (_hashtagLine) _sections.push(_hashtagLine);

  return cleanText(_sections.filter(Boolean).join("\n\n"));
}

// ─── DOM UTILS ────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "";
}

// ─── STATE ────────────────────────────────────────────────────────
let allGroups      = [];
let filteredGroups = [];
let selectedGroups = [];
let presets        = {};
let postLog        = [];
let isPosting      = false;
let isPaused       = false;
let imageDataUrl   = null;
let selectedMediaFiles = [];
let smartVariationEnabled = true;
let antiSpamRandomizerEnabled = false;

// ─── INIT ─────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function() {

  // ── Port keepalive: keeps background service worker alive while popup is open ──
  (function startKeepalivePort() {
    try {
      var port = chrome.runtime.connect({ name: "keepalive" });
      port.onDisconnect.addListener(function() {
        setTimeout(startKeepalivePort, 1000);
      });
    } catch (_) {}
  })();

  // ── contenteditable #postContent shim — exposes .value like a textarea ──
  (function shimPostContent() {
    var el = document.getElementById("postContent");
    if (!el || el.tagName === "TEXTAREA") return; // already a textarea, no shim needed

    function getText() {
      // Preserve newlines: <br> and <div> → \n
      var html = el.innerHTML;
      return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<div>/gi, "\n")
        .replace(/<\/div>/gi, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/<[^>]+>/g, "")  // strip remaining tags
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
    }

    function setText(v) {
      var escaped = String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      el.innerHTML = escaped;
    }

    // Define .value as a property on the element
    Object.defineProperty(el, "value", {
      get: getText,
      set: setText,
      configurable: true
    });

    // Show/hide placeholder
    el.addEventListener("input",  function() { el.dispatchEvent(new Event("change", {bubbles:true})); });
    el.addEventListener("keydown", function(e) {
      // Tab key: insert 2 spaces instead of moving focus
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
      }
    });
  })();
  try {
    var redirected = await ensureFullscreenMobileMode();
    // مهم: مينفعش نثق في "redirected" وحدها. لو chrome.tabs.create نجحت
    // وبعدها window.close() فشلت بصمت (Chrome بيرفضها أحيانًا لأسباب أمنية
    // لو الصفحة مش اتفتحت بطريقة برمجية pure)، كان بيحصل إن الصفحة القديمة
    // تفضل مفتوحة قدام المستخدم لكن من غير أي تهيئة خالص — الزرارات كلها
    // (بما فيها تبديل الثيم) بتفضل معطّلة تمامًا بصمت، من غير أي خطأ ظاهر.
    // الحل: نتأكد فعليًا إن الصفحة اتقفلت (أو بقت مخفية) قبل ما نمنع التهيئة؛
    // لو لسه ظاهرة، لازم نكمل التهيئة عادي بدل ما نفترض إنها هتقفل قريب.
    if (redirected) {
      await new Promise(function(r) { setTimeout(r, 150); });
      if (document.hidden || document.visibilityState === "hidden") return;
      console.warn("ensureFullscreenMobileMode: redirect reported but page still visible — continuing init as a safety net");
    }
  } catch (e) {
    console.warn("ensureFullscreenMobileMode", e);
  }

  initTabs();
  try { initLpTheme(); } catch(e) { console.warn("initLpTheme", e); }
  loadSettings().then(function() {
    try { initTheme();       } catch(e) { console.warn("initTheme",    e); }
    try { initCompose();     } catch(e) { console.warn("initCompose",  e); }
    try { initGroups();      } catch(e) { console.warn("initGroups",   e); }
    try { initSettings();    } catch(e) { console.warn("initSettings", e); }
    try { initLog();         } catch(e) { console.warn("initLog",      e); }
    try { initPowerButton(); } catch(e) { console.warn("initPower",    e); }
    try { initPauseButton();  } catch(e) { console.warn("initPause",    e); }
    try { startLogPolling(); } catch(e) { console.warn("polling",      e); }
  }).catch(function(e) {
    console.warn("loadSettings failed:", e);
    try { initLpTheme();     } catch(_) {}
    try { initTheme();       } catch(_) {}
    try { initCompose();     } catch(_) {}
    try { initGroups();      } catch(_) {}
    try { initSettings();    } catch(_) {}
    try { initLog();         } catch(_) {}
    try { initPowerButton(); } catch(_) {}
    try { startLogPolling(); } catch(_) {}
  });
});

function ensureFullscreenMobileMode() {
  return new Promise(function(resolve) {
    var params = new URLSearchParams(location.search || "");
    var isFullMode = params.get("mode") === "full";
    var isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) <= 900;

    if (isFullMode) {
      document.documentElement.classList.add("fullscreen-tab");
      document.body.classList.add("fullscreen-tab");
      document.body.dataset.surface = "tab";
      resolve(false);
      return;
    }

    if (!isMobile || !chrome.tabs || !chrome.tabs.getCurrent || !chrome.tabs.create) {
      document.body.dataset.surface = "popup";
      resolve(false);
      return;
    }

    chrome.tabs.getCurrent(function(tab) {
      if (tab && tab.id) {
        document.documentElement.classList.add("fullscreen-tab");
        document.body.classList.add("fullscreen-tab");
        document.body.dataset.surface = "tab";
        resolve(false);
        return;
      }

      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?mode=full") }, function() {
        try { window.close(); } catch (_) {}
        resolve(true);
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════════════
function initTabs() {
  var tabs = Array.from($$(".tab"));
  tabs.forEach(function(tab) {
    var lastT = 0;
    function activate(e) {
      var now = Date.now();
      if (now - lastT < 350) return;
      lastT = now;
      if (e && e.cancelable) { try { e.preventDefault(); } catch(_){} }
      var name = tab.getAttribute("data-tab");
      switchTab(name);
      try { history.replaceState(null, "", "#" + name); } catch (_) {}
    }
    var _tabTouchFired = false;
    tab.addEventListener("touchend", function(e){
      _tabTouchFired = true;
      setTimeout(function(){ _tabTouchFired = false; }, 600);
      activate(e);
    }, {passive:false});
    tab.addEventListener("click", function(e){
      if (_tabTouchFired) return;
      activate(e);
    });
  });

  var initialName = (location.hash || "").replace(/^#/, "");
  if (initialName && document.getElementById("tab-" + initialName)) {
    switchTab(initialName);
  }
}

function switchTab(name) {
  $$(".tab").forEach(function(t){
    var active = t.getAttribute("data-tab") === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active ? "true" : "false");
  });
  $$(".tab-content").forEach(function(c){ c.classList.remove("active"); });
  var btn   = document.querySelector('[data-tab="' + name + '"]');
  var panel = document.getElementById("tab-" + name);
  if (btn)   btn.classList.add("active");
  if (panel) {
    panel.classList.add("active");
    panel.scrollTop = 0;
  }
}

function connectUiKeepAlive() {
  var port = null;
  var reconnectTimer = null;

  function pulse(source) {
    try {
      chrome.runtime.sendMessage({
        action: "HEARTBEAT",
        source: source || "popup-ui",
        hidden: typeof document !== "undefined" ? !!document.hidden : false,
        frozen: false,
        url: location.href,
        ts: Date.now()
      }, function(){ void chrome.runtime.lastError; });
    } catch (_) {}
  }

  function connect() {
    try {
      if (port) return;
      port = chrome.runtime.connect({ name: "keepalive" });
      pulse("popup-connect");
      port.onDisconnect.addListener(function() {
        port = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1500);
      });
    } catch (_) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  }

  connect();
  setInterval(function(){ pulse("popup-interval"); }, 15000);
  document.addEventListener("visibilitychange", function(){ pulse("popup-visibility"); }, true);
  window.addEventListener("pageshow", function(){ pulse("popup-pageshow"); }, true);
}

// ─── THEME ────────────────────────────────────────────────────────
function initTheme() {
    // Three themes: dark → violet → light → dark
    var THEMES = ["dark", "violet", "light"];

    function applyTheme(t) {
      document.body.classList.remove("dark", "violet", "light");
      document.body.classList.add(t);
      var moonEl    = $("moonIcon");
      var sunEl     = $("sunIcon");
      var violetEl  = $("violetIcon");
      if (moonEl)   moonEl.style.display   = t === "dark"   ? "block" : "none";
      if (sunEl)    sunEl.style.display    = t === "light"  ? "block" : "none";
      if (violetEl) violetEl.style.display = t === "violet" ? "block" : "none";
      var btn = $("themeToggle");
      if (btn) btn.title = t === "dark" ? "🌙 ليلي — اضغط للتغيير" : (t === "violet" ? "⭐ بنفسجي — اضغط للتغيير" : "☀️ نهاري — اضغط للتغيير");
      chrome.storage.local.set({ appTheme: t, darkMode: t === "dark" });
    }

    chrome.storage.local.get(["appTheme", "darkMode"], function(d) {
      var theme = d.appTheme;
      if (!theme) theme = (d.darkMode !== false) ? "dark" : "light";
      if (THEMES.indexOf(theme) === -1) theme = "dark";
      applyTheme(theme);
    });

    var toggleBtn = $("themeToggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function() {
        chrome.storage.local.get(["appTheme", "darkMode"], function(d) {
          var current = d.appTheme;
          if (!current) current = (d.darkMode !== false) ? "dark" : "light";
          if (THEMES.indexOf(current) === -1) current = "dark";
          var next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
          applyTheme(next);
        });
      });
    }
  }

// ── LP theme toggle (in landing page nav — separate from app header) ──
function initLpTheme() {
    var btn  = $("lpThemeToggle");
    var moon = $("lpMoonIcon");
    var sun  = $("lpSunIcon");
    if (!btn) return;

    var THEMES = ["dark", "violet", "light"];

    function _applyLp(t) {
      document.body.classList.remove("dark", "violet", "light");
      document.body.classList.add(t);
      if (moon) moon.style.display = t === "dark"   ? "block" : "none";
      if (sun)  sun.style.display  = t === "light"  ? "block" : "none";
      // sync app-header icons
      var appMoon   = $("moonIcon");
      var appSun    = $("sunIcon");
      var appViolet = $("violetIcon");
      if (appMoon)   appMoon.style.display   = t === "dark"   ? "block" : "none";
      if (appSun)    appSun.style.display    = t === "light"  ? "block" : "none";
      if (appViolet) appViolet.style.display = t === "violet" ? "block" : "none";
      chrome.storage.local.set({ appTheme: t, darkMode: t === "dark" });
    }

    chrome.storage.local.get(["appTheme", "darkMode"], function(d) {
      var theme = d.appTheme || (d.darkMode !== false ? "dark" : "light");
      _applyLp(theme);
    });

    btn.addEventListener("click", function() {
      chrome.storage.local.get(["appTheme", "darkMode"], function(d) {
        var current = d.appTheme || (d.darkMode !== false ? "dark" : "light");
        var next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
        _applyLp(next);
      });
    });
  }

// ─── COMPOSE ──────────────────────────────────────────────────────
function initCompose() {
  $("generateAI").addEventListener("click", handleGenerateAI);
  var dashBtn = $("openDashboardBtn"); if (dashBtn) dashBtn.addEventListener("click", function(){ chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }); });

  // Preview button — shows one spintax variation
  $("previewSpintax").addEventListener("click", function() {
    var raw  = $("postContent").value;
    var link = $("fixedLink").value.trim();
    if (!raw) return;
    var preview = generateContent(raw, link, {
      linkPosition: "end",
      smartVariation: smartVariationEnabled,
      antiSpamRandomizer: antiSpamRandomizerEnabled
    });
    $("previewText").textContent = preview;
    $("spintaxPreview").style.display = "block";
  });

  // ② Randomize button — generates a NEW random spintax variation each click
  $("randomizeSpintax").addEventListener("click", function() {
    var raw  = $("postContent").value;
    var link = $("fixedLink").value.trim();
    if (!raw) {
      showToast("اكتب المحتوى أولاً", "warning");
      return;
    }
    // Always process spintax to get a new random variation
    var randomized = generateContent(raw, link, {
      linkPosition: "end",
      smartVariation: false,  // Don't add invisible chars in preview
      antiSpamRandomizer: antiSpamRandomizerEnabled,
      processSpintax: true
    });
    $("previewText").textContent = randomized;
    $("spintaxPreview").style.display = "block";

    // Check if content has spintax patterns
    if (/\{[^{}]+\|[^{}]+\}/.test(raw)) {
      showToast("تم توليد نسخة عشوائية جديدة", "success");
    } else {
      showToast("لا يوجد Spintax — أضف {خيار1|خيار2}", "info");
    }
  });

  $("clearContent").addEventListener("click", function() {
    $("postContent").value = "";
    $("spintaxPreview").style.display = "none";
  });

  $("postContent").addEventListener("input", function() {
    var found = extractFirstLink($("postContent").value);
    if (found && !$("fixedLink").value.trim()) $("fixedLink").value = found;
  });

  $("smartVariationBtn").addEventListener("click", async function() {
    smartVariationEnabled = !smartVariationEnabled;
    if (smartVariationEnabled && $("uniqueSpintax")) $("uniqueSpintax").checked = true;
    await storageSet({smartVariation: smartVariationEnabled, uniqueSpintax: $("uniqueSpintax") ? $("uniqueSpintax").checked : true});
    updateSmartVariationButton();
    showToast(
      smartVariationEnabled
        ? "✅ تنويع النصوص مفعّل — كل جروب سيحصل على نسخة مختلفة"
        : "⚠️ تنويع النصوص معطّل — كل الجروبات ستحصل على نفس النص",
      smartVariationEnabled ? "success" : "warning"
    );
  });

  $("antiSpamRandomizer").addEventListener("change", async function(e) {
    antiSpamRandomizerEnabled = !!e.target.checked;
    await storageSet({ antiSpamRandomizer: antiSpamRandomizerEnabled });
    showToast(antiSpamRandomizerEnabled ? "تم تفعيل Anti-spam" : "تم إيقاف Anti-spam", "info");
  });

  $("enableComment").addEventListener("change", function(e) {
    $("commentSection").style.display = e.target.checked ? "block" : "none";
  });

  $("spintaxHelp").addEventListener("click",  function(){ $("spintaxModal").style.display = "flex"; });
  $("closeModal").addEventListener("click",   function(){ $("spintaxModal").style.display = "none"; });
  $("modalOverlay").addEventListener("click", function(){ $("spintaxModal").style.display = "none"; });

  updateSmartVariationButton();
  initImageUpload();
}

function updateSmartVariationButton() {
  var btn = $("smartVariationBtn");
  if (!btn) return;
  var onLabel  = "تنويع النصوص: مفعّل ✓";
  var offLabel = "تنويع النصوص: مُعطّل";
  btn.textContent = smartVariationEnabled ? onLabel : offLabel;
  btn.classList.remove("btn-primary","btn-outline","btn-variation-active","btn-variation-off");
  if (smartVariationEnabled) {
    btn.classList.add("btn-variation-active");
  } else {
    btn.classList.add("btn-variation-off","btn-outline");
  }
}

async function handleGenerateAI() {
  var topic = $("aiTopic").value.trim();
  var tone  = $("aiTone").value;
  var type  = $("aiType").value;
  var lang  = $("aiLang").value;
  if (!topic) { showToast("Enter a topic first", "warning"); return; }

  var btn = $("generateAI");
  btn.disabled = true;
  btn.textContent = "Generating...";

  var existingContent = $("postContent").value;
  var existingLink = $("fixedLink").value.trim();

  try {
    var text = await generateAIContent(topic, tone, type, lang, existingContent, existingLink, "");
    if (text) {
      $("postContent").value = text;
      var embeddedLink = extractFirstLink(text);
      if (embeddedLink && !existingLink) {
        $("fixedLink").value = embeddedLink;
      }
      showToast("Content generated!", "success");
    }
  } catch (err) {
    var errorMessage = normalizeAIErrorMessage(err && err.message ? err.message : err);
    console.error("[AI]", errorMessage, err);
    try { chrome.runtime.sendMessage({ action: "API_ERROR", error: errorMessage }); } catch (_) {}
    showToast(errorMessage, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate with AI";
  }
}

// ─── V5.5: Media Upload (images + video) — wired to actual DOM ──────
function initImageUpload() {
  var MAX_MEDIA      = 10;
  var MAX_IMG_SIZE   = 25 * 1024 * 1024;   // 25 MB per image
  var MAX_VID_SIZE   = 100 * 1024 * 1024;  // 100 MB per video

  var area      = document.getElementById("imageUploadArea");
  var input     = document.getElementById("imageInput");
  var emptyView = document.getElementById("imageEmpty");
  var strip     = document.getElementById("mediaStrip");
  var items     = document.getElementById("mediaItems");
  var addMore   = document.getElementById("addMoreMedia");
  if (!area || !input || !items) return;

  // Local store of media (kept in-memory + mirrored to chrome.storage.local)
  var media = [];

  function persist() {
    selectedMediaFiles = media.slice();
    imageDataUrl = media[0] ? media[0].dataUrl : null;
    try {
      chrome.storage.local.set({ selectedMediaFiles: media });
    } catch (_) {}
  }

  function refresh() {
    items.innerHTML = "";
    if (!media.length) {
      strip.style.display = "none";
      emptyView.style.display = "";
    } else {
      emptyView.style.display = "none";
      strip.style.display = "";
      media.forEach(function(m, idx) {
        var cell = document.createElement("div");
        cell.className = "media-item";
        var isVideo = /^video\//.test(m.type || "");
        if (isVideo) {
          var v = document.createElement("video");
          v.src = m.dataUrl; v.muted = true; v.playsInline = true; v.preload = "metadata";
          cell.appendChild(v);
          var tag = document.createElement("span");
          tag.className = "video-tag"; tag.textContent = "VIDEO";
          cell.appendChild(tag);
        } else {
          var im = document.createElement("img");
          im.src = m.dataUrl; im.alt = m.name || "media";
          cell.appendChild(im);
        }
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove-media";
        rm.title = "Remove";
        rm.textContent = "×";
        rm.addEventListener("click", function(e) {
          e.stopPropagation();
          media.splice(idx, 1);
          persist();
          refresh();
        });
        cell.appendChild(rm);
        items.appendChild(cell);
      });
    }
    persist();
  }

  function readFile(file) {
    return new Promise(function(resolve, reject) {
      var r = new FileReader();
      r.onload  = function(e) { resolve(e.target.result); };
      r.onerror = function()  { reject(new Error("read fail")); };
      r.readAsDataURL(file);
    });
  }

  function handleFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    var queue = [];
    arr.forEach(function(f) {
      var isImg = /^image\//.test(f.type);
      var isVid = /^video\//.test(f.type);
      if (!isImg && !isVid) {
        showToast("Unsupported file: " + (f.name || ""), "error");
        return;
      }
      var max = isVid ? MAX_VID_SIZE : MAX_IMG_SIZE;
      if (f.size > max) {
        showToast((isVid ? "Video" : "Image") + " too large: " + (f.name || ""), "error");
        return;
      }
      queue.push(f);
    });
    if (!queue.length) return;
    if (media.length + queue.length > MAX_MEDIA) {
      showToast("Max " + MAX_MEDIA + " files", "warning");
      queue = queue.slice(0, MAX_MEDIA - media.length);
    }
    Promise.all(queue.map(readFile)).then(function(urls) {
      urls.forEach(function(url, i) {
        var f = queue[i];
        media.push({
          name:    f.name || "media",
          type:    f.type || "image/jpeg",
          size:    f.size || 0,
          dataUrl: url
        });
      });
      refresh();
      showToast("Added " + queue.length + " file(s)", "success");
    }).catch(function() {
      showToast("Could not read one or more files", "error");
    });
  }

  // ── Click on the upload area opens the file explorer ──
  function openPicker(e) {
    if (e && e.target && e.target.closest && e.target.closest(".remove-media,.media-item")) return;
    // Re-trigger file dialog (reset value so picking the same file fires change)
    input.value = "";
    input.click();
  }
  area.addEventListener("click", openPicker);
  area.addEventListener("keydown", function(e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(e); }
  });
  if (addMore) addMore.addEventListener("click", function(e){ e.stopPropagation(); openPicker(e); });

  // ── File input change ──
  input.addEventListener("change", function(e) {
    handleFiles(e.target.files);
    // allow re-selecting same file
    e.target.value = "";
  });

  // ── Drag & drop ──
  ["dragenter", "dragover"].forEach(function(ev) {
    area.addEventListener(ev, function(e) {
      e.preventDefault(); e.stopPropagation();
      area.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function(ev) {
    area.addEventListener(ev, function(e) {
      e.preventDefault(); e.stopPropagation();
      area.classList.remove("dragover");
    });
  });
  area.addEventListener("drop", function(e) {
    var dt = e.dataTransfer;
    if (dt && dt.files) handleFiles(dt.files);
  });

  // ── Restore from storage on open ──
  try {
    chrome.storage.local.get(["selectedMediaFiles"], function(data) {
      if (data && Array.isArray(data.selectedMediaFiles) && data.selectedMediaFiles.length) {
        media = data.selectedMediaFiles.slice(0, MAX_MEDIA);
        refresh();
      } else {
        refresh();
      }
    });
  } catch (_) { refresh(); }
}


// ─── GROUPS ───────────────────────────────────────────────────────
function initGroups() {
  $("detectSession").addEventListener("click", detectFBSession);
  $("scanGroups").addEventListener("click",    scanGroups);
  if ($("startGroupJoinSearch")) $("startGroupJoinSearch").addEventListener("click", handleGroupSearchJoin);
  $("selectAll").addEventListener("click",     function(){ selectedGroups = dedupeGroupsByUrl(allGroups.slice()); renderGroupList(filteredGroups.length ? filteredGroups : allGroups); updateCount(); });
  $("deselectAll").addEventListener("click",   function(){ selectedGroups = []; renderGroupList(filteredGroups.length ? filteredGroups : allGroups); updateCount(); });
  $("selectFiltered").addEventListener("click", selectFilteredOnly);
  $("savePreset").addEventListener("click",    savePreset);

  // LIVE FILTER
  $("groupFilter").addEventListener("input", function() {
    var q = this.value.trim().toLowerCase();
    $("clearFilter").style.display = q ? "inline-flex" : "none";
    // V5 FIX: تصفية صارمة — تطابق الكلمة الكاملة فقط (word match)
    filteredGroups = q ? allGroups.filter(function(g) {
      var name = (g.name || "").toLowerCase();
      // تقسيم الاستعلام إلى كلمات والتحقق من وجود كل منها في الاسم
      var words = q.split(/\s+/).filter(Boolean);
      return words.every(function(w) { return name.includes(w); });
    }) : allGroups.slice();
    renderGroupList(filteredGroups);
    var sfBtn = $("selectFiltered");
    if (sfBtn) {
      sfBtn.style.display = (q && filteredGroups.length > 0) ? "inline-flex" : "none";
      sfBtn.textContent   = "✔ تحديد المفلتر (" + filteredGroups.length + ")";
    }
    updateCount();
  });

  var cf = $("clearFilter");
  if (cf) cf.addEventListener("click", function() {
    $("groupFilter").value = "";
    $("groupFilter").dispatchEvent(new Event("input"));
  });

  loadPresets();
}

function selectFilteredOnly() {
  if (!filteredGroups.length) return;
  filteredGroups.forEach(function(g) {
    if (!selectedGroups.find(function(s){ return normalizeGroupUrl(s.url) === normalizeGroupUrl(g.url); })) selectedGroups.push(g);
  });
  selectedGroups = dedupeGroupsByUrl(selectedGroups);
  renderGroupList(filteredGroups);
  updateCount();
  showToast("Selected " + filteredGroups.length + " filtered groups", "success");
}

function updateCount() {
  var q = ($("groupFilter").value || "").trim();
  var shown = filteredGroups.length || allGroups.length;
  $("groupCount").textContent = q
    ? (shown + " / " + allGroups.length + " groups · " + selectedGroups.length + " selected")
    : (allGroups.length + " groups · " + selectedGroups.length + " selected");
}

function normalizeGroupUrl(url) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  var match = raw.match(/facebook\.com\/groups\/([^/?#]+)/i);
  if (match && match[1]) return "https://www.facebook.com/groups/" + match[1] + "/";
  return raw.replace(/\?.*$/, "").replace(/#.*$/, "").replace(/\/+$/, "") + "/";
}

function dedupeGroupsByUrl(groups) {
  var map = {};
  (groups || []).forEach(function(group) {
    var url = normalizeGroupUrl(group && group.url);
    if (!url) return;
    if (!map[url]) map[url] = Object.assign({}, group, { url: url });
  });
  return Object.keys(map).map(function(url) { return map[url]; });
}

function mergeUniqueGroups(groupLists) {
  var map = {};
  (groupLists || []).forEach(function(groups) {
    (groups || []).forEach(function(group) {
      var url = normalizeGroupUrl(group && group.url);
      if (!url) return;
      if (!map[url]) {
        map[url] = {
          name: String((group && group.name) || url).trim(),
          url: url,
          member: !!(group && group.member),
          source: (group && group.source) || ((group && group.member) ? "member" : "search")
        };
      } else {
        if (group && group.name && (!map[url].name || map[url].name === url)) map[url].name = String(group.name).trim();
        if (group && group.member) map[url].member = true;
        if (group && group.source === "member") map[url].source = "member";
      }
    });
  });
  return Object.keys(map).map(function(url) { return map[url]; }).sort(function(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

async function detectFBSession() {
  var btn = $("detectSession");
  btn.textContent = "جاري الكشف...";
  try {
    var tabs = await new Promise(function(r){ chrome.tabs.query({url:"*://*.facebook.com/*"}, r); });
    if (!tabs.length) {
      $("sessionInfo").textContent = "لا يوجد تبويب فيسبوك مفتوح.";
      ["sessionBadge","sessionBadge2"].forEach(function(id){ var el=$(id); if(el){el.textContent="لا جلسة";el.className="badge badge-inactive";} });
      btn.textContent = "كشف الجلسة"; return;
    }
    var ready = await ensureContentScriptOnTab(tabs[0].id);
    if (!ready) {
      $("sessionInfo").textContent = "فيسبوك مفتوح لكن الإضافة غير نشطة على الصفحة — حدّث تبويب فيسبوك (F5).";
      ["sessionBadge","sessionBadge2"].forEach(function(id){ var el=$(id); if(el){el.textContent="لا جلسة";el.className="badge badge-inactive";} });
    } else {
      $("sessionInfo").textContent = "جلسة نشطة: " + String(tabs[0].url || "").slice(0,60);
      ["sessionBadge","sessionBadge2"].forEach(function(id){ var el=$(id); if(el){el.textContent="نشطة";el.className="badge badge-active";} });
    }
    btn.textContent = "كشف الجلسة";
  } catch(_){ btn.textContent = "كشف الجلسة"; }
}

function ensureContentScriptOnTab(tabId) {
  return new Promise(function(resolve) {
    try {
      chrome.tabs.sendMessage(tabId, { action: "PING" }, function(resp) {
        if (!chrome.runtime.lastError && resp && resp.alive) {
          resolve(true);
          return;
        }
        // تبويب فيسبوك مفتوح قبل تثبيت/تحديث الإضافة → نحقن content.js يدوياً
        try {
          chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] }, function() {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            setTimeout(function() {
              chrome.tabs.sendMessage(tabId, { action: "PING" }, function(resp2) {
                resolve(!chrome.runtime.lastError && resp2 && resp2.alive);
              });
            }, 500);
          });
        } catch (_) {
          resolve(false);
        }
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function requestGroupsFromTab(tabId) {
  return new Promise(function(resolve) {
    chrome.tabs.sendMessage(tabId, { action: "GET_GROUPS" }, function(resp) {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || "not_ready" });
        return;
      }
      resolve({ ok: true, groups: (resp && resp.groups) || [] });
    });
  });
}

async function scanGroups() {
  var btn = $("scanGroups");
  btn.disabled = true;
  btn.textContent = "جاري المسح...";
  try {
    var tabs = await new Promise(function(r){ chrome.tabs.query({url:"*://*.facebook.com/*"}, r); });
    if (!tabs.length) {
      showToast("افتح فيسبوك أولاً في تبويب", "warning");
      resetScanBtn();
      return;
    }
    // تفضيل صفحة الجروبات؛ على الموبايل أي تبويب فيسبوك يكفي
    var fbTab = tabs.find(function(t){ return t.url && t.url.includes("/groups"); }) || tabs[0];

    // 1) تأكد أن content script جاهز (حقن تلقائي لو ناقص)
    var ready = await ensureContentScriptOnTab(fbTab.id);
    if (!ready) {
      // 2) مسار بديل عبر الخلفية بدون الاعتماد على content script القديم
      try {
        var bg = await chrome.runtime.sendMessage({ action: "GET_MY_GROUPS" });
        if (bg && bg.success && bg.groups && bg.groups.length) {
          allGroups = bg.groups;
          filteredGroups = allGroups.slice();
          renderGroupList(allGroups);
          showToast("تم العثور على " + allGroups.length + " جروب", "success");
          resetScanBtn();
          return;
        }
      } catch (_) {}
      allGroups = filteredGroups = [];
      $("groupList").innerHTML = '<div class="empty-state">تعذر الاتصال بصفحة فيسبوك. حدّث تبويب فيسبوك (F5) ثم اضغط مسح مرة أخرى.</div>';
      showToast("حدّث تبويب فيسبوك ثم أعد المحاولة", "error");
      resetScanBtn();
      return;
    }

    var resp = await requestGroupsFromTab(fbTab.id);
    if (!resp.ok) {
      // محاولة حقن ثانية ثم إعادة الطلب
      await ensureContentScriptOnTab(fbTab.id);
      resp = await requestGroupsFromTab(fbTab.id);
    }
    if (!resp.ok) {
      try {
        var bg2 = await chrome.runtime.sendMessage({ action: "GET_MY_GROUPS" });
        if (bg2 && bg2.success && bg2.groups && bg2.groups.length) {
          allGroups = bg2.groups;
          filteredGroups = allGroups.slice();
          renderGroupList(allGroups);
          showToast("تم العثور على " + allGroups.length + " جروب", "success");
          resetScanBtn();
          return;
        }
      } catch (_) {}
      allGroups = filteredGroups = [];
      $("groupList").innerHTML = '<div class="empty-state">تعذر قراءة الجروبات. افتح facebook.com/groups وحدّث الصفحة ثم أعد المسح.</div>';
      showToast("تعذر قراءة الجروبات — حدّث صفحة فيسبوك", "error");
      resetScanBtn();
      return;
    }
    if (resp.groups && resp.groups.length) {
      allGroups = resp.groups;
      filteredGroups = allGroups.slice();
      renderGroupList(allGroups);
      showToast("تم العثور على " + allGroups.length + " جروب", "success");
    } else {
      allGroups = filteredGroups = [];
      $("groupList").innerHTML = '<div class="empty-state">لم يُعثر على جروبات. افتح facebook.com/groups ثم أعد المسح.</div>';
      showToast("لا توجد جروبات ظاهرة في الصفحة", "warning");
    }
    resetScanBtn();
  } catch(e){
    showToast("خطأ في المسح: " + (e && e.message ? e.message : e), "error");
    resetScanBtn();
  }
}

function resetScanBtn() {
  var btn = $("scanGroups");
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = "مسح الجروبات";
}

async function handleGroupSearchJoin() {
  var input = $("groupSearchKeyword");
  var btn = $("startGroupJoinSearch");
  var keyword = (input && input.value || "").trim();
  if (!keyword) {
    showToast("Enter a group keyword first", "warning");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Searching all groups...";
  try {
    var results = await Promise.all([
      chrome.runtime.sendMessage({ action: "GET_MY_GROUPS" }).catch(function(){ return { success:false, groups:[] }; }),
      chrome.runtime.sendMessage({ action: "SEARCH_GROUPS_ONLY", keyword: keyword }).catch(function(){ return { success:false, groups:[] }; })
    ]);

    var myGroupsResp = results[0] || { groups: [] };
    var searchResp   = results[1] || { groups: [] };

    var myGroups = (myGroupsResp.groups || []).map(function(g) {
      return Object.assign({}, g, { member: true, source: "member", url: normalizeGroupUrl(g.url) });
    });
    var searchGroups = (searchResp.groups || []).map(function(g) {
      return Object.assign({}, g, { member: !!g.member, source: g.member ? "member" : "search", url: normalizeGroupUrl(g.url) });
    });

    var merged = mergeUniqueGroups([myGroups, searchGroups]);
    if (!merged.length) {
      allGroups = filteredGroups = selectedGroups = [];
      renderGroupList([]);
      showToast("No groups found for this search", "warning");
      return;
    }

    // V5 FIX: فلتر فوري بالكلمة المفتاحية — لا تُظهر مجموعات بأسماء مختلفة
    var kwLower = keyword.toLowerCase();
    var kwWords2 = kwLower.split(/\s+/).filter(Boolean);
    var filtered = merged.filter(function(g) {
      var n = (g.name || "").toLowerCase();
      return kwWords2.every(function(w) { return n.includes(w); });
    });
    // إذا كانت النتيجة المفلترة فارغة، نُظهر الكل (fallback)
    var toShow = filtered.length ? filtered : merged;
    allGroups = toShow;
    filteredGroups = toShow.slice();
    selectedGroups = dedupeGroupsByUrl(toShow.slice());
    renderGroupList(allGroups);

    var joinedCount = toShow.filter(function(g){ return !!g.member; }).length;
    var searchOnlyCount = merged.length - joinedCount;
    showToast("Loaded " + merged.length + " groups (" + joinedCount + " joined + " + searchOnlyCount + " search results)", "success");
  } catch (e) {
    showToast("Group search error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Search All Groups";
  }
}

function renderGroupList(groups) {
  var list = $("groupList");
  if (!groups || !groups.length) {
    list.innerHTML = '<div class="empty-state">No groups to show.</div>';
    updateCount();
    return;
  }
  list.innerHTML = groups.map(function(g) {
    var checked = selectedGroups.find(function(s){ return normalizeGroupUrl(s.url) === normalizeGroupUrl(g.url); }) ? "checked" : "";
    var status = g.member ? '<small class="muted"> · joined</small>' : (g.source === "search" ? '<small class="muted"> · search</small>' : '');
    // V5 FIX: عرض الاسم الحقيقي فقط — تنظيف الأرقام والروابط من الاسم
    var cleanName = (g.name || "").trim()
      .replace(/^https?:\/\/[^\s]+/i, "")  // حذف الروابط
      .replace(/\/groups\/[\w-]+/gi, "")   // حذف مسارات المجموعة
      .replace(/^[\d]+$/, g.url.match(/\/groups\/([^/?#]+)/i)?.[1]?.replace(/-/g," ") || g.name) // رقم فقط → slug
      .trim() || g.name;
    return '<label class="group-item"><input type="checkbox" value="'+escHtml(normalizeGroupUrl(g.url))+'" '+checked+'/><span>'+escHtml(cleanName)+status+'</span></label>';
  }).join("");
  list.querySelectorAll("input[type='checkbox']").forEach(function(cb) {
    cb.addEventListener("change", function() {
      var url = normalizeGroupUrl(cb.value);
      var grp = allGroups.find(function(g){ return normalizeGroupUrl(g.url) === url; });
      if (!grp) return;
      if (cb.checked) {
        if (!selectedGroups.find(function(s){ return normalizeGroupUrl(s.url) === url; })) selectedGroups.push(grp);
        selectedGroups = dedupeGroupsByUrl(selectedGroups);
      } else {
        selectedGroups = selectedGroups.filter(function(s){ return normalizeGroupUrl(s.url) !== url; });
      }
      updateCount();
    });
  });
  updateCount();
}

// ─── PRESETS ──────────────────────────────────────────────────────
async function loadPresets() {
  var d = await storageGet(["groupPresets"]);
  presets = d.groupPresets || {};
  renderPresets();
}

async function savePreset() {
  var name = $("presetName").value.trim();
  if (!name) { showToast("Enter a preset name", "warning"); return; }
  if (!selectedGroups.length) { showToast("Select groups first", "warning"); return; }
  presets[name] = { groups: selectedGroups.slice() };
  await storageSet({groupPresets: presets});
  $("presetName").value = "";
  renderPresets();
  showToast('Preset "' + name + '" saved', "success");
}

function renderPresets() {
  var list  = $("presetList");
  var names = Object.keys(presets);
  if (!names.length) { list.innerHTML = '<div class="empty-state" style="padding:8px">No presets saved</div>'; return; }
  list.innerHTML = names.map(function(n) {
    return '<div class="preset-item"><div><b>'+escHtml(n)+'</b> <span class="muted">('+presets[n].groups.length+')</span></div>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-outline small" data-load="'+escHtml(n)+'">Load</button>' +
      '<button class="btn btn-outline small" data-del="'+escHtml(n)+'">🗑</button>' +
      '</div></div>';
  }).join("");
  list.querySelectorAll("[data-load]").forEach(function(b){ b.addEventListener("click",function(){ loadPreset(b.dataset.load); }); });
  list.querySelectorAll("[data-del]").forEach(function(b){  b.addEventListener("click",function(){ deletePreset(b.dataset.del); }); });
}

function loadPreset(name) {
  var p = presets[name]; if (!p) return;
  allGroups = filteredGroups = selectedGroups = p.groups.slice();
  renderGroupList(allGroups);
  updateCount();
  showToast('Loaded "' + name + '"', "success");
  switchTab("groups");
}

async function deletePreset(name) {
  delete presets[name];
  await storageSet({groupPresets: presets});
  renderPresets();
  showToast('Deleted "' + name + '"', "success");
}

// ─── SETTINGS ─────────────────────────────────────────────────────
function initSettings() {
  var mn = $("minDelay"), mx = $("maxDelay");
  var aiProviderSelect = getAIProviderSelectEl();
  var apiKeyInput = getAPIKeyInputEl();

  function upd(){
    var minVal = parseFloat(mn.value) || 0.35;
    var maxVal = parseFloat(mx.value) || 0.75;
    if (maxVal < minVal) {
      maxVal = minVal;
      mx.value = String(maxVal);
    }
    $("delayRange").textContent = "Turbo Range: " + minVal.toFixed(2) + " – " + maxVal.toFixed(2) + " sec";
  }

  mn.addEventListener("input", upd);
  mx.addEventListener("input", upd);
  upd();

  if (aiProviderSelect) {
    aiProviderSelect.addEventListener("change", async function() {
      var nextProvider = normalizeProvider(this.value);
      try {
        await persistProviderApiKey(currentAIProvider, apiKeyInput && apiKeyInput.value || "");
      } catch (_) {}
      await syncAIProviderUI(nextProvider);
      await persistProviderApiKey(nextProvider, getAPIKeyInputEl() && getAPIKeyInputEl().value || "");
    });
  }

  if (apiKeyInput) {
    var saveKeySilently = async function() {
      try { await persistCurrentAIConfig(); } catch (_) {}
    };
    apiKeyInput.addEventListener("input", saveKeySilently);
    apiKeyInput.addEventListener("change", saveKeySilently);
    apiKeyInput.addEventListener("blur", saveKeySilently);
  }

  $("saveAiConfig").addEventListener("click", async function() {
    await persistCurrentAIConfig();
    showToast("✅ تم حفظ مفتاح Gemini", "success");
  });

  // ── اختبار مفتاح Gemini ──────────────────────────────────────────────
  $("testApiKey").addEventListener("click", async function() {
    var btn       = $("testApiKey");
    var resultBox = $("keyTestResult");
    var key       = String(getAPIKeyInputEl() && getAPIKeyInputEl().value || "").trim();
    var provider  = getLiveAIProvider();

    resultBox.style.display = "block";

    if (!key) {
      resultBox.style.background = "#fff3cd"; resultBox.style.color = "#856404";
      resultBox.textContent = "⚠️ الصق مفتاح Gemini (AIza...) أو HuggingFace (hf_...) ثم اضغط اختبر.";
      return;
    }

    btn.disabled = true; btn.textContent = "⏳ جاري الاختبار...";
    resultBox.style.background = "var(--surface2)"; resultBox.style.color = "var(--text)";
    resultBox.textContent = provider === "huggingface" ? "🔄 اتصال بـ HuggingFace..." : "🔄 اتصال بـ Gemini...";

    try {
      var r, bd = null;
      if (provider === "huggingface") {
        r = await fetch(HF_ENDPOINT + HF_MODELS[0], {
          method: "POST",
          headers: { "Content-Type":"application/json", "Authorization":"Bearer "+key },
          body: JSON.stringify({ inputs: "قل: OK", parameters: { max_new_tokens: 8 } })
        });
      } else {
        r = await fetch(geminiUrl(GEMINI_DEFAULT_MODEL, key), {
          method: "POST",
          headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "قل: OK" }] }], generationConfig: { maxOutputTokens: 8 } })
        });
      }
      try { bd = await r.json(); } catch(_){}

      if (r.ok) {
        resultBox.style.background = "#d4edda"; resultBox.style.color = "#155724";
        resultBox.textContent = "✅ المفتاح يعمل بنجاح! 🎉\nاضغط 💾 حفظ المفتاح ثم استخدم Generate.";
        await persistProviderApiKey(provider, key);
      } else if (r.status === 401 || r.status === 403) {
        resultBox.style.background = "#f8d7da"; resultBox.style.color = "#721c24";
        resultBox.textContent = provider === "huggingface"
          ? "❌ توكن HuggingFace مرفوض.\nأنشئ توكنًا من: https://huggingface.co/settings/tokens"
          : "❌ مفتاح Gemini مرفوض.\nأنشئ مفتاحًا من: https://aistudio.google.com/apikey";
      } else if (r.status === 429 || r.status === 503) {
        resultBox.style.background = "#fff3cd"; resultBox.style.color = "#856404";
        resultBox.textContent = "⚠️ الحصة أو الموديل مشغول مؤقتًا — أعد المحاولة بعد دقيقة.";
      } else {
        resultBox.style.background = "#f8d7da"; resultBox.style.color = "#721c24";
        resultBox.textContent = "❌ فشل الاختبار (" + r.status + "). راجع المفتاح والمحاولة مرة أخرى.";
      }
    } catch (e) {
      resultBox.style.background = "#f8d7da"; resultBox.style.color = "#721c24";
      resultBox.textContent = "❌ خطأ اتصال: " + (e.message || e);
    }
    btn.disabled = false; btn.textContent = "🔬 اختبر المفتاح";
  });

  $("exportData").addEventListener("click", async function() {
    var d = await storageGet(null);
    var a = document.createElement("a");
    a.href     = URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:"application/json"}));
    a.download = "fb-poster-settings.json";
    a.click();
  });

  $("clearData").addEventListener("click", async function() {
    if (confirm("Clear all data?")) { await chrome.storage.local.clear(); showToast("Cleared", "success"); location.reload(); }
  });
}

async function loadSettings() {
  var d = await storageGet(["minDelay","maxDelay","apiKey","aiApiKey","geminiApiKey","groqApiKey","aiEndpoint","aiModel","aiProvider","aiModelSelect","humanTyping","uniqueSpintax","autoCloseTabs","linkPosition","smartVariation","antiSpamRandomizer","postAsPage"]);
  if (d.minDelay !== undefined) $("minDelay").value = d.minDelay;
  else $("minDelay").value = 0.35;
  if (d.maxDelay !== undefined) $("maxDelay").value = d.maxDelay;
  else $("maxDelay").value = 0.75;

  var provider = getStoredAIProvider(d);
  var aiProviderSelect = getAIProviderSelectEl();
  if (aiProviderSelect) aiProviderSelect.value = provider;
  await syncAIProviderUI(provider, { data: d });

  smartVariationEnabled = d.smartVariation !== undefined ? !!d.smartVariation : true;
  // Ensure the button label matches the loaded state
  updateSmartVariationButton();
  antiSpamRandomizerEnabled = !!d.antiSpamRandomizer;
  if ($("antiSpamRandomizer")) $("antiSpamRandomizer").checked = antiSpamRandomizerEnabled;
  if (d.humanTyping !== undefined) $("humanTyping").checked = d.humanTyping;
  if (d.uniqueSpintax !== undefined) $("uniqueSpintax").checked = d.uniqueSpintax;
  else $("uniqueSpintax").checked = true;
  if (d.autoCloseTabs !== undefined) $("autoCloseTabs").checked = d.autoCloseTabs;
  if ($("postAsPage") && d.postAsPage) $("postAsPage").value = d.postAsPage;
}

// ─── LOG ──────────────────────────────────────────────────────────
function initLog() {
  $("clearLog").addEventListener("click", async function() {
    await storageSet({postLog:[]});
    postLog = [];
    renderLog();
  });
}

function startLogPolling() {
  setInterval(async function() {
    var d = await storageGet(["postLog","postingActive","paused","pausedGroupIndex","currentGroupIndex","postQueue","awaitingNextGroup"]);
    postLog   = d.postLog || [];
    isPosting = !!d.postingActive;
    isPaused  = !!d.paused;
    renderLog();
    updateStats();
    updateProgress(d);
    updatePowerBtn();
  }, 2000);
}

function renderLog() {
  var c = $("postLog");
  if (!postLog.length) { c.innerHTML = '<div class="empty-state">لا توجد عمليات نشر بعد.</div>'; return; }
  c.innerHTML = postLog.slice().reverse().map(function(e) {
    var cls  = e.pending ? "pending" : (e.success ? "success" : "fail");
    var icon = e.pending ? "⏳" : (e.success ? "✅" : "❌");
    return '<div class="log-entry ' + cls + '">' +
      '<span class="log-icon">' + icon + '</span>' +
      '<span class="log-name">' + escHtml(e.groupName||"Unknown") + '</span>' +
      '<span class="log-time">' + fmtTime(e.timestamp) + '</span>' +
      (e.pending ? '<div class="log-pending">منشورك في هذه المجموعة قيد المراجعة / الموافقة</div>' : '') +
      (e.error ? '<div class="log-err">' + escHtml(e.error) + '</div>' : '') +
      (e.postUrl ? '<a class="log-link" href="' + escHtml(e.postUrl) + '" target="_blank">فتح المنشور</a>' : '') +
    '</div>';
  }).join("");
}

function updateStats() {
  $("successCount").textContent = postLog.filter(function(l){ return l.success && !l.pending; }).length;
  if ($("pendingCount")) $("pendingCount").textContent = postLog.filter(function(l){ return !!l.pending; }).length;
  $("failCount").textContent    = postLog.filter(function(l){ return !l.success; }).length;
  $("totalCount").textContent   = postLog.length;
}

function updateProgress(d) {
  var q = d.postQueue || [], cur = d.currentGroupIndex || 0;
  if (d.postingActive && q.length) {
    $("progressBar").style.display = "block";
    $("progressFill").style.width  = Math.min(100, Math.round(cur/q.length*100)) + "%";
    $("progressText").textContent  = cur + " / " + q.length;
    $("statusText").textContent    = "جارٍ النشر " + (cur+1) + " من " + q.length + "...";
  } else {
    $("progressBar").style.display = "none";
    if (!d.postingActive) $("statusText").textContent = "جاهز";
  }
}

// ─── POWER BUTTON ────────────────────────────────────────────────
function initPowerButton() {
  // FIX: On mobile, touchend auto-generates a click event.
  // We track which path triggered handlePower to prevent the double-call.
  var _powerTouchFired = false;
  $("powerBtn").addEventListener("touchend", function(e){
    e.preventDefault();
    _powerTouchFired = true;
    setTimeout(function(){ _powerTouchFired = false; }, 600);
    handlePower();
  }, {passive:false});
  $("powerBtn").addEventListener("click", function(e){
    if (_powerTouchFired) return; // already handled by touchend, skip synthetic click
    handlePower();
  });
}

var _handlePowerRunning = false;
async function handlePower() {
  if (_handlePowerRunning) { return; }
  _handlePowerRunning = true;
  setTimeout(function(){ _handlePowerRunning = false; }, 800);
  if (isPosting) {
    await chrome.runtime.sendMessage({action:"STOP_POSTING"});
    isPosting = false;
    updatePowerBtn();
    $("statusText").textContent = "تم الإيقاف";
    showToast("تم الإيقاف", "warning");
    return;
  }

  var raw  = $("postContent").value.trim();
  var link = $("fixedLink").value.trim();
  // ① Link position is always "end" now
  var linkPosition = "end";

  if (!raw) { showToast("اكتب محتوى المنشور أولاً", "warning"); switchTab("compose"); return; }
  if (!selectedGroups.length) { showToast("اختر الجروبات أولاً", "warning"); switchTab("groups"); return; }

  selectedGroups = dedupeGroupsByUrl(selectedGroups);
  var useUnique = $("uniqueSpintax") ? $("uniqueSpintax").checked : false;
  var groups;
  
  // ← CRITICAL: Always create unique variations for selected groups
  // each group MUST get different content to avoid posting same content to all groups
  if (useUnique || smartVariationEnabled || selectedGroups.length > 1) {
    // Smart Variation ON: each group gets a genuinely different version
    var variations = buildVariations(raw, link, selectedGroups.length, {
      linkPosition:         linkPosition,
      smartVariation:       smartVariationEnabled || selectedGroups.length > 1,
      antiSpamRandomizer:   antiSpamRandomizerEnabled,
      processSpintax:       true
    });
    groups = selectedGroups.map(function(g, i) {
      return Object.assign({}, g, { content: variations[i] });
    });
  } else {
    // Single group: can use same content
    var single = generateContent(raw, link, {
      linkPosition:         linkPosition,
      smartVariation:       false,
      antiSpamRandomizer:   antiSpamRandomizerEnabled,
      processSpintax:       true
    });
    groups = selectedGroups.map(function(g) {
      return Object.assign({}, g, { content: single });
    });
  }

  groups = dedupeGroupsByUrl(groups);

  var minD = parseFloat($("minDelay").value) || 0.35;
  var maxD = parseFloat($("maxDelay").value) || 0.75;
  if (maxD < minD) maxD = minD;
  var mediaFiles = selectedMediaFiles.length ? selectedMediaFiles.slice() : [];

  await storageSet({
    minDelay: minD, maxDelay: maxD,
    humanTyping:   $("humanTyping").checked,
    uniqueSpintax: $("uniqueSpintax").checked,
    autoCloseTabs: $("autoCloseTabs").checked,
    linkPosition:  linkPosition,
    smartVariation: smartVariationEnabled,
    antiSpamRandomizer: antiSpamRandomizerEnabled,
    postAsPage: $("postAsPage") ? $("postAsPage").value.trim() : ""
  });

  isPosting = true;
  updatePowerBtn();

  chrome.runtime.sendMessage({
    action: "START_POSTING",
    payload: {
      groups:    groups,
      content:   raw,
      comment:   $("enableComment").checked ? $("firstComment").value.trim() : "",
      minDelay:  minD,
      maxDelay:  maxD,
      imageData: imageDataUrl,
      mediaFiles: mediaFiles,
      postAsPage:          $("postAsPage") ? $("postAsPage").value.trim() : "",
      backgroundWorkerMode: true,  // ← always use background worker (single pinned tab)
      singleAttemptPerGroup: true
    }
  });

  switchTab("log");
  showToast("بدء التشغيل على " + selectedGroups.length + " جروب", "success");
}

function updateBgStatusBanner() {
  var banner = document.getElementById("bgStatusBanner");
  var dot    = document.getElementById("bgStatusDot");
  var text   = document.getElementById("bgStatusText");
  var chip   = document.getElementById("bgStatusChip");
  if (!banner) return;
  if (isPosting) {
    banner.classList.remove("bg-idle");
    if (dot)  dot.style.background = "#14b8a6";
    if (text) text.textContent = "يعمل بسلاسة في الخلفية — يمكنك إغلاق النافذة";
    if (chip) chip.textContent = "نشط";
  } else {
    banner.classList.add("bg-idle");
    if (dot)  dot.style.background = "#64748b";
    if (text) text.textContent = "المحرك جاهز — ابدأ حملة للنشر في الخلفية";
    if (chip) chip.textContent = "Idle";
  }
}

function updatePowerBtn() {
  var btn = $("powerBtn"), lbl = $("powerLabel"), ico = $("powerIcon");
  // V5: إدارة زر PAUSE/RESUME — لا يمس الكود الأصلي
  var pb = $("pauseBtn"), pl = $("pauseLabel"), pi = $("pauseIcon");
  if (pb) {
    if (isPaused) {
      pb.style.display = "flex"; pb.classList.add("is-paused");
      if (pi) pi.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      if (pl) pl.textContent = "استكمال";
    } else if (isPosting) {
      pb.style.display = "flex"; pb.classList.remove("is-paused");
      if (pi) pi.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      if (pl) pl.textContent = "إيقاف مؤقت";
    } else {
      pb.style.display = "none"; pb.classList.remove("is-paused");
    }
  }
  if (isPosting) {
    btn.classList.add("running");
    lbl.textContent = "إيقاف";
    ico.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  } else {
    btn.classList.remove("running");
    lbl.textContent = "ابدأ";
    ico.innerHTML = '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>';
  }
  updateBgStatusBanner();
}

// ─── TOAST ────────────────────────────────────────────────────────
var _toastT = null;
function showToast(msg, type) {
  var t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.className = "toast " + (type || "info");
  t.textContent = msg;
  // Force reflow so re-triggering the same toast animates again
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(_toastT);
  _toastT = setTimeout(function() { t.classList.remove("show"); }, 3200);
}

// ═══════════════════════════════════════════════════════════════════════
//  PRO-MASTER: MOBILE POST PREVIEW MODAL
// ═══════════════════════════════════════════════════════════════════════

(function initPreviewModal() {

  // ── Helpers ──────────────────────────────────────────────────────
  function getEl(id) { return document.getElementById(id); }

  // Resolve spintax once for the preview
  function resolveSpintax(text) {
    return String(text || "").replace(/\{([^{}]+)\}/g, function(_, group) {
      var opts = group.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }

  // Highlight #hashtags inside the post body
  function highlightHashtags(text) {
    // Escape HTML first
    var safe = text
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    // Wrap hashtags
    safe = safe.replace(/(#[\w\u0600-\u06FF]+)/g, '<span class="tag">$1</span>');
    return safe;
  }

  // Count words (Arabic + Latin)
  function wordCount(text) {
    return (text.match(/[\u0600-\u06FF\w]+/g) || []).length;
  }

  // Detect WhatsApp link
  function extractWaLink(text) {
    var m = text.match(/https?:\/\/[^\s]*wa\.me[^\s]*/i)
           || text.match(/https?:\/\/[^\s]*whatsapp[^\s]*/i);
    return m ? m[0] : null;
  }

  // Render quality pills
  function renderStats(resolvedText, link) {
    var wc   = wordCount(resolvedText);
    var hasTags = /#[\w\u0600-\u06FF]+/.test(resolvedText);
    var hasLink = !!link;

    var pills = [
      {
        label: wc + " words",
        cls: wc >= 200 && wc <= 400 ? "good" : wc < 100 ? "bad" : "warn",
        icon: "📝"
      },
      {
        label: hasLink  ? "✓ CTA Link"    : "✗ No link",
        cls:   hasLink  ? "good"          : "warn",
        icon:  "📲"
      },
      {
        label: hasTags  ? "✓ Hashtags"   : "✗ No hashtags",
        cls:   hasTags  ? "good"         : "warn",
        icon:  "🏷️"
      },
      {
        label: /\{[^{}]+\}/.test(getEl("postContent").value) ? "✓ Spintax" : "No spintax",
        cls:   /\{[^{}]+\}/.test(getEl("postContent").value) ? "good"      : "warn",
        icon:  "🎲"
      }
    ];

    return pills.map(function(p) {
      return '<div class="preview-stat-pill ' + p.cls + '">' + p.icon + ' ' + p.label + '</div>';
    }).join("");
  }

  // ── Main render function ─────────────────────────────────────────
  function renderPreview() {
    var rawContent = (getEl("postContent") ? getEl("postContent").value : "").trim();
    var fixedLink  = (getEl("fixedLink")  ? getEl("fixedLink").value   : "").trim();

    if (!rawContent) {
      showToast("Write or generate post content first", "warning");
      return false;
    }

    // Resolve spintax for the preview
    var resolved = resolveSpintax(rawContent);

    // Detect language for CTA label
    var isAr = detectLang(resolved) === "ar";

    // Find WhatsApp link (from fixedLink field or embedded in content)
    var waLink = fixedLink || extractWaLink(resolved) || "";

    // Strip any raw URLs from the body display (they'll show in the CTA strip)
    var displayBody = resolved
      .replace(/(https?:\/\/[^\s]+)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Build body HTML (hashtags highlighted)
    var bodyHtml = highlightHashtags(displayBody.replace(/\n/g, "\n"));

    // Populate modal elements
    getEl("previewBody").innerHTML = bodyHtml;

    // CTA strip
    var ctaStrip = getEl("previewCtaStrip");
    var ctaText  = getEl("previewCtaText");
    if (waLink) {
      ctaStrip.href = waLink;
      ctaText.textContent = isAr ? "تواصل معنا عبر واتساب" : "Contact us on WhatsApp";
      ctaStrip.style.display = "flex";
    } else {
      ctaStrip.style.display = "none";
    }

    // Stats
    getEl("previewStats").innerHTML = renderStats(resolved, waLink);

    return true;
  }

  // ── Open / Close ─────────────────────────────────────────────────
  function openModal() {
    if (!renderPreview()) return;
    var modal = getEl("previewModal");
    if (modal) {
      modal.classList.add("open");
      modal.style.display = "flex";
    }
  }

  function closeModal() {
    var modal = getEl("previewModal");
    if (modal) {
      modal.classList.remove("open");
      modal.style.display = "none";
    }
  }

  // ── Wire up events after DOM ready ───────────────────────────────
  document.addEventListener("DOMContentLoaded", function() {
    // Open button
    var openBtn = getEl("openPreviewModal");
    if (openBtn) openBtn.addEventListener("click", openModal);

    // Close buttons
    ["closePreviewModal", "closePreviewModal2"].forEach(function(id) {
      var btn = getEl(id);
      if (btn) btn.addEventListener("click", closeModal);
    });

    // Close on backdrop tap
    var modal = getEl("previewModal");
    if (modal) {
      modal.addEventListener("click", function(e) {
        if (e.target === modal) closeModal();
      });
    }

    // "Use This Post" — simply close (content already in textarea)
    var useBtn = getEl("previewUsePost");
    if (useBtn) {
      useBtn.addEventListener("click", function() {
        closeModal();
        showToast("Post ready! Select groups and hit START.", "success");
      });
    }

    // Keyboard: Escape closes
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") closeModal();
    });
  });

})();


// ═══════════════════════════════════════════════════════════════════
// V5: PAUSE BUTTON — إضافة جديدة كاملة لا تمس الكود الأصلي
// ═══════════════════════════════════════════════════════════════════
function initPauseButton() {
  var pb = $("pauseBtn");
  if (!pb) return;
  var tf = false;
  pb.addEventListener("touchend", function(e) {
    e.preventDefault(); tf = true;
    setTimeout(function(){ tf = false; }, 600);
    handlePauseToggle();
  }, { passive: false });
  pb.addEventListener("click", function() { if (!tf) handlePauseToggle(); });
}

var _ptBusy = false;
async function handlePauseToggle() {
  if (_ptBusy) return;
  _ptBusy = true;
  setTimeout(function(){ _ptBusy = false; }, 1000);
  if (isPaused) {
    var r = await chrome.runtime.sendMessage({ action: "RESUME_POSTING" });
    if (r && r.success) {
      isPosting = true; isPaused = false; updatePowerBtn();
      showToast("▶ استئناف من المجموعة #" + (r.resumedFrom + 1), "success");
    } else { showToast((r && r.error) || "لا يوجد طابور", "warning"); }
  } else if (isPosting) {
    var r2 = await chrome.runtime.sendMessage({ action: "PAUSE_POSTING" });
    if (r2 && r2.success) {
      isPosting = false; isPaused = true; updatePowerBtn();
      showToast("⏸ موقوف عند #" + (r2.pausedAt + 1) + " — اضغط RESUME للمتابعة", "warning");
    }
  }
  _ptBusy = false;
}
