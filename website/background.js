// ═══════════════════════════════════════════════════════════════════
//  BACKGROUND.JS  —  V8.4 Robust Queue + Persistence Layer (Patch 5)
//
//  Core posting engine preserved.
//  Surgical additions in this build:
//  • chrome.alarms-based queue wakeups / persistence
//  • Auto spintax resolution right before dispatch to content.js
//  • Search & Join Groups automation with notifications
//  • API error notifications
// ═══════════════════════════════════════════════════════════════════
const processedGroupIds    = new Set();
const POST_TIMEOUT_MS      = 70000;   // tighter timeout for faster queue flow
const PAGE_RENDER_WAIT_MS  = 900;     // turbo settle wait
const TAB_READY_TIMEOUTMS  = 8000;    // faster readiness timeout
const MIN_INTER_DELAY_MS   = 250;     // turbo inter-group floor
const QUEUE_ALARM_NAME     = "fbposter_queue_tick";
const SCHEDULE_ALARM_PREFIX = "fbposter_scheduled_";

// ── Storage helper (mirrors dashboard.js / popup.js pattern) ────────
function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
const KEEPALIVE_ALARM_NAME = "fbposter_keepalive";
const KEEPALIVE_PERIOD_MIN = 1;
const MAX_SMART_RECOVERY_RETRIES = 4;
const NETWORK_RECOVERY_DELAY_MS  = 12000;
const HANG_RECOVERY_DELAY_MS     = 8000;
const CONTENT_RECOVERY_DELAY_MS  = 5000;
const BACKGROUND_SAFE_DELAY_MS   = 15000;
const BACKGROUND_GRACE_WINDOW_MS = 120000;
const BACKGROUND_SAFE_MAX_RETRIES = 30;
const ALWAYS_FRESH_WORKER_TAB = false;
const WORKER_NAVIGATION_STABILIZE_MS = 450;
const CONTENT_HEARTBEAT_STALE_MS = 45000;

let activePostTabId      = null;
let backgroundWorkerTabId = null;
let backgroundWorkerMode  = true;
let advanceResolve        = null;
let isProcessingQueue     = false;
let _selfPingInterval     = null;  // keeps SW alive during active posting
const tabRuntimeState     = new Map();


async function getActiveTabSnapshot() {
  return await new Promise(resolve => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
        const t = Array.isArray(tabs) && tabs[0] ? tabs[0] : null;
        resolve(t && t.id != null ? { id: t.id, windowId: t.windowId || null } : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function restoreActiveTabSnapshot(snapshot) {
  if (!snapshot || snapshot.id == null) return;
  try {
    await new Promise(resolve => chrome.tabs.update(snapshot.id, { active: true }, () => resolve()));
  } catch (_) {}
}

// ─── SW SELF-PING — prevents MV3 service worker from sleeping ─────
function startSelfPing() {
    if (_selfPingInterval) return;
    // Dual-frequency ping: 10s timer + 25s alarm backup
    // Kiwi Android kills SW after ~30s of inactivity — this prevents it
    _selfPingInterval = setInterval(function() {
      chrome.storage.local.get(["postingActive", "backgroundWorkerTabId"], function(r) {
        if (!r.postingActive) { stopSelfPing(); return; }
        // Also poke the worker tab to prevent freezing
        if (r.backgroundWorkerTabId) {
          chrome.tabs.get(r.backgroundWorkerTabId, function(tab) {
            if (chrome.runtime.lastError || !tab) return;
            // Re-inject keepalive into worker tab if it went hidden
            try {
              chrome.scripting.executeScript({
                target: { tabId: r.backgroundWorkerTabId },
                func: function() {
                  if (window._fbpxKeepAlive) return;
                  window._fbpxKeepAlive = true;
                  // Prevent tab freeze via no-op storage access
                  try { chrome.storage.local.get("_ping", function(){}) } catch(_){}
                }
              }).catch(function(){});
            } catch(_){}
          });
        }
      });
    }, 8000);

    // Alarm-based backup — fires even if the setInterval is killed
    chrome.alarms.create(KEEPALIVE_ALARM_NAME + "_b", { periodInMinutes: 0.4 });
    chrome.alarms.create(KEEPALIVE_ALARM_NAME + "_c", { periodInMinutes: 0.6 });
  }

function stopSelfPing() {
  if (_selfPingInterval) { clearInterval(_selfPingInterval); _selfPingInterval = null; }
}

// ─── INSTALL / STARTUP ────────────────────────────────────────────
/* ══════════════════════════════════════════════════════════════════
   IN-EXTENSION UPDATE CHECKER
   Polls https://faset.xo.je/api/version.php on startup + every 4 h.
   Stores { version, notes, zip_url, detectedAt } in pendingUpdate key.
   popup.js reads this and shows the golden banner to the user.
   ══════════════════════════════════════════════════════════════════ */
const UPDATE_CHECK_ALARM = 'fbpx_updateCheck';
const UPDATE_CHECK_URL   = 'https://faset.xo.je/api/version.php';
const LICENSE_CHECK_URL  = 'https://faset.xo.je/api/check.php';
const LP_STATE_KEYS = ['fbpx_lp_session','fbpx_lp_email','fbpx_lp_token','fbpx_access_granted','fbpx_last_verified_at','fbpx_device_id','fbpx_device_label'];

function ensureBgDeviceIdentity() {
  return storageGet(LP_STATE_KEYS).then(function(s){
    var deviceId = s.fbpx_device_id || ('kiwi-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36));
    var deviceLabel = s.fbpx_device_label || 'Kiwi Android';
    if (deviceId !== s.fbpx_device_id || deviceLabel !== s.fbpx_device_label) {
      return storageSet({ fbpx_device_id: deviceId, fbpx_device_label: deviceLabel }).then(function(){ return { deviceId, deviceLabel, state: Object.assign({}, s, { fbpx_device_id: deviceId, fbpx_device_label: deviceLabel }) }; });
    }
    return { deviceId, deviceLabel, state: s };
  });
}

async function ensureLicensedAccess() {
  const packet = await ensureBgDeviceIdentity();
  const s = packet.state || {};
  if (!s.fbpx_lp_session || !s.fbpx_lp_email || !s.fbpx_lp_token) {
    throw new Error('سجّل دخولك أولاً من واجهة الإضافة.');
  }
  const lastVerified = Number(s.fbpx_last_verified_at || 0);
  if (s.fbpx_access_granted === true && lastVerified && (Date.now() - lastVerified) < 15 * 60 * 1000) {
    return true;
  }
  const resp = await fetch(LICENSE_CHECK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: s.fbpx_lp_email,
      token: s.fbpx_lp_token,
      device_id: packet.deviceId,
      device_label: packet.deviceLabel,
      extension_version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''
    })
  });
  let data = {};
  try { data = await resp.json(); } catch (_) {}
  if (!resp.ok || !data.ok || !data.access_granted) {
    await storageSet({ fbpx_access_granted: false, fbpx_access_status: data && data.status ? data.status : 'denied', fbpx_last_verified_at: Date.now() });
    var code = (data && (data.message || data.error)) || '';
    var ar = (data && data.message_ar) || '';
    if (!ar) {
      if (code === 'invalid_token') ar = 'انتهت جلسة الدخول. سجّل دخولك مرة أخرى.';
      else if (code === 'unknown_device') ar = 'الجهاز غير مسجّل. سجّل دخولك مرة واحدة لربط الجهاز.';
      else if (code === 'device_limit_reached') ar = 'تم بلوغ حد الأجهزة. سجّل دخولك مجددًا لربط هذا الجهاز.';
      else if (code === 'expired' || code === 'denied') ar = 'انتهت التجربة أو الاشتراك. جدّد من صفحة الدفع.';
      else if (code === 'extension_paused_by_admin') ar = 'تم إيقاف الإضافة مؤقتًا من الإدارة.';
      else if (code === 'server_not_configured') ar = 'السيرفر غير جاهز. تواصل مع الدعم.';
      else ar = 'الوصول غير مفعّل لهذا الحساب أو الجهاز.';
    }
    throw new Error(ar);
  }
  await storageSet({
    fbpx_access_granted: true,
    fbpx_access_status: data.status || 'active',
    fbpx_last_verified_at: Date.now(),
    fbpx_trial_started_at: data.trial_started_at || 0,
    fbpx_trial_ends_at: data.trial_ends_at || 0,
    fbpx_subscription_ends_at: data.subscription_expires_at || 0
  });
  return true;
}

function withLicensedAccess(sendResponse, job) {
  ensureLicensedAccess()
    .then(function(){ return job(); })
    .then(sendResponse)
    .catch(function(err){ sendResponse({ success: false, ok: false, message: err && err.message ? err.message : 'الوصول غير مفعّل' }); });
}

function _versionIsNewer(remote, current) {
  const r = String(remote || '0').split('.').map(Number);
  const c = String(current || '0').split('.').map(Number);
  const len = Math.max(r.length, c.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] || 0, cv = c[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

async function checkForExtensionUpdate() {
  try {
    const manifest = chrome.runtime.getManifest();
    const current  = manifest.version || '0.0.0';
    const res = await fetch(UPDATE_CHECK_URL, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.version) return;
    if (_versionIsNewer(data.version, current)) {
      await new Promise(r => chrome.storage.local.set({
        pendingUpdate: {
          version:     data.version,
          notes:       data.notes   || '',
          zip_url:     data.zip_url || '',
          current:     current,
          detectedAt:  Date.now()
        }
      }, r));
    } else {
      await new Promise(r => chrome.storage.local.remove('pendingUpdate', r));
    }
  } catch (_) {}
}

function ensureUpdateCheckAlarm() {
  chrome.alarms.get(UPDATE_CHECK_ALARM, (a) => {
    if (!a) chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: 240 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    postingActive: false,
    postQueue: [],
    postLog: [],
    currentGroupIndex: 0,
    minDelay: 0.35,
    maxDelay: 0.75,
    autoCloseTabs: true,
    backgroundWorkerMode: true,
    backgroundWorkerTabId: null,
    retryState: {},
    recoveryActive: false,
    lastRecoveryReason: "",
    awaitingNextGroup: false,
    nextRunAt: 0,
    singleAttemptPerGroup: true,
    attemptedTargetKeys: [],
    completedTargetKeys: [],
    postingSessionId: "",
    lastCompletedGroupIndex: -1,
    lastCompletedGroupUrl: "",
    lastCompletedSessionId: "",
    lastCompletedAt: 0
  });
  ensureKeepAliveAlarm();
  ensureUpdateCheckAlarm();
  checkForExtensionUpdate();
});

chrome.runtime.onStartup?.addListener(async () => {
  ensureKeepAliveAlarm();
  ensureUpdateCheckAlarm();
  checkForExtensionUpdate();
  try {
    const state = await storageGetAll();
    backgroundWorkerMode = state.backgroundWorkerMode !== false;
    backgroundWorkerTabId = state.backgroundWorkerTabId || null;
    if (state.postingActive) {
      startSelfPing();
      if (state.awaitingNextGroup) {
        wakeScheduledQueue("startup").catch(err => log("startup wake error:", err.message));
      } else if (!isProcessingQueue) {
        processNextGroup().catch(err => log("startup resume error:", err.message));
      }
    }
  } catch (err) {
    log("startup restore error:", err && err.message ? err.message : err);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabRuntimeState.delete(tabId);
  if (tabId === activePostTabId) activePostTabId = null;
  if (tabId === backgroundWorkerTabId) {
    backgroundWorkerTabId = null;
    storageSet({ backgroundWorkerTabId: null }).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME ||
      alarm.name === KEEPALIVE_ALARM_NAME + "_b" ||
      alarm.name === KEEPALIVE_ALARM_NAME + "_c") {
    await keepAliveHeartbeat();
    return;
  }
  if (alarm.name === UPDATE_CHECK_ALARM) {
    await checkForExtensionUpdate();
    return;
  }
  if (alarm.name === QUEUE_ALARM_NAME) {
    await wakeScheduledQueue("alarm");
    return;
  }
  if (alarm.name.indexOf(SCHEDULE_ALARM_PREFIX) === 0) {
    await fireScheduledCampaign(alarm.name.slice(SCHEDULE_ALARM_PREFIX.length));
  }
});

// ─── SCHEDULED CAMPAIGNS — independent of the live posting queue ──
// Stored separately under `scheduledCampaigns` so it never interferes
// with the existing posting/queue state machine above.
async function fireScheduledCampaign(scheduleId) {
  try {
    const data = await storageGet(["scheduledCampaigns"]);
    const list = data.scheduledCampaigns || [];
    const idx = list.findIndex(s => s.id === scheduleId);
    if (idx === -1) return;
    const job = list[idx];

    if (job.status !== "pending") return; // already fired or cancelled

    job.status = "running";
    job.firedAt = Date.now();
    await storageSet({ scheduledCampaigns: list });

    startSelfPing();
    const result = await handleStartPosting(job.payload);

    const fresh = (await storageGet(["scheduledCampaigns"])).scheduledCampaigns || [];
    const fIdx = fresh.findIndex(s => s.id === scheduleId);
    if (fIdx !== -1) {
      fresh[fIdx].status = (result && result.success !== false) ? "completed" : "failed";
      fresh[fIdx].completedAt = Date.now();
      fresh[fIdx].resultSummary = result && result.message ? String(result.message) : "";
      await storageSet({ scheduledCampaigns: fresh });
    }

    try {
      chrome.notifications.create("sched_" + scheduleId, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "fb Bablushr F — جدولة منشور",
        message: (job.payload && job.payload.title) || "تم تنفيذ الحملة المجدولة"
      });
    } catch (_) {}
  } catch (err) {
    log("Scheduled campaign error: " + (err && err.message ? err.message : err));
  }
}

// ─── MESSAGE ROUTER ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "PAGE_VISIBILITY_STATE") {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId !== null && tabId !== undefined) {
      const prev = tabRuntimeState.get(tabId) || {};
      const hidden = !!msg.hidden;
      tabRuntimeState.set(tabId, {
        ...prev,
        hidden,
        frozen: !!msg.frozen,
        url: msg.url || prev.url || "",
        lastVisibilityChangeAt: Number(msg.ts || Date.now()),
        lastHiddenAt: hidden ? Number(msg.ts || Date.now()) : (prev.lastHiddenAt || 0),
        lastShownAt: hidden ? (prev.lastShownAt || 0) : Number(msg.ts || Date.now()),
        lastHeartbeatAt: Number(msg.ts || Date.now())
      });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === "START_POSTING") {
    withLicensedAccess(sendResponse, function(){
      startSelfPing();
      return handleStartPosting(msg.payload);
    });
    return true;
  }
  if (msg.action === "SCHEDULE_CAMPAIGN") {
    withLicensedAccess(sendResponse, async function(){
      const { payload, scheduledAt, title } = msg;
      const delay = scheduledAt - Date.now();
      if (delay < 30000) return { ok: false, message: "الوقت المحدد قريب جداً — اختر وقتاً بعد 30 ثانية على الأقل" };
      const id = "sc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const data = await storageGet(["scheduledCampaigns"]);
      const list = data.scheduledCampaigns || [];
      list.push({ id, title: title || "حملة مجدولة", payload, scheduledAt, status: "pending", createdAt: Date.now() });
      await storageSet({ scheduledCampaigns: list });
      chrome.alarms.create(SCHEDULE_ALARM_PREFIX + id, { when: scheduledAt });
      return { ok: true, id };
    });
    return true;
  }
  if (msg.action === "GET_SCHEDULES") {
    (async () => {
      const data = await storageGet(["scheduledCampaigns"]);
      sendResponse({ ok: true, list: data.scheduledCampaigns || [] });
    })();
    return true;
  }
  if (msg.action === "CANCEL_SCHEDULE") {
    (async () => {
      try {
        const { id } = msg;
        chrome.alarms.clear(SCHEDULE_ALARM_PREFIX + id);
        const data = await storageGet(["scheduledCampaigns"]);
        const list = (data.scheduledCampaigns || []).map(s => s.id === id ? { ...s, status: "cancelled" } : s);
        await storageSet({ scheduledCampaigns: list });
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, message: e.message }); }
    })();
    return true;
  }
  // ── STEP 5: Test webhook ─────────────────────────────────────────
  if (msg.action === "TEST_WEBHOOK") {
    if (msg.url) sendCampaignWebhook(msg.url, 42, 3);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === "STOP_POSTING") {
    handleStopPosting().then(sendResponse);
    return true;
  }
  if (msg.action === "PAUSE_POSTING") {
    handlePausePosting().then(sendResponse);
    return true;
  }
  if (msg.action === "RESUME_POSTING") {
    handleResumePosting().then(sendResponse);
    return true;
  }
  if (msg.action === "GET_STATE") {
    chrome.storage.local.get(null, sendResponse);
    return true;
  }
  if (msg.action === "SEARCH_AND_JOIN_GROUPS") {
    withLicensedAccess(sendResponse, function(){ return handleSearchAndJoinGroups(msg.keyword || ""); });
    return true;
  }
  // ── NEW: Search groups without joining — returns list for posting ──
  if (msg.action === "SEARCH_GROUPS_ONLY") {
    withLicensedAccess(sendResponse, function(){ return handleSearchGroupsOnly(msg.keyword || "", msg.location || ""); });
    return true;
  }
  // ── Harvest all groups the user is already a member of ────────────
  if (msg.action === "GET_MY_GROUPS") {
    withLicensedAccess(sendResponse, function(){ return handleGetMyGroups(); });
    return true;
  }
  // ── NEW: Get/clear blacklist ───────────────────────────────────────
  if (msg.action === "GET_BLACKLIST") {
    getBlacklist().then(bl => sendResponse({ list: Array.from(bl) }));
    return true;
  }
  if (msg.action === "CLEAR_BLACKLIST") {
    storageSet({ blacklistedUrls: [] }).then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.action === "REMOVE_FROM_BLACKLIST") {
    getBlacklist().then(async bl => {
      bl.delete(String(msg.url || "").split("?")[0].toLowerCase());
      await storageSet({ blacklistedUrls: Array.from(bl) });
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.action === "HEARTBEAT") {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId !== null && tabId !== undefined) {
      const prev = tabRuntimeState.get(tabId) || {};
      tabRuntimeState.set(tabId, {
        ...prev,
        hidden: !!msg.hidden,
        frozen: !!msg.frozen,
        url: msg.url || prev.url || "",
        lastHeartbeatAt: Number(msg.ts || Date.now()),
        lastHeartbeatSource: msg.source || "content",
        lastVisibilityChangeAt: prev.lastVisibilityChangeAt || Number(msg.ts || Date.now())
      });
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === "GROUP_JOINED") {
    notifyGroupJoined(msg.payload?.groupName || "Facebook Group");
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === "API_ERROR") {
    notifyApiError(msg.error || "Unknown API error");
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === "SEARCH_GROUPS_ADVANCED") {
    withLicensedAccess(sendResponse, function(){ return handleSearchGroupsAdvanced(msg.payload || {}); });
    return true;
  }
  if (msg.action === "EXTRACT_POST_COMMENTS") {
    withLicensedAccess(sendResponse, function(){ return handleExtractPostComments(msg.payload || {}); });
    return true;
  }
  if (msg.action === "BULK_REPLY_TO_POST_COMMENTS") {
    withLicensedAccess(sendResponse, function(){ return handleBulkReplyToPostComments(msg.payload || {}); });
    return true;
  }
  if (msg.action === "SEND_PRIVATE_MESSAGE") {
    withLicensedAccess(sendResponse, function(){ return handleSendPrivateMessage(msg.payload || {}); });
    return true;
  }
  if (msg.action === "BULK_SEND_PRIVATE_MESSAGES") {
    withLicensedAccess(sendResponse, function(){ return handleBulkSendPrivateMessages(msg.payload || {}); });
    return true;
  }
  // ── V5: Smart Auto-Join — answer FB join questionnaire via Gemini/Groq ──
  if (msg.action === "GET_SMART_JOIN_ANSWER") {
    withLicensedAccess(sendResponse, function(){
      return handleSmartJoinAnswer(msg.question || "", msg.groupName || "").then(answer => ({ success: true, answer }));
    });
    return true;
  }

  // ── POSTING_DONE: content script signals success/failure ────────
  if (msg.action === "POSTING_DONE") {
    const result = msg.result || {};
    const isSuccess = !!result.success;

    if (activePostTabId !== null) {
      const tid = activePostTabId;

      if (isSuccess) {
        if (!backgroundWorkerMode) {
          // SUCCESS → close tab immediately
          log(`✅ Post succeeded — closing tab ${tid} immediately`);
          activePostTabId = null;
          chrome.tabs.remove(tid, () => {
            if (chrome.runtime.lastError) {
              log("Tab already closed:", chrome.runtime.lastError.message);
            }
          });
        } else {
          log(`✅ Post succeeded in worker mode — keeping worker tab ${tid}`);
        }
      } else {
        // FAILURE → wait 10s to let content.js retry, then close
        log(`❌ Post failed (${result.error || "unknown"}) — waiting 10s before closing tab ${tid}`);
        setTimeout(() => {
          // Only close if this tab is still the active posting tab
          if (activePostTabId === tid && !backgroundWorkerMode) {
            activePostTabId = null;
            chrome.tabs.remove(tid, () => {
              if (chrome.runtime.lastError) {
                log("Tab already closed:", chrome.runtime.lastError.message);
              }
            });
          }
        }, 10000);
      }
    }

    // Unblock advance() so the next group starts after the delay
    if (typeof advanceResolve === "function") {
      advanceResolve();
      advanceResolve = null;
    }

    // ── STEP 1: Update live badge with running success count ─────────
    chrome.storage.local.get('postLog', d => {
      const lg = d.postLog || [];
      const ok = lg.filter(l => l.success).length;
      updateLiveBadge(ok, lg.length);
    });

    sendResponse({ received: true });
    return true;
  }
});

