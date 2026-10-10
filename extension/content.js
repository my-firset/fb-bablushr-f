// ═══════════════════════════════════════════════════════════════════
//  CONTENT.JS — FB Auto Poster V13 (Fixed)
//
//  Fixes over V12:
//  ① MutationObserver-based media upload wait (no fixed sleep)
//  ② Robust editor clearing (remove all child nodes)
//  ③ FAILSAFE timer now closes dialog + signals failure properly
//  ④ MutationObserver for dialog-gone detection after clicking Post
//  ⑤ Better retry logic with proper error notification
//  ⑥ Removed location.reload() — background.js handles tab lifecycle
// ═══════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand  = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const log   = (...a) => console.log("[FBPoster]", ...a);

  // ─── KEEPALIVE PORT — keeps background worker alive even if popup closes ───
  let _keepAlivePort = null;
  let _keepAliveReconnectTimer = null;
  function connectKeepAlivePort() {
    try {
      if (_keepAlivePort) return;
      _keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
      _keepAlivePort.onDisconnect.addListener(function() {
        _keepAlivePort = null;
        if (_keepAliveReconnectTimer) clearTimeout(_keepAliveReconnectTimer);
        _keepAliveReconnectTimer = setTimeout(connectKeepAlivePort, 1200);
      });
    } catch (_) {
      if (_keepAliveReconnectTimer) clearTimeout(_keepAliveReconnectTimer);
      _keepAliveReconnectTimer = setTimeout(connectKeepAlivePort, 2000);
    }
  }
  connectKeepAlivePort();
  connectKeepAlivePort();

  function reportVisibilityState(extra) {
    try {
      chrome.runtime.sendMessage({
        action: "PAGE_VISIBILITY_STATE",
        hidden: typeof document !== "undefined" ? !!document.hidden : false,
        frozen: !!(extra && extra.frozen),
        url: location.href,
        ts: Date.now()
      }, function() { void chrome.runtime.lastError; });
    } catch (_) {}
  }
  document.addEventListener("visibilitychange", function() {
    reportVisibilityState({ frozen: false });
  }, true);
  window.addEventListener("pagehide", function() {
    reportVisibilityState({ frozen: true });
  }, true);
  window.addEventListener("pageshow", function() {
    reportVisibilityState({ frozen: false });
  }, true);
  setTimeout(function() { reportVisibilityState({ frozen: false }); }, 600);

  function sendHeartbeat(source) {
    try {
      chrome.runtime.sendMessage({
        action: "HEARTBEAT",
        source: source || "content",
        hidden: typeof document !== "undefined" ? !!document.hidden : false,
        frozen: false,
        url: location.href,
        ts: Date.now()
      }, function() { void chrome.runtime.lastError; });
    } catch (_) {}
  }

  setInterval(function() {
    sendHeartbeat("content-interval");
  }, 15000);

  setTimeout(function() { sendHeartbeat("content-boot"); }, 1200);

  // ─── TIMING ────────────────────────────────────────────────────
  const DIALOG_POLL_MS  = 200;
  const DIALOG_WAIT_MS  = 20000;
  const POST_POLL_MS    = 300;
  const POST_WAIT_MS    = 25000;
  const POST_GONE_MS    = 25000;
  const POST_CONFIRM_MS = 1200;
  const FAILSAFE_MS     = 300000;  // 5 minutes
  const MEDIA_UPLOAD_TIMEOUT_MS = 90000; // 90s for media uploads

  // Hybrid injection
  const REACT_SIM_CHARS = 3;
  const REACT_SIM_DELAY = 60;

  // FB error phrases
  const FB_ERROR_PHRASES = [
    "something went wrong", "we're working on getting it fixed",
    "حدث خطأ ما", "حدث شيء خاطئ", "نعمل على إصلاحه",
    "an error occurred", "please try again"
  ];

  // ─── HELPERS ────────────────────────────────────────────────────
  function isGroupPage() {
    return /facebook\.com\/groups\/[^/?#]+/i.test(location.href);
  }

  // Also accept posting when FB redirects to group via page identity
  function isPostableContext() {
    return isGroupPage()
      || /facebook\.com\/(groups\/|pages\/|[^/?#]+\/posts)/i.test(location.href);
  }

  function normalizeComparableFbUrl(url) {
    try {
      const u = new URL(String(url || ""), location.origin);
      return (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
    } catch (_) {
      return String(url || "").split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
    }
  }

  function getPostingTargetKey(url) {
    const raw = String(url || "");
    const group = raw.match(/facebook\.com\/groups\/([^/?#]+)/i);
    if (group && group[1]) return "group:" + group[1].toLowerCase();
    const page = raw.match(/facebook\.com\/(?:pages\/[^/?#]+\/(\d+)|([^/?#]+))(?:[/?#]|$)/i);
    if (page) return "page:" + String(page[1] || page[2] || "").toLowerCase();
    return normalizeComparableFbUrl(raw);
  }

  function isExpectedPostingTarget(expectedUrl, currentUrl) {
    const expectedKey = getPostingTargetKey(expectedUrl || "");
    const currentKey = getPostingTargetKey(currentUrl || "");
    if (expectedKey && currentKey && expectedKey === currentKey) return true;
    return normalizeComparableFbUrl(expectedUrl || "") === normalizeComparableFbUrl(currentUrl || "");
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < window.innerHeight + 200;
    } catch (_) { return false; }
  }

  function attrText(el) {
    return [
      el?.getAttribute?.("aria-label"),
      el?.getAttribute?.("aria-placeholder"),
      el?.getAttribute?.("placeholder"),
      el?.getAttribute?.("title"),
      el?.id || "",
      typeof el?.className === "string" ? el.className : ""
    ].filter(Boolean).join(" ").trim();
  }

  function shallowText(el) {
    if (!el) return "";
    let t = "";
    el.childNodes?.forEach?.(n => { if (n.nodeType === 3) t += n.textContent; });
    return (t.trim() || (el.innerText || "").trim()).slice(0, 200);
  }

  function editorText(el) {
    return String(el?.innerText || el?.textContent || "")
      .replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  }

  // ─── COMMENT FILTER ─────────────────────────────────────────────
  const COMMENT_RX = /comment|reply|تعليق|رد|اكتب\s*تعليق|write\s*a\s*comment/i;

  function isCommentElement(el) {
    if (!el) return false;
    const attrs = [
      el.getAttribute?.("aria-label") || "",
      el.getAttribute?.("aria-placeholder") || "",
      el.getAttribute?.("placeholder") || "",
      el.id || "",
      typeof el.className === "string" ? el.className : ""
    ];
    if (attrs.some(s => COMMENT_RX.test(s))) return true;
    if (el.closest?.('[aria-label*="Comment"],[aria-label*="تعليق"]')) return true;
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++) {
      const pa = (p.getAttribute?.("aria-label") || "") + " " +
                 (p.getAttribute?.("data-testid") || "") + " " +
                 (p.id || "") + " " +
                 (typeof p.className === "string" ? p.className : "");
      if (COMMENT_RX.test(pa)) return true;
      p = p.parentElement;
    }
    return false;
  }

  // ─── HARD EXCLUSION PATTERNS (never click these) ────────────────
  const RX_HARD_SKIP = /(like|love|haha|wow|sad|angry|care|react|reaction|إعجاب|أعجبني|قلب|هههه|واو|حزين|غاضب|اهتمام|تسجيل.*دخول|sign.*in|log.*in|continue|proceed|confirm|متابعة|تأكيد|view.*more|see.*more|عرض.*المزيد|report|إبلاغ|block|حظر|follow|متابعة|unfollow|share|مشاركة)/i;
  const RX_HARD_SKIP_ARIA = /(emoji|reaction|sticker|gif|attachment|feeling|activity|إيموجي|ملصق|مشاعر)/i;
  const COMPOSER_PHRASES = [
    "بماذا تفكر", "اكتب شيئ", "اكتب شيئا", "أنشئ منشور", "إنشاء منشور",
    "منشور جديد", "what's on your mind", "write something",
    "create a public post", "say something", "create post"
  ];
  function isComposerHint(text) {
    const lc = (text || "").toLowerCase();
    return COMPOSER_PHRASES.some(p => lc.includes(p.toLowerCase()));
  }

  // ─── GHOST MODAL DETECTION ──────────────────────────────────────
  function isGhostDialog(dialogEl) {
    if (!dialogEl) return true;
    const rect = dialogEl.getBoundingClientRect();
    if (rect.height < 150) return true;
    const hasEditor = !!dialogEl.querySelector('[role="textbox"],[contenteditable="true"]');
    if (!hasEditor) return true;
    const spinners = dialogEl.querySelectorAll(
      '[role="progressbar"],[data-visualcompletion="loading-state"]'
    );
    const hasButtons = dialogEl.querySelectorAll('[role="button"]').length > 1;
    if (spinners.length > 0 && !hasButtons) return true;
    return false;
  }

  function collectContextText(el, depth = 5) {
    const parts = [];
    let node = el;
    for (let i = 0; i < depth && node; i++, node = node.parentElement) {
      parts.push(
        node.getAttribute?.("aria-label") || "",
        node.getAttribute?.("data-pagelet") || "",
        node.getAttribute?.("data-testid") || "",
        node.id || "",
        typeof node.className === "string" ? node.className : "",
        shallowText(node)
      );
    }
    return parts.filter(Boolean).join(" ").trim();
  }

  function isBlockingMediaOverlay(node) {
    const overlay = node?.getAttribute?.("role") === "dialog"
      ? node
      : node?.closest?.('[role="dialog"],[aria-modal="true"]');
    if (!overlay || !isVisible(overlay)) return false;
    if (findEditor(overlay)) return false;

    const ctx = (attrText(overlay) + " " + collectContextText(overlay, 4)).toLowerCase();
    const hasVideo = !!overlay.querySelector("video") ||
      /(^|\s)(video|watch|reel|ريل|فيديو|مشاهدة)(\s|$)/i.test(ctx);
    const hasMediaViewer = !!overlay.querySelector('img,canvas,[data-video-id],a[href*="/watch/"],a[href*="/reel/"]');

    return hasVideo || hasMediaViewer;
  }

  async function dismissBlockingMediaOverlays() {
    const overlays = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))
      .filter(isVisible)
      .filter(isBlockingMediaOverlay);

    for (const overlay of overlays) {
      log("dismissBlockingMediaOverlays: closing blocking media overlay");
      try { await closeDialog(overlay); } catch (_) {}
      await sleep(450);
    }

    return overlays.length;
  }

  // ─── FIND EDITOR (dialog-only) ──────────────────────────────────
  function findEditor(dialogEl) {
    if (!dialogEl || dialogEl.getAttribute("role") !== "dialog") return null;

    const candidates = [];
    const boxes = Array.from(dialogEl.querySelectorAll(
      '[role="textbox"],[contenteditable="true"]'
    ));

    for (const el of boxes) {
      if (!isVisible(el)) continue;
      if (!el.closest('[role="dialog"]')) continue;
      if (isCommentElement(el)) continue;
      let n = el.parentElement, inArt = false;
      while (n && n !== document.body) {
        if (n.tagName === "ARTICLE") { inArt = true; break; }
        n = n.parentElement;
      }
      if (inArt) continue;

      const txt = attrText(el) + " " + shallowText(el);
      let score = 10;
      if (isComposerHint(txt)) score += 100;
      if (el.isContentEditable) score += 40;
      if (!editorText(el)) score += 10;
      candidates.push({ el, score });
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    log("findEditor ✓", attrText(candidates[0].el).slice(0, 50), "score=" + candidates[0].score);
    return candidates[0].el;
  }

  // ─── WAIT FOR SELECTOR ──────────────────────────────────────────
  function waitForSelector(selector, opts = {}) {
    const root = opts.root || document;
    const timeoutMs = opts.timeoutMs || DIALOG_WAIT_MS;
    const pollMs = opts.pollMs || DIALOG_POLL_MS;
    const visibleOnly = !!opts.visibleOnly;
    const filter = typeof opts.filter === "function" ? opts.filter : null;

    return new Promise(resolve => {
      const startedAt = Date.now();
      const pick = () => {
        let nodes = [];
        try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) { return null; }
        for (const node of nodes) {
          if (visibleOnly && !isVisible(node)) continue;
          if (filter && !filter(node)) continue;
          return node;
        }
        return null;
      };
      const done = v => { try { clearInterval(tid); } catch(_){} try { obs.disconnect(); } catch(_){} resolve(v || null); };
      const immediate = pick();
      if (immediate) return done(immediate);
      const tid = setInterval(() => {
        const f = pick(); if (f) return done(f);
        if (Date.now() - startedAt >= timeoutMs) return done(null);
      }, pollMs);
      const obs = new MutationObserver(() => {
        const f = pick(); if (f) return done(f);
        if (Date.now() - startedAt >= timeoutMs) return done(null);
      });
      try { obs.observe(root === document ? document.documentElement : root,
        { childList:true, subtree:true, attributes:true,
          attributeFilter:["style","class","aria-hidden","aria-disabled"] }); } catch(_){}
    });
  }

  // ─── WAIT FOR COMPOSER DIALOG (real, not ghost) ─────────────────
  async function waitForComposerDialog(ms = DIALOG_WAIT_MS) {
    log("waitForComposerDialog: waiting for real dialog...");
    const start = Date.now();
    while (Date.now() - start < ms) {
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(isVisible);
      for (const dlg of dialogs) {
        if (isGhostDialog(dlg)) continue;
        const ed = findEditor(dlg);
        if (ed) { log("✓ real dialog found"); return { dialog: dlg, editor: ed }; }
      }
      await sleep(DIALOG_POLL_MS);
    }
    return null;
  }

  // ─── FB ERROR DETECTION ─────────────────────────────────────────
  function detectFBError(scope) {
    const txt = ((scope || document).innerText || (scope || document).textContent || "").toLowerCase();
    return FB_ERROR_PHRASES.some(p => txt.includes(p.toLowerCase()));
  }

  async function closeDialog(dialogEl) {
    log("closeDialog...");
    const sels = [
      '[aria-label="Close"]','[aria-label="إغلاق"]','[aria-label="close"]',
      'div[role="button"][aria-label*="lose"]','div[role="button"][aria-label*="غلق"]'
    ];
    for (const sel of sels) {
      const btn = (dialogEl || document).querySelector(sel) || document.querySelector(sel);
      if (btn && isVisible(btn)) { await forceTrigger(btn, { waitAfter: 400 }); await sleep(400); return; }
    }
    document.dispatchEvent(new KeyboardEvent("keydown",
      { key:"Escape", keyCode:27, bubbles:true, cancelable:true }));
    await sleep(600);
  }

  // ─── KIWI TAP SIMULATION ────────────────────────────────────────
  // Re-entry guard: prevents same element being triggered twice within 1.5s (fixes double-popup bug)
  const _forceTriggerActive = new WeakSet();

  async function forceTrigger(el, opts = {}) {
    if (!el) return false;
    const target = el.closest("[role='button'],button,[contenteditable='true']") || el;
    const { waitAfter = rand(200, 350) } = opts;

    if (_forceTriggerActive.has(target)) {
      log("forceTrigger: duplicate call blocked on same element");
      return false;
    }
    _forceTriggerActive.add(target);
    setTimeout(() => { try { _forceTriggerActive.delete(target); } catch(_){} }, 1500);

    try { target.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    await sleep(rand(60, 120));

    const rect = target.getBoundingClientRect();
    const cx = rect.left + Math.max(6, rect.width / 2) + rand(-2, 2);
    const cy = rect.top  + Math.max(6, rect.height / 2) + rand(-2, 2);
    const sx = Math.round((window.screenX || 0) + cx);
    const sy = Math.round((window.screenY || 0) + cy);
    const px = Math.round((window.scrollX || 0) + cx);
    const py = Math.round((window.scrollY || 0) + cy);

    // debug dot
    try {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;top:${cy-5}px;left:${cx-5}px;width:10px;height:10px;background:#ff3b30;border-radius:50%;z-index:2147483647;pointer-events:none;`;
      document.body.appendChild(d);
      setTimeout(() => { try { d.remove(); } catch (_) {} }, 700);
    } catch (_) {}

    function spoof(evt) {
      try { Object.defineProperty(evt, "isTrusted", { get: () => true, configurable: true }); } catch (_) {}
      try { target.dispatchEvent(evt); } catch (_) {}
    }

    const mkT = (force = 0.7) => {
      try { return new Touch({ identifier: Date.now() + rand(0,99), target, clientX:cx, clientY:cy, screenX:sx, screenY:sy, pageX:px, pageY:py, radiusX:rand(7,11), radiusY:rand(7,11), rotationAngle:0, force }); }
      catch (_) { return { identifier:Date.now(), target, clientX:cx, clientY:cy, screenX:sx, screenY:sy, pageX:px, pageY:py }; }
    };
    const mkTE = (name, pts, active) => {
      const p = { bubbles:true, cancelable:true, composed:true, touches:active?pts:[], targetTouches:active?pts:[], changedTouches:pts };
      try { return typeof TouchEvent==="function"?new TouchEvent(name,p):new Event(name,{bubbles:true,cancelable:true}); }
      catch (_) { return new Event(name,{bubbles:true,cancelable:true}); }
    };
    const mkPtr = (name, pressure = 0) => {
      const b = { view:window, bubbles:true, cancelable:true, composed:true, clientX:cx, clientY:cy, screenX:sx, screenY:sy, pointerId:1, pointerType:"touch", isPrimary:true, pressure, button:0, buttons:pressure>0?1:0 };
      try { return new PointerEvent(name, b); } catch (_) { return new MouseEvent(name,{...b,which:1}); }
    };
    const mkM = (name, down = false) => {
      try { return new MouseEvent(name,{view:window,bubbles:true,cancelable:true,composed:true,clientX:cx,clientY:cy,screenX:sx,screenY:sy,button:0,buttons:down?1:0,detail:1,which:1}); }
      catch (_) { return new Event(name,{bubbles:true,cancelable:true}); }
    };

    const ts = mkT(0.7), te = mkT(0.0);
    spoof(mkPtr("pointerdown", 0.7));
    spoof(mkM("mousedown", true));
    spoof(mkTE("touchstart", [ts], true));
    try { target.focus({ preventScroll: true }); } catch (_) { try { target.focus(); } catch (_) {} }
    await sleep(50);
    spoof(mkTE("touchend", [te], false));
    spoof(mkPtr("pointerup", 0));
    spoof(mkM("mouseup", false));
    spoof(mkM("click", false));
    // NOTE: target.click() removed — it duplicates the synthetic click above
    // and causes a second popup/dialog to open on mobile browsers (Kiwi, Chrome for Android)
    await sleep(waitAfter);
    return true;
  }

  // ─── CARET ──────────────────────────────────────────────────────
  function placeCaretAtEnd(editor) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // ① ROBUST EDITOR CLEARING — remove all child nodes
  // ═══════════════════════════════════════════════════════════════
  function clearEditor(editor) {
    if (!editor) return;
    try {
      // Method 1: selectAll + delete
      editor.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch (_) {}
    try {
      // Method 2: remove all child nodes
      while (editor.firstChild) {
        editor.removeChild(editor.firstChild);
      }
    } catch (_) {}
    try {
      // Method 3: clear text properties
      editor.textContent = "";
      editor.innerHTML = "";
    } catch (_) {}
    // Fire events to notify React
    try {
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true, cancelable: true, composed: true,
        inputType: "deleteContentBackward"
      }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // ② HYBRID TEXT INJECTION — with robust clearing
  // ═══════════════════════════════════════════════════════════════
  // ── Anti-duplication: remove repeated consecutive occurrences of any URL ──
  function deduplicateLinks(text) {
    // Matches http/https URLs and wa.me short links
    const URL_PATTERN = /(https?:\/\/[^\s]+|wa\.me\/[^\s]*)/g;
    const seen = new Set();
    return text.replace(URL_PATTERN, function(url) {
      const key = url.trim().replace(/\/+$/, ""); // normalise trailing slashes
      if (seen.has(key)) return "";               // remove duplicate
      seen.add(key);
      return url;
    }).replace(/\n{3,}/g, "\n\n").trim();         // collapse blank lines left by removals
  }

  // ─── INJECTION SANITIZER ────────────────────────────────────────
  // Mirrors popup.js sanitizeForFB() at the content-script boundary.
  // Removes hidden chars that can survive the chrome.runtime message
  // round-trip (JSON serialisation) and cause Facebook to silently
  // collapse \n\n paragraph boundaries.
  function sanitizeForFBInjection(text) {
    return String(text || "")
      .replace(/[\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF]/g, "")
      .replace(/[\u00AD\u2028\u2029\u202A-\u202F\u2066-\u206F]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  // ─── HTML PARAGRAPH BUILDER ─────────────────────────────────────
  // Converts plain text with \n\n (paragraph breaks) and \n (line
  // breaks) into Facebook-compatible HTML that the contenteditable
  // editor stores as distinct <p> nodes — guaranteeing visual spacing.
  // NOTE: <br> = soft break (same paragraph). </p><p> = hard paragraph
  // break with full visual gap. This distinction is the core fix.
  function buildFBHtml(text) {
    return text
      .split("\n\n")
      .map(function(para) {
        var inner = para
          .split("\n")
          .map(function(line) {
            return line
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
          })
          .join("<br>");
        return "<p>" + (inner || "<br>") + "</p>";
      })
      .join("");
  }

  // ─── LENGTH MEASURE (newline-preserving) ────────────────────────
  // editorText() collapses /\s+/ → " " which makes \n\n count as 1
  // char, causing the length check to fire the textContent fallback.
  // This version counts raw characters including newlines.
  function editorTextLen(el) {
    return String(el ? (el.innerText || el.textContent || "") : "").length;
  }


  // ═══════════════════════════════════════════════════════════════
  // TEXT INJECTION — 4-method cascade targeting Lexical internals
  // ═══════════════════════════════════════════════════════════════
  async function injectText(editor, text) {
    if (!editor || !text) return false;

    const deduped  = deduplicateLinks(String(text).replace(/\r/g, "").trim());
    const fullText = sanitizeForFBInjection(deduped);
    if (!fullText) return false;

    log("injectText start len=" + fullText.length);

    // Scroll into view + real click to ensure Lexical ownership
    try { editor.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    await sleep(70);
    try { editor.click(); } catch (_) {}
    try { editor.focus(); } catch (_) {}
    await sleep(60);

    // Clear existing content safely
    clearEditor(editor);
    await sleep(40);

    // Move caret to end
    placeCaretAtEnd(editor);
    await sleep(20);

    // ── Notify React/Lexical with plain events ONLY (no data= to avoid overwrite) ──
    function notify() {
      try { editor.dispatchEvent(new Event("input",  { bubbles: true })); } catch (_) {}
      try { editor.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
    }

    // ── METHOD 1: beforeinput (Lexical's native input handler) ─────
    let ok = false;
    try {
      // Select ALL existing content first — Lexical will REPLACE, not append
      const sel = window.getSelection();
      if (sel) {
        const rng = document.createRange();
        rng.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(rng);
      }
      await sleep(15);
      const ev = new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, composed: true,
        inputType: "insertText",
        data: fullText
      });
      editor.dispatchEvent(ev);
      await sleep(90);
      ok = editorTextLen(editor) >= Math.min(50, fullText.length * 0.5);
    } catch (_) { ok = false; }

    if (ok) {
      log("injectText ✓ M1 beforeinput len=" + editorTextLen(editor));
      notify();
      return true;
    }

    // ── METHOD 2: execCommand("insertText") ────────────────────────
    try {
      editor.focus();
      clearEditor(editor);
      await sleep(30);
      placeCaretAtEnd(editor);
      await sleep(20);
      ok = !!document.execCommand("insertText", false, fullText);
      await sleep(80);
      ok = ok && editorTextLen(editor) >= Math.min(50, fullText.length * 0.5);
    } catch (_) { ok = false; }

    if (ok) {
      log("injectText ✓ M2 execCommand len=" + editorTextLen(editor));
      notify();
      return true;
    }

    // ── METHOD 3: ClipboardEvent paste (Lexical has an onPaste handler) ──
    try {
      editor.focus();
      clearEditor(editor);
      await sleep(30);
      const dt = new DataTransfer();
      dt.setData("text/plain", fullText);
      dt.setData("text/html",  buildFBHtml(fullText));
      editor.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, composed: true, clipboardData: dt
      }));
      await sleep(90);
      ok = editorTextLen(editor) >= Math.min(50, fullText.length * 0.5);
    } catch (_) { ok = false; }

    if (ok) {
      log("injectText ✓ M3 paste len=" + editorTextLen(editor));
      notify();
      return true;
    }

    // ── METHOD 4: Direct innerHTML (last resort) ────────────────────
    try {
      editor.focus();
      editor.innerHTML = buildFBHtml(fullText);
      await sleep(50);
      placeCaretAtEnd(editor);
      notify();
    } catch (_) {}

    const finalLen = editorTextLen(editor);
    log("injectText M4 innerHTML len=" + finalLen);
    return finalLen > 0;
  }

  // ─── POST BUTTON ────────────────────────────────────────────────
  const RX_POST  = /^(post|نشر|publish|نشر الآن|post now|أنشر)$/i;
  const RX_LOOSE = /(^|\s)(post|نشر|publish)(\s|$)/i;
  const RX_SKIP  = /(comment|تعليق|share|مشاركة|like|إعجاب|sponsored|ممول|reaction|تفاعل|sign.*in|log.*in|تسجيل.*دخول|continue|متابعة|cancel|إلغاء|discard|delete|حذف|report|إبلاغ)/i;

  function isDisabledButton(el) {
    return !!(
      !el || el.disabled ||
      el.getAttribute?.("disabled") !== null ||
      el.getAttribute?.("aria-disabled") === "true"
    );
  }

  function findPostButton(scope, opts = {}) {
    scope = scope || document;
    const includeDisabled = !!opts.includeDisabled;
    const candidates = [];
    const els = scope.querySelectorAll('div[role="button"],button');
    for (const el of els) {
      if (!isVisible(el)) continue;
      if (el.offsetWidth < 10 || el.offsetHeight < 10) continue;
      if (!includeDisabled && isDisabledButton(el)) continue;
      const aria    = (el.getAttribute("aria-label") || "").trim();
      const direct  = (el.innerText || el.textContent || "").trim();
      const childTx = Array.from(el.querySelectorAll("span,div"))
        .map(c => (c.innerText || c.textContent || "").trim()).find(t => t) || "";
      const best = aria || direct || childTx;
      if (!best) continue;
      if (RX_SKIP.test(best) && best.length < 20) continue;
      let score = 0;
      if (RX_POST.test(aria))    score += 70;
      else if (RX_LOOSE.test(aria))   score += 40;
      if (RX_POST.test(direct))  score += 60;
      else if (RX_LOOSE.test(direct)) score += 30;
      if (RX_POST.test(childTx)) score += 55;
      else if (RX_LOOSE.test(childTx)) score += 25;
      if (score === 0) continue;
      if (el.closest("div[role='dialog']")) score += 20;
      if (el.tagName === "BUTTON") score += 10;
      if (isDisabledButton(el)) score -= 20;
      candidates.push({ el, score });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].el;
  }

  async function waitForPostButton(scope, ms = POST_WAIT_MS) {
    const start = Date.now();
    let disabledBtn = null;
    while (Date.now() - start < ms) {
      const btn = findPostButton(scope, { includeDisabled: false });
      if (btn) { log("✓ Post button enabled"); return { button: btn, reason: "" }; }
      disabledBtn = findPostButton(scope, { includeDisabled: true }) || disabledBtn;
      await sleep(POST_POLL_MS);
    }
    disabledBtn = findPostButton(scope, { includeDisabled: true }) || disabledBtn;
    if (disabledBtn && isDisabledButton(disabledBtn)) return { button: null, reason: "Post button found but disabled" };
    return { button: null, reason: "Post button not found" };
  }

  // ═══════════════════════════════════════════════════════════════
  // ③ MUTATIONOBSERVER-BASED MEDIA UPLOAD WAIT
  // ═══════════════════════════════════════════════════════════════
  function waitForMediaUpload(dialog, timeoutMs = MEDIA_UPLOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
      const startTime = Date.now();

      // Selectors for upload progress indicators
      const UPLOAD_SELECTORS = [
        '[role="progressbar"]',
        '[data-visualcompletion="loading-state"]',
        '[aria-valuemin][aria-valuemax][aria-valuenow]',
        '[aria-label*="Uploading"]',
        '[aria-label*="رفع"]',
        '[aria-label*="upload"]'
      ];

      function hasActiveUploads() {
        for (const sel of UPLOAD_SELECTORS) {
          const els = dialog.querySelectorAll(sel);
          for (const el of els) {
            if (isVisible(el)) {
              // Check if progress bar is not yet complete
              const now = el.getAttribute("aria-valuenow");
              const max = el.getAttribute("aria-valuemax");
              if (now && max && parseFloat(now) >= parseFloat(max)) continue;
              return true;
            }
          }
        }
        return false;
      }

      // Also check for disabled post button as indicator of ongoing upload
      function isUploadStillInProgress() {
        if (hasActiveUploads()) return true;
        // If post button is disabled, upload may still be processing
        const postBtn = findPostButton(dialog, { includeDisabled: true });
        if (postBtn && isDisabledButton(postBtn)) {
          // Only consider this as "uploading" if we're within first 30s
          if (Date.now() - startTime < 30000) return true;
        }
        return false;
      }

      // Quick check — if no uploads detected immediately, wait a short time then resolve
      if (!isUploadStillInProgress()) {
        log("waitForMediaUpload: no active uploads detected, waiting 2s safety margin...");
        setTimeout(() => resolve(true), 2000);
        return;
      }

      log("waitForMediaUpload: upload in progress, watching with MutationObserver...");

      let resolved = false;
      const done = (success) => {
        if (resolved) return;
        resolved = true;
        try { clearInterval(pollTimer); } catch (_) {}
        try { observer.disconnect(); } catch (_) {}
        resolve(success);
      };

      // Timeout
      const timeoutTimer = setTimeout(() => {
        log("waitForMediaUpload: TIMEOUT after " + (timeoutMs/1000) + "s");
        done(false);
      }, timeoutMs);

      // Poll every 500ms as backup
      const pollTimer = setInterval(() => {
        if (!isUploadStillInProgress()) {
          log("waitForMediaUpload: upload complete (poll detected)");
          clearTimeout(timeoutTimer);
          // Wait 1.5s after upload completes for FB to process
          setTimeout(() => done(true), 1500);
        }
      }, 500);

      // MutationObserver for faster detection
      const observer = new MutationObserver(() => {
        if (!isUploadStillInProgress()) {
          log("waitForMediaUpload: upload complete (MutationObserver detected)");
          clearTimeout(timeoutTimer);
          clearInterval(pollTimer);
          // Wait 1.5s after upload completes for FB to process
          setTimeout(() => done(true), 1500);
        }
      });

      try {
        observer.observe(dialog, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "aria-hidden", "aria-disabled", "aria-valuenow", "aria-valuemax"]
        });
      } catch (_) {
        // If observer fails, rely on polling
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ④ MUTATIONOBSERVER-BASED DIALOG GONE DETECTION
  // ═══════════════════════════════════════════════════════════════
  function isDialogGone(dialogEl) {
    if (!dialogEl) return true;
    if (!document.contains(dialogEl)) return true;
    if (!isVisible(dialogEl)) return true;
    return false;
  }

  function waitForDialogGone(dialogEl, ms = POST_GONE_MS) {
    return new Promise(resolve => {
      if (isDialogGone(dialogEl)) {
        log("✓ Dialog already gone");
        return resolve(true);
      }

      let resolved = false;
      const done = (val) => {
        if (resolved) return;
        resolved = true;
        try { clearInterval(pollTimer); } catch (_) {}
        try { observer.disconnect(); } catch (_) {}
        resolve(val);
      };

      // Timeout
      setTimeout(() => done(isDialogGone(dialogEl)), ms);

      // Polling backup
      const pollTimer = setInterval(() => {
        if (isDialogGone(dialogEl)) {
          log("✓ Dialog gone (poll)");
          done(true);
        }
      }, DIALOG_POLL_MS);

      // MutationObserver for faster detection
      const observer = new MutationObserver(() => {
        if (isDialogGone(dialogEl)) {
          log("✓ Dialog gone (MutationObserver)");
          done(true);
        }
      });

      try {
        // Watch the parent of the dialog for removal
        const parent = dialogEl.parentElement || document.body;
        observer.observe(parent, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style", "class", "aria-hidden"]
        });
      } catch (_) {}
    });
  }

  // ─── FIND COMPOSER TARGET ───────────────────────────────────────
  // Group-action buttons to NEVER treat as composer (دخول موقع، انضمام، دعوة...)
  const RX_GROUP_ACTION = /(visit\s*(group\s*)?website|دخول\s*(موقع|الموقع)|join\s*(group)?|انضم|invite|دعوة|share\s*group|مشاركة\s*المجموعة|manage\s*group|إدارة|leave\s*(group)?|مغادرة|admin|مسؤول|moderator|notify\s*me|إشعارات)/i;

  // ══════════════════════════════════════════════════════════════════
  // FIND COMPOSER TARGET — own-text ONLY, no parent context leak
  // ══════════════════════════════════════════════════════════════════
  function findComposerTarget() {
    const PHRASES = [
      "بماذا تفكر", "اكتب شيئ", "اكتب شيئا", "أنشئ منشور",
      "إنشاء منشور", "منشور جديد", "ما الذي تفكر",
      "what's on your mind", "write something",
      "create a public post", "say something", "create post"
    ];

    // Returns only the element's OWN text — no parent climbing
    function ownText(el) {
      return [
        el.getAttribute("aria-label")       || "",
        el.getAttribute("aria-placeholder") || "",
        el.getAttribute("placeholder")      || "",
        el.getAttribute("title")            || "",
        shallowText(el)
      ].join(" ").toLowerCase();
    }

    function excluded(el) {
      const aria = el.getAttribute("aria-label") || "";
      const txt  = (el.innerText || el.textContent || "").slice(0, 120);
      if (RX_HARD_SKIP.test(aria)      || RX_HARD_SKIP.test(txt))      return true;
      if (RX_HARD_SKIP_ARIA.test(aria))                                 return true;
      if (RX_GROUP_ACTION.test(aria)   || RX_GROUP_ACTION.test(txt))   return true;
      if (el.tagName === "A"           || el.closest("a[href]"))        return true;
      if (el.closest('article,[data-pagelet*="FeedUnit"],[data-pagelet*="Story"]')) return true;
      if (el.closest('[data-pagelet*="GroupInfo"],[data-pagelet*="GroupHeader"],[role="banner"]')) return true;
      if (el.closest('[aria-label*="React"],[aria-label*="تفاعل"],[data-testid*="reaction"],[role="menu"]')) return true;
      if (el.closest('[data-testid*="login"]')) return true;
      return false;
    }

    // ── Pass 1: element with aria-placeholder = composer phrase ────
    for (const el of document.querySelectorAll('[aria-placeholder],[contenteditable="true"],[role="textbox"]')) {
      if (!isVisible(el) || isCommentElement(el) || excluded(el)) continue;
      const ph = (el.getAttribute("aria-placeholder") || "").toLowerCase();
      if (ph && PHRASES.some(p => ph.includes(p.toLowerCase()))) {
        log("Composer P1 aria-placeholder:", ph.slice(0, 40));
        return el;
      }
    }

    // ── Pass 2: role=button with OWN text matching phrase ──────────
    for (const el of document.querySelectorAll('[role="button"]')) {
      if (!isVisible(el) || isCommentElement(el) || excluded(el)) continue;
      const own = ownText(el);
      if (PHRASES.some(p => own.includes(p.toLowerCase()))) {
        log("Composer P2 own-text:", own.slice(0, 40));
        return el;
      }
    }

    // ── Pass 3: scored, OWN text only, no collectContextText ───────
    const hits = [];
    for (const el of document.querySelectorAll('[role="button"],button,[contenteditable],[aria-placeholder]')) {
      if (!isVisible(el) || isCommentElement(el) || excluded(el)) continue;
      const own = ownText(el);
      if (!PHRASES.some(p => own.includes(p.toLowerCase()))) continue; // own text gate
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 18) continue;
      let score = 50;
      if (el.getAttribute("aria-placeholder") && PHRASES.some(p =>
          el.getAttribute("aria-placeholder").toLowerCase().includes(p.toLowerCase()))) score += 100;
      if (el.getAttribute("aria-haspopup")) score += 25;
      if (el.isContentEditable)             score += 20;
      if (r.top >= 0 && r.top < 400)       score += 20;
      hits.push({ el, score, top: r.top });
    }
    hits.sort((a, b) => (b.score - a.score) || (a.top - b.top));
    if (hits[0]) { log("Composer P3 scored:", ownText(hits[0].el).slice(0, 40)); return hits[0].el; }
    return null;
  }

  // ─── MEDIA UPLOAD ───────────────────────────────────────────────
  async function waitForFileInput(scope, ms = 6000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const inp = (scope || document).querySelector("input[type='file']") ||
                  document.querySelector("input[type='file']");
      if (inp) return inp;
      await sleep(200);
    }
    return (scope || document).querySelector("input[type='file']") ||
           document.querySelector("input[type='file']");
  }

  function buildDragEvent(type, dt) {
    try { return new DragEvent(type, { bubbles:true, cancelable:true, composed:true, dataTransfer:dt }); }
    catch (_) {
      const e = new Event(type, { bubbles:true, cancelable:true, composed:true });
      try { Object.defineProperty(e,"dataTransfer",{value:dt}); } catch(_){}
      return e;
    }
  }

  async function uploadMedia(mediaFiles, dialog) {
    if (!mediaFiles || !mediaFiles.length) return false;
    const photoLabels = [
      "Photo/video","Photo","Add photo or video","Add photos/videos",
      "Choose photos/videos","صورة/فيديو","صورة","أضف صورة/فيديو","فيديو"
    ];
    let photoBtn = null;
    for (const lbl of photoLabels) {
      photoBtn = dialog.querySelector(`[aria-label="${lbl}"]`);
      if (photoBtn && isVisible(photoBtn)) break;
    }
    if (!photoBtn) {
      photoBtn = Array.from(dialog.querySelectorAll("[aria-label],[role='button'],button"))
        .find(el => /photo|video|image|media|صورة|فيديو/i.test(
          el.getAttribute("aria-label") || el.innerText || "") && isVisible(el));
    }
    if (!photoBtn) throw new Error("Photo/video button not found");
    await forceTrigger(photoBtn, { waitAfter: 900 });

    const input = await waitForFileInput(document, 7000);
    if (!input) throw new Error("File input not found");
    const dt = new DataTransfer();
    for (const item of mediaFiles) {
      if (!item?.dataUrl) continue;
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      const isVideo = /^video\//.test(item.type || blob.type || "");
      dt.items.add(new File([blob], item.name || (isVideo?"video.mp4":"photo.jpg"),
        { type: item.type || blob.type || (isVideo?"video/mp4":"image/jpeg") }));
    }
    if (!dt.files.length) throw new Error("No media files");
    const dropTarget = dialog.querySelector("[role='dialog']") ||
                       input.closest("label,form,div") || input;
    ["dragenter","dragover","drop"].forEach(t => {
      try { dropTarget.dispatchEvent(buildDragEvent(t, dt)); } catch(_){}
    });
    try { input.files = dt.files; } catch(_){}
    ["input","change"].forEach(t => {
      try { input.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})); } catch(_){}
    });

    // ── Wait for upload to complete using MutationObserver ──
    log("uploadMedia: waiting for upload to complete...");
    const uploadOk = await waitForMediaUpload(dialog, MEDIA_UPLOAD_TIMEOUT_MS);
    if (!uploadOk) {
      log("⚠️ Media upload may not have completed (timeout)");
    } else {
      log("✓ Media upload complete");
    }

    return true;
  }

  // ─── FIRST COMMENT (FIXED) ─────────────────────────────────────
  // إصلاح: استخدام injectText+forceTrigger الموجودتان + البحث عن زر الإرسال
  // السبب: execCommand لا يعمل على Kiwi Browser والمتصفحات الحديثة
  async function postComment(text, postUrl) {
    if (!text || !text.trim()) return { success: false, skipped: true, reason: "no_comment_text" };
    const COMMENT_RX_LOCAL = /(comment|write a comment|اكتب تعليق|تعليق|write something)/i;

    // ── كشف مبكر: هل التعليقات مغلقة/ممنوعة على هذا المنشور أصلاً؟ ──
    // لو فيسبوك عارض رسالة صريحة إن التعليقات متوقفة، مفيش داعي نضيع وقت
    // نحاول نلاقي خانة مش هتظهر أصلاً — نرجع فشل واضح فورًا.
    const commentsOffRx = /(comments? (are|is) (off|turned off|disabled|limited)|commenting (is|has been) (disabled|turned off|limited)|لا يمكن التعليق|التعليقات معطّلة|تم إيقاف التعليقات|تعليقات هذا المنشور مقيدة|لا يمكنك التعليق)/i;
    const bodyTxtCheck = (document.body?.innerText || "").toLowerCase();
    if (commentsOffRx.test(bodyTxtCheck)) {
      log("postComment: comments appear disabled on this post");
      return { success: false, reason: "comments_disabled" };
    }

    // تمرير للأسفل أولاً — فيسبوك يُخفي خانة التعليق حتى تظهر في الشاشة
    window.scrollBy({ top: 500, behavior: "smooth" });
    await sleep(rand(500, 800));

    // ── تحديد حاوية البوست الفعلي المنشور (مش أي بوست ظاهر في الصفحة) ──
    // بدون هذا القيد، البحث في document كله ممكن يمسك خانة تعليق تخص بوست
    // مختلف ظاهر أعلى/أسفل في الـ feed، خصوصاً في الجروبات اللي بترفض/تعلّق
    // فيرجع المستخدم يحاول تاني والصفحة فيها أكتر من بوست.
    let scopeRoot = document;
    if (postUrl) {
      try {
        const idMatch = postUrl.match(/\/posts\/(\d+)|story_fbid=(\d+)|\/permalink\/(\d+)/);
        const postId = idMatch ? (idMatch[1] || idMatch[2] || idMatch[3]) : null;
        const linkSelector = postId
          ? `a[href*="${postId}"]`
          : `a[href="${postUrl}"]`;
        const anchor = document.querySelector(linkSelector);
        const articleContainer = anchor && anchor.closest('[role="article"]');
        if (articleContainer) scopeRoot = articleContainer;
      } catch (_) { /* fallback to document scope below */ }
    }

    // Pass 1: ابحث عن خانة التعليق داخل حاوية البوست الصحيح أولاً
    let box = null;
    const allBoxes = Array.from(scopeRoot.querySelectorAll("[contenteditable='true'],[role='textbox']"));
    for (const el of allBoxes) {
      const t = (attrText(el) + " " + (el.innerText || "")).toLowerCase();
      if (COMMENT_RX_LOCAL.test(t) && isVisible(el)) { box = el; break; }
    }
    // لو الحاوية المحددة ملهاش نتيجة (مثلاً فيسبوك غيّر البنية)، ارجع للبحث
    // في الصفحة كلها كخطة بديلة بدل ما نفشل تمامًا
    if (!box && scopeRoot !== document) {
      const allBoxesFallback = Array.from(document.querySelectorAll("[contenteditable='true'],[role='textbox']"));
      for (const el of allBoxesFallback) {
        const t = (attrText(el) + " " + (el.innerText || "")).toLowerCase();
        if (COMMENT_RX_LOCAL.test(t) && isVisible(el)) { box = el; break; }
      }
    }

    // Pass 2: إذا لم تُوجد، ابحث عن زر "Comment" واضغطه (داخل نفس نطاق البحث)
    if (!box) {
      const BTN_RX = /(^comment$|^تعليق$|write a comment|اكتب تعليقًا)/i;
      const commentBtn = Array.from(scopeRoot.querySelectorAll('[role="button"],button'))
        .find(el => BTN_RX.test((el.getAttribute("aria-label") || el.innerText || "").trim()) && isVisible(el));
      if (commentBtn) {
        await forceTrigger(commentBtn, { waitAfter: rand(600, 900) });
        await sleep(rand(500, 700));
        const boxes2 = Array.from(scopeRoot.querySelectorAll("[contenteditable='true'],[role='textbox']"));
        for (const el of boxes2) {
          const t = (attrText(el) + " " + (el.innerText || "")).toLowerCase();
          if (COMMENT_RX_LOCAL.test(t) && isVisible(el)) { box = el; break; }
        }
      }
    }

    if (!box) { log("postComment: comment box not found"); return { success: false, reason: "box_not_found" }; }

    // تفعيل الخانة وحقن النص باستخدام injectText الموثوق
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    await sleep(rand(200, 350));
    await forceTrigger(box, { waitAfter: rand(200, 300) });
    await sleep(rand(200, 300));

    // استخدام injectText الموجودة في الملف
    const typed = await injectText(box, text);
    if (!typed) {
      // fallback أخير
      try { document.execCommand("insertText", false, text); } catch (_) {
        box.innerText = text;
        box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
    await sleep(rand(500, 700));

    // ابحث عن زر الإرسال الفعلي داخل نفس الحاوية
    const SUBMIT_RX = /(^post$|^comment$|^reply$|^send$|إرسال|^تعليق$|نشر)/i;
    const container = box.closest('[role="form"],[data-testid]') || box.parentElement?.parentElement;
    let submitBtn = null;
    if (container) {
      submitBtn = Array.from(container.querySelectorAll('[role="button"],button'))
        .find(el => {
          if (!isVisible(el)) return false;
          const lbl = (el.getAttribute("aria-label") || el.innerText || "").trim();
          return SUBMIT_RX.test(lbl);
        });
    }

    if (submitBtn) {
      await forceTrigger(submitBtn, { waitAfter: rand(300, 500) });
      log("postComment ✅ submitted via button");
    } else {
      // fallback: Enter key
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
      try { document.execCommand("insertParagraph", false, null); } catch (_) {}
      box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
      log("postComment ✅ submitted via Enter");
    }
    await sleep(rand(400, 600));

    // ── تأكيد ما بعد الإرسال: هل ظهرت رسالة رفض/تعطيل فورية؟ ──
    // بعض الجروبات بترفض التعليق الأول فورًا برسالة صريحة بعد محاولة الإرسال
    // مباشرة (مش قبلها)، فبنتأكد تاني بعد الإرسال قبل ما نعتبرها نجحت فعلاً.
    const bodyTxtAfter = (document.body?.innerText || "").toLowerCase();
    const rejectedAfterRx = /(comment (was|has been) (removed|blocked|declined)|تم حذف تعليقك|تعذر نشر تعليقك|لا يمكن نشر هذا التعليق)/i;
    if (rejectedAfterRx.test(bodyTxtAfter)) {
      log("postComment: comment appears rejected right after submit");
      return { success: false, reason: "rejected_after_submit" };
    }
    return { success: true };
  }

  // ─── UTILITIES ──────────────────────────────────────────────────
  function extractPostUrl() {
    const links = document.querySelectorAll(
      "a[href*='/posts/'],a[href*='story_fbid'],a[href*='/permalink/']");
    return links.length ? links[links.length - 1].href : location.href;
  }

  function signalBg(result) {
    try { chrome.runtime.sendMessage({ action: "POSTING_DONE", result }); } catch (_) {}
  }

  // ─── GROUP SCANNER ──────────────────────────────────────────────
  async function getGroupList() {
    const groups = [], seen = new Set();
    const skip = new Set(["feed","discover","joins","create","search","invites","category","browse"]);
    function collect() {
      document.querySelectorAll("a[href*='/groups/']").forEach(a => {
        try {
          const href = a.href || a.getAttribute("href") || "";
          if (!href || !/groups\/[^/?#]+/i.test(href)) return;
          const slug = (href.match(/\/groups\/([^/?#]+)/i) || [])[1] || "";
          if (!slug || skip.has(slug.toLowerCase()) || seen.has(slug)) return;
          // تجاهل روابط المنشورات داخل الجروب
          if (/\/posts\//i.test(href) || /\/permalink\//i.test(href)) return;
          seen.add(slug);
          const card = a.closest('[role="listitem"],[role="article"],[data-pagelet],li,div') || a.parentElement;
          const nameEl = card && card.querySelector('[role="heading"],h2,h3,h4,strong,span');
          let name = (a.getAttribute("aria-label") || (nameEl && (nameEl.innerText || nameEl.textContent)) || a.innerText || a.textContent || slug).trim();
          name = name.replace(/\s+/g, " ").replace(/\n.*/s, "").slice(0, 100);
          if (!name) name = slug;
          groups.push({ name, url: "https://www.facebook.com/groups/" + slug + "/", member: true });
        } catch (_) {}
      });
    }
    collect();
    // تمرير أعمق لالتقاط قوائم الجروبات الطويلة
    for (let i = 0; i < 12; i++) {
      window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.9)));
      await sleep(380);
      collect();
      if (groups.length >= 400) break;
    }
    groups.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return groups;
  }

  // ═══════════════════════════════════════════════════════════════
  // SWITCH POSTING IDENTITY — post as Page instead of personal profile
  // ═══════════════════════════════════════════════════════════════
  async function switchPostingIdentity(dialog, pageName) {
    if (!pageName || !dialog) return false;
    const normalize = t => String(t || "").toLowerCase().trim()
      .replace(/\s+/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "");
    const target = normalize(pageName);

    // Look for the "Posting as / النشر بهوية" dropdown button in the dialog
    const dropdownRx = /(posting\s*as|public\s*group|النشر\s*بهوية|مجموعة\s*عامة|نشر\s*بصفتك)/i;
    const allBtns = Array.from(dialog.querySelectorAll('[role="button"],[aria-haspopup],[aria-expanded]'));
    const dropdown = allBtns.find(el => {
      const lbl = (el.getAttribute("aria-label") || el.innerText || "").trim();
      return dropdownRx.test(lbl) && isVisible(el);
    });

    if (!dropdown) {
      log("switchPostingIdentity: posting-as dropdown not found");
      return false;
    }

    log("switchPostingIdentity: found dropdown, clicking...");
    try { dropdown.click(); } catch (_) {}
    await sleep(rand(600, 900));

    // After clicking, a list of identities appears — find matching page name
    const allItems = Array.from(document.querySelectorAll(
      '[role="menuitem"],[role="option"],[role="radio"],[role="listitem"],[role="button"]'
    ));

    const match = allItems.find(el => {
      if (!isVisible(el)) return false;
      const txt = normalize(el.innerText || el.getAttribute("aria-label") || "");
      return txt.includes(target) || target.includes(txt.slice(0, 20));
    });

    if (match) {
      log("switchPostingIdentity: found page match, clicking:", match.innerText?.slice(0, 40));
      try { match.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
      await sleep(300);
      try { match.click(); } catch (_) {}
      await sleep(rand(180, 320));
      return true;
    }

    log("switchPostingIdentity: page not found in list, using default identity");
    // Close dropdown without selecting
    try { document.pressEscape?.() || document.body.click(); } catch (_) {}
    return false;
  }

  async function switchAnonymousMode(dialog, mode) {
    if (!dialog || String(mode || 'account') !== 'anonymous') return false;
    const rx = /(anonymous|anonymous post|publish anonymously|مجهول|نشر بشكل مجهول|منشور مجهول)/i;
    const btn = Array.from(dialog.querySelectorAll('[role="button"],button,[role="radio"],[role="option"]')).find(el => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
      return rx.test(t);
    });
    if (!btn) {
      log('switchAnonymousMode: anonymous option not found');
      return false;
    }
    try { await forceTrigger(btn, { waitAfter: rand(300, 500) }); } catch (_) {}
    await sleep(rand(300, 600));
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // ─── MAIN POSTING LOGIC ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════
  // Guard: prevent two concurrent postToGroup executions (e.g. from rapid message delivery)
  let _postToGroupRunning = false;

  async function postToGroup(content, comment, mediaFiles, retryCount = 0, postAsPage = "", postMode = "account", expectedUrl = "") {
    if (retryCount === 0 && _postToGroupRunning) {
      log("postToGroup: already running, ignoring duplicate call");
      signalBg({ success: false, error: "Duplicate call blocked" });
      return;
    }
    if (retryCount === 0) _postToGroupRunning = true;

    const MAX_RETRIES = 2;
    let finished = false;
    let currentDialog = null;

    // ⑤ FAILSAFE: now properly closes dialog and signals failure
    const failTimer = setTimeout(async () => {
      if (finished) return;
      finished = true;
      log("FAILSAFE triggered — closing dialog and signaling failure");
      _postToGroupRunning = false;
      if (currentDialog) {
        try { await closeDialog(currentDialog); } catch (_) {}
      }
      signalBg({ success: false, error: "انتهت المهلة الكلية (FAILSAFE)" });
    }, FAILSAFE_MS);

    try {
      log(`[${retryCount+1}/${MAX_RETRIES+1}] URL: ${location.href}`);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("NETWORK_OFFLINE");
      }
      if (!isPostableContext()) throw new Error("Not on a Facebook group/page");
      if (expectedUrl && !isExpectedPostingTarget(expectedUrl, location.href)) {
        throw new Error("Unexpected URL after load — target mismatch");
      }


        // ─── EARLY SKIP: existing pending/rejected posts ──────────────────────────
        // If there's already a pending or rejected post on this page, skip immediately.
        // This avoids opening the composer, wasting time, and getting the group blacklisted.
        const _existingCheck = detectExistingPendingOrRejected();
        if (_existingCheck.found) {
          log("⚡ EARLY SKIP —", _existingCheck.message);
          finished = true;
          _postToGroupRunning = false;
          clearTimeout(failTimer);
          return { success: false, pendingRejected: true, earlySkip: true,
            error: _existingCheck.message || "Existing pending/rejected post" };
        }

        // ─── Step 0: Handle non-member groups ─────────────────────────
      // If user is not a member, try to join first then post
      let joinedAsNonMember = false;
      const joinBtnRx = /^(join\s*group|join|انضم(?:\s*إلى)?(?:\s*المجموعة)?|انضم\s*للمجموعة)$/i;
      const joinBtn = Array.from(document.querySelectorAll(
        '[role="button"],button'
      )).find(el => {
        if (!isVisible(el)) return false;
        const t = (el.innerText || el.getAttribute("aria-label") || "").trim();
        return joinBtnRx.test(t);
      });

      if (joinBtn) {
        log("Step 0 – not a member, joining group first...");
        try {
          joinBtn.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(rand(600, 900));
          joinBtn.click();
          await sleep(rand(2500, 3500)); // wait for join to process
          joinedAsNonMember = true;
          log("Step 0 ✓ Joined group");
        } catch (e) {
          log("Step 0 join failed:", e.message);
        }
      }

      // ─── Step 1: Open composer ─────────────────────────────────
      await dismissBlockingMediaOverlays();
      let composerResult = await waitForComposerDialog(3000);

      if (!composerResult) {
        log("Step 1 – looking for composer button...");
        await dismissBlockingMediaOverlays();
        const target = findComposerTarget();
        if (!target) throw new Error("Composer button not found");
        log("Step 1 – clicking:", attrText(target).slice(0, 50));
        await forceTrigger(target, { waitAfter: rand(220, 340) });
        composerResult = await waitForComposerDialog(DIALOG_WAIT_MS);
      }

      if (!composerResult) throw new Error("Composer dialog did not appear");
      log("Step 2 ✓ Composer dialog open");

      const { dialog, editor: initialEditor } = composerResult;
      currentDialog = dialog;
      await sleep(rand(180, 320));

      // ─── Step 1.5: Anonymous / Page identity switches ─
      if (postMode === "anonymous") {
        log("Step 1.5 – trying anonymous mode");
        await switchAnonymousMode(dialog, postMode);
        await sleep(rand(180, 260));
      }
      if (postAsPage) {
        log("Step 1.6 – switching posting identity to page:", postAsPage);
        await switchPostingIdentity(dialog, postAsPage);
        await sleep(rand(180, 260));
      }

      // ─── Step 2: Upload media ──────────────────────────────────
      if (mediaFiles && mediaFiles.length) {
        log("Step 3 – uploading media...");
        try { await uploadMedia(mediaFiles, dialog); }
        catch (e) { log("Media upload skipped:", e.message); }
        await sleep(240);
      }

      // ─── Step 3: Write text ────────────────────────────────────
      let editor = findEditor(dialog) || initialEditor;
      if (!editor) throw new Error("Editor not found in dialog");

      log("Step 4 – injecting text...");
      // Note: injectText handles focus + click internally — no forceTrigger needed here
      const typed = await injectText(editor, content);
      if (!typed) throw new Error("Failed to type in editor");

      // Check for FB error after typing
      await sleep(180);
      if (detectFBError(dialog)) {
        log("⚠️ FB error after typing");
        await closeDialog(dialog);
        await sleep(rand(3000, 5000));
        if (retryCount < MAX_RETRIES) {
          clearTimeout(failTimer); finished = true;
          return postToGroup(content, comment, mediaFiles, retryCount + 1, postAsPage, postMode, expectedUrl);
        }
        throw new Error("Facebook rejects posting — try again later");
      }

      // ─── Step 4: Wait for post button ──────────────────────────
      log("Step 4b – waiting for post button...");
      await sleep(220);
      const postState = await waitForPostButton(dialog, POST_WAIT_MS);

      if (!postState.button) {
        // Extra attempt: Space+Backspace to wake React
        log("Post button disabled — trying Space+Backspace activation...");
        const ed2 = findEditor(dialog) || editor;
        if (ed2) {
          placeCaretAtEnd(ed2);
          try { document.execCommand("insertText", false, " "); } catch (_) {}
          ed2.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:" "}));
          await sleep(60);
          try { document.execCommand("delete", false, null); } catch (_) {}
          ed2.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));
          await sleep(120);
        }
        const postState2 = await waitForPostButton(dialog, 8000);
        if (!postState2.button) throw new Error(postState2.reason || "Could not enable post button");
        postState.button = postState2.button;
      }

      // ─── Step 5: Click post button ─────────────────────────────
      log("Step 5 – clicking post button...");
      let dialogGone = false;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const btn = findPostButton(dialog, { includeDisabled: false }) || postState.button;
        if (!btn || !document.contains(btn)) { log("Post button disappeared"); break; }

        log(`Step 5 – attempt ${attempt}...`, attrText(btn).slice(0,30));

        await forceTrigger(btn, { waitAfter: rand(160, 240) });
        try { btn.click(); } catch (_) {}

        // Wait for dialog gone OR FB error
        const result = await Promise.race([
          waitForDialogGone(dialog, 8000).then(v => ({ gone: v, error: false })),
          new Promise(resolve => {
            const iv = setInterval(() => {
              if (detectFBError(dialog)) {
                clearInterval(iv);
                resolve({ gone: false, error: true });
              }
            }, 350);
            setTimeout(() => { clearInterval(iv); resolve({ gone: false, error: false }); }, 8000);
          })
        ]);

        if (result.error) {
          log("⚠️ FB error during posting");
          await closeDialog(dialog);
          await sleep(rand(3000, 5000));
          if (retryCount < MAX_RETRIES) {
            clearTimeout(failTimer); finished = true;
            return postToGroup(content, comment, mediaFiles, retryCount + 1, postAsPage, postMode, expectedUrl);
          }
          throw new Error("Facebook rejects posting after retries");
        }

        if (result.gone) { dialogGone = true; break; }
        await sleep(260);
      }

      if (!dialogGone) dialogGone = await waitForDialogGone(dialog, POST_GONE_MS);
      if (!dialogGone) {
        if (!isDialogGone(dialog)) {
          if (detectFBError(dialog)) {
            // ⑤ Close dialog on error instead of leaving it stuck
            await closeDialog(dialog);
            throw new Error("Facebook shows error — wait and retry");
          }
          // Close stuck dialog
          await closeDialog(dialog);
          throw new Error("Post button clicked but dialog didn't close");
        }
        dialogGone = true;
      }

      await sleep(POST_CONFIRM_MS);
      const postUrl = extractPostUrl();
      const pendingState = detectPendingApproval(document);
      if (pendingState.pending) {
        log("⏳ Post submitted for approval:", pendingState.message);
        finished = true;
        _postToGroupRunning = false;
        clearTimeout(failTimer);
        return { success: true, pending: true, postUrl: postUrl || null, error: pendingState.message };
      }
      log("✅ Posted successfully! URL:", postUrl);

      let commentResult = null;
      // حماية إضافية: لا تعليق إلا بنص غير فارغ بعد trim
      const commentToPost = (typeof comment === "string" && comment.trim()) ? comment.trim() : "";
      if (commentToPost) {
        await sleep(1500);
        commentResult = await postComment(commentToPost, postUrl);
        if (commentResult && !commentResult.success && !commentResult.skipped) {
          log("⚠️ Comment failed (post itself still succeeded):", commentResult.reason);
        }
      }

      finished = true;
      _postToGroupRunning = false;
      clearTimeout(failTimer);
      return { success: true, postUrl, commentResult };

    } catch (err) {
      finished = true;
      _postToGroupRunning = false;
      clearTimeout(failTimer);
      log("ERROR:", err.message);

      // ⑤ Always try to close dialog on error
      if (currentDialog && !isDialogGone(currentDialog)) {
        try { await closeDialog(currentDialog); } catch (_) {}
      }

      const offlineNow = (typeof navigator !== "undefined" && navigator.onLine === false);
      return { success: false, error: offlineNow ? "NETWORK_OFFLINE" : (err.message || "Unknown error") };
    }
  }

  // ─── PAGE SUPPORT — detect Facebook Page composer ───────────────
  function isPageUrl() {
    return /facebook\.com\/(pages\/[^/?#]+|[^/?#]+\?.*)?/i.test(location.href)
      && !/facebook\.com\/groups\//i.test(location.href);
  }

  function isPageOrGroupPage() {
    return isGroupPage() || /facebook\.com\/(pages\/|[^/?#]+\/posts|[^/?#]+\/?$)/i.test(location.href);
  }

  // ─── BLACKLIST — detect dead/banned groups ───────────────────────
  function detectDeadGroup() {
    const bodyText = (document.body ? document.body.innerText || "" : "").toLowerCase();
    const deadPhrases = [
      "you can't post in this group",
      "posting is turned off",
      "لا يمكنك النشر في هذه المجموعة",
      "تم إيقاف تشغيل النشر",
      "this group is no longer active",
      "this group is archived",
      "المجموعة مؤرشفة",
      "هذه المجموعة لم تعد نشطة",
      "you've been blocked",
      "لقد تم حظرك",
      "you can't use this feature",
      "لا يمكنك استخدام هذه الميزة",
      "temporarily blocked",
      "محظور مؤقتاً",
      // FIX v90: additional phrases seen on restricted groups
      "you don't have permission to post",
      "only admins can post",
      "لا يمكن لأي شخص النشر في هذه المجموعة",
      "يمكن للمسؤولين فقط النشر",
      "posting has been turned off",
      "posting is disabled"
    ];
    return deadPhrases.some(function(p) { return bodyText.includes(p); });
  }


    // ─── EARLY SKIP: detect EXISTING pending/rejected posts BEFORE posting ────────
    // Called at the start of postToGroup — if 2 أو أكتر من منشوراتنا السابقة لسه
    // معلّقة/مرفوضة في هذه المجموعة، اعتبرها مجموعة "ممنوعة فعليًا" واتخطاها
    // فورًا من غير حتى فتح نافذة النشر. منشور معلّق واحد بس ممكن يكون طبيعي
    // (جروبات كتير بتراجع كل بوست يدويًا لكل الأعضاء، مش بالضرورة بترفضك أنت)،
    // فمش بنحكم على المجموعة كلها من مثال واحد بس.
    function detectExistingPendingOrRejected() {
      // Phrases that appear when a previous post is still in pending review state
      const pendingPhrases = [
        "your post is pending", "post is pending", "pending admin approval",
        "submitted for approval", "awaiting approval", "your post was submitted",
        "ينتظر موافقة", "بانتظار الموافقة", "قيد المراجعة", "قيد الموافقة",
        "تم إرسال منشورك للمراجعة", "منشورك ينتظر", "منشور معلق",
        "sent for approval", "review by admins"
      ];

      // Phrases that appear when a post was explicitly rejected/declined
      const rejectedPhrases = [
        "post was declined", "post was rejected", "your post was declined",
        "post has been declined", "post has been rejected",
        "تم رفض منشورك", "رُفض منشورك", "تم رفض المنشور",
        "declined by admin", "not approved by admin"
      ];

      const MIN_COUNT_TO_SKIP = 2;

      // ── عدّ حقيقي: كل منشور (article) لوحده، مش نص الصفحة ككتلة واحدة ──
      // ده بيمنع سيناريو "منشور واحد قديم لسه معلّق" إنه يتسبب في حظر
      // مجموعة سليمة، وبيضمن إننا بنعتمد على عدد فعلي لعناصر منفصلة.
      // الحد الأقصى 40 منشور — كافي جدًا لتحديد حالة المجموعة، ويمنع
      // بطء التنفيذ في الجروبات الكبيرة اللي فيها فييد طويل محمّل بالفعل.
      const MAX_ARTICLES_TO_SCAN = 40;
      const articles = Array.from(document.querySelectorAll('[role="article"]')).slice(0, MAX_ARTICLES_TO_SCAN);
      let pendingCount = 0, rejectedCount = 0;
      const scanScope = articles.length ? articles : [document.body].filter(Boolean);

      for (const el of scanScope) {
        const t = ((el.innerText || el.textContent || "") + "").toLowerCase();
        if (!t) continue;
        if (rejectedPhrases.some(p => t.includes(p))) rejectedCount++;
        else if (pendingPhrases.some(p => t.includes(p))) pendingCount++;
      }

      // Fallback: لو مفيش عناصر article ظهرت (فيسبوك غيّر البنية)، ارجع لفحص
      // نص الصفحة كله كإشارة وحيدة بس ماينفعش نعدّها كـ"عدد فعلي" أكتر من 1
      if (!articles.length) {
        const bodyTxt = (document.body ? (document.body.innerText || document.body.textContent || "") : "").toLowerCase();
        const hasNotifPending = Array.from(document.querySelectorAll('[role="status"],[role="alert"],div[data-pagelet]'))
          .some(el => {
            const t = (el.innerText || el.textContent || "").toLowerCase();
            return pendingPhrases.some(p => t.includes(p)) || rejectedPhrases.some(p => t.includes(p));
          });
        if (rejectedPhrases.some(p => bodyTxt.includes(p))) rejectedCount = Math.max(rejectedCount, 1);
        else if (pendingPhrases.some(p => bodyTxt.includes(p)) || hasNotifPending) pendingCount = Math.max(pendingCount, 1);
      }

      const totalFlagged = pendingCount + rejectedCount;
      if (totalFlagged < MIN_COUNT_TO_SKIP) {
        return { found: false, pendingCount, rejectedCount };
      }

      if (rejectedCount >= pendingCount) {
        return { found: true, type: "rejected", pendingCount, rejectedCount,
          message: `⛔ تخطي فوري — ${totalFlagged} منشورات سابقة مرفوضة/معلّقة في هذه المجموعة` };
      }
      return { found: true, type: "pending", pendingCount, rejectedCount,
        message: `⏭️ تخطي فوري — ${totalFlagged} منشورات سابقة لا تزال معلّقة بانتظار الموافقة` };
    }

  
  function detectPendingApproval(scope) {
    const txt = String((scope && (scope.innerText || scope.textContent)) || (document.body && (document.body.innerText || document.body.textContent)) || "").toLowerCase();
    const phrases = [
      "pending admin approval",
      "post is pending",
      "your post is pending",
      "submitted for approval",
      "sent for approval",
      "your post was submitted",
      "awaiting approval",
      "review by admins",
      "post awaiting approval",
      "معلق",
      "قيد المراجعة",
      "قيد الموافقة",
      "بانتظار الموافقة",
      "تم إرسال منشورك للمراجعة",
      "تم إرسال منشورك للموافقة",
      "ينتظر موافقة المشرف",
      "ينتظر موافقة المسؤولين",
      "تتم مراجعة منشورك"
    ];
    const matched = phrases.find(function(p) { return txt.includes(p); });
    if (!matched) return { pending: false, message: "" };
    return {
      pending: true,
      message: /معلق|مراجعة|موافقة/.test(matched)
        ? "المنشور قيد مراجعة المشرفين"
        : "Post is pending admin approval"
    };
  }


  function setNativeValue(el, value) {
    if (!el) return;
    try {
      if (el.isContentEditable) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, value);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (_) {}
  }

  function findReplyButtonNear(node) {
    const RX = /(^reply$|^رد$|write a reply|اكتب رد|رد)/i;
    return Array.from((node || document).querySelectorAll('[role="button"],button')).find(el => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
      return RX.test(t);
    }) || null;
  }

  function findReplyEditorNearNode(node) {
    const localRoot = node?.closest('[role="article"],li,div,section') || node || document;
    const local = Array.from(localRoot.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea,input')).find(el => isVisible(el) && !isCommentElement(el));
    if (local) return local;
    return Array.from(document.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea,input')).find(el => {
      if (!isVisible(el) || isCommentElement(el)) return false;
      const t = attrText(el) + ' ' + collectContextText(el, 3);
      return /reply|رد|write a reply|اكتب رد/i.test(t);
    }) || null;
  }

  function findSendButtonNearBox(box) {
    const root = box?.closest('[role="form"],li,div,section,[role="article"]') || document;
    return Array.from(root.querySelectorAll('[role="button"],button')).find(el => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      return /(^reply$|^رد$|send|إرسال|comment|تعليق|post)/i.test(t);
    }) || null;
  }

  async function bulkReplyToCurrentPost(replyText, targetNames, targetProfiles, delayMs) {
    const interReplyDelay = Math.max(500, Number(delayMs) || 1400);
    const wantedNames = new Set((targetNames || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean));
    const wantedProfiles = new Set((targetProfiles || []).map(x => String(x || '').trim().toLowerCase().replace(/[?#].*$/, '')).filter(Boolean));
    const replied = [];
    const failed = [];
    const skipped = [];
    const seen = new Set();
    const done = new Set();
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function normalizeProfile(u) { return String(u || '').trim().toLowerCase().replace(/[?#].*$/, ''); }
    function collectCandidateNodes() {
      return Array.from(document.querySelectorAll('[role="article"], ul li, div')).filter(node => {
        const text = clean(node.innerText || '');
        if (!text || text.length < 3) return false;
        const btn = findReplyButtonNear(node);
        if (!btn) return false;
        const profile = node.querySelector('a[href*="facebook.com/"]:not([href*="/groups/"]):not([href*="/posts/"]):not([href*="comment_id="])');
        const name = clean(profile?.innerText || '').split("\n")[0];
        const profileUrl = normalizeProfile(profile?.href || '');
        if (!name) return false;
        if (wantedNames.size && !wantedNames.has(name.toLowerCase()) && !(profileUrl && wantedProfiles.has(profileUrl))) return false;
        const key = `${name}__${text.slice(0,60)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    for (let round = 0; round < 14; round++) {
      const nodes = collectCandidateNodes();
      for (const node of nodes) {
        const profile = node.querySelector('a[href*="facebook.com/"]:not([href*="/groups/"]):not([href*="/posts/"]):not([href*="comment_id="])');
        const name = clean(profile?.innerText || '').split("\n")[0];
        const profileUrl = normalizeProfile(profile?.href || '');
        const doneKey = profileUrl || name.toLowerCase();
        if (!doneKey || done.has(doneKey)) continue;
        try {
          const btn = findReplyButtonNear(node);
          if (!btn) {
            skipped.push({ name, error: 'Reply button not found' });
            done.add(doneKey);
            continue;
          }
          try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
          await forceTrigger(btn, { waitAfter: rand(450, 700) });
          await sleep(rand(650, 1100));
          const box = findReplyEditorNearNode(node);
          if (!box) throw new Error('Reply editor not found');
          setNativeValue(box, replyText);
          await sleep(rand(450, 750));
          const sendBtn = findSendButtonNearBox(box);
          if (sendBtn) await forceTrigger(sendBtn, { waitAfter: rand(280, 520) });
          else {
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
            box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
          }
          done.add(doneKey);
          replied.push({ name, profileUrl, success: true });
          await sleep(interReplyDelay + rand(-200, 400));
        } catch (err) {
          done.add(doneKey);
          failed.push({ name, profileUrl, error: err && err.message ? err.message : String(err) });
          await sleep(rand(600, 1000));
        }
      }
      window.scrollBy({ top: window.innerHeight * 1.1, behavior: 'smooth' });
      await sleep(rand(1000, 1500));
    }
    return { success: true, repliedCount: replied.length, failedCount: failed.length, skippedCount: skipped.length, replied, failed, skipped };
  }

  function findMessageActionButton() {
    const quickSelectors = [
      'a[href*="/messages/t/"]',
      'a[href*="messenger.com/t/"]',
      'a[href*="/messages/"]',
      '[aria-label*="Message"]',
      '[aria-label*="message"]',
      '[aria-label*="رسالة"]',
      '[title*="Message"]',
      '[title*="رسالة"]'
    ];
    for (const sel of quickSelectors) {
      const hit = Array.from(document.querySelectorAll(sel)).find(el => isVisible(el));
      if (hit) return hit;
    }
    const candidates = Array.from(document.querySelectorAll('[role="button"],button,a[role="button"],a,div[role="button"],span[role="button"]'));
    const scored = candidates.map(el => {
      if (!isVisible(el)) return null;
      const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      const href = el.getAttribute('href') || '';
      let score = 0;
      if (/^message$|^رسالة$|^مراسلة$|send message|contact now|تواصل الآن|ابعت رسالة/i.test(t)) score += 5;
      if (/(message|رسالة|مراسلة|messenger|send message|contact)/i.test(t)) score += 2;
      if (/\/messages\/t\//i.test(href)) score += 4;
      if ((el.getAttribute('aria-haspopup') || '') === 'dialog') score += 1;
      return score ? { el, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }

  function findMessageEditorBox() {
    const candidates = Array.from(document.querySelectorAll('[role="textbox"],[contenteditable="true"],textarea,input'));
    const scored = candidates.map(el => {
      if (!isVisible(el)) return null;
      const t = (attrText(el) + ' ' + collectContextText(el, 5) + ' ' + (el.className || '') + ' ' + (el.id || '')).trim();
      let score = 0;
      if (/(message|رسالة|اكتب رسالة|messenger|send message|write a message)/i.test(t)) score += 4;
      if (/composer|draftjs|lexical|notranslate/i.test(t)) score += 2;
      if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') score += 1;
      return score ? { el, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }

  function findSendButtonForMessageBox(box) {
    const root = box?.closest('[role="dialog"],[role="main"],form,section,div') || document;
    const candidates = Array.from(root.querySelectorAll('[role="button"],button,div[role="button"],span[role="button"]'));
    const scored = candidates.map(el => {
      if (!isVisible(el)) return null;
      const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      let score = 0;
      if (/^send$|إرسال|ارسال|send message|send now/i.test(t)) score += 5;
      if (/(send|إرسال|ارسال)/i.test(t)) score += 2;
      if (/paper-airplane|send/i.test((el.className || '') + ' ' + (el.getAttribute('data-testid') || ''))) score += 1;
      return score ? { el, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }

  async function sendPrivateMessageInProfile(messageText) {
    let lastError = 'Message button not found';
    for (let attempt = 0; attempt < 3; attempt++) {
      let btn = findMessageActionButton();
      if (!btn && attempt > 0) {
        try { window.scrollTo({ top: document.body.scrollHeight * Math.min(0.75, 0.25 * (attempt + 1)), behavior: 'smooth' }); } catch (_) {}
        await sleep(700);
        btn = findMessageActionButton();
      }
      if (btn) {
        try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
        await forceTrigger(btn, { waitAfter: rand(900, 1300) });
      }
      let box = null;
      for (let i = 0; i < 10; i++) {
        await sleep(550 + (attempt * 120));
        box = findMessageEditorBox();
        if (box) break;
        if (!btn && i === 3) {
          btn = findMessageActionButton();
          if (btn) {
            try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
            await forceTrigger(btn, { waitAfter: rand(800, 1200) });
          }
        }
      }
      if (!box) {
        lastError = 'Message editor not found';
        continue;
      }
      try { box.focus(); } catch (_) {}
      try { setNativeValue(box, ''); await sleep(120); } catch (_) {}
      setNativeValue(box, messageText);
      await sleep(rand(550, 900));
      const sendBtn = findSendButtonForMessageBox(box);
      if (sendBtn) await forceTrigger(sendBtn, { waitAfter: rand(350, 550) });
      else {
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      }
      await sleep(1000);
      const leftover = String(box.innerText || box.value || '').trim();
      if (!leftover || leftover !== String(messageText || '').trim()) return { success: true, attempt: attempt + 1 };
      lastError = 'Message may not have been sent';
    }
    return { success: false, error: lastError };
  }

  // ─── MESSAGE LISTENER ───────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "POST_TO_GROUP") {
      if (_postToGroupRunning) {
        log("POST_TO_GROUP: duplicate message blocked — already posting");
        sendResponse({ success: false, error: "Already posting" });
        return true;
      }

      // ── Check for dead/banned group BEFORE attempting to post ──
      if (detectDeadGroup()) {
        log("Dead/banned group detected — skipping and blacklisting");
        sendResponse({ success: false, error: "DEAD_GROUP", dead: true });
        return true;
      }

      const mediaFiles = msg.payload?.mediaFiles?.length
        ? msg.payload.mediaFiles
        : (msg.payload.imageData
            ? [{ dataUrl: msg.payload.imageData, name: "photo.jpg", type: "image/jpeg" }]
            : []);
      postToGroup(msg.payload.content, msg.payload.comment || "", mediaFiles, 0, msg.payload.postAsPage || "", msg.payload.postMode || "account", msg.payload.expectedUrl || "")
        .then(function(result) {
          // FIX v90: If the post ended up in pending-approval state, mark it
          // as dead=true so background.js adds this group to the blacklist.
          // Groups that always queue posts for admin review are effectively
          // no-post groups — there is no point visiting them again.
          if (result && result.pending) {
            result.dead = true;
          }
          sendResponse(result);
          signalBg(result);
        });
      return true;
    }
    if (msg.action === "GET_GROUPS") {
      getGroupList().then(groups => sendResponse({ groups }));
      return true;
    }
    if (msg.action === "PING") {
      sendResponse({
        alive: true,
        hidden: typeof document !== "undefined" ? !!document.hidden : false,
        href: location.href
      });
      return true;
    }
    if (msg.action === "CHECK_DEAD") {
      sendResponse({ dead: detectDeadGroup() });
      return true;
    }
    if (msg.action === "BULK_REPLY_TO_CURRENT_POST") {
      bulkReplyToCurrentPost(msg.payload?.replyText || '', msg.payload?.targetNames || [], msg.payload?.targetProfiles || [], msg.payload?.delayMs || 1400).then(sendResponse);
      return true;
    }
    if (msg.action === "SEND_PRIVATE_MESSAGE_IN_PROFILE") {
      sendPrivateMessageInProfile(msg.payload?.messageText || '').then(sendResponse);
      return true;
    }
  });
})();
