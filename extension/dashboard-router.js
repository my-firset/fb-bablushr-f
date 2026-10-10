/* ════════════════════════════════════════════════════════════════════
   DASHBOARD TOP-LEVEL TAB ROUTER — fb Bablushr F  v16.3.0
   IIFE-scoped — never touches global scope.
   FIX v16.3: Discover tab content guaranteed visible on EVERY visit.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var TAB_MAP = {
    home:       'tab-home',
    discover:   'tab-tool1',
    campaigns:  'tab-tool2',
    schedule:   'tab-schedule',
    analytics:  'tab-analytics',
    abtest:     'tab-abtest',
    profiles:   'tab-profiles',
    referral:   'tab-referral',
    bestgroups: 'tab-bestgroups',
    webhook:    'tab-webhook',
    pricing:    'tab-pricing-page'
  };
  var TOP_PANEL_IDS = ['tab-home','tab-tool1','tab-tool2','tab-schedule','tab-analytics','tab-abtest','tab-profiles','tab-referral','tab-bestgroups','tab-webhook','tab-pricing-page'];
  var TOP_BTN_IDS   = ['btn-tab-home','btn-tab-tool1','btn-tab-tool2','btn-tab-schedule','btn-tab-analytics','btn-tab-abtest','btn-tab-profiles','btn-tab-referral','btn-tab-bestgroups','btn-tab-webhook','btn-tab-pricing-page'];

  /* ── Core fix: guarantee discover inner section is always visible ── */
  function ensureDiscoverVisible() {
    var discoverSection = document.getElementById('tab-discover');
    if (!discoverSection) return;
    discoverSection.classList.add('active');
    discoverSection.style.setProperty('display', 'block', 'important');
    discoverSection.style.setProperty('visibility', 'visible', 'important');
    discoverSection.style.setProperty('opacity', '1', 'important');
  }

  function showTopPanel(panelId) {
    TOP_PANEL_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    TOP_BTN_IDS.forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.classList.remove('active');
    });
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.add('active');
    var activeBtn = document.getElementById('btn-' + panelId);
    if (activeBtn) activeBtn.classList.add('active');

    /* ─── DISCOVER TAB FIX ─────────────────────────────────────────
       Every time #tab-tool1 is shown, force #tab-discover visible.
       This counters dashboard.js switchTab() which strips .active
       from ALL .tab-panel globally when switching sub-tabs.
       Three timing layers = bulletproof across all browsers/Kiwi.
       ────────────────────────────────────────────────────────────── */
    if (panelId === 'tab-tool1') {
      ensureDiscoverVisible();
      requestAnimationFrame(ensureDiscoverVisible);
      setTimeout(ensureDiscoverVisible, 80);
      setTimeout(ensureDiscoverVisible, 250);
    }

    /* Auto-activate first sub-tab when switching to Campaigns */
    if (panelId === 'tab-tool2' && panel) {
      var firstSub = panel.querySelector('.nav-btn[data-tab="campaign"]');
      if (firstSub && !panel.querySelector('.nav-btn.active')) {
        firstSub.click();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {

    /* ── Wire top-level nav buttons (.d-tab[data-dash]) ── */
    document.querySelectorAll('.d-tab[data-dash]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = TAB_MAP[this.getAttribute('data-dash')];
        if (id) showTopPanel(id);
      });
      btn.addEventListener('touchend', function (e) {
        e.preventDefault();
        var id = TAB_MAP[this.getAttribute('data-dash')];
        if (id) showTopPanel(id);
      }, { passive: false });
    });

    /* ── Quick-action buttons ── */
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t) return;
      var act = t.getAttribute('data-action');
      var target;
      if (act === 'open-facebook')  target = document.getElementById('openFacebookBtn');
      else if (act === 'open-popup') target = document.getElementById('openPopupBtn');
      else if (act === 'stop-now')   target = document.getElementById('stopNowBtn');
      if (target) target.click();
    });

    /* ── Show home on first load ── */
    showTopPanel('tab-home');

    /* ── MutationObserver backup guard: watches #tab-tool1 for
       class changes; re-shows #tab-discover instantly whenever
       the outer panel becomes active. ── */
    var outerPanel = document.getElementById('tab-tool1');
    if (outerPanel) {
      new MutationObserver(function () {
        if (outerPanel.classList.contains('active')) {
          ensureDiscoverVisible();
          requestAnimationFrame(ensureDiscoverVisible);
        }
      }).observe(outerPanel, { attributes: true, attributeFilter: ['class'] });
    }
  });
}());