function dedupePostingQueue(groups = []) {
  const seen = new Set();
  const out = [];
  (groups || []).forEach(group => {
    const key = getPostingTargetKey(group && group.url || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(group);
  });
  return out;
}

function mergeUniqueStringList(list = [], value) {
  const set = new Set(Array.isArray(list) ? list : []);
  if (value) set.add(String(value));
  return Array.from(set);
}

// ─── SESSION START / STOP ─────────────────────────────────────────
async function handleStartPosting(payload = {}) {
  const {
    groups               = [],
    content              = "",
    comment              = "",
    commentEnabled       = false,
    mediaFiles           = [],
    minDelay             = 0.35,
    maxDelay             = 0.75,
    autoCloseTabs        = true,
    backgroundWorkerMode: payloadWorkerMode = true,
    repeatCycleEnabled   = false,
    repeatCycleIntervalMs = 1800000,
    campaignName         = "",
    selectedCategory     = "",
    postAsPage           = "",
    postMode             = "account",
    singleAttemptPerGroup = true
  } = payload;

  // لا يُمرَّر أي تعليق إلا إذا كان مفعّلاً صراحةً ومعه نص
  const safeComment = (commentEnabled === true && String(comment || "").trim())
    ? String(comment).trim()
    : "";

  const dedupedGroups = dedupePostingQueue(groups);

  processedGroupIds.clear();
  activePostTabId = null;
  backgroundWorkerMode = payloadWorkerMode !== false;
  advanceResolve  = null;
  isProcessingQueue = false;
  ensureKeepAliveAlarm();
  await clearQueueAlarm();

  const postingSessionId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);

  await storageSet({
    postingActive:     true,
    postQueue:         dedupedGroups,
    currentGroupIndex: 0,
    postContent:       content,
    postComment:       safeComment,
    commentEnabled:    !!safeComment,
    mediaFiles,
    minDelay,
    maxDelay,
    autoCloseTabs,
    backgroundWorkerMode,
    backgroundWorkerTabId: backgroundWorkerMode ? backgroundWorkerTabId : null,
    retryState: {},
    recoveryActive: false,
    lastRecoveryReason: "",
    awaitingNextGroup: false,
    nextRunAt: 0,
    singleAttemptPerGroup: singleAttemptPerGroup !== false,
    attemptedTargetKeys: [],
    completedTargetKeys: [],
    repeatCycleEnabled: !!repeatCycleEnabled,
    repeatCycleIntervalMs: Math.max(60000, Number(repeatCycleIntervalMs) || 1800000),
    campaignName: String(campaignName || ""),
    selectedCategory: String(selectedCategory || ""),
    postAsPage: String(postAsPage || ""),
    postMode: String(postMode || "account"),
    postingSessionId,
    lastCompletedGroupIndex: -1,
    lastCompletedGroupUrl: "",
    lastCompletedSessionId: "",
    lastCompletedAt: 0,
    postLog: []
  });

  if (backgroundWorkerMode) notifyBackgroundWorkerReady();
  processNextGroup().catch(err => log("processNextGroup error:", err.message));
  return { success: true };
}

async function handleStopPosting() {
  stopSelfPing();  // stop SW keepalive
  await storageSet({ postingActive: false, awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false, lastRecoveryReason: "", retryState: {} });
  await clearQueueAlarm();
  await closeBackgroundWorkerTab();
  return { success: true };
}

async function handlePausePosting() {
  stopSelfPing();
  await clearQueueAlarm();
  const state = await storageGetAll();
  const idx = state.currentGroupIndex || 0;
  await storageSet({ postingActive: false, paused: true, pausedGroupIndex: idx, awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false, lastRecoveryReason: "" });
  return { success: true, pausedAt: idx };
}

async function handleResumePosting() {
  const state     = await storageGetAll();
  backgroundWorkerMode = state.backgroundWorkerMode !== false;
  backgroundWorkerTabId = state.backgroundWorkerTabId || null;
  const resumeIdx = (state.pausedGroupIndex != null) ? state.pausedGroupIndex : 0;
  const queue     = state.postQueue || [];
  if (!queue.length)             return { success: false, error: "No queue" };
  if (resumeIdx >= queue.length) return { success: false, error: "Queue finished" };
  await storageSet({ postingActive: true, paused: false, currentGroupIndex: resumeIdx, awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false, lastRecoveryReason: "" });
  startSelfPing();
  ensureKeepAliveAlarm();
  processNextGroup().catch(err => log("resume error:", err.message));
  return { success: true, resumedFrom: resumeIdx };
}

// ─── MAIN LOOP ────────────────────────────────────────────────────
async function processNextGroup() {
  if (isProcessingQueue) {
    log("processNextGroup skipped: already running");
    return;
  }
  isProcessingQueue = true;

  try {
    await clearQueueAlarm();
    await storageSet({ awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false });

    const state = await storageGetAll();
    if (!state.postingActive) { log("Stopped."); return; }

    const idx   = state.currentGroupIndex || 0;
    const queue = state.postQueue         || [];

    if (idx >= queue.length) {
      if (state.repeatCycleEnabled && queue.length) {
        const cycleDelay = Math.max(60000, Number(state.repeatCycleIntervalMs) || 1800000);
        const nextRunAt = Date.now() + cycleDelay;
        await storageSet({
          currentGroupIndex: 0,
          awaitingNextGroup: true,
          nextRunAt,
          recoveryActive: false,
          lastRecoveryReason: "",
          retryState: {}
        });
        chrome.alarms.create(QUEUE_ALARM_NAME, { when: nextRunAt });
        log(`🔁 Full cycle scheduled in ${Math.round(cycleDelay / 1000)}s`);
        return;
      }
      await storageSet({ postingActive: false, awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false, lastRecoveryReason: "", retryState: {} });
      await clearQueueAlarm();
      notifyComplete();
      return;
    }

    let effectiveIdx = idx;
    let group = queue[effectiveIdx];

    while (
      group &&
      state.postingSessionId &&
      state.lastCompletedSessionId === state.postingSessionId &&
      Number(state.lastCompletedGroupIndex) === effectiveIdx &&
      normalizeComparableFbUrl(state.lastCompletedGroupUrl || "") === normalizeComparableFbUrl(group?.url || "")
    ) {
      log(`🩹 Queue self-heal: skipping already-completed target at index ${effectiveIdx + 1}: ${group?.name || group?.url || "Unknown"}`);
      effectiveIdx += 1;
      await storageSet({ currentGroupIndex: effectiveIdx, awaitingNextGroup: false, nextRunAt: 0 });
      if (effectiveIdx >= queue.length) {
        await storageSet({ postingActive: false, awaitingNextGroup: false, nextRunAt: 0, recoveryActive: false, lastRecoveryReason: "", retryState: {} });
        await clearQueueAlarm();
        notifyComplete();
        return;
      }
      group = queue[effectiveIdx];
    }

    const groupId = extractGroupId(group?.url || "");
    const postingTargetKey = getPostingTargetKey(group?.url || "");
    const retryKey = getRetryKey(group, effectiveIdx);

    // ── Blacklist check ───────────────────────────────────────────
    if (await isBlacklisted(group?.url || "")) {
      log(`SKIP (blacklisted dead/banned): ${group.name}`);
      await clearRetryStateFor(retryKey);
      await appendLog({ groupName: group.name, groupUrl: group.url,
        success: false, error: "Blacklisted (dead or banned group)", timestamp: Date.now() });
      await advance(effectiveIdx);
      return;
    }

    // ── Smart spam guard: skip groups posted too many times today ──
    if (await isGroupOverPosted(group?.url || "")) {
      log(`SKIP (spam guard — already posted ${SMART_POST_LIMIT}+ times today): ${group.name}`);
      await clearRetryStateFor(retryKey);
      await appendLog({ groupName: group.name, groupUrl: group.url,
        success: false, error: "Smart spam guard: posted to this group too many times today (limit reached)", timestamp: Date.now() });
      await advance(effectiveIdx);
      return;
    }

    // ── Duplicate / single-attempt guard ─────────────────────────
    const attemptedTargetKeys = Array.isArray(state.attemptedTargetKeys) ? state.attemptedTargetKeys : [];
    if (postingTargetKey && attemptedTargetKeys.includes(postingTargetKey)) {
      log(`SKIP (already attempted in this run): ${group.name} — advancing to next`);
      await clearRetryStateFor(retryKey);
      await appendLog({ groupName: group.name, groupUrl: group.url,
        success: false, error: "Already attempted in this session", timestamp: Date.now() });
      await advance(effectiveIdx);
      return;
    }
    if (postingTargetKey && processedGroupIds.has(postingTargetKey)) {
      log(`SKIP (duplicate target key): ${group.name} — advancing to next`);
      await clearRetryStateFor(retryKey);
      await appendLog({ groupName: group.name, groupUrl: group.url,
        success: false, error: "Duplicate target in queue", timestamp: Date.now() });
      await advance(effectiveIdx);
      return;
    }
    if (postingTargetKey) {
      processedGroupIds.add(postingTargetKey);
      await storageSet({ attemptedTargetKeys: mergeUniqueStringList(attemptedTargetKeys, postingTargetKey) }).catch(() => {});
    }

    let tab = null;
    try {
      log(`Opening [${effectiveIdx + 1}/${queue.length}]: ${group.name}`);
      tab = await openPostingTab(group.url);
      activePostTabId = tab.id;

      // ── Short settle wait then verify the worker really reached the requested target ──
      await sleep(PAGE_RENDER_WAIT_MS);
      await waitForContentScript(tab.id, TAB_READY_TIMEOUTMS);
      const tabInfo = await ensurePostingTarget(tab.id, group.url, 4);

      // ── Verify we are still on the expected postable page (group OR page) ────
      if (!tabInfo || !isPostableUrl(tabInfo.url)) {
        throw new Error("Unexpected URL after load: " + (tabInfo ? tabInfo.url : "none"));
      }

      // ← CRITICAL: Use group.content which is pre-generated unique variation
      // Each group in queue has unique content assigned from popup's buildVariations()
      // Fallback to state.postContent only if group.content is missing
      const groupContent = group.content || state.postContent;
      const spintaxOpts = state.uniqueSpintax ? { homoglyph: true, zeroWidth: true } : {};
      const randomizedContent = processSpintax(groupContent || "", spintaxOpts);

      // ── Kiwi/Android: briefly activate the tab before posting ──────
      // Android freezes background tabs — this unfreezes content.js
      // long enough to receive and execute the POST_TO_GROUP command.
      try {
        await new Promise(r => chrome.tabs.update(tab.id, { active: true }, () => r()));
        await sleep(700);
      } catch (_) {}

      // ── FIX v90: sendWithRetry returns the result from content.js via
      // sendResponse. buildTimeoutResult now actually waits timeoutMs (see
      // its definition below) so this race is a real timeout, not an
      // instant-resolve that skips posting.
      const result = await Promise.race([
        sendWithRetry(tab.id, {
          action: "POST_TO_GROUP",
          payload: {
            content:    randomizedContent,
            comment:    state.postComment   || "",
            mediaFiles: state.mediaFiles    || [],
            imageData:  (state.mediaFiles && state.mediaFiles[0])
                          ? state.mediaFiles[0].dataUrl : null,
            groupId,
            groupName:  group.name,
            expectedUrl: group.url,
            postAsPage: state.postAsPage    || "",
            postMode:   state.postMode || "account"
          }
        }, 5, 2500),
        buildTimeoutResult(tab.id, POST_TIMEOUT_MS)
      ]);

      // ── Auto-blacklist dead/banned groups ─────────────────────────
      if (result && result.dead) {
        await addToBlacklist(group.url);
        log("Auto-blacklisted dead group: " + group.name);
        result.error = "Dead/banned group — blacklisted for future sessions";
      }

      // ── FIX v90: Auto-blacklist groups that always require admin approval.
      // These groups are "posting-blocked" in practice — the post is never
      // actually published. We record them so we never waste time on them again.
      if (result && result.pending) {
        log("Auto-blacklisting pending-approval group: " + group.name);
        await addToBlacklist(group.url);
      }

      // ── EARLY SKIP: existing pending/rejected post ─────────────────────────
      if (result && result.pendingRejected && result.earlySkip) {
        log(`⚡ EARLY SKIP (existing pending/rejected): ${group.name}`);
        await addToBlacklist(group.url);
        await appendLog({ groupName: group.name, groupUrl: group.url, success: false, pending: false, error: result.error || "تخطي فوري — منشور معلق/مرفوض سابق", status: "skipped_pending", timestamp: Date.now() });
        await clearRetryStateFor(retryKey);
        await advance(effectiveIdx);
        return;
      }

      if (!result.success && !result.dead) {
        const scheduled = await maybeScheduleRecoveryRetry({
          idx: effectiveIdx, group, groupId, retryKey,
          reason: result.error || "Unknown error",
          stage: "result"
        });
        if (scheduled) return;
      }

      // ── Log to session history (shown in dashboard) ───────────────
      const logStatus = result.pending ? "pending" : (result.success ? "success" : "failed");
      // حالة التعليق الأول منفصلة تمامًا عن حالة البوست نفسه — البوست ينجح
      // حتى لو التعليق فشل أو اتخطى (مفيش تعليق أصلاً).
      const commentStatus = !result.commentResult ? "none"
        : result.commentResult.skipped ? "skipped"
        : result.commentResult.success ? "success"
        : "failed";
      log(group.name + ": " + (result.success ? "SUCCESS" : (result.pending ? "PENDING" : "FAIL — " + result.error)) +
          (commentStatus === "failed" ? " | COMMENT FAILED — " + result.commentResult.reason : ""));
      await clearRetryStateFor(retryKey);
      await appendLog({
        groupName:  group.name,
        groupUrl:   group.url,
        success:    !!result.success,
        pending:    !!result.pending,
        postUrl:    result.postUrl || null,
        error:      result.error   || null,
        status:     logStatus,
        commentStatus: commentStatus,
        commentError:  (result.commentResult && !result.commentResult.success && !result.commentResult.skipped)
          ? (result.commentResult.reason || "unknown") : null,
        timestamp:  Date.now()
      });

      if (result.success || result.pending) {
        await storageSet({
          lastCompletedGroupIndex: effectiveIdx,
          lastCompletedGroupUrl:   group.url || "",
          lastCompletedSessionId:  state.postingSessionId || "",
          lastCompletedAt:         Date.now(),
          completedTargetKeys:     mergeUniqueStringList(state.completedTargetKeys || [], postingTargetKey)
        }).catch(() => {});
      }

      // ── Smart post-count: track per-group 24h history ─────────────
      if (result.success) {
        await incrementGroupPostCount(group.url || "").catch(() => {});
      }

      // ── Per-post notifications ─────────────────────────────────
      if (result.pending) {
        notifyPostPending(group.name, result.error || "Post is pending admin approval");
      } else if (result.success) {
        notifyPostSuccess(group.name, result.postUrl || null);
      } else if (shouldSuppressFailureNotification(result.error || "")) {
        notifyBackgroundSafePause(group.name, result.error || "Temporary background pause", 0, BACKGROUND_SAFE_DELAY_MS);
      } else {
        notifyPostFailed(group.name, result.error || "Unknown error");
      }

      // ── إشعار منفصل لفشل التعليق الأول — بيظهر جنب إشعار نجاح البوست،
      // مش بديل عنه، عشان تعرف إن النشر نجح لكن التعليق لأ. ────────────
      if (commentStatus === "failed") {
        notifyCommentFailed(group.name, result.commentResult.reason || "Unknown reason");
      }

      if (backgroundWorkerMode && tab && tab.id) {
        backgroundWorkerTabId = tab.id;
        await storageSet({ backgroundWorkerTabId: tab.id, lastPostedTarget: group.url || "" }).catch(() => {});
      }

    } catch (err) {
      const scheduled = await maybeScheduleRecoveryRetry({
        idx: effectiveIdx, group, groupId, retryKey,
        reason: err && err.message ? err.message : String(err || "Unknown error"),
        stage: "catch"
      });
      if (scheduled) return;
      log("Error:", err.message);
      await clearRetryStateFor(retryKey);
      await appendLog({
        groupName:  group ? group.name  : "Unknown",
        groupUrl:   group ? group.url   : "",
        success:    false,
        pending:    false,
        error:      err.message,
        status:     "failed",
        timestamp:  Date.now()
      });
      if (shouldSuppressFailureNotification(err && err.message ? err.message : "")) {
        notifyBackgroundSafePause(group ? group.name : "Unknown", err.message || "Temporary background pause", 0, BACKGROUND_SAFE_DELAY_MS);
      } else {
        notifyPostFailed(group ? group.name : "Unknown", err.message);
      }
    } finally {
      // ── FIX v90: In background-worker mode the pinned tab stays alive for
      // the next group — we just navigate it. In classic mode, close it now.
      const latest = await storageGetAll();
      if (tab && activePostTabId === tab.id && latest.autoCloseTabs !== false && !latest.backgroundWorkerMode) {
        activePostTabId = null;
        try { await chrome.tabs.remove(tab.id); log("Tab closed: " + (group ? group.name : "")); } catch (_) {}
      }
      if (latest.backgroundWorkerMode && tab && tab.id) {
        backgroundWorkerTabId = tab.id;
        await storageSet({ backgroundWorkerTabId: tab.id }).catch(() => {});
      }
      activePostTabId = null;
      advanceResolve  = null;
    }
    await advance(effectiveIdx);
  } finally {
    isProcessingQueue = false;
  }
}

// ─── ADVANCE — now backed by chrome.alarms for MV3 persistence ────
async function advance(currentIdx) {
  await storageSet({ currentGroupIndex: currentIdx + 1 });
  const fresh = await storageGetAll();
  if (!fresh.postingActive) return;

  const userMin  = Math.max(MIN_INTER_DELAY_MS / 1000, parseFloat(fresh.minDelay) || 0.35);
  const userMax  = Math.max(userMin,                    parseFloat(fresh.maxDelay) || 0.75);
  const delaySec = Math.random() * (userMax - userMin) + userMin;
  const delayMs  = Math.round(delaySec * 1000);
  const nextRunAt = Date.now() + delayMs;

  await storageSet({ awaitingNextGroup: true, nextRunAt });
  chrome.alarms.create(QUEUE_ALARM_NAME, { when: nextRunAt });

  log(`⏳ Waiting ${delaySec.toFixed(1)}s before next group… (alarm scheduled)`);

  // In-memory fast path — works while SW is alive
  // If SW dies before this fires, the alarm above will wake it back up
  setTimeout(() => {
    wakeScheduledQueue("timeout", currentIdx + 1).catch(err => log("timeout wake error:", err.message));
  }, delayMs + 50);
}

async function wakeScheduledQueue(source, expectedIndex = null) {
  const state = await storageGetAll();
  if (!state.postingActive) return false;
  if (!state.awaitingNextGroup) {
    // If SW restarted mid-session, awaitingNextGroup may be false but we still need to continue
    if (source === "alarm" && state.postingActive && !isProcessingQueue) {
      log(`⏰ SW restart detected via alarm — resuming queue`);
      processNextGroup().catch(err => log("alarm-resume error:", err.message));
      return true;
    }
    return false;
  }
  if (expectedIndex !== null && (state.currentGroupIndex || 0) !== expectedIndex) return false;
  if (isProcessingQueue) return false;

  await storageSet({ awaitingNextGroup: false, nextRunAt: 0 });
  await clearQueueAlarm();
  log(`⏰ Queue wake triggered by ${source}`);
  processNextGroup().catch(err => log("wakeScheduledQueue process error:", err.message));
  return true;
}

// ─── GROUP SEARCH & AUTO JOINER ───────────────────────────────────
async function handleSearchAndJoinGroups(keyword) {
  const cleanKeyword = String(keyword || "").trim();
  if (!cleanKeyword) return { success: false, error: "Keyword is required" };

  const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(cleanKeyword)}`;
  const tab = await openPostingTab(url);
  await sleep(2500);

  const results = await executeScript(tab.id, autoJoinGroupsInTab, [{ keyword: cleanKeyword }]);
  const summary = Array.isArray(results) && results[0] ? results[0].result : null;

  return {
    success: true,
    tabId: tab.id,
    summary: summary || { joinedCount: 0, joinedGroups: [] }
  };
}

// ── NEW: Search groups/pages — collect URLs without joining ──────────
async function handleSearchGroupsOnly(keyword, location) {
  const cleanKeyword = String(keyword || "").trim();
  if (!cleanKeyword) return { success: false, error: "Keyword is required" };

  const q = encodeURIComponent(cleanKeyword + (location ? " " + location : ""));
  const url = `https://www.facebook.com/search/groups/?q=${q}`;
  const tab = await openPostingTab(url);
  await sleep(3000);

  const results = await executeScript(tab.id, function({ kw }) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const groups = [];
    const seen   = new Set();

    function collectGroups() {
      document.querySelectorAll('a[href*="/groups/"]').forEach(a => {
        const href = a.href || "";
        const m = href.match(/facebook\.com\/groups\/([^/?#]+)/i);
        if (!m) return;
        const id = m[1];
        if (id === "feed" || id === "discover" || id === "create" || seen.has(id)) return;
        seen.add(id);
        const card  = a.closest('[role="article"],[data-pagelet]') || a.parentElement;
        const name  = (card?.querySelector('span, h3, h4')?.innerText || a.innerText || id).trim().slice(0, 80);
        groups.push({ name: name || id, url: "https://www.facebook.com/groups/" + id });
      });
    }

    return (async () => {
      for (let i = 0; i < 60; i++) {   // 60 scroll cycles to reach ~500
        collectGroups();
        window.scrollBy({ top: window.innerHeight * 1.2, behavior: "smooth" });
        await sleep(900);
        if (groups.length >= 500) break;  // cap at 500
      }
      collectGroups();
      return { groups, count: groups.length };
    })();
  }, [{ kw: cleanKeyword }]);

  const data = Array.isArray(results) && results[0] ? results[0].result : null;

  try { await chrome.tabs.remove(tab.id); } catch (_) {}

  // V5 FIX: فلتر النتائج بالكلمة المفتاحية الدقيقة قبل الإرجاع
  const allFound   = data?.groups || [];
  const kwNormBg   = cleanKeyword.toLowerCase();
  const kwWordsBg  = kwNormBg.split(/\s+/).filter(Boolean);
  const filtered   = allFound.filter(g => {
    const n = (g.name || "").toLowerCase();
    return kwWordsBg.every(w => n.includes(w));
  });
  const toReturn = filtered.length ? filtered : allFound; // fallback
  return {
    success: true,
    groups: toReturn,
    count:  toReturn.length
  };
}

// ── Harvest all groups the user is a member of (up to 500) ──────────
async function handleGetMyGroups() {
  const url = "https://www.facebook.com/groups/feed/";
  const tab = await openPostingTab(url);
  await sleep(3500);

  const results = await executeScript(tab.id, function() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const groups = [];
    const seen   = new Set();

    function collect() {
      document.querySelectorAll('a[href*="/groups/"]').forEach(a => {
        const m = (a.href || "").match(/facebook\.com\/groups\/([^/?#]+)/i);
        if (!m) return;
        const id = m[1];
        if (["feed","discover","create","joins","search","invites"].includes(id)) return;
        if (seen.has(id)) return;
        seen.add(id);
        const card = a.closest('[role="article"],[data-pagelet],li') || a.parentElement;
        const name = (card?.querySelector('span,h3,h4,strong')?.innerText || a.innerText || id)
          .trim().replace(/\n.*/s,"").slice(0, 80);
        groups.push({ name: name || id, url: "https://www.facebook.com/groups/" + id, member: true });
      });
    }

    return (async () => {
      for (let i = 0; i < 60; i++) {
        collect();
        window.scrollBy({ top: window.innerHeight * 1.2, behavior: "smooth" });
        await sleep(850);
        if (groups.length >= 500) break;
      }
      collect();
      return { groups, count: groups.length };
    })();
  }, []);

  const data = Array.isArray(results) && results[0] ? results[0].result : null;
  try { await chrome.tabs.remove(tab.id); } catch (_) {}

  return {
    success: true,
    groups: data?.groups || [],
    count:  data?.count  || 0
  };
}



function parseMemberCount(text) {
  const s = String(text || "").toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|m|ألف|الف|مليون)?\s*(members?|عضو|أعضاء|member)?/i);
  if (!m) return 0;
  let n = Number(m[1] || 0);
  const unit = String(m[2] || "").toLowerCase();
  if (unit === 'k' || unit === 'ألف' || unit === 'الف') n *= 1000;
  if (unit === 'm' || unit === 'مليون') n *= 1000000;
  return Math.round(n);
}

function detectGroupType(text) {
  const s = String(text || '').toLowerCase();
  if (/buy\s*&?\s*sell|بيع\s*وشراء|buy and sell/.test(s)) return 'buy-sell';
  if (/private|خاصة|خاص/.test(s)) return 'private';
  if (/public|عامة|عام/.test(s)) return 'public';
  return 'unknown';
}

function normalizeDiscoverText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^\u0000-\u007E\u0600-\u06FFa-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitFilterTerms(text) {
  return Array.from(new Set(
    normalizeDiscoverText(text)
      .split(/[\s,،|\/\n\t]+/)
      .map(x => x.trim())
      .filter(Boolean)
  ));
}

function toJoinKey(value) {
  return normalizeDiscoverText(String(value || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, ''));
}

async function setDiscoverLiveStatus(status = {}) {
  await storageSet({ discoverLiveStatus: { ...status, at: Date.now() } });
}

async function saveGroupsToLibrary(groups, category) {
  const state = await storageGetAll();
  const existing = Array.isArray(state.groupsLibrary) ? state.groupsLibrary : [];
  const map = new Map(existing.map(g => [String(g.url || '').toLowerCase(), g]));
  (groups || []).forEach(g => {
    const key = String(g.url || '').toLowerCase();
    if (!key) return;
    const prev = map.get(key) || {};
    map.set(key, {
      ...prev,
      ...g,
      category: g.category || prev.category || category || 'عام',
      savedAt: prev.savedAt || Date.now()
    });
  });
  const categories = new Set(Array.isArray(state.groupCategories) ? state.groupCategories : ['عام']);
  if (category) categories.add(String(category));
  await storageSet({ groupsLibrary: Array.from(map.values()), groupCategories: Array.from(categories) });
}

async function handleSearchGroupsAdvanced(payload = {}) {
  const keyword = String(payload.keyword || '').trim();
  const province = String(payload.province || '').trim();
  const searchSeed = [keyword, province].filter(Boolean).join(' ').trim();
  const groupType = String(payload.groupType || 'all').trim();
  const minMembers = Math.max(0, Number(payload.minMembers) || 0);
  const autoJoin = !!payload.autoJoin;
  const category = String(payload.category || 'عام').trim() || 'عام';
  const requiredTermsRaw = String(payload.requiredTerms || '').trim();
  const excludedTermsRaw = String(payload.excludedTerms || '').trim();
  if (!searchSeed) return { success: false, error: 'اكتب كلمة مفتاحية أو محافظة على الأقل' };

  await setDiscoverLiveStatus({ phase: 'open', message: 'جاري فتح صفحة البحث...' });
  const keywordTerms = splitFilterTerms(keyword || searchSeed);
  const requiredTerms = splitFilterTerms(requiredTermsRaw);
  const excludedTerms = splitFilterTerms(excludedTermsRaw);
  const provinceTerms = splitFilterTerms(province);
  const q = encodeURIComponent(searchSeed);
  const url = `https://www.facebook.com/search/groups/?q=${q}`;
  const tab = await openPostingTab(url);
  await sleep(3500);

  await setDiscoverLiveStatus({ phase: 'scan', message: 'جاري مسح النتائج من صفحة Facebook...' });
  const results = await executeScript(tab.id, function({ keyword, province }) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const out = [];
    const seen = new Set();
    function txt(el) { return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim(); }
    function collect() {
      const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
      anchors.forEach(a => {
        const href = a.href || '';
        const m = href.match(/facebook\.com\/groups\/([^/?#]+)/i);
        if (!m) return;
        const slug = m[1];
        if (!slug || ['feed','discover','create','joins','search','invites'].includes(slug) || seen.has(slug)) return;
        const card = a.closest('[role="article"],[data-pagelet],[role="listitem"],li,section,div') || a.parentElement;
        const text = txt(card);
        const nameNode = card?.querySelector('[role="heading"],h1,h2,h3,h4,strong,span');
        const name = txt(nameNode) || txt(a) || slug;
        seen.add(slug);
        out.push({
          slug,
          name: name.slice(0, 120),
          url: 'https://www.facebook.com/groups/' + slug,
          rawText: text.slice(0, 900)
        });
      });
    }
    return (async () => {
      for (let i = 0; i < 55; i++) {
        collect();
        window.scrollBy({ top: window.innerHeight * 1.15, behavior: 'smooth' });
        await sleep(900);
      }
      collect();
      return out;
    })();
  }, [{ keyword, province }]);

  let raw = Array.isArray(results) && results[0] ? (results[0].result || []) : [];
  if (!raw.length) {
    const compat = await handleSearchGroupsOnly(searchSeed, '');
    if (compat && compat.success && Array.isArray(compat.groups) && compat.groups.length) {
      raw = compat.groups.map(g => ({
        slug: String(g.url || '').match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1] || '',
        name: g.name || '',
        url: g.url || '',
        rawText: [g.name || '', searchSeed].join(' ').trim()
      }));
    }
  }
  await setDiscoverLiveStatus({ phase: 'filter', message: 'جاري تطبيق الفلاتر المتقدمة...', scannedCount: raw.length });
  const enriched = raw.map(g => {
    const members = parseMemberCount(g.rawText || '');
    const detectedType = detectGroupType(g.rawText || g.name || '');
    const nameNorm = normalizeDiscoverText(g.name || '');
    const haystack = normalizeDiscoverText(`${g.name} ${g.rawText || ''} ${g.url || ''}`);
    const matchedKeywordTerms = keywordTerms.filter(term => haystack.includes(term) || nameNorm.includes(term));
    const missingRequired = requiredTerms.filter(term => !haystack.includes(term) && !nameNorm.includes(term));
    const hitExcluded = excludedTerms.find(term => haystack.includes(term) || nameNorm.includes(term));
    // المحافظة تُستخدم في استعلام البحث فقط — لا نرفض النتائج لمجرد غيابها من نص البطاقة (فيسبوك غالباً لا يعرضها)
    const keywordCoverage = keywordTerms.length ? (matchedKeywordTerms.length / keywordTerms.length) : 1;
    const matchedByLabel = requiredTerms.length
      ? requiredTerms.join(' + ')
      : (matchedKeywordTerms.join(' + ') || `Facebook search: ${searchSeed}`);
    let rejectedReason = '';
    // رفض فقط عند كلمات إلزامية ناقصة أو مستبعدة أو نوع واضح مختلف أو أعضاء أقل من الحد عند توفر العدد
    if (requiredTerms.length && missingRequired.length) rejectedReason = `تنقص كلمات مطلوبة: ${missingRequired.join('، ')}`;
    else if (hitExcluded) rejectedReason = `يحتوي كلمة مستبعدة: ${hitExcluded}`;
    else if (minMembers > 0 && members > 0 && members < minMembers) rejectedReason = `أقل من الحد الأدنى (${minMembers})`;
    else if (groupType !== 'all' && detectedType !== 'unknown' && detectedType !== groupType) rejectedReason = `النوع ${detectedType} لا يطابق ${groupType}`;
    // إن وُجدت كلمات مفتاحية ولم تطابق أي كلمة في الاسم/الوصف → استبعاد ضعيف فقط عند تغطية صفر
    else if (keywordTerms.length && matchedKeywordTerms.length === 0 && nameNorm) {
      // لا نرفض بقسوة — فيسبوك قد يعرض نتائج ذات صلة بدون تكرار حرفي
      rejectedReason = '';
    }
    return {
      ...g,
      members,
      detectedType,
      category,
      matchedBy: matchedByLabel,
      keywordCoverage,
      matchedKeywordTerms,
      rejectedReason,
      autoJoinMatched: !rejectedReason
    };
  });

  const filtered = enriched.filter(g => !g.rejectedReason);
  const excluded = enriched.filter(g => !!g.rejectedReason);
  let joinSummary = { joinedCount: 0, joinedGroups: [], attemptedCount: 0, matchedVisibleCount: 0, skippedOutOfFilterCount: 0, duplicateAttemptSkips: 0 };
  if (autoJoin && filtered.length) {
    await setDiscoverLiveStatus({ phase: 'join', message: 'جاري الانضمام إلى الجروبات المطابقة فقط...', scannedCount: raw.length, matchedCount: filtered.length });
    try {
      const joinResults = await executeScript(tab.id, autoJoinGroupsInTab, [{ keyword, allowedGroups: filtered.slice(0, 200).map(g => ({ name: g.name, url: g.url, slug: g.slug, rawText: g.rawText })) }]);
      joinSummary = Array.isArray(joinResults) && joinResults[0] ? (joinResults[0].result || joinSummary) : joinSummary;
    } catch (_) {}
  }

  const joinedKeySet = new Set([
    ...((joinSummary.joinedGroups || []).map(name => toJoinKey(name))),
    ...((joinSummary.joinedKeys || []).map(value => toJoinKey(value)))
  ]);
  const finalGroups = filtered.map(g => {
    const isJoined = joinedKeySet.has(toJoinKey(g.name)) || joinedKeySet.has(toJoinKey(g.url)) || (g.slug && joinedKeySet.has(toJoinKey('facebook.com/groups/' + g.slug)));
    return {
      ...g,
      joinStatus: isJoined ? 'joined' : '',
      joinNote: isJoined ? 'تم الانضمام أو إرسال الطلب' : (autoJoin ? 'مطابق لكن لم يتم تأكيد الانضمام' : 'مطابق بدون انضمام تلقائي'),
      autoJoinMatched: true
    };
  });

  await setDiscoverLiveStatus({ phase: 'save', message: 'جاري حفظ النتائج والتقرير...', scannedCount: raw.length, matchedCount: finalGroups.length, attemptedCount: joinSummary.attemptedCount || 0 });
  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  await saveGroupsToLibrary(finalGroups, category);
  // إعادة التركيز لتبويب لوحة الويب (🌐) حتى لا يضيع المستخدم بعد انتهاء البحث
  try {
    const dashUrl = chrome.runtime.getURL('dashboard.html');
    const dashTabs = await chrome.tabs.query({ url: dashUrl + '*' }).catch(() => []);
    const allTabs = dashTabs && dashTabs.length ? dashTabs : await chrome.tabs.query({}).catch(() => []);
    const dash = (allTabs || []).find(t => t.url && t.url.indexOf('dashboard.html') !== -1);
    if (dash && dash.id) {
      await chrome.tabs.update(dash.id, { active: true }).catch(() => {});
      if (dash.windowId != null) await chrome.windows.update(dash.windowId, { focused: true }).catch(() => {});
    }
  } catch (_) {}
  const summary = {
    keyword,
    province,
    category,
    autoJoin,
    keywordTerms,
    requiredTerms,
    excludedTerms,
    scannedCount: raw.length,
    strictMatchedCount: filtered.length,
    excludedCount: excluded.length,
    count: finalGroups.length,
    joinSummary,
    groups: finalGroups.slice(0, 60),
    excludedPreview: excluded.slice(0, 80),
    liveStatus: { phase: 'done', message: 'اكتمل البحث والحفظ.', scannedCount: raw.length, matchedCount: finalGroups.length, attemptedCount: joinSummary.attemptedCount || 0 },
    at: Date.now()
  };
  await storageSet({ lastSearchSummary: summary });
  await setDiscoverLiveStatus(summary.liveStatus);
  return {
    success: true,
    groups: finalGroups,
    excluded,
    excludedCount: excluded.length,
    count: finalGroups.length,
    strictMatchedCount: filtered.length,
    scannedCount: raw.length,
    joinSummary
  };
}

async function handleExtractPostComments(payload = {}) {
  const postUrl = String(payload.postUrl || '').trim();
  if (!postUrl) return { success: false, error: 'Post URL is required' };
  const tab = await openPostingTab(postUrl);
  await sleep(3500);
  const results = await executeScript(tab.id, function() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const items = [];
    const seen = new Set();
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    function getIdFromUrl(u) {
      const m = String(u || '').match(/facebook\.com\/([^/?#]+)/i);
      return m ? m[1] : '';
    }
    function normalizeUrl(u) {
      return String(u || '').split('#')[0].trim();
    }
    function collect() {
      const nodes = Array.from(document.querySelectorAll('[role="article"], ul li, div'));
      nodes.forEach(node => {
        const text = clean(node.innerText || '');
        if (!text || text.length < 3) return;
        const profile = node.querySelector('a[href*="facebook.com/"]:not([href*="/groups/"]):not([href*="/posts/"]):not([href*="story_fbid="]):not([href*="comment_id="])');
        const name = clean(profile?.innerText || '').split("\n")[0];
        if (!name || name.length < 2) return;
        const commentLink = node.querySelector('a[href*="comment_id="], a[href*="reply_comment_id="], a[href*="story_fbid="]');
        const key = `${normalizeUrl(profile?.href || '')}__${text.slice(0, 100)}`;
        if (seen.has(key)) return;
        const replyCountMatch = text.match(/(\d+)\s*(reply|replies|رد|ردود)/i);
        seen.add(key);
        items.push({
          name,
          profileUrl: normalizeUrl(profile?.href || ''),
          profileId: getIdFromUrl(profile?.href || ''),
          commentUrl: normalizeUrl(commentLink?.href || ''),
          text: text.slice(0, 700),
          replyCount: replyCountMatch ? Number(replyCountMatch[1]) : 0
        });
      });
    }
    return (async () => {
      for (let i = 0; i < 24; i++) {
        collect();
        window.scrollBy({ top: window.innerHeight * 1.15, behavior: 'smooth' });
        await sleep(1100);
      }
      collect();
      return items.slice(0, 500);
    })();
  }, []);
  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  const comments = Array.isArray(results) && results[0] ? (results[0].result || []) : [];
  return { success: true, comments, count: comments.length };
}

async function handleBulkReplyToPostComments(payload = {}) {
  const postUrl = String(payload.postUrl || '').trim();
  const replyText = String(payload.replyText || '').trim();
  const targetNames = Array.isArray(payload.targetNames) ? payload.targetNames.filter(Boolean) : [];
  const targetProfiles = Array.isArray(payload.targetProfiles) ? payload.targetProfiles.filter(Boolean) : [];
  const delayMs = Math.max(500, Number(payload.delayMs) || 2000);
  if (!postUrl || !replyText) return { success: false, error: 'Post URL and reply text are required' };
  const tab = await openPostingTab(postUrl);
  await waitForContentScript(tab.id, 12000);
  await sleep(2500);
  const result = await sendWithRetry(tab.id, {
    action: 'BULK_REPLY_TO_CURRENT_POST',
    payload: { replyText, targetNames, targetProfiles, delayMs }
  }, 3, 1400);
  try { await chrome.tabs.remove(tab.id); } catch (_) {}
  if (!result) return { success: false, error: 'Bulk reply failed' };
  return {
    success: !!result.success,
    repliedCount: Number(result.repliedCount || 0),
    failedCount: Number(result.failedCount || 0),
    skippedCount: Number(result.skippedCount || 0),
    replied: result.replied || [],
    failed: result.failed || [],
    skipped: result.skipped || [],
    error: result.error || ''
  };
}

function buildProfileUrlVariants(input) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const out = [];
  const push = value => {
    const v = String(value || '').trim();
    if (!v || out.includes(v)) return;
    out.push(v);
  };
  push(raw);
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://www.facebook.com/${raw.replace(/^\/+/, '')}`);
    const pathname = url.pathname.replace(/\/$/, '');
    const search = /profile\.php/i.test(pathname) ? url.search : '';
    push(`https://www.facebook.com${pathname}${search}`);
    push(`https://m.facebook.com${pathname}${search}`);
    push(`https://web.facebook.com${pathname}${search}`);
  } catch (_) {}
  return out;
}

async function handleSendPrivateMessage(payload = {}) {
  const profileUrl = String(payload.profileUrl || '').trim();
  const messageText = String(payload.messageText || '').trim();
  if (!profileUrl || !messageText) return { success: false, error: 'Profile URL and message text are required' };
  const variants = buildProfileUrlVariants(profileUrl);
  let lastError = '';
  for (let i = 0; i < variants.length; i++) {
    const currentUrl = variants[i];
    let tab = null;
    try {
      tab = await openPostingTab(currentUrl);
      await waitForContentScript(tab.id, 12000);
      await sleep(2500);
      const result = await sendWithRetry(tab.id, {
        action: 'SEND_PRIVATE_MESSAGE_IN_PROFILE',
        payload: { messageText }
      }, 3, 1500);
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
      if (result && result.success) return { ...result, usedProfileUrl: currentUrl, attempts: i + 1 };
      lastError = result?.error || lastError || 'Private message failed';
    } catch (err) {
      lastError = err?.message || String(err || 'Private message failed');
      if (tab?.id) {
        try { await chrome.tabs.remove(tab.id); } catch (_) {}
      }
    }
    if (i < variants.length - 1) await sleep(900 + (i * 700));
  }
  return { success: false, error: lastError || 'Private message failed', attemptedUrls: variants };
}

async function handleBulkSendPrivateMessages(payload = {}) {
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const messageText = String(payload.messageText || '').trim();
  const delayMs = Math.max(500, Number(payload.delayMs) || 2000);
  const MAX_RETRY = 3;
  if (!profiles.length || !messageText) return { success: false, error: 'Profiles and message text are required' };
  const unique = [];
  const seen = new Set();
  for (const item of profiles) {
    const key = String(item?.profileUrl || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  let sent = 0, failed = 0, skipped = profiles.length - unique.length;
  const details = [];
  for (const item of unique) {
    let result = null;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      result = await handleSendPrivateMessage({ profileUrl: item.profileUrl, messageText });
      if (result && result.success) break;
      if (attempt < MAX_RETRY - 1) {
        const retryWait = delayMs * (attempt + 1);
        log(`PM retry ${attempt + 1}/${MAX_RETRY} for ${item.name || item.profileUrl} in ${retryWait}ms`);
        await new Promise(r => setTimeout(r, retryWait));
      }
    }
    if (result && result.success) {
      sent += 1;
      details.push({ name: item.name || '', profileUrl: item.profileUrl, success: true });
    } else {
      failed += 1;
      details.push({ name: item.name || '', profileUrl: item.profileUrl, success: false, error: result?.error || 'Unknown error' });
    }
    const jitter = Math.floor(Math.random() * 800);
    await new Promise(resolve => setTimeout(resolve, delayMs + jitter));
  }
  return { success: sent > 0 || failed === 0, sent, failed, skipped, details };
}

async function executeScript(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
}

// ─── V5: SMART AUTO-JOIN — robust scan + Gemini-answered questionnaire ──
function autoJoinGroupsInTab({ keyword, allowedGroups = [] }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const norm = t => String(t || '').replace(/\s+/g, ' ').replace(/[​-‍﻿]/g, '').trim().toLowerCase();
  const isVis = el => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
  };
  const textOf = el => norm([
    el?.innerText,
    el?.textContent,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title')
  ].filter(Boolean).join(' '));
  const normalizeKey = value => norm(String(value || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, ''));
  const slugFrom = value => {
    const m = String(value || '').match(/\/groups\/([^/?#]+)/i);
    return m ? m[1] : '';
  };

  const JOIN_RX = /(join|join group|request to join|طلب الانضمام|طلب عضوية|انضم|انضمام|انضم للمجموعة|انضم إلى المجموعة)/i;
  const SKIP_RX = /(joined|requested|pending|cancel request|cancelled|تم الانضمام|تم إرسال|تم ارسال|requested to join|عضو|member|مشرف|admin)/i;

  const clicked = new Set();
  const joined = [];
  const joinedKeys = [];
  const attemptedSessionKeys = new Set();
  let duplicateAttemptSkips = 0;
  let unresolvedAllowedCount = 0;

  const allowedEntries = (Array.isArray(allowedGroups) ? allowedGroups : []).map(item => {
    const slug = item?.slug || slugFrom(item?.url || '');
    const name = String(item?.name || '').trim();
    const url = String(item?.url || '').trim();
    const rawText = String(item?.rawText || '').trim();
    return {
      name,
      url,
      slug,
      rawText,
      nameKey: normalizeKey(name),
      urlKey: normalizeKey(url),
      slugKey: slug ? normalizeKey('facebook.com/groups/' + slug) : '',
      rawKey: normalizeKey(rawText).slice(0, 180)
    };
  });

  function getGroupCard(node) {
    return node?.closest?.('[data-pagelet],[role="article"],li,section,[role="listitem"],div') || node?.parentElement || null;
  }

  function getCardInfo(card) {
    if (!card) return null;
    const anchor = card.querySelector('a[href*="/groups/"]');
    const heading = card.querySelector('[role="heading"],h1,h2,h3,h4,strong');
    const url = String(anchor?.href || '').split('#')[0].trim();
    const slug = slugFrom(url);
    const anchorText = String(anchor?.innerText || anchor?.textContent || '').trim().replace(/\s+/g, ' ');
    const name = (String(heading?.innerText || heading?.textContent || '').trim().replace(/\s+/g, ' ') || anchorText || slug || keyword).slice(0, 140);
    const cardText = textOf(card);
    return {
      card,
      name,
      url,
      slug,
      cardText,
      nameKey: normalizeKey(name),
      urlKey: normalizeKey(url),
      slugKey: slug ? normalizeKey('facebook.com/groups/' + slug) : ''
    };
  }

  function collectCards() {
    const seen = new Set();
    const out = [];
    const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
    for (const a of anchors) {
      const card = getGroupCard(a);
      const info = getCardInfo(card);
      if (!info) continue;
      const key = info.slugKey || info.urlKey || info.nameKey;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(info);
    }
    return out;
  }

  function scoreEntry(cardInfo, entry) {
    let score = 0;
    if (!cardInfo || !entry) return score;
    if (entry.slugKey && cardInfo.slugKey && entry.slugKey === cardInfo.slugKey) score += 120;
    if (entry.urlKey && cardInfo.urlKey && entry.urlKey === cardInfo.urlKey) score += 120;
    if (entry.nameKey && cardInfo.nameKey && entry.nameKey === cardInfo.nameKey) score += 90;
    if (entry.nameKey && cardInfo.cardText.includes(entry.nameKey)) score += 40;
    if (entry.rawKey && cardInfo.cardText && (entry.rawKey.includes(cardInfo.nameKey) || cardInfo.cardText.includes(entry.rawKey.slice(0, 80)))) score += 20;
    return score;
  }

  function findBestCard(entry, cards) {
    let best = null;
    let bestScore = 0;
    for (const cardInfo of cards) {
      const score = scoreEntry(cardInfo, entry);
      if (score > bestScore) {
        bestScore = score;
        best = cardInfo;
      }
    }
    return bestScore >= 40 ? best : null;
  }

  function asClickable(el) {
    if (!el) return null;
    return el.closest('button,[role="button"],a[role="button"],div[role="button"],span[role="button"],a[href]') || el;
  }

  function findJoinControl(card) {
    if (!card) return null;
    const direct = Array.from(card.querySelectorAll('button,[role="button"],a[role="button"],div[role="button"],span[role="button"],a[href]'))
      .map(asClickable)
      .filter(Boolean)
      .find(el => isVis(el) && JOIN_RX.test(textOf(el)) && !SKIP_RX.test(textOf(el)));
    if (direct) return direct;

    const textNodes = Array.from(card.querySelectorAll('span,div,a'))
      .find(el => isVis(el) && JOIN_RX.test(textOf(el)) && !SKIP_RX.test(textOf(el)));
    if (textNodes) return asClickable(textNodes);
    return null;
  }

  async function clickBtn(el) {
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    await sleep(rand(180, 320));
    try { el.click(); } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (_) {}
  }

  async function notify(name) {
    try { chrome.runtime.sendMessage({ action: 'GROUP_JOINED', payload: { groupName: name } }); } catch (_) {}
  }

  async function answerDialog() {
    const dlg = await new Promise(res => {
      let t = 0;
      const iv = setInterval(() => {
        t += 150;
        for (const d of document.querySelectorAll('[role="dialog"]')) {
          if ((d.querySelector('textarea,input[type="text"],input[type="checkbox"]') || /question|سؤال|approve|membership/i.test(textOf(d)))) {
            clearInterval(iv);
            res(d);
            return;
          }
        }
        if (t >= 2600) {
          clearInterval(iv);
          res(null);
        }
      }, 150);
    });
    if (!dlg) return false;

    for (const inp of dlg.querySelectorAll('textarea,input[type="text"],input:not([type])')) {
      try {
        inp.focus();
        await sleep(80);
        const ns = Object.getOwnPropertyDescriptor(inp.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
        if (ns) ns.call(inp, 'نعم');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    }
    for (const cb of dlg.querySelectorAll('input[type="checkbox"]')) {
      try { if (!cb.checked) cb.click(); } catch (_) {}
    }
    const submit = Array.from(dlg.querySelectorAll('button,[role="button"],div[role="button"],span[role="button"]'))
      .map(asClickable)
      .filter(Boolean)
      .find(b => /(submit|إرسال|ارسال|confirm|join|انضم|next|متابعة|approve|تم)/i.test(textOf(b)));
    if (submit) {
      await sleep(220);
      try { submit.click(); } catch (_) {}
      await sleep(700);
      return true;
    }
    return false;
  }

  return (async () => {
    let attemptedCount = 0;
    let matchedVisibleCount = 0;
    let skippedOutOfFilterCount = 0;

    for (let round = 0; round < 12; round++) {
      const cards = collectCards();
      let hit = 0;

      for (const entry of allowedEntries) {
        const sessionKey = entry.urlKey || entry.slugKey || entry.nameKey;
        if (sessionKey && attemptedSessionKeys.has(sessionKey)) {
          duplicateAttemptSkips++;
          continue;
        }

        const cardInfo = findBestCard(entry, cards);
        if (!cardInfo) continue;

        const btn = findJoinControl(cardInfo.card);
        if (!btn) {
          matchedVisibleCount++;
          continue;
        }

        matchedVisibleCount++;
        const clickKey = (cardInfo.slugKey || cardInfo.urlKey || cardInfo.nameKey) + '|' + btn.getBoundingClientRect().top.toFixed(0);
        if (clicked.has(clickKey)) continue;
        clicked.add(clickKey);

        if (sessionKey) attemptedSessionKeys.add(sessionKey);
        attemptedCount++;
        const before = textOf(btn);
        await clickBtn(btn);
        const dialogSubmitted = await answerDialog();
        await sleep(rand(450, 850));
        const after = textOf(btn);
        const success = dialogSubmitted || SKIP_RX.test(after) || (after && before !== after);
        if (success) {
          const joinedName = cardInfo.name || entry.name || keyword;
          if (!joined.includes(joinedName)) joined.push(joinedName);
          for (const key of [entry.urlKey, entry.slugKey, entry.nameKey, cardInfo.urlKey, cardInfo.slugKey, cardInfo.nameKey]) {
            if (key && !joinedKeys.includes(key)) joinedKeys.push(key);
          }
          hit++;
          await notify(joinedName);
        }
        await sleep(rand(550, 950));
      }

      unresolvedAllowedCount = allowedEntries.filter(entry => {
        const key = entry.urlKey || entry.slugKey || entry.nameKey;
        return key && !attemptedSessionKeys.has(key);
      }).length;

      const visibleJoinControls = Array.from(document.querySelectorAll('button,[role="button"],a[role="button"],div[role="button"],span[role="button"],a[href]'))
        .filter(el => isVis(el) && JOIN_RX.test(textOf(el)) && !SKIP_RX.test(textOf(el))).length;
      skippedOutOfFilterCount = Math.max(0, visibleJoinControls - matchedVisibleCount);

      if (!hit && unresolvedAllowedCount === 0) break;
      window.scrollBy({ top: Math.max(window.innerHeight * 0.95, 520), behavior: 'smooth' });
      await sleep(rand(450, 750));
    }

    return {
      joinedCount: joined.length,
      joinedGroups: joined,
      joinedKeys,
      attemptedCount,
      matchedVisibleCount,
      skippedOutOfFilterCount,
      duplicateAttemptSkips,
      unresolvedAllowedCount
    };
  })();
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const immediate = await getTabInfo(tabId);
  if (immediate && immediate.status === "complete") return true;

  return await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try { clearTimeout(timer); } catch (_) {}
      try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
      resolve(true);
    };
    const timer = setTimeout(done, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    getTabInfo(tabId).then(tab => {
      if (tab && tab.status === "complete") done();
    }).catch(() => {});
  });
}

async function createBackgroundWorkerTab(url) {
  const previousTab = await getActiveTabSnapshot();
  return await new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false, pinned: true }, async tab => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      try { chrome.tabs.update(tab.id, { autoDiscardable: false, pinned: true }, function(){}); } catch (_) {}
      await waitForTabComplete(tab.id, 15000);
      await restoreActiveTabSnapshot(previousTab);
      resolve(tab);
    });
  });
}

async function navigateWorkerTab(tabId, url) {
  const previousTab = await getActiveTabSnapshot();
  return await new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url, active: false, pinned: true, autoDiscardable: false }, async tab => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      await waitForTabComplete(tabId, 15000);
      await restoreActiveTabSnapshot(previousTab);
      resolve(tab);
    });
  });
}

async function closeBackgroundWorkerTab() {
  if (!backgroundWorkerTabId) return false;
  const tabId = backgroundWorkerTabId;
  backgroundWorkerTabId = null;
  await storageSet({ backgroundWorkerTabId: null }).catch(() => {});
  try {
    await chrome.tabs.remove(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

async function openPostingTab(url) {
  const state = await storageGetAll().catch(() => ({}));
  backgroundWorkerMode = state.backgroundWorkerMode !== false;
  backgroundWorkerTabId = state.backgroundWorkerTabId || backgroundWorkerTabId || null;

  if (!backgroundWorkerMode) {
    return createBackgroundWorkerTab(url);
  }

  let existing = null;
  if (backgroundWorkerTabId) existing = await getTabInfo(backgroundWorkerTabId);

  if (ALWAYS_FRESH_WORKER_TAB && existing && existing.id) {
    log(`♻️ Resetting worker tab before opening next target: ${existing.url || "about:blank"}`);
    try { await chrome.tabs.remove(existing.id); } catch (_) {}
    backgroundWorkerTabId = null;
    await storageSet({ backgroundWorkerTabId: null }).catch(() => {});
    existing = null;
    await sleep(160);
  }

  if (!existing) {
    const created = await createBackgroundWorkerTab(url);
    backgroundWorkerTabId = created.id;
    await storageSet({ backgroundWorkerTabId: created.id }).catch(() => {});
    await sleep(WORKER_NAVIGATION_STABILIZE_MS);
    return created;
  }

  const updated = ALWAYS_FRESH_WORKER_TAB
    ? await bounceAndNavigatePostingTab(existing.id, url)
    : await navigateWorkerTab(existing.id, url);
  backgroundWorkerTabId = updated.id;
  await storageSet({ backgroundWorkerTabId: updated.id }).catch(() => {});
  await sleep(WORKER_NAVIGATION_STABILIZE_MS);
  return updated;
}

function normalizeComparableFbUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch (_) {
    return String(url || "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  }
}

function getPostingTargetKey(url) {
  const groupId = extractGroupId(url || "");
  if (groupId) return "group:" + groupId;
  const pageId = extractPageId(url || "");
  if (pageId) return "page:" + pageId;
  return normalizeComparableFbUrl(url || "");
}

function isSamePostingTarget(currentUrl, targetUrl) {
  const currentKey = getPostingTargetKey(currentUrl || "");
  const targetKey = getPostingTargetKey(targetUrl || "");
  if (currentKey && targetKey && currentKey === targetKey) return true;
  return normalizeComparableFbUrl(currentUrl || "") === normalizeComparableFbUrl(targetUrl || "");
}

async function updatePostingTabUrl(tabId, url) {
  const previousTab = await getActiveTabSnapshot();
  return await new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, {
      url,
      active: false,
      pinned: !!backgroundWorkerMode,
      autoDiscardable: false
    }, async tab => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      await waitForTabComplete(tabId, 15000);
      await restoreActiveTabSnapshot(previousTab);
      resolve(tab);
    });
  });
}

async function bounceAndNavigatePostingTab(tabId, url) {
  try {
    await updatePostingTabUrl(tabId, "about:blank#fbpx-reset");
    await sleep(180);
  } catch (_) {}
  return updatePostingTabUrl(tabId, url);
}

async function ensurePostingTarget(tabId, targetUrl, maxAttempts = 3) {
  let info = await getTabInfo(tabId);
  if (info && isSamePostingTarget(info.url, targetUrl)) return info;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Navigation mismatch on worker tab — expected ${targetUrl}, got ${info && info.url ? info.url : 'none'} (retry ${attempt}/${maxAttempts})`);
    await bounceAndNavigatePostingTab(tabId, targetUrl);
    await sleep(PAGE_RENDER_WAIT_MS + (attempt * 220));
    await waitForContentScript(tabId, Math.max(TAB_READY_TIMEOUTMS, 12000));
    info = await getTabInfo(tabId);
    if (info && isSamePostingTarget(info.url, targetUrl)) return info;
  }

  throw new Error("Navigation mismatch: expected " + targetUrl + " but landed on " + (info && info.url ? info.url : "none"));
}

// ─── CONTENT SCRIPT READINESS ─────────────────────────────────────
async function waitForContentScript(tabId, timeoutMs = 8000) {
  const start = Date.now();
  let lastErrorMessage = "";
  while (Date.now() - start < timeoutMs) {
    const pong = await new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, { action: "PING" }, resp => {
        if (chrome.runtime.lastError) {
          lastErrorMessage = chrome.runtime.lastError.message || "";
          resolve(null);
        } else resolve(resp);
      });
    });
    if (pong && pong.alive) return true;
    await sleep(250);
  }
  if (await isTabLikelyBackgrounded(tabId)) {
    throw new Error(withBackgroundMarker("Content script did not become ready within " + (timeoutMs / 1000) + "s"));
  }
  throw new Error(lastErrorMessage
    ? ("Content script did not become ready within " + (timeoutMs / 1000) + "s — " + lastErrorMessage)
    : ("Content script did not become ready within " + (timeoutMs / 1000) + "s"));
}

// ─── RETRY SEND ───────────────────────────────────────────────────
async function sendWithRetry(tabId, message, maxRetries = 4, baseRetryMs = 1200) {
  let lastErrorMessage = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, message, resp => {
        if (chrome.runtime.lastError) {
          lastErrorMessage = chrome.runtime.lastError.message || "";
          resolve(null);
        } else resolve(resp);
      });
    });
    if (result !== null) return result;
    if (attempt < maxRetries) {
      const backgrounded = await isTabLikelyBackgrounded(tabId);
      const wait = backgrounded
        ? Math.max(BACKGROUND_SAFE_DELAY_MS, baseRetryMs * (attempt + 1))
        : (baseRetryMs * (attempt + 1));
      log(`Retry ${attempt + 1}/${maxRetries} in ${wait / 1000}s…`);
      await sleep(wait);
    }
  }
  if (await isTabLikelyBackgrounded(tabId)) {
    return { success: false, error: withBackgroundMarker("Content script did not respond after retries") };
  }
  return { success: false, error: lastErrorMessage
    ? ("Content script did not respond after retries — " + lastErrorMessage)
    : "Content script did not respond after retries" };
}

async function isInternetReachable() {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  } catch (_) {}
  try {
    await fetch("https://www.facebook.com/favicon.ico?ts=" + Date.now(), {
      method: "GET", mode: "no-cors", cache: "no-store"
    });
    return true;
  } catch (_) { return false; }
}

function getRetryKey(group, idx) {
  const url = String(group && group.url || "").split("?")[0].trim().toLowerCase();
  return url || ("idx:" + String(idx));
}

async function getRetryStateMap() {
  const state = await storageGetAll();
  return state.retryState || {};
}

async function clearRetryStateFor(retryKey) {
  if (!retryKey) return;
  const retryState = await getRetryStateMap();
  if (retryKey in retryState) {
    delete retryState[retryKey];
    await storageSet({ retryState, recoveryActive: false, lastRecoveryReason: "" });
  }
}

function isBackgroundLikeReason(reason) {
  const r = String(reason || "").toLowerCase();
  if (!r) return false;
  return [
    "background_throttled", "background_suspended_timeout",
    "content script did not respond", "did not become ready",
    "the message port closed", "receiving end does not exist",
    "already posting", "duplicate call blocked",
    "hard timeout", "unexpected url after load",
    "tab not focused", "background pause", "worker tab inactive"
  ].some(x => r.includes(x));
}

function shouldSuppressFailureNotification(reason) {
  return isBackgroundLikeReason(reason);
}

async function isTabLikelyBackgrounded(tabId) {
  const state = tabRuntimeState.get(tabId) || {};
  const now = Date.now();

  if (state.frozen) return true;

  if (state.lastHeartbeatAt && (now - state.lastHeartbeatAt) > CONTENT_HEARTBEAT_STALE_MS) {
    return true;
  }

  if (state.hidden && state.lastHeartbeatAt && (now - state.lastHeartbeatAt) > 12000) {
    return true;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.discarded) return true;
    if (tab && tab.status === "unloaded") return true;
  } catch (_) {}

  return false;
}

function withBackgroundMarker(reason) {
  const msg = String(reason || "Temporary background pause");
  if (/^background_/i.test(msg)) return msg;
  return "BACKGROUND_THROTTLED: " + msg;
}

async function buildTimeoutResult(tabId, timeoutMs) {
  // ── FIX v90: This function MUST actually wait `timeoutMs` before resolving.
  // Previously it resolved immediately (only awaited isTabLikelyBackgrounded),
  // which meant Promise.race() in processNextGroup would sometimes pick THIS
  // branch before sendWithRetry received any reply from content.js, causing
  // the poster to skip groups without ever actually publishing anything.
  await new Promise(r => setTimeout(r, timeoutMs));
  const backgrounded = await isTabLikelyBackgrounded(tabId);
  return {
    success: false,
    error: backgrounded
      ? "BACKGROUND_SUSPENDED_TIMEOUT"
      : "Hard timeout (" + (timeoutMs / 1000) + "s) — moving to next group"
  };
}

function shouldSmartRecover(reason) {
  const r = String(reason || "").toLowerCase();
  if (!r) return true;
  const fatalSignals = [
    "dead_group", "blacklisted", "duplicate",
    "already posted this session",
    "not on a facebook group/page",
    "you can\\'t post in this group",
    "temporarily blocked", "dead/banned group"
  ];
  if (fatalSignals.some(x => r.includes(x))) return false;
  return [
    "network_offline", "timeout", "did not respond", "did not become ready",
    "unexpected url", "navigation mismatch", "target mismatch", "facebook shows error", "facebook rejects posting",
    "didn\\'t close", "composer dialog did not appear", "composer button not found",
    "failed to type", "editor not found", "could not enable post button",
    "failsafe", "something went wrong", "an error occurred",
    "please try again", "connection", "offline"
  ].some(x => r.includes(x));
}

function classifyRecoveryDelay(reason, online) {
  const r = String(reason || "").toLowerCase();
  if (!online || r.includes("offline") || r.includes("connection")) {
    return NETWORK_RECOVERY_DELAY_MS;
  }
  if (r.includes("did not respond") || r.includes("did not become ready") || r.includes("unexpected url")) {
    return CONTENT_RECOVERY_DELAY_MS;
  }
  return HANG_RECOVERY_DELAY_MS;
}

async function maybeScheduleRecoveryRetry(ctx) {
  const idx      = ctx.idx;
  const group    = ctx.group || {};
  const groupId  = ctx.groupId;
  const retryKey = ctx.retryKey;
  const rawReason = String(ctx.reason || "Unknown error");
  const reason   = rawReason;
  const backgroundLike = isBackgroundLikeReason(reason);

  if (!shouldSmartRecover(reason) && !backgroundLike) return false;

  const state        = await storageGetAll();
  if (state.singleAttemptPerGroup !== false) return false;
  const retryState   = state.retryState || {};
  const currentCount = Number(retryState[retryKey] || 0);
  const retryLimit   = backgroundLike ? BACKGROUND_SAFE_MAX_RETRIES : MAX_SMART_RECOVERY_RETRIES;
  const nextCount    = currentCount + 1;
  if (nextCount > retryLimit) return false;

  const online    = await isInternetReachable();
  const baseDelay = backgroundLike
    ? Math.max(BACKGROUND_SAFE_DELAY_MS, classifyRecoveryDelay(reason, online))
    : classifyRecoveryDelay(reason, online);
  const delayMs   = baseDelay + ((nextCount - 1) * (backgroundLike ? 2000 : 4000));
  const nextRunAt = Date.now() + delayMs;
  const storedReason = backgroundLike ? withBackgroundMarker(reason) : reason;

  retryState[retryKey] = nextCount;
  if (groupId && state.singleAttemptPerGroup === false) processedGroupIds.delete(groupId);

  await storageSet({
    currentGroupIndex: idx,
    retryState,
    recoveryActive:     true,
    lastRecoveryReason: storedReason,
    awaitingNextGroup:  true,
    nextRunAt
  });
  chrome.alarms.create(QUEUE_ALARM_NAME, { when: nextRunAt });

  if (backgroundLike) {
    notifyBackgroundSafePause(group.name || "Unknown", storedReason, nextCount, delayMs);
  } else {
    notifyRecoveryRetry(group.name || "Unknown", storedReason, nextCount, delayMs, online);
  }
  log(`\u{1F501} Smart recovery scheduled for ${group.name || "group"} in ${(delayMs/1000).toFixed(1)}s [${nextCount}/${retryLimit}] — ${storedReason}`);

  setTimeout(() => {
    wakeScheduledQueue("smart_recovery", idx).catch(err => log("smart recovery wake error:", err.message));
  }, delayMs + 50);

  return true;
}

// ─── UTILITIES ────────────────────────────────────────────────────
function extractGroupId(url) {
  const m = String(url || "").match(/facebook\.com\/groups\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function extractPageId(url) {
  const m = String(url || "").match(/facebook\.com\/(?:pages\/[^/?#]+\/(\d+)|([^/?#]+))/i);
  return m ? (m[1] || m[2] || "").toLowerCase() : null;
}

function isGroupUrl(url) {
  return !!url && /facebook\.com\/groups\/[^/?#]+/i.test(url);
}

function isPageUrl(url) {
  return !!url
    && !/facebook\.com\/groups\//i.test(url)
    && /facebook\.com\/(?:pages\/|[^/?#]+\/?(?:\?|$))/i.test(url);
}

function isPostableUrl(url) {
  return isGroupUrl(url) || isPageUrl(url);
}

// ─── BLACKLIST — dead/banned groups/pages ─────────────────────────
async function getBlacklist() {
  const data = await storageGetAll();
  return new Set(data.blacklistedUrls || []);
}

async function addToBlacklist(url) {
  const bl = await getBlacklist();
  bl.add(String(url || "").split("?")[0].toLowerCase());
  await storageSet({ blacklistedUrls: Array.from(bl) });
  log("Blacklisted:", url);
}

async function isBlacklisted(url) {
  const bl = await getBlacklist();
  const clean = String(url || "").split("?")[0].toLowerCase();
  return bl.has(clean);
}

function processSpintax(text, opts) {
  opts = opts || {};
  let out = String(text || ""), prev = "";
  while (prev !== out) { prev = out; out = out.replace(/\{([^{}]+)\}/g, (_,c) => { const p=c.split("|"); return p[Math.floor(Math.random()*p.length)]; }); }
  if (opts.homoglyph) {
    const M={"a":"а","c":"с","e":"е","o":"о","p":"р","x":"х","y":"у","A":"А","B":"В","C":"С","E":"Е","H":"Н","K":"К","M":"М","O":"О","P":"Р","T":"Т","X":"Х"};
    out=out.split("").map(ch=>M[ch]&&Math.random()<0.1?M[ch]:ch).join("");
  }
  if (opts.zeroWidth) {
    const Z=["​","‌","‍","⁠"];
    out=out.replace(/ /g,s=>Math.random()<0.08?Z[Math.floor(Math.random()*Z.length)]+s:s);
  }
  return out;
}

function getTabInfo(tabId) {
  return new Promise(r => chrome.tabs.get(tabId, t => r(chrome.runtime.lastError ? null : t)));
}

function storageGetAll() {
  return new Promise(r => chrome.storage.local.get(null, r));
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(true);
    });
  });
}

async function appendLog(entry) {
  return new Promise(r => {
    chrome.storage.local.get("postLog", data => {
      const l = data.postLog || [];
      l.push(entry);
      chrome.storage.local.set({ postLog: l }, r);
    });
  });
}

function ensureKeepAliveAlarm() {
  // MV3 service workers can be killed after ~30s of idle.
  // على الهواتف (Kiwi) يكون الـ timeout أقصر — نستخدم 0.33 دقيقة (20 ثانية)
  chrome.alarms.create(KEEPALIVE_ALARM_NAME,          { periodInMinutes: 0.33 });
  chrome.alarms.create(KEEPALIVE_ALARM_NAME + "_b",   { periodInMinutes: 0.4  });
  chrome.alarms.create(KEEPALIVE_ALARM_NAME + "_c",   { periodInMinutes: 0.5  });
  chrome.alarms.create(KEEPALIVE_ALARM_NAME + "_d",   { periodInMinutes: 1    });
  // Web Locks API — يمنع الـ SW من النوم طالما القفل محجوز
  tryAcquireWakeLock();
}

// Web Locks API: يبقي الـ service worker حياً على الهواتف
// يعمل في Chrome/Kiwi ويُجدَّد تلقائياً
let _wakeLockInterval = null;
function tryAcquireWakeLock() {
  if (typeof navigator === "undefined" || !navigator.locks) return;
  const acquireLock = () => {
    navigator.locks.request("fbposter_sw_lock", { mode: "exclusive" }, async () => {
      // نبقى في القفل طالما النشر نشط
      return new Promise(resolve => {
        _wakeLockInterval = setInterval(async () => {
          const state = await storageGetAll().catch(() => ({}));
          if (!state.postingActive) {
            clearInterval(_wakeLockInterval);
            resolve();
          }
        }, 15000);
      });
    }).catch(() => {});
  };
  try { acquireLock(); } catch(_) {}
}

// ── Port-based keepalive: popup/content can connect to keep SW alive ──
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "keepalive") return;
  const iv = setInterval(() => { try { port.postMessage("ping"); } catch(_){} }, 15000);
  port.onDisconnect.addListener(() => clearInterval(iv));
});

// Heartbeat: called by both keepalive alarms to keep the SW awake
  // ─── ENHANCED KEEPALIVE: re-activate worker tab if frozen ─────────────────
  async function keepAliveHeartbeatEnhanced() {
    try {
      const data = await storageGet(["postingActive", "backgroundWorkerTabId", "awaitingNextGroup"]);
      if (!data.postingActive) return;
      // If we're awaiting next group but SW woke up, check if we should resume
      if (data.awaitingNextGroup && !isProcessingQueue) {
        const state = await storageGetAll();
        if (state.nextRunAt && Date.now() >= state.nextRunAt) {
          log("⏰ Enhanced keepalive: waking overdue queue");
          wakeScheduledQueue("enhanced_heartbeat").catch(()=>{});
        }
      }
      // Ensure worker tab is not frozen (Kiwi-specific)
      if (data.backgroundWorkerTabId) {
        chrome.tabs.get(data.backgroundWorkerTabId, function(tab) {
          if (chrome.runtime.lastError || !tab) return;
          // Briefly make active to unfreeze, then background again
          if (tab.discarded) {
            chrome.tabs.reload(data.backgroundWorkerTabId, {}, function() {
              chrome.runtime.lastError; // consume
            });
          }
        });
      }
    } catch(_) {}
  }
  
async function keepAliveHeartbeat() {
  await chrome.storage.local.get("postingActive");
  const state = await storageGetAll();
  // لا نستأنف إذا كان في وضع الإيقاف المؤقت
  if (state.postingActive && !state.paused && !state.awaitingNextGroup && !isProcessingQueue) {
    processNextGroup().catch(err => log("keepalive wake error:", err.message));
  }
}

function clearQueueAlarm() {
  return new Promise(resolve => {
    try {
      chrome.alarms.clear(QUEUE_ALARM_NAME, cleared => resolve(!!cleared));
    } catch (_) {
      resolve(false);
    }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(...a)  { console.log("[FBPoster BG]", ...a); }

function notifyPostSuccess(groupName, postUrl) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "✅ fb Bablushr F — Post Success",
    message: "Posted to: " + String(groupName || "Group").slice(0, 100) +
             (postUrl ? "\n" + String(postUrl).slice(0, 100) : "")
  });
}

function notifyPostFailed(groupName, reason) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "❌ fb Bablushr F — Post Failed",
    message: "Group: " + String(groupName || "Unknown").slice(0, 80) +
             "\nReason: " + String(reason || "Unknown error").slice(0, 140)
  });
}

function notifyBackgroundSafePause(groupName, reason, attempt, delayMs) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "⏸️ fb Bablushr F — Background Safe",
    message: "Group: " + String(groupName || "Unknown").slice(0, 72) +
             "\nState: Temporary background pause" +
             ((attempt && attempt > 0) ? ("\nRetry: " + attempt + "/" + BACKGROUND_SAFE_MAX_RETRIES + " after " + Math.round(delayMs / 1000) + "s") : "") +
             "\nReason: " + String(reason || "Worker tab inactive").replace(/^BACKGROUND_[^:]+:\s*/i, "").slice(0, 110)
  });
}

function notifyPostPending(groupName, reason) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "⏳ fb Bablushr F — Pending Review",
    message: "Group: " + String(groupName || "Unknown").slice(0, 80) +
             "\nStatus: " + String(reason || "Pending admin approval").slice(0, 140)
  });
}

function notifyCommentFailed(groupName, reason) {
  if (!chrome.notifications?.create) return;
  const reasonLabels = {
    comments_disabled: "التعليقات معطّلة على هذا المنشور",
    box_not_found: "تعذّر إيجاد خانة التعليق",
    rejected_after_submit: "فيسبوك رفض التعليق بعد الإرسال",
  };
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "💬⚠️ fb Bablushr F — Comment Failed",
    message: "Group: " + String(groupName || "Unknown").slice(0, 80) +
             "\nالمنشور نجح، لكن التعليق الأول فشل: " +
             String(reasonLabels[reason] || reason || "سبب غير معروف").slice(0, 120)
  });
}

function notifyBackgroundWorkerReady() {
  if (!chrome.notifications?.create || !backgroundWorkerMode) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "🛰 fb Bablushr F — Worker Mode",
    message: "Background worker mode is active with one pinned service tab."
  });
}


function notifyRecoveryRetry(groupName, reason, attempt, delayMs, online) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: online ? "\\u{1F501} fb Bablushr F \\u2014 Smart Resume" : "\\u{1F4F6} fb Bablushr F \\u2014 Waiting for Internet",
    message: "Group: " + String(groupName || "Unknown").slice(0, 70) +
             "\\nRetry: " + attempt + "/" + MAX_SMART_RECOVERY_RETRIES +
             " after " + Math.round(delayMs / 1000) + "s" +
             "\\nReason: " + String(reason || "Temporary issue").slice(0, 110)
  });
}

function notifyComplete() {
  chrome.storage.local.get(["postLog","webhookUrl","webhookEnabled"], data => {
    const log  = data.postLog || [];
    const ok   = log.filter(l => l.success).length;
    const fail = log.filter(l => !l.success).length;

    // ── STEP 1: Clear live badge when done ──────────────────────────
    try { chrome.action.setBadgeText({ text: '' }); } catch(_) {}

    // ── STEP 5: WhatsApp/Telegram Webhook ───────────────────────────
    if (data.webhookEnabled && data.webhookUrl) {
      sendCampaignWebhook(data.webhookUrl, ok, fail);
    }

    if (!chrome.notifications?.create) return;
    chrome.notifications.create({
      type: "basic", iconUrl: "icons/icon48.png",
      title: "fb Bablushr F — اكتملت الحملة ✅",
      message: `✅ نجح: ${ok}  |  ❌ فشل: ${fail}`
    });
  });
}

// ── STEP 1 helper: update badge during posting ───────────────────────
function updateLiveBadge(successCount, total) {
  try {
    if (successCount === 0 && total === 0) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    chrome.action.setBadgeText({ text: String(successCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  } catch(_) {}
}

// ── STEP 5: Webhook — WhatsApp link OR Telegram bot ─────────────────
// Supports two patterns:
//   • WhatsApp:  https://wa.me/201XXXXXXXXX  (opens chat with prefilled msg)
//   • Telegram:  https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
function sendCampaignWebhook(url, ok, fail) {
  try {
    const msg = encodeURIComponent(
      `📊 *fb Bablushr F — تقرير الحملة*\n✅ نجح: ${ok}\n❌ فشل: ${fail}\n🕐 ${new Date().toLocaleString('ar-EG')}`
    );
    if (url.includes('wa.me') || url.includes('whatsapp')) {
      // WhatsApp: open a tab with pre-filled message
      chrome.tabs.create({ url: url + (url.includes('?') ? '&' : '?') + 'text=' + msg, active: false });
    } else if (url.includes('api.telegram.org')) {
      // Telegram Bot API
      const finalUrl = url + (url.includes('?') ? '&' : '?') +
        `text=${msg}&parse_mode=Markdown`;
      fetch(finalUrl).catch(() => {});
    } else {
      // Generic webhook — POST JSON
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok, fail, time: Date.now(), source: 'fb-bablushr-f' })
      }).catch(() => {});
    }
  } catch(_) {}
}

function notifyApiError(message) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "fb Bablushr F — API Error",
    message: String(message || "Unknown API error").slice(0, 240)
  });
}

function notifyGroupJoined(groupName) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "fb Bablushr F — Group Join",
    message: `Join successful: ${String(groupName || "Facebook Group").slice(0, 120)}`
  });
}


// ═══════════════════════════════════════════════════════════════════
//  SMART POST-COUNT GUARD — prevents re-posting to same group
//  Tracks posts per group URL in a rolling 24-hour window.
//  Limit: SMART_POST_LIMIT posts per group per day.
//  Storage key: groupPostCounts  { [normalizedUrl]: {count,lastAt} }
// ═══════════════════════════════════════════════════════════════════

const SMART_POST_LIMIT    = 3;          // max successful posts per group per 24h
const SMART_POST_WINDOW_MS = 86400000; // 24-hour window

function _normGroupUrl(url) {
  return String(url || "").split("?")[0].replace(/\/$/, "").toLowerCase().trim();
}

async function _getGroupPostCounts() {
  try {
    const r = await storageGetAll();
    return (r && r.groupPostCounts && typeof r.groupPostCounts === "object")
      ? r.groupPostCounts : {};
  } catch (_) { return {}; }
}

async function incrementGroupPostCount(url) {
  const key = _normGroupUrl(url);
  if (!key) return;
  try {
    const counts = await _getGroupPostCounts();
    const now    = Date.now();
    const entry  = counts[key] || { count: 0, lastAt: 0 };
    if (now - entry.lastAt > SMART_POST_WINDOW_MS) entry.count = 0; // window reset
    entry.count  = (entry.count || 0) + 1;
    entry.lastAt = now;
    counts[key]  = entry;
    // Prune stale entries (older than 48h) to keep storage small
    const cutoff = now - 2 * SMART_POST_WINDOW_MS;
    for (const k of Object.keys(counts)) {
      if ((counts[k].lastAt || 0) < cutoff) delete counts[k];
    }
    await storageSet({ groupPostCounts: counts });
  } catch (_) {}
}

async function isGroupOverPosted(url) {
  const key = _normGroupUrl(url);
  if (!key) return false;
  try {
    const counts = await _getGroupPostCounts();
    const entry  = counts[key];
    if (!entry) return false;
    if (Date.now() - entry.lastAt > SMART_POST_WINDOW_MS) return false; // window expired
    return (entry.count || 0) >= SMART_POST_LIMIT;
  } catch (_) { return false; }
}
