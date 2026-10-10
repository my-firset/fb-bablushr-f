const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let latestDiscover = [];
let latestExcludedDiscover = [];
let lastJoinSummary = { joinedCount: 0, joinedGroups: [] };
let discoverStatusPoller = 0;
let mediaFiles = [];
let extractedComments = [];
let rawExtractedComments = [];
let savedReplyTemplates = [];
let interactionLogs = [];
let favoriteCommenters = [];
let doNotReplyList = [];
let _bulkTotal = 0;
let _bulkDone = 0;
let _sessionStats = { replies: 0, pms: 0, success: 0, fail: 0 };
let lastBulkReport = null;

async function storageGet(keys = null) {
  return chrome.storage.local.get(keys);
}
async function storageSet(obj) {
  return chrome.storage.local.set(obj);
}
function toast(msg) {
  const el = $('#dashToast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function splitCsvText(value) {
  return String(value || '').split(/[،,]/).map(x => x.trim().toLowerCase()).filter(Boolean);
}
function dedupeGroupsByUrl(groups) {
  const map = new Map();
  (groups || []).forEach(group => {
    const raw = String(group?.url || '').trim();
    const m = raw.match(/facebook\.com\/groups\/([^/?#]+)/i);
    const url = m && m[1] ? `https://www.facebook.com/groups/${m[1]}/` : raw.replace(/[?#].*$/, '').replace(/\/+$/, '') + (raw ? '/' : '');
    if (!url || map.has(url)) return;
    map.set(url, { ...group, url });
  });
  return Array.from(map.values());
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
}
function commentKey(item) {
  return normalizeKey(item?.profileUrl || item?.profileId || item?.name || item?.commentUrl || '');
}
function uniqueByKey(list, keyFn) {
  const out = [];
  const seen = new Set();
  (list || []).forEach(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

// ── Patch 5: progress bar helpers ──
function bulkProgressStart(total) {
  _bulkTotal = total; _bulkDone = 0;
  const wrap = $('#bulkProgressWrap');
  if (wrap) { wrap.style.display = ''; setBulkProgress(0); }
}
function bulkProgressStep() {
  _bulkDone++;
  setBulkProgress(Math.round((_bulkDone / Math.max(1, _bulkTotal)) * 100));
}
function bulkProgressEnd() {
  setBulkProgress(100);
  setTimeout(() => { const w = $('#bulkProgressWrap'); if (w) w.style.display = 'none'; }, 1800);
}
function setBulkProgress(pct) {
  const bar = $('#bulkProgressBar');
  const lbl = $('#bulkProgressLabel');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = pct + '%';
}
function incSessionStat(kind, success) {
  if (kind.includes('رد')) _sessionStats.replies++;
  else if (kind.includes('رسالة') || kind.includes('رسائل')) _sessionStats.pms += (typeof success === 'number' ? success : 1);
  if (success === true) _sessionStats.success++;
  else if (success === false) _sessionStats.fail++;
  updateSessionStats();
}
function updateSessionStats() {
  const total = _sessionStats.success + _sessionStats.fail;
  const rate = total > 0 ? Math.round((_sessionStats.success / total) * 100) + '%' : '-';
  const rEl = $('#sessReplies'); const pEl = $('#sessPMs'); const rateEl = $('#sessRate');
  if (rEl) rEl.textContent = _sessionStats.replies;
  if (pEl) pEl.textContent = _sessionStats.pms;
  if (rateEl) rateEl.textContent = rate;
}
function currentSortMode() {
  return $('#commentSortSelect')?.value || 'favorite';
}
function advancedFilterOptions() {
  return {
    minLen: Math.max(0, Number($('#minCommentLengthInput')?.value || 0)),
    onlyProfiles: !!$('#onlyProfileComments')?.checked,
    onlyReplies: !!$('#onlyReplyThreads')?.checked,
    skipSpam: !!$('#skipSpamComments')?.checked,
    uniqueProfiles: !!$('#uniqueProfilesOnly')?.checked
  };
}
function detectSpamComment(item) {
  const blob = `${item?.name || ''} ${item?.text || ''}`.toLowerCase();
  if (!blob) return false;
  let score = 0;
  if ((blob.match(/https?:\/\//g) || []).length) score += 2;
  if (/(wa\.me|whatsapp|telegram|t\.me|تلجرام|واتساب|انبوكس|inbox|dm|رقمي|اتصل|call me)/i.test(blob)) score += 2;
  if (/(\+?\d[\d\s\-()]{7,})/.test(blob)) score += 2;
  if ((blob.match(/[!?.،]/g) || []).length > 8) score += 1;
  const meaningful = blob.replace(/[^a-z0-9؀-ۿ]/gi, '');
  if (blob.length > 20 && meaningful.length / Math.max(1, blob.length) < 0.4) score += 1;
  return score >= 3;
}
function normalizeBulkReportItems(res = {}, mode = '') {
  const items = [];
  (res.replied || []).forEach(item => items.push({ mode, status: 'success', name: item.name || '', profileUrl: item.profileUrl || '', error: '', note: item.commentUrl || '' }));
  (res.failed || []).forEach(item => items.push({ mode, status: 'failed', name: item.name || '', profileUrl: item.profileUrl || '', error: item.error || '', note: item.commentUrl || '' }));
  (res.skipped || []).forEach(item => items.push({ mode, status: 'skipped', name: item.name || '', profileUrl: item.profileUrl || '', error: item.reason || item.error || '', note: item.commentUrl || '' }));
  (res.details || []).forEach(item => items.push({ mode, status: item.success ? 'success' : 'failed', name: item.name || '', profileUrl: item.profileUrl || '', error: item.error || '', note: item.usedProfileUrl || '' }));
  return items;
}
function buildBulkReportCsv(report) {
  const header = ['type','status','name','profileUrl','error','note','at'];
  const lines = [header.join(',')];
  (report?.items || []).forEach(item => {
    lines.push([
      report?.type || '',
      item.status || '',
      item.name || '',
      item.profileUrl || '',
      item.error || '',
      item.note || '',
      report?.at ? new Date(report.at).toISOString() : ''
    ].map(csvCell).join(','));
  });
  return lines.join('\\n');
}
async function setLastBulkReport(report) {
  lastBulkReport = report ? { ...report, at: report.at || Date.now() } : null;
  await storageSet({ lastBulkReport });
  renderLastBulkReport();
}
function renderLastBulkReport() {
  const box = $('#bulkReportBox');
  if (!box) return;
  if (!lastBulkReport || !lastBulkReport.type) {
    box.innerHTML = 'لا يوجد تقرير جماعي محفوظ حتى الآن.';
    return;
  }
  const t = lastBulkReport.totals || {};
  const preview = (lastBulkReport.items || []).slice(0, 6).map(item => {
    const cls = item.status === 'success' ? 'ok' : item.status === 'failed' ? 'fail' : 'skip';
    const label = item.status === 'success' ? 'نجاح' : item.status === 'failed' ? 'فشل' : 'تخطي';
    return `<div class="report-item"><div><strong>${esc(item.name || 'بدون اسم')}</strong><div class="row-meta">${esc(item.profileUrl || item.note || '')}</div>${item.error ? `<div class="row-meta" style="color:#fca5a5">${esc(item.error)}</div>` : ''}</div><div class="state ${cls}">${label}</div></div>`;
  }).join('') || '<div class="note">لا توجد تفاصيل عناصر محفوظة.</div>';
  box.innerHTML = `
    <div class="report-grid">
      <div class="report-stat"><strong>${t.attempted || 0}</strong><span>المستهدف</span></div>
      <div class="report-stat"><strong>${t.success || 0}</strong><span>نجاح</span></div>
      <div class="report-stat"><strong>${t.failed || 0}</strong><span>فشل</span></div>
      <div class="report-stat"><strong>${t.skipped || 0}</strong><span>تخطي</span></div>
    </div>
    <div class="row-meta" style="margin-bottom:10px">${esc(lastBulkReport.title || lastBulkReport.type)} • ${new Date(lastBulkReport.at).toLocaleString('ar-EG')}</div>
    <div class="report-items">${preview}</div>`;
}
function exportLastBulkReportJson() {
  if (!lastBulkReport) return toast('لا يوجد تقرير محفوظ');
  downloadTextFile('fb-last-bulk-report.json', JSON.stringify(lastBulkReport, null, 2), 'application/json');
}
function exportLastBulkReportCsv() {
  if (!lastBulkReport) return toast('لا يوجد تقرير محفوظ');
  downloadTextFile('fb-last-bulk-report.csv', buildBulkReportCsv(lastBulkReport), 'text/csv;charset=utf-8');
}
function bulkDelaySec() {
  return Math.max(0.5, Number($('#bulkDelayInput')?.value || 2)) * 1000;
}
function bulkMax() {
  return Math.max(1, Number($('#bulkMaxInput')?.value || 50));
}

// ── Patch 5: export interaction log ──
function exportLogJson() {
  downloadTextFile('fb-interaction-log.json', JSON.stringify(interactionLogs, null, 2), 'application/json');
}
function exportLogCsv() {
  const header = ['kind','name','success','message','error','durationMs','at'];
  const lines = [header.join(',')];
  interactionLogs.forEach(item => {
    lines.push([item.kind||'', item.name||'', item.success?'yes':'no', item.message||'', item.error||'', item.durationMs||0, item.at ? new Date(item.at).toISOString() : ''].map(csvCell).join(','));
  });
  downloadTextFile('fb-interaction-log.csv', lines.join('\n'), 'text/csv;charset=utf-8');
}
async function clearInteractionLog() {
  if (!confirm('هل تريد مسح سجل الردود والرسائل بالكامل؟')) return;
  interactionLogs = [];
  await storageSet({ interactionLogs: [] });
  renderInteractionLogs();
  toast('تم مسح السجل');
}

// ── Patch 5: paste clipboard names into lists ──
async function pasteNamesToFavorites() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (_) { text = prompt('الصق الأسماء (مفصولة بسطر جديد أو فاصلة):') || ''; }
  const names = text.split(/[\n,،]/).map(x => x.trim()).filter(x => x.length > 1);
  if (!names.length) return toast('لم يتم العثور على أسماء');
  names.forEach(name => {
    const key = normalizeKey(name);
    if (!key || favoriteCommenters.find(x => x.key === key)) return;
    favoriteCommenters.unshift({ key, name, profileUrl: '', profileId: '', at: Date.now() });
  });
  favoriteCommenters = uniqueByKey(favoriteCommenters, x => x.key).slice(0, 200);
  await persistCommentLists();
  renderFavoriteLists();
  toast('تم إضافة ' + names.length + ' اسم للمفضلة');
}
async function pasteNamesToDNR() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (_) { text = prompt('الصق الأسماء (مفصولة بسطر جديد أو فاصلة):') || ''; }
  const names = text.split(/[\n,،]/).map(x => x.trim()).filter(x => x.length > 1);
  if (!names.length) return toast('لم يتم العثور على أسماء');
  names.forEach(name => {
    const key = normalizeKey(name);
    if (!key || doNotReplyList.find(x => x.key === key)) return;
    doNotReplyList.unshift({ key, name, profileUrl: '', profileId: '', at: Date.now() });
  });
  doNotReplyList = uniqueByKey(doNotReplyList, x => x.key).slice(0, 200);
  await persistCommentLists();
  applyCommentFilters();
  renderFavoriteLists();
  toast('تم إضافة ' + names.length + ' اسم لقائمة عدم الرد');
}

// ── Patch 5: render quick fill bar ──
function renderQuickFill() {
  const bar = $('#quickFillBar');
  if (!bar) return;
  if (!savedReplyTemplates.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = savedReplyTemplates.slice(0, 8).map((t, i) => `<button class="qf-chip" data-idx="${i}">${esc(t.type || 'عام')}: ${esc((t.text || '').slice(0, 30))}...</button>`).join('');
  $$('.qf-chip').forEach(btn => btn.onclick = () => {
    const item = savedReplyTemplates[Number(btn.dataset.idx)];
    if (!item) return;
    $('#replyTemplateInput').value = item.text || '';
    $('#privateMessageInput').value = item.text || '';
    if ($('#replyTemplateType')) $('#replyTemplateType').value = item.type || 'عام';
    toast('تم تحميل القالب السريع');
  });
}

function downloadTextFile(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
  return `"${text}"`;
}
function buildCommentsCsv(items) {
  const header = ['name','profileId','profileUrl','commentUrl','replyCount','favorite','blocked','text'];
  const lines = [header.join(',')];
  (items || []).forEach(item => {
    lines.push([
      item.name || '',
      item.profileId || '',
      item.profileUrl || '',
      item.commentUrl || '',
      item.replyCount || 0,
      isFavorite(item) ? 'yes' : 'no',
      isDoNotReply(item) ? 'yes' : 'no',
      item.text || ''
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}
function isFavorite(item) {
  const key = commentKey(item);
  return !!favoriteCommenters.find(x => x.key === key);
}
function isDoNotReply(item) {
  const key = commentKey(item);
  return !!doNotReplyList.find(x => x.key === key);
}
async function persistCommentLists() {
  await storageSet({ favoriteCommenters, doNotReplyList });
}
function updateCompetitorSummary(prefix = '') {
  const rawCount = rawExtractedComments.length;
  const visibleCount = extractedComments.length;
  const favoriteCount = extractedComments.filter(isFavorite).length;
  const blockedCount = doNotReplyList.length;
  const bits = [prefix || `تم تجهيز ${visibleCount} من أصل ${rawCount} تعليق/رد`];
  bits.push(`المفضلة: ${favoriteCount}`);
  bits.push(`عدم الرد: ${blockedCount}`);
  const el = $('#competitorSummary');
  if (el) el.innerHTML = bits.join(' • ');
}
async function toggleFavoriteByIndex(idx) {
  const item = extractedComments[idx];
  if (!item) return;
  const key = commentKey(item);
  if (!key) return toast('تعذر تحديد المعلق');
  const hit = favoriteCommenters.find(x => x.key === key);
  favoriteCommenters = hit
    ? favoriteCommenters.filter(x => x.key !== key)
    : [{ key, name: item.name || 'بدون اسم', profileUrl: item.profileUrl || '', profileId: item.profileId || '', at: Date.now() }, ...favoriteCommenters].slice(0, 200);
  favoriteCommenters = uniqueByKey(favoriteCommenters, x => x.key);
  await persistCommentLists();
  renderFavoriteLists();
  renderComments();
  updateCompetitorSummary();
}
async function addDoNotReplyByIndex(idx) {
  const item = extractedComments[idx];
  if (!item) return;
  const key = commentKey(item);
  if (!key) return toast('تعذر تحديد المعلق');
  if (!doNotReplyList.find(x => x.key === key)) {
    doNotReplyList.unshift({ key, name: item.name || 'بدون اسم', profileUrl: item.profileUrl || '', profileId: item.profileId || '', at: Date.now() });
    doNotReplyList = uniqueByKey(doNotReplyList, x => x.key).slice(0, 200);
    await persistCommentLists();
  }
  applyCommentFilters();
  renderFavoriteLists();
  toast('تمت إضافته لقائمة عدم الرد');
}
async function removeFavorite(key) {
  favoriteCommenters = favoriteCommenters.filter(x => x.key !== key);
  await persistCommentLists();
  renderFavoriteLists();
  renderComments();
  updateCompetitorSummary();
}
async function removeDoNotReply(key) {
  doNotReplyList = doNotReplyList.filter(x => x.key !== key);
  await persistCommentLists();
  applyCommentFilters();
  renderFavoriteLists();
  toast('تمت الإزالة من قائمة عدم الرد');
}
function renderFavoriteLists() {
  const favBox = $('#favoritesList');
  const blockBox = $('#doNotReplyList');
  if (favBox) {
    favBox.classList.add('compact-list');
    favBox.innerHTML = favoriteCommenters.length ? favoriteCommenters.map(item => `
      <div class="row-item">
        <div>
          <div class="row-title">${esc(item.name || 'بدون اسم')}</div>
          <div class="row-meta">${esc(item.profileId || item.profileUrl || '')}</div>
        </div>
        <button class="small-btn soft remove-favorite-btn" data-key="${esc(item.key)}">إزالة</button>
      </div>`).join('') : '<div class="note">لا توجد مفضلة بعد.</div>';
  }
  if (blockBox) {
    blockBox.classList.add('compact-list');
    blockBox.innerHTML = doNotReplyList.length ? doNotReplyList.map(item => `
      <div class="row-item">
        <div>
          <div class="row-title">${esc(item.name || 'بدون اسم')}</div>
          <div class="row-meta">${esc(item.profileId || item.profileUrl || '')}</div>
        </div>
        <button class="small-btn soft remove-block-btn" data-key="${esc(item.key)}">إزالة</button>
      </div>`).join('') : '<div class="note">لا يوجد مستبعدون حتى الآن.</div>';
  }
  $$('.remove-favorite-btn').forEach(btn => btn.onclick = () => removeFavorite(btn.dataset.key));
  $$('.remove-block-btn').forEach(btn => btn.onclick = () => removeDoNotReply(btn.dataset.key));
}

function applyCommentFilters() {
  const search = ($('#commentSearchInput')?.value || '').trim().toLowerCase();
  const excludedNames = splitCsvText($('#excludeNamesInput')?.value || '');
  const excludedKeywords = splitCsvText($('#excludeKeywordsInput')?.value || '');
  const opts = advancedFilterOptions();
  const seenProfiles = new Set();
  extractedComments = (rawExtractedComments || []).filter(item => {
    const blob = `${item.name || ''} ${item.text || ''}`.toLowerCase();
    const key = commentKey(item);
    const profileOnlyKey = normalizeKey(item.profileUrl || item.profileId || '');
    if (search && !blob.includes(search)) return false;
    if (excludedNames.some(x => (item.name || '').toLowerCase().includes(x))) return false;
    if (excludedKeywords.some(x => blob.includes(x))) return false;
    if (key && doNotReplyList.some(x => x.key === key)) return false;
    if (opts.minLen && String(item.text || '').trim().length < opts.minLen) return false;
    if (opts.onlyProfiles && !item.profileUrl) return false;
    if (opts.onlyReplies && Number(item.replyCount || 0) <= 0) return false;
    if (opts.skipSpam && detectSpamComment(item)) return false;
    if (opts.uniqueProfiles && profileOnlyKey) {
      if (seenProfiles.has(profileOnlyKey)) return false;
      seenProfiles.add(profileOnlyKey);
    }
    return true;
  });
  renderComments();
  renderFavoriteLists();
  updateCompetitorSummary();
}
async function appendInteractionLog(entry) {
  const data = await storageGet(['interactionLogs']);
  interactionLogs = data.interactionLogs || [];
  interactionLogs.unshift({ ...entry, at: Date.now() });
  interactionLogs = interactionLogs.slice(0, 200);
  await storageSet({ interactionLogs });
  renderInteractionLogs();
}
function renderInteractionLogs() {
  const box = $('#interactionLogsList');
  if (!box) return;
  box.innerHTML = interactionLogs.length ? interactionLogs.map((item, idx) => {
    const icon = item.success === true ? '✅' : item.success === false ? '❌' : '⏳';
    const dur = item.durationMs ? ` — ${(item.durationMs / 1000).toFixed(1)}ث` : '';
    return `
    <div class="row-item">
      <div style="flex:1">
        <div class="row-title ${item.success ? 'log-ok' : 'log-bad'}">${icon} ${esc(item.kind || 'عملية')} — ${esc(item.name || item.target || '')}</div>
        ${item.message ? `<div class="log-detail">✓ ${esc(item.message)}</div>` : ''}
        ${item.error ? `<div class="log-detail" style="color:#f87171">✗ ${esc(item.error)}</div>` : ''}
        <div class="log-duration">${new Date(item.at || Date.now()).toLocaleString('ar-EG')}${dur}</div>
      </div>
    </div>`;
  }).join('') : '<div class="note">لا يوجد سجل ردود أو رسائل بعد.</div>';
}
function toIntervalMs(value, unit) {
  const n = Math.max(1, Number(value) || 1);
  if (unit === 'hours') return n * 60 * 60 * 1000;
  if (unit === 'days') return n * 24 * 60 * 60 * 1000;
  return n * 60 * 1000;
}
function buildTemplateText() {
  const title = $('#tplTitle').value.trim();
  const price = $('#tplPrice').value.trim();
  const condition = $('#tplCondition').value.trim();
  const location = $('#tplLocation').value.trim();
  const body = $('#tplBody').value.trim();
  const phone = $('#tplPhone') ? $('#tplPhone').value.trim() : '';
  const features = $('#tplFeatures') ? $('#tplFeatures').value.trim() : '';
  const cta = $('#tplCTA') ? $('#tplCTA').value.trim() : '';
  const hashtags = $('#tplHashtags') ? $('#tplHashtags').value.trim() : '';
  const parts = [];
  if (title) parts.push(`📌 ${title}`);
  if (price) parts.push(`💰 السعر: ${price}`);
  if (condition) parts.push(`🧾 الحالة: ${condition}`);
  if (location) parts.push(`📍 الموقع: ${location}`);
  if (body) parts.push(body);
  if (features) parts.push('✨ المميزات:\n' + features.split(',').map(f => f.trim()).filter(Boolean).map(f => `✔️ ${f}`).join('\n'));
  if (phone) parts.push(`📞 للتواصل: ${phone}`);
  if (cta) parts.push(`👉 ${cta}`);
  if (hashtags) parts.push(hashtags.split(',').map(h => h.trim()).filter(Boolean).map(h => h.startsWith('#') ? h : '#' + h).join(' '));
  return parts.join('\n\n').trim();
}

/* ── Ready-made template presets for all industries ─────────────── */
const TEMPLATE_PRESETS = {
  realestate: {
    label: 'عقارات', title: 'شقة مميزة للبيع/الإيجار', price: '0 جنيه',
    condition: 'تشطيب سوبر لوكس', location: 'المدينة - الحي',
    body: 'وصف تفصيلي للوحدة: المساحة، عدد الغرف، الدور، الواجهة، التشطيب، والمرافق القريبة.',
    features: 'تشطيب فاخر, موقع مميز, قريب من الخدمات, تقسيط متاح',
    cta: 'احجز معاينتك الآن قبل نفاذ العرض', hashtags: 'عقارات, شقق_للبيع, عقار_مصر'
  },
  ecommerce: {
    label: 'منتجات / تجارة إلكترونية', title: 'اسم المنتج', price: '0 جنيه',
    condition: 'جديد - أصلي 100%', location: 'توصيل لكل المحافظات',
    body: 'وصف المنتج، الاستخدام، المقاسات أو الألوان المتاحة، وأي تفاصيل تهم العميل.',
    features: 'ضمان سنة, توصيل سريع, دفع عند الاستلام, جودة عالية',
    cta: 'اطلب الآن وقبل نفاذ الكمية', hashtags: 'تسوق, عروض, منتج_جديد'
  },
  services: {
    label: 'خدمات (صيانة/تصميم/استشارات)', title: 'اسم الخدمة المقدمة', price: 'حسب الطلب',
    condition: 'فريق محترف ومعتمد', location: 'نخدم كل المناطق',
    body: 'شرح للخدمة، آلية العمل، ولماذا نحن الخيار الأفضل لك.',
    features: 'خبرة +5 سنوات, ضمان على الخدمة, أسعار تنافسية, تنفيذ سريع',
    cta: 'احجز استشارتك المجانية الآن', hashtags: 'خدمات, احترافية, جودة'
  },
  jobs: {
    label: 'توظيف وفرص عمل', title: 'مطلوب: اسم الوظيفة', price: 'راتب يحدد بعد المقابلة',
    condition: 'دوام كامل / جزئي', location: 'مقر الشركة - المدينة',
    body: 'وصف الوظيفة، المهام الأساسية، والمؤهلات المطلوبة من المتقدم.',
    features: 'تأمين صحي, بيئة عمل محفزة, فرص ترقي, مكافآت أداء',
    cta: 'أرسل سيرتك الذاتية الآن', hashtags: 'وظائف, توظيف, فرصة_عمل'
  },
  restaurant: {
    label: 'مطاعم وكافيهات', title: 'اسم الوجبة / العرض', price: '0 جنيه',
    condition: 'طازج يوميًا', location: 'الفرع - العنوان',
    body: 'وصف الطبق أو العرض، المكونات، ولماذا يستحق التجربة.',
    features: 'مكونات طازجة, توصيل سريع, عروض يومية, طلب أونلاين',
    cta: 'اطلب الآن وتوصلك لحد الباب', hashtags: 'مطاعم, اكل, عروض_اليوم'
  },
  education: {
    label: 'تعليم ودورات تدريبية', title: 'اسم الدورة / الكورس', price: '0 جنيه',
    condition: 'أونلاين / حضوري', location: 'منصة الدورة أو مقر التدريب',
    body: 'محتوى الدورة، المحاور الأساسية، والفائدة التي سيحصل عليها المتدرب.',
    features: 'شهادة معتمدة, متابعة فردية, مجموعات تدريبية صغيرة, دعم مستمر',
    cta: 'سجّل الآن وابدأ رحلتك التعليمية', hashtags: 'تعليم, تدريب, تطوير_الذات'
  },
  beauty: {
    label: 'تجميل وعناية شخصية', title: 'اسم الخدمة / المنتج', price: '0 جنيه',
    condition: 'منتجات أصلية ومضمونة', location: 'الصالون - العنوان',
    body: 'وصف الخدمة أو المنتج وفوائده وكيف يحسّن مظهرك أو يعتني ببشرتك.',
    features: 'منتجات أصلية, خبرة متخصصة, نتائج مضمونة, أسعار مناسبة',
    cta: 'احجزي موعدك الآن', hashtags: 'تجميل, عناية_بالبشرة, ميكب'
  },
  automotive: {
    label: 'سيارات وقطع غيار', title: 'موديل السيارة / القطعة', price: '0 جنيه',
    condition: 'حالة ممتازة - فحص كامل', location: 'المدينة',
    body: 'تفاصيل السيارة: الموديل، السنة، الممشى، الحالة الفنية والهيكل.',
    features: 'فحص شامل, ضمان فحص, إمكانية المعاينة, تقسيط متاح',
    cta: 'تواصل الآن للمعاينة', hashtags: 'سيارات, سيارات_للبيع, قطع_غيار'
  }
};

function applyTemplatePreset(key) {
  const p = TEMPLATE_PRESETS[key];
  if (!p) return;
  if ($('#tplTitle')) $('#tplTitle').value = p.title;
  if ($('#tplPrice')) $('#tplPrice').value = p.price;
  if ($('#tplCondition')) $('#tplCondition').value = p.condition;
  if ($('#tplLocation')) $('#tplLocation').value = p.location;
  if ($('#tplBody')) $('#tplBody').value = p.body;
  if ($('#tplFeatures')) $('#tplFeatures').value = p.features;
  if ($('#tplCTA')) $('#tplCTA').value = p.cta;
  if ($('#tplHashtags')) $('#tplHashtags').value = p.hashtags;
  if ($('#tplCategory')) $('#tplCategory').value = p.label;
  toast('تم تحميل قالب: ' + p.label);
}

/* ── AI Template Generation ──────────────────────────────────────
   Reuses the same Groq API key the user already saved from the
   popup (shared chrome.storage.local). Falls back to a smart local
   generator (no API key needed) so the feature always works. ────── */
const AI_TEMPLATE_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const AI_TEMPLATE_HF = 'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-7B-Instruct';

function localTemplateFallback(idea, industry) {
  const p = TEMPLATE_PRESETS[industry] || null;
  const title = idea.length > 60 ? idea.slice(0, 60) + '…' : idea;
  return {
    title,
    price: p ? p.price : '0 جنيه',
    condition: p ? p.condition : 'جديد ومتاح الآن',
    location: p ? p.location : 'متاح لجميع المناطق',
    body: `${idea}\n\nفرصة لا تفوّت — تواصل معنا الآن لمعرفة كل التفاصيل والحصول على أفضل عرض متاح.`,
    features: p ? p.features : 'جودة عالية, خدمة سريعة, أسعار منافسة, ضمان رضا العميل',
    cta: p ? p.cta : 'تواصل الآن واحصل على عرضك الخاص',
    hashtags: p ? p.hashtags : 'عروض, جودة, فرصة'
  };
}

async function generateTemplateWithAI(idea, industry) {
  if (!idea || !idea.trim()) { toast('⚠️ اكتب فكرة المنشور أولاً'); return; }

  const btn = $('#aiGenerateTplBtn');
  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ جاري التوليد بالذكاء الاصطناعي…'; }

  try {
    const cfg = await storageGet(['apiKey', 'aiApiKey', 'geminiApiKey', 'hfApiKey', 'huggingfaceApiKey', 'aiProvider']);
    const provider = String(cfg.aiProvider || 'gemini').toLowerCase().includes('hugging') ? 'huggingface' : 'gemini';
    const apiKey = provider === 'huggingface'
      ? String(cfg.hfApiKey || cfg.huggingfaceApiKey || cfg.apiKey || '').trim()
      : String(cfg.geminiApiKey || cfg.apiKey || cfg.aiApiKey || '').trim();
    const industryLabel = (TEMPLATE_PRESETS[industry] && TEMPLATE_PRESETS[industry].label) || 'عام';

    let result;
    if (!apiKey) {
      result = localTemplateFallback(idea, industry);
      toast('✅ تم التوليد محليًا — أضف مفتاح Gemini أو HuggingFace من إعدادات الإضافة لتوليد أذكى');
    } else {
      // Prompt هندسي: خبير تسويق مصري + Spintax + JSON فقط
      const prompt =
        `أنت خبير تسويق رقمي مصري. بناءً على الفكرة: "${idea}" والمجال: "${industryLabel}"\n` +
        `أرجع JSON فقط (بدون markdown) بالمفاتيح:\n` +
        `{"title":"...","price":"...","condition":"...","location":"...","body":"وصف مع Spintax مثل {رائع|مميز}","features":"م1,م2,م3,م4","cta":"...","hashtags":"وسم1,وسم2,وسم3"}\n` +
        `نوّع الـ Hook والـ CTA. النبرة مناسبة للمجال.`;

      let resp;
      try {
        if (provider === 'huggingface') {
          resp = await fetch(AI_TEMPLATE_HF, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
            body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, temperature: 0.8, return_full_text: false } })
          });
        } else {
          const url = AI_TEMPLATE_GEMINI_BASE + 'gemini-1.5-flash:generateContent?key=' + encodeURIComponent(apiKey);
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.8, maxOutputTokens: 600 }
            })
          });
        }
      } catch (netErr) {
        toast('⚠️ تعذر الاتصال بالذكاء الاصطناعي — تم التوليد محليًا');
        result = localTemplateFallback(idea, industry);
        resp = null;
      }

      if (resp && !resp.ok) {
        if (resp.status === 429 || resp.status === 503) toast('⚠️ الحصة أو الموديل مشغول — تم التوليد محليًا');
        else toast('⚠️ تعذر الاتصال بالذكاء الاصطناعي — تم التوليد محليًا');
        result = localTemplateFallback(idea, industry);
      } else if (resp) {
        const data = await resp.json();
        let raw = '';
        if (provider === 'huggingface') {
          raw = (Array.isArray(data) && data[0] && data[0].generated_text) || data.generated_text || '';
        } else {
          const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
          raw = parts ? parts.map(pt => pt.text || '').join('\n') : '';
        }
        raw = String(raw).trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        // استخراج JSON من الرد إن وُجد نص حوله
        const jm = raw.match(/\{[\s\S]*\}/);
        if (jm) raw = jm[0];
        try {
          const parsed = JSON.parse(raw);
          result = {
            title: parsed.title || idea,
            price: parsed.price || '',
            condition: parsed.condition || '',
            location: parsed.location || '',
            body: parsed.body || '',
            features: parsed.features || '',
            cta: parsed.cta || '',
            hashtags: parsed.hashtags || ''
          };
          toast('🎉 تم توليد القالب بالذكاء الاصطناعي بنجاح');
        } catch (parseErr) {
          result = localTemplateFallback(idea, industry);
          toast('⚠️ رد غير متوقع من الذكاء الاصطناعي — تم التوليد محليًا');
        }
      }
    }

    if ($('#tplTitle')) $('#tplTitle').value = result.title;
    if ($('#tplPrice')) $('#tplPrice').value = result.price;
    if ($('#tplCondition')) $('#tplCondition').value = result.condition;
    if ($('#tplLocation')) $('#tplLocation').value = result.location;
    if ($('#tplBody')) $('#tplBody').value = result.body;
    if ($('#tplFeatures')) $('#tplFeatures').value = result.features;
    if ($('#tplCTA')) $('#tplCTA').value = result.cta;
    if ($('#tplHashtags')) $('#tplHashtags').value = result.hashtags;
    if ($('#tplCategory') && industry) $('#tplCategory').value = industryLabelOf(industry);

    $('#tplResult').value = buildTemplateText();
    $('#campaignContent').value = $('#tplResult').value;
  } catch (err) {
    toast('❌ حدث خطأ أثناء التوليد — حاول مرة أخرى');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
  }
}

function industryLabelOf(key) {
  return (TEMPLATE_PRESETS[key] && TEMPLATE_PRESETS[key].label) || 'عام';
}
async function filesToData(files) {
  const arr = [];
  for (const file of Array.from(files || [])) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    arr.push({ name: file.name, type: file.type, size: file.size, dataUrl });
  }
  return arr;
}


function showTopLevelPanelForTab(name) {
  const panelMap = { discover: 'tab-tool1', campaign: 'tab-tool2', templates: 'tab-tool2', competitors: 'tab-tool2', tracking: 'tab-tool2' };
  const btnMap = { discover: 'btn-tab-tool1', campaign: 'btn-tab-tool2', templates: 'btn-tab-tool2', competitors: 'btn-tab-tool2', tracking: 'btn-tab-tool2' };
  const panelId = panelMap[name];
  if (!panelId) return;
  $$('.d-panel').forEach(p => p.classList.toggle('active', p.id === panelId));
  ['btn-tab-home','btn-tab-tool1','btn-tab-tool2','btn-tab-pricing-page'].forEach(id => {
    const btn = $('#' + id);
    if (btn) btn.classList.toggle('active', id === btnMap[name]);
  });
}

function switchTab(name) {
  if (!name) return;
  showTopLevelPanelForTab(name);
  $$('.nav-btn').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  const flowMap = { discover: 0, campaign: 1, templates: 1, competitors: 2, tracking: 2 };
  const activeStep = flowMap[name] ?? 0;
  $$('.flow-step').forEach((step, idx) => step.classList.toggle('active', idx === activeStep));
  const main = document.querySelector('.main');
  if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
}

function connectDashboardKeepAlive() {
  let port = null;
  let reconnectTimer = 0;

  const pulse = (source = 'dashboard-ui') => {
    try {
      chrome.runtime.sendMessage({
        action: 'HEARTBEAT',
        source,
        hidden: typeof document !== 'undefined' ? !!document.hidden : false,
        frozen: false,
        url: location.href,
        ts: Date.now()
      }, () => void chrome.runtime.lastError);
    } catch (_) {}
  };

  const connect = () => {
    try {
      if (port) return;
      port = chrome.runtime.connect({ name: 'keepalive' });
      pulse('dashboard-connect');
      port.onDisconnect.addListener(() => {
        port = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1500);
      });
    } catch (_) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    }
  };

  connect();
  setInterval(() => pulse('dashboard-interval'), 15000);
  document.addEventListener('visibilitychange', () => pulse('dashboard-visibility'), true);
  window.addEventListener('pageshow', () => pulse('dashboard-pageshow'), true);
}

function renderCategories(data) {
  const cats = ['الكل', ...new Set((data.groupCategories || ['عام']).filter(Boolean))];
  $('#libraryCategoryFilter').innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function renderLibrary(data) {
  const q = ($('#librarySearch').value || '').toLowerCase().trim();
  const cat = $('#libraryCategoryFilter').value || 'الكل';
  const groups = (data.groupsLibrary || []).filter(g => {
    const okQ = !q || `${g.name || ''} ${g.url || ''}`.toLowerCase().includes(q);
    const okC = cat === 'الكل' || (g.category || 'عام') === cat;
    return okQ && okC;
  });
  $('#selectedGroupsCounter').textContent = `المحدد الآن: ${groups.filter(g => g.selected).length} من ${groups.length}`;
  $('#libraryList').innerHTML = groups.length ? groups.map((g, idx) => `
    <div class="row-item">
      <div>
        <div class="row-title">${esc(g.name)}</div>
        <div class="row-meta">${esc(g.category || 'عام')} • ${esc(g.detectedType || 'unknown')} • ${g.members || 0} عضو</div>
      </div>
      <div>
        <label class="checkbox-line"><input type="checkbox" data-url="${esc(g.url)}" class="lib-check" ${g.selected ? 'checked' : ''}/> <span>اختيار</span></label>
      </div>
    </div>`).join('') : '<div class="note">لا توجد جروبات محفوظة بعد.</div>';

  $$('.lib-check').forEach(ch => {
    ch.onchange = async () => {
      const store = await storageGet(['groupsLibrary']);
      const gl = (store.groupsLibrary || []).map(x => x.url === ch.dataset.url ? { ...x, selected: ch.checked } : x);
      await storageSet({ groupsLibrary: gl });
      renderLibrary({ ...store, groupsLibrary: gl, groupCategories: (await storageGet(['groupCategories'])).groupCategories || ['عام'] });
    };
  });
}

function renderDiscoverResults() {
  $('#discoverResults').innerHTML = latestDiscover.length ? latestDiscover.map(g => {
    const joinBadge = g.autoJoinMatched
      ? `<span class="tag ok">${g.joinStatus === 'joined' ? 'تم الانضمام/الطلب' : 'مطابق للفلتر'}</span>`
      : `<span class="tag">خارج الانضمام التلقائي</span>`;
    const ruleLine = [
      g.detectedType || 'unknown',
      `${g.members || 0} عضو`,
      g.matchedBy ? `مطابقة: ${esc(g.matchedBy)}` : '',
      g.joinNote ? `ملاحظة: ${esc(g.joinNote)}` : '',
      g.rejectedReason ? `مستبعد: ${esc(g.rejectedReason)}` : ''
    ].filter(Boolean).join(' • ');
    return `
    <div class="row-item">
      <div class="row-stack">
        <div class="row-title">${esc(g.name)} ${joinBadge}</div>
        <div class="row-meta">${esc(g.category || 'عام')} • ${esc(ruleLine)}</div>
        <div class="row-meta mono">${esc(g.url)}</div>
      </div>
      <a class="small-btn link" target="_blank" href="${esc(g.url)}">فتح</a>
    </div>`;
  }).join('') : '<div class="note">لا توجد نتائج مطابقة حتى الآن.</div>';
}

function renderExcludedDiscoverResults() {
  const el = $('#discoverExcludedResults');
  if (!el) return;
  el.innerHTML = latestExcludedDiscover.length ? latestExcludedDiscover.map(g => `
    <div class="row-item">
      <div class="row-stack">
        <div class="row-title">${esc(g.name || 'بدون اسم')} <span class="tag warn">مستبعد</span></div>
        <div class="row-meta">${esc(g.category || 'عام')} • السبب: <code>${esc(g.rejectedReason || 'غير محدد')}</code></div>
        <div class="row-meta mono">${esc(g.url || '')}</div>
      </div>
      ${g.url ? `<a class="small-btn dim" target="_blank" href="${esc(g.url)}">فتح</a>` : ''}
    </div>`).join('') : '<div class="note">لا توجد نتائج مستبعدة محفوظة.</div>';
}

function renderDiscoverLiveStatus(status) {
  const el = $('#discoverLiveStatus');
  if (!el) return;
  if (!status || !status.message) {
    el.textContent = 'حالة البحث اللحظية ستظهر هنا.';
    return;
  }
  const bits = [status.message];
  if (status.scannedCount) bits.push(`تم مسح ${status.scannedCount}`);
  if (status.matchedCount) bits.push(`مطابق ${status.matchedCount}`);
  if (status.attemptedCount) bits.push(`محاولات ${status.attemptedCount}`);
  el.innerHTML = bits.map(esc).join(' • ');
}

function buildDiscoverSummary(summary) {
  if (!summary) return {
    summaryHtml: 'ابدأ ببحث جديد وسيظهر عدد النتائج الممسوحة والمطابقة هنا.',
    liveHtml: 'حالة البحث اللحظية ستظهر هنا.',
    joinHtml: 'سيظهر هنا عدد محاولات الانضمام والطلبات المقبولة/المرسلة طبقًا للفلاتر فقط.',
    excludedHtml: 'سيظهر هنا عدد النتائج المستبعدة وأسباب الاستبعاد.'
  };
  const scanned = Number(summary.scannedCount || 0);
  const matched = Number(summary.count || 0);
  const strict = Number(summary.strictMatchedCount || matched || 0);
  const joinedCount = Number(summary.joinSummary?.joinedCount || 0);
  const attempted = Number(summary.joinSummary?.attemptedCount || 0);
  const visibleMatched = Number(summary.joinSummary?.matchedVisibleCount || 0);
  const skippedOut = Number(summary.joinSummary?.skippedOutOfFilterCount || 0);
  const duplicateSkips = Number(summary.joinSummary?.duplicateAttemptSkips || 0);
  const excludedCount = Number(summary.excludedCount || 0);
  const joinedNames = (summary.joinSummary?.joinedGroups || []).slice(0, 12).join(' ، ');
  const summaryHtml = `آخر بحث: <strong>${esc(summary.keyword || '')}</strong> • تم مسح <strong>${scanned}</strong> • مطابق فعلي <strong>${matched}</strong>${strict && strict !== matched ? ` • مطابق صارم <strong>${strict}</strong>` : ''}`;
  const liveHtml = summary.liveStatus?.message ? esc(summary.liveStatus.message) : 'اكتمل آخر بحث.';
  const joinHtml = summary.autoJoin
    ? `الانضمام التلقائي: تمت محاولة <strong>${attempted}</strong> من النتائج المطابقة الظاهرة <strong>${visibleMatched}</strong> • نجاح/طلب <strong>${joinedCount}</strong>${skippedOut ? ` • تم تجاهل <strong>${skippedOut}</strong> خارج الفلتر` : ''}${duplicateSkips ? ` • تكرارات متجاوزة <strong>${duplicateSkips}</strong>` : ''}${joinedNames ? `<br>الأسماء: ${esc(joinedNames)}` : ''}`
    : 'الانضمام التلقائي غير مفعل في آخر بحث';
  const excludedHtml = excludedCount
    ? `تم استبعاد <strong>${excludedCount}</strong> نتيجة غير مطابقة. راجع الصندوق الجانبي لمعرفة الأسباب.`
    : 'لا توجد نتائج مستبعدة في آخر بحث.';
  return { summaryHtml, liveHtml, joinHtml, excludedHtml };
}

function buildDiscoverExportRows() {
  return [
    ...latestDiscover.map(item => ({
      bucket: 'matched',
      name: item.name || '',
      url: item.url || '',
      members: item.members || 0,
      detectedType: item.detectedType || '',
      category: item.category || '',
      matchedBy: item.matchedBy || '',
      joinStatus: item.joinStatus || '',
      joinNote: item.joinNote || '',
      rejectedReason: item.rejectedReason || ''
    })),
    ...latestExcludedDiscover.map(item => ({
      bucket: 'excluded',
      name: item.name || '',
      url: item.url || '',
      members: item.members || 0,
      detectedType: item.detectedType || '',
      category: item.category || '',
      matchedBy: item.matchedBy || '',
      joinStatus: '',
      joinNote: '',
      rejectedReason: item.rejectedReason || ''
    }))
  ];
}

function buildDiscoverCsv() {
  const rows = buildDiscoverExportRows();
  const header = ['bucket','name','url','members','detectedType','category','matchedBy','joinStatus','joinNote','rejectedReason'];
  const lines = [header.join(',')];
  rows.forEach(item => lines.push(header.map(k => csvCell(item[k])).join(',')));
  return lines.join('\n');
}

function exportDiscoverJson() {
  downloadTextFile('fb-discover-results.json', JSON.stringify({
    matched: latestDiscover,
    excluded: latestExcludedDiscover,
    joinSummary: lastJoinSummary,
    exportedAt: new Date().toISOString()
  }, null, 2), 'application/json');
}

function exportDiscoverCsv() {
  downloadTextFile('fb-discover-results.csv', buildDiscoverCsv(), 'text/csv;charset=utf-8');
}

async function startDiscoverStatusPolling() {
  clearInterval(discoverStatusPoller);
  renderDiscoverLiveStatus({ message: 'جاري تجهيز البحث...' });
  discoverStatusPoller = setInterval(async () => {
    try {
      const data = await storageGet(['discoverLiveStatus']);
      renderDiscoverLiveStatus(data.discoverLiveStatus || null);
    } catch (_) {}
  }, 500);
}

async function stopDiscoverStatusPolling(finalStatus = null) {
  clearInterval(discoverStatusPoller);
  discoverStatusPoller = 0;
  if (finalStatus) {
    renderDiscoverLiveStatus(finalStatus);
    await storageSet({ discoverLiveStatus: finalStatus });
  }
}

function renderTemplates(data) {
  const items = data.postTemplates || [];
  $('#templatePicker').innerHTML = '<option value="">اختر قالبًا</option>' + items.map((t, i) => `<option value="${i}">${esc(t.name || 'قالب')}</option>`).join('');
  $('#templatesList').innerHTML = items.length ? items.map((t, i) => `
    <div class="row-item">
      <div>
        <div class="row-title">${esc(t.name)}</div>
        <div class="row-meta">${esc(t.category || 'عام')}</div>
      </div>
      <div class="actions-row">
        <button class="small-btn use-template" data-idx="${i}">استخدام</button>
        <button class="small-btn warn del-template" data-idx="${i}">حذف</button>
      </div>
    </div>`).join('') : '<div class="note">لا توجد قوالب محفوظة.</div>';

  $$('.use-template').forEach(btn => btn.onclick = async () => {
    const idx = Number(btn.dataset.idx);
    const t = items[idx];
    $('#campaignContent').value = t.result || '';
    $('#tplName').value = t.name || '';
    $('#tplCategory').value = t.category || '';
    $('#tplTitle').value = t.title || '';
    $('#tplPrice').value = t.price || '';
    $('#tplCondition').value = t.condition || '';
    $('#tplLocation').value = t.location || '';
    $('#tplBody').value = t.body || '';
    if ($('#tplFeatures')) $('#tplFeatures').value = t.features || '';
    if ($('#tplCTA')) $('#tplCTA').value = t.cta || '';
    if ($('#tplHashtags')) $('#tplHashtags').value = t.hashtags || '';
    $('#tplResult').value = t.result || '';
    toast('تم تحميل القالب');
  });
  $$('.del-template').forEach(btn => btn.onclick = async () => {
    const idx = Number(btn.dataset.idx);
    const next = items.filter((_, i) => i !== idx);
    await storageSet({ postTemplates: next });
    await refreshAll();
    toast('تم حذف القالب');
  });
}

function renderReplyTemplates() {
  $('#replyTemplatesList').innerHTML = savedReplyTemplates.length ? savedReplyTemplates.map((t, i) => `<button class="small-btn export reply-template-chip" data-idx="${i}">${esc(t.type || 'عام')} • ${esc(t.text)}</button>`).join('') : '<span class="chip">لا توجد قوالب محفوظة</span>';
  $$('.reply-template-chip').forEach(btn => btn.onclick = () => {
    const idx = Number(btn.dataset.idx);
    const item = savedReplyTemplates[idx];
    if (!item) return;
    $('#replyTemplateInput').value = item.text || '';
    $('#privateMessageInput').value = item.text || '';
    if ($('#replyTemplateType')) $('#replyTemplateType').value = item.type || 'عام';
    toast('تم تحميل القالب');
  });
  renderQuickFill();
}

function renderComments() {
  const sorted = [...extractedComments].sort((a, b) => {
    const favDelta = (isFavorite(b) ? 1 : 0) - (isFavorite(a) ? 1 : 0);
    const blockedDelta = (isDoNotReply(a) ? 1 : 0) - (isDoNotReply(b) ? 1 : 0);
    if (currentSortMode() === 'replies') return (Number(b.replyCount || 0) - Number(a.replyCount || 0)) || favDelta || blockedDelta;
    if (currentSortMode() === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ar') || favDelta || blockedDelta;
    if (currentSortMode() === 'blocked-last') return blockedDelta || favDelta || (Number(b.replyCount || 0) - Number(a.replyCount || 0));
    return favDelta || blockedDelta || (Number(b.replyCount || 0) - Number(a.replyCount || 0));
  });
  $('#commentsList').innerHTML = sorted.length ? sorted.map((c, i) => {
    const badges = [];
    if (isFavorite(c)) badges.push('<span class="badge favorite">★ مفضلة</span>');
    if (isDoNotReply(c)) badges.push('<span class="badge blocked">عدم الرد</span>');
    return `
    <div class="row-item">
      <div>
        <div class="row-title">${esc(c.name || 'بدون اسم')}</div>
        <div class="row-meta">ID: ${esc(c.profileId || '-')} • Replies: ${c.replyCount || 0}</div>
        <div class="row-meta">${esc(c.text || '')}</div>
        ${badges.length ? `<div class="badge-row">${badges.join('')}</div>` : ''}
      </div>
      <div class="row-actions">
        ${c.profileUrl ? `<a class="small-btn link" target="_blank" href="${esc(c.profileUrl)}">الملف</a>` : ''}
        ${c.commentUrl ? `<a class="small-btn soft" target="_blank" href="${esc(c.commentUrl)}">التعليق</a>` : ''}
        <button class="small-btn reply single-reply-btn" data-idx="${i}">رد</button>
        ${c.profileUrl ? `<button class="small-btn pm single-pm-btn" data-idx="${i}">خاص</button>` : ''}
        <button class="small-btn star favorite-btn" data-idx="${i}">${isFavorite(c) ? 'إلغاء المفضلة' : 'مفضلة'}</button>
        <button class="small-btn block block-btn" data-idx="${i}">عدم الرد</button>
      </div>
    </div>`;
  }).join('') : '<div class="note">لم يتم سحب تعليقات بعد.</div>';

  $$('.single-reply-btn').forEach(btn => btn.onclick = () => singleReply(Number(btn.dataset.idx)));
  $$('.single-pm-btn').forEach(btn => btn.onclick = () => singlePrivateMessage(Number(btn.dataset.idx)));
  $$('.favorite-btn').forEach(btn => btn.onclick = () => toggleFavoriteByIndex(Number(btn.dataset.idx)));
  $$('.block-btn').forEach(btn => btn.onclick = () => addDoNotReplyByIndex(Number(btn.dataset.idx)));
}


async function refreshTracking() {
  const d = await storageGet(['postLog', 'postingActive', 'awaitingNextGroup', 'nextRunAt', 'currentGroupIndex', 'postQueue']);
  const log = d.postLog || [];
  const success = log.filter(x => x.success && !x.pending).length;
  const pending = log.filter(x => x.pending).length;
  const fail = log.filter(x => !x.success && !x.pending).length;
  $('#statSuccess').textContent = success;
  $('#statPending').textContent = pending;
  $('#statFail').textContent = fail;
  $('#statTotal').textContent = log.length;
  $('#queueIndicator').textContent = d.postingActive ? 'الحملة شغالة' : 'جاهز';
  $('#queueStateBox').textContent = d.postingActive ? (d.awaitingNextGroup ? 'في انتظار الدور التالي' : 'جاري النشر الآن') : 'متوقف';
  if ($('#overviewQueue')) $('#overviewQueue').textContent = d.postingActive ? 'قيد التشغيل' : 'جاهز';
  if ($('#overviewSpeed')) $('#overviewSpeed').textContent = `${Number(d.minDelay || 0)}s → ${Number(d.maxDelay || 0)}s`;
  $('#queueMeta').textContent = d.postingActive
    ? `المجموعة الحالية: ${(d.currentGroupIndex || 0) + 1} / ${(d.postQueue || []).length}${d.nextRunAt ? ` • التالي بعد ${Math.max(0, Math.round((d.nextRunAt - Date.now())/1000))} ثانية` : ''}`
    : 'لا توجد حملة قيد التشغيل';
  const rateEl = $('#campaignRateBar');
  if (rateEl) {
    const total = success + fail;
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
    const avgDelay = d.maxDelay ? `متوسط التأخير: ${(((d.minDelay || 0) + (d.maxDelay || 0)) / 2).toFixed(0)} ثانية` : '';
    rateEl.textContent = total > 0 ? `نسبة النجاح: ${rate}% (${success} نجاح / ${fail} فشل)${avgDelay ? ' • ' + avgDelay : ''}` : '';
  }
  $('#trackingLog').innerHTML = log.length ? log.slice().reverse().map(item => {
    const statusClass = item.pending ? 'log-warn' : (item.success ? 'log-ok' : 'log-bad');
    const statusText = item.pending ? '⏳ قيد الانتظار' : (item.success ? '✅ نجاح' : '❌ فشل');
    const commentReasonLabels = {
      comments_disabled: 'التعليقات معطّلة على المنشور',
      box_not_found: 'تعذّر إيجاد خانة التعليق',
      rejected_after_submit: 'تم رفض التعليق بعد الإرسال',
      no_comment_text: 'لا يوجد تعليق أول محدد'
    };
    const commentBadge = item.commentStatus === 'success'
      ? '<span class="row-meta log-ok">💬 التعليق الأول: نجح</span>'
      : item.commentStatus === 'failed'
        ? `<span class="row-meta log-bad">💬 التعليق الأول: فشل — ${esc(commentReasonLabels[item.commentError] || item.commentError || 'سبب غير معروف')}</span>`
        : '';
    return `<div class="row-item"><div><div class="row-title ${statusClass}">${statusText} — ${esc(item.groupName || '')}</div><div class="row-meta">${esc(item.error || '')}</div>${item.postUrl ? `<div class="row-meta"><a target="_blank" href="${esc(item.postUrl)}">رابط المنشور</a></div>` : ''}${commentBadge}</div></div>`;
  }).join('') : '<div class="note">لا يوجد سجل بعد.</div>';
}


/** حفظ كل حقول لوحة التحكم — يمنع فقدان البيانات عند تبديل التبويب على الموبايل */
async function saveDashboardFormState() {
  try {
    const enableComment = !!( $('#enableFirstComment') && $('#enableFirstComment').checked );
    const state = {
      campaignContent: ($('#campaignContent') && $('#campaignContent').value) || '',
      campaignComment: ($('#campaignComment') && $('#campaignComment').value) || '',
      enableFirstComment: enableComment,
      campaignName: ($('#campaignName') && $('#campaignName').value) || '',
      campaignMinDelay: ($('#campaignMinDelay') && $('#campaignMinDelay').value) || '',
      campaignMaxDelay: ($('#campaignMaxDelay') && $('#campaignMaxDelay').value) || '',
      campaignPostMode: ($('#campaignPostMode') && $('#campaignPostMode').value) || '',
      repeatCycleEnabled: !!( $('#repeatCycleEnabled') && $('#repeatCycleEnabled').checked ),
      repeatCycleValue: ($('#repeatCycleValue') && $('#repeatCycleValue').value) || '',
      repeatCycleUnit: ($('#repeatCycleUnit') && $('#repeatCycleUnit').value) || '',
      libraryCategoryFilter: ($('#libraryCategoryFilter') && $('#libraryCategoryFilter').value) || '',
      librarySearch: ($('#librarySearch') && $('#librarySearch').value) || '',
      competitorPostUrl: ($('#competitorPostUrl') && $('#competitorPostUrl').value) || '',
      activeToolTab: (document.querySelector('.tab-btn.active') && document.querySelector('.tab-btn.active').dataset.tab) || '',
      savedAt: Date.now()
    };
    await storageSet({ dashboardState: state });
  } catch (e) { /* silent */ }
}

function applyEnableFirstCommentUI() {
  const en = $('#enableFirstComment');
  const ta = $('#campaignComment');
  if (!en || !ta) return;
  ta.disabled = !en.checked;
  ta.style.opacity = en.checked ? '1' : '0.55';
}

async function restoreDashboardFormState(data) {
  const s = (data && data.dashboardState) || {};
  if (!s || typeof s !== 'object') return;
  const setVal = (id, v) => { const el = $('#' + id); if (el && v != null && v !== '') el.value = v; };
  setVal('campaignContent', s.campaignContent);
  setVal('campaignComment', s.campaignComment);
  setVal('campaignName', s.campaignName);
  setVal('campaignMinDelay', s.campaignMinDelay);
  setVal('campaignMaxDelay', s.campaignMaxDelay);
  setVal('campaignPostMode', s.campaignPostMode);
  setVal('repeatCycleValue', s.repeatCycleValue);
  setVal('repeatCycleUnit', s.repeatCycleUnit);
  setVal('libraryCategoryFilter', s.libraryCategoryFilter);
  setVal('librarySearch', s.librarySearch);
  setVal('competitorPostUrl', s.competitorPostUrl);
  if ($('#repeatCycleEnabled') && typeof s.repeatCycleEnabled === 'boolean') {
    $('#repeatCycleEnabled').checked = s.repeatCycleEnabled;
  }
  // التعليق الأول: افتراضيًا مغلق — لا يُفعَّل إلا إن كان محفوظًا صراحةً
  if ($('#enableFirstComment')) {
    $('#enableFirstComment').checked = s.enableFirstComment === true;
  }
  applyEnableFirstCommentUI();
}

async function refreshAll() {
  const data = await storageGet(['groupsLibrary', 'groupCategories', 'postTemplates', 'dashboardState', 'competitorTemplates', 'interactionLogs', 'lastSearchSummary', 'favoriteCommenters', 'doNotReplyList', 'lastBulkReport', 'discoverLiveStatus']);
  savedReplyTemplates = data.competitorTemplates || [];
  interactionLogs = data.interactionLogs || [];
  favoriteCommenters = uniqueByKey(data.favoriteCommenters || [], x => x.key);
  doNotReplyList = uniqueByKey(data.doNotReplyList || [], x => x.key);
  lastBulkReport = data.lastBulkReport || null;
  if (data.lastSearchSummary?.groups) latestDiscover = data.lastSearchSummary.groups || [];
  if (data.lastSearchSummary?.excludedPreview) latestExcludedDiscover = data.lastSearchSummary.excludedPreview || [];
  if (data.lastSearchSummary?.joinSummary) lastJoinSummary = data.lastSearchSummary.joinSummary;
  renderCategories(data);
  renderLibrary(data);
  renderTemplates(data);
  renderReplyTemplates();
  renderInteractionLogs();
  renderLastBulkReport();
  renderFavoriteLists();
  renderDiscoverResults();
  renderExcludedDiscoverResults();
  const discoverUi = buildDiscoverSummary({ ...(data.lastSearchSummary || {}), liveStatus: data.discoverLiveStatus || null });
  $('#discoverSummary').innerHTML = discoverUi.summaryHtml;
  $('#discoverLiveStatus').innerHTML = discoverUi.liveHtml;
  $('#discoverJoinSummary').innerHTML = discoverUi.joinHtml;
  $('#discoverExcludedSummary').innerHTML = discoverUi.excludedHtml;
  await restoreDashboardFormState(data);
  updateCompetitorSummary();
  await refreshTracking();
}

async function runDiscovery() {
  const payload = {
    keyword: $('#discoverKeyword').value.trim(),
    province: $('#discoverProvince').value.trim(),
    minMembers: Number($('#discoverMinMembers').value || 0),
    groupType: $('#discoverType').value,
    category: $('#discoverCategory').value.trim() || 'عام',
    requiredTerms: $('#discoverMustInclude')?.value.trim(),
    excludedTerms: $('#discoverExcludeTerms')?.value.trim(),
    autoJoin: $('#discoverAutoJoin').checked
  };
  const searchSeed = [payload.keyword, payload.province].filter(Boolean).join(' ').trim();
  if (!searchSeed) return toast('اكتب كلمة مفتاحية أو محافظة على الأقل');
  latestDiscover = [];
  latestExcludedDiscover = [];
  renderDiscoverResults();
  renderExcludedDiscoverResults();
  $('#discoverSummary').textContent = 'جاري البحث والمسح...';
  $('#discoverJoinSummary').textContent = 'يتم تجهيز فلتر الانضمام المطابق فقط...';
  $('#discoverExcludedSummary').textContent = 'يتم انتظار أسباب الاستبعاد...';
  try {
    await startDiscoverStatusPolling();
  const res = await chrome.runtime.sendMessage({ action: 'SEARCH_GROUPS_ADVANCED', payload });
  if (!res || !res.success) {
    await stopDiscoverStatusPolling({ message: (res && res.error) || 'فشل البحث' });
    $('#discoverSummary').textContent = 'فشل البحث';
    toast((res && res.error) || 'فشل البحث');
    return;
  }
  latestDiscover = res.groups || [];
  latestExcludedDiscover = res.excluded || [];
  lastJoinSummary = res.joinSummary || { joinedCount: 0, joinedGroups: [] };
  renderDiscoverResults();
  renderExcludedDiscoverResults();
  const finalStatus = { message: 'اكتمل البحث والحفظ.', scannedCount: res.scannedCount || 0, matchedCount: res.count || 0, attemptedCount: res.joinSummary?.attemptedCount || 0 };
  await stopDiscoverStatusPolling(finalStatus);
  await refreshAll();
  const discoverUi = buildDiscoverSummary({
    keyword: payload.keyword,
    count: res.count || 0,
    scannedCount: res.scannedCount || 0,
    strictMatchedCount: res.strictMatchedCount || res.count || 0,
    autoJoin: payload.autoJoin,
    joinSummary: lastJoinSummary,
    excludedCount: res.excludedCount || latestExcludedDiscover.length,
    liveStatus: finalStatus
  });
  $('#discoverSummary').innerHTML = discoverUi.summaryHtml;
  $('#discoverLiveStatus').innerHTML = discoverUi.liveHtml;
  $('#discoverJoinSummary').innerHTML = discoverUi.joinHtml;
  $('#discoverExcludedSummary').innerHTML = discoverUi.excludedHtml;
  toast('تم تحديث نتائج الاكتشاف وتفاصيل الانضمام');
  // البقاء على تبويب الاكتشاف بعد انتهاء البحث/الانضمام
  try { switchTab('discover'); } catch (_) {}
  try {
    const resultsEl = document.getElementById('discoverResults');
    if (resultsEl) resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (_) {}
  } catch (error) {
    const message = (error && error.message) ? error.message : 'حدث خطأ أثناء تشغيل البحث';
    await stopDiscoverStatusPolling({ message });
    $('#discoverSummary').textContent = message;
    $('#discoverLiveStatus').textContent = 'تعذر إكمال الاكتشاف — حاول مرة أخرى';
    toast(message);
    try { switchTab('discover'); } catch (_) {}
  }
}

async function saveLatestResultsAgain() {
  if (!latestDiscover || !latestDiscover.length) {
    toast('لا توجد نتائج بحث لحفظها — نفّذ بحثاً أولاً');
    return;
  }
  const data = await storageGet(['groupsLibrary', 'groupCategories']);
  const lib = data.groupsLibrary || [];
  const map = new Map(lib.map(g => [String(g.url || '').toLowerCase(), g]));
  latestDiscover.forEach(g => {
    const key = String(g.url || '').toLowerCase();
    if (!key) return;
    map.set(key, { ...(map.get(key) || {}), ...g, savedAt: Date.now() });
  });
  const cats = new Set(Array.isArray(data.groupCategories) ? data.groupCategories : ['عام']);
  latestDiscover.forEach(g => { if (g.category) cats.add(String(g.category)); });
  await storageSet({ groupsLibrary: Array.from(map.values()), groupCategories: Array.from(cats) });
  await refreshAll();
  try { switchTab('discover'); } catch (_) {}
  toast('تم حفظ ' + latestDiscover.length + ' جروب في المكتبة');
}

async function saveTemplate() {
  const result = $('#tplResult').value.trim() || buildTemplateText();
  $('#tplResult').value = result;
  const data = await storageGet(['postTemplates']);
  const items = data.postTemplates || [];
  items.unshift({
    name: $('#tplName').value.trim() || 'قالب بدون اسم',
    category: $('#tplCategory').value.trim() || 'عام',
    title: $('#tplTitle').value.trim(),
    price: $('#tplPrice').value.trim(),
    condition: $('#tplCondition').value.trim(),
    location: $('#tplLocation').value.trim(),
    body: $('#tplBody').value.trim(),
    features: $('#tplFeatures') ? $('#tplFeatures').value.trim() : '',
    cta: $('#tplCTA') ? $('#tplCTA').value.trim() : '',
    hashtags: $('#tplHashtags') ? $('#tplHashtags').value.trim() : '',
    result,
    savedAt: Date.now()
  });
  await storageSet({ postTemplates: items.slice(0, 100) });
  $('#campaignContent').value = result;
  await refreshAll();
  toast('تم حفظ القالب');
}

async function startCampaign() {
  const data = await storageGet(['groupsLibrary']);
  const groups = dedupeGroupsByUrl((data.groupsLibrary || []).filter(g => g.selected));
  if (!groups.length) return toast('حدد جروبات من المكتبة أولاً');
  if (!$('#campaignContent').value.trim()) return toast('اكتب محتوى المنشور أولاً');
  // التعليق الأول يعمل فقط عند تفعيل الخيار صراحةً — وإلا يُرسل فارغًا دائمًا
  const commentEnabled = !!( $('#enableFirstComment') && $('#enableFirstComment').checked );
  const commentText = commentEnabled ? (($('#campaignComment') && $('#campaignComment').value) || '').trim() : '';
  if (commentEnabled && !commentText) return toast('فعّلت التعليق الأول لكن النص فارغ');
  const payload = {
    groups,
    content: $('#campaignContent').value.trim(),
    comment: commentText,
    commentEnabled: commentEnabled && !!commentText,
    mediaFiles,
    minDelay: Number($('#campaignMinDelay').value || 15),
    maxDelay: Number($('#campaignMaxDelay').value || 45),
    autoCloseTabs: true,
    backgroundWorkerMode: true,
    repeatCycleEnabled: $('#repeatCycleEnabled').checked,
    repeatCycleIntervalMs: toIntervalMs($('#repeatCycleValue').value, $('#repeatCycleUnit').value),
    campaignName: $('#campaignName').value.trim(),
    selectedCategory: $('#libraryCategoryFilter').value,
    postMode: $('#campaignPostMode').value,
    singleAttemptPerGroup: true
  };
  await saveDashboardFormState();
  const res = await chrome.runtime.sendMessage({ action: 'START_POSTING', payload });
  toast(res && res.success ? 'بدأت الحملة' : 'فشل بدء الحملة');
  await refreshTracking();
}

async function stopCampaign() {
  await chrome.runtime.sendMessage({ action: 'STOP_POSTING' });
  toast('تم الإيقاف');
  await refreshTracking();
}

async function extractComments() {
  const postUrl = $('#competitorPostUrl').value.trim();
  if (!postUrl) return toast('أدخل رابط المنشور');
  $('#competitorSummary').textContent = 'جاري السحب...';
  const res = await chrome.runtime.sendMessage({ action: 'EXTRACT_POST_COMMENTS', payload: { postUrl } });
  if (!res || !res.success) {
    $('#competitorSummary').textContent = 'فشل السحب';
    return toast((res && res.error) || 'فشل السحب');
  }
  rawExtractedComments = uniqueByKey(res.comments || [], item => `${commentKey(item)}__${normalizeKey(item.text || '').slice(0, 80)}`);
  applyCommentFilters();
  updateCompetitorSummary(`تم سحب ${res.count || rawExtractedComments.length} تعليق/رد`);
  toast('تم سحب التعليقات');
}

function exportComments() {
  downloadTextFile('fb-competitor-comments.json', JSON.stringify(extractedComments, null, 2), 'application/json');
}

function exportCommentsCsv() {
  downloadTextFile('fb-competitor-comments.csv', buildCommentsCsv(extractedComments), 'text/csv;charset=utf-8');
}

async function singleReply(idx) {
  const item = extractedComments[idx];
  const postUrl = $('#competitorPostUrl').value.trim();
  const replyText = $('#replyTemplateInput').value.trim();
  if (!item || !postUrl || !replyText) return toast('أدخل رابط المنشور ونص الرد');
  const startedAt = Date.now();
  const res = await chrome.runtime.sendMessage({ action: 'BULK_REPLY_TO_POST_COMMENTS', payload: { postUrl, replyText, targetNames: [item.name], targetProfiles: item.profileUrl ? [item.profileUrl] : [], delayMs: bulkDelaySec() } });
  await appendInteractionLog({ kind: 'رد فردي', name: item.name, success: !!(res && res.success), message: res && res.success ? `تم ${res.repliedCount || 0} • تخطى ${res.skippedCount || 0}` : '', error: (res && res.error) || '', durationMs: Date.now() - startedAt });
  await setLastBulkReport({
    type: 'single_reply',
    title: `رد فردي على ${item.name || 'بدون اسم'}`,
    totals: { attempted: 1, success: Number(res?.repliedCount || 0), failed: Number(res?.failedCount || 0), skipped: Number(res?.skippedCount || 0) },
    items: normalizeBulkReportItems(res, 'reply').slice(0, 50)
  });
  updateCompetitorSummary(res && res.success ? `الرد الفردي: نجاح ${res.repliedCount || 0} • فشل ${res.failedCount || 0}` : 'فشل الرد الفردي');
  toast(res && res.success ? `تمت محاولة الرد على ${item.name}` : ((res && res.error) || 'فشل الرد'));
}

async function bulkReply() {
  const postUrl = $('#competitorPostUrl').value.trim();
  const replyText = $('#replyTemplateInput').value.trim();
  const maxOps = bulkMax();
  const targets = extractedComments.filter(item => !isDoNotReply(item)).slice(0, maxOps);
  if (!postUrl || !replyText) return toast('أدخل رابط المنشور ونص الرد');
  if (!targets.length) return toast('لا يوجد معلقون صالحون بعد الفلاتر');
  bulkProgressStart(targets.length);
  $('#competitorSummary').textContent = `جاري تنفيذ الرد الجماعي على ${targets.length} شخص...`;
  const startedAt = Date.now();
  const res = await chrome.runtime.sendMessage({
    action: 'BULK_REPLY_TO_POST_COMMENTS',
    payload: { postUrl, replyText, targetNames: targets.map(x => x.name).filter(Boolean), targetProfiles: targets.map(x => x.profileUrl).filter(Boolean), delayMs: bulkDelaySec() }
  });
  bulkProgressEnd();
  const log = { kind: 'رد جماعي', name: `عدد ${targets.length}`, success: !!(res && res.success), message: res && res.success ? `نجاح ${res.repliedCount || 0} • فشل ${res.failedCount || 0} • تخطى ${res.skippedCount || 0}` : '', error: (res && res.error) || '', durationMs: Date.now() - startedAt };
  await appendInteractionLog(log);
  await setLastBulkReport({
    type: 'bulk_reply',
    title: `رد جماعي على ${targets.length} تعليق`,
    totals: { attempted: targets.length, success: Number(res?.repliedCount || 0), failed: Number(res?.failedCount || 0), skipped: Number(res?.skippedCount || 0) },
    items: normalizeBulkReportItems(res, 'reply').slice(0, 300)
  });
  incSessionStat('رد جماعي', res && res.success);
  updateCompetitorSummary(res && res.success ? `الرد الجماعي: نجاح ${res.repliedCount || 0} • فشل ${res.failedCount || 0} • تخطى ${res.skippedCount || 0}` : 'فشل الرد الجماعي');
  toast(res && res.success ? 'تم تنفيذ الرد الجماعي' : ((res && res.error) || 'فشل الرد الجماعي'));
}

async function singlePrivateMessage(idx) {
  const item = extractedComments[idx];
  const messageText = $('#privateMessageInput').value.trim() || $('#replyTemplateInput').value.trim();
  if (!item || !item.profileUrl || !messageText) return toast('أدخل نص الرسالة أولاً');
  const startedAt = Date.now();
  const res = await chrome.runtime.sendMessage({ action: 'SEND_PRIVATE_MESSAGE', payload: { profileUrl: item.profileUrl, messageText } });
  await appendInteractionLog({ kind: 'رسالة خاصة', name: item.name, success: !!(res && res.success), message: res && res.success ? 'تمت المحاولة بنجاح' : '', error: (res && res.error) || '', durationMs: Date.now() - startedAt });
  await setLastBulkReport({
    type: 'single_pm',
    title: `رسالة خاصة إلى ${item.name || 'بدون اسم'}`,
    totals: { attempted: 1, success: res?.success ? 1 : 0, failed: res?.success ? 0 : 1, skipped: 0 },
    items: normalizeBulkReportItems({ details: [{ name: item.name || '', profileUrl: item.profileUrl || '', success: !!res?.success, error: res?.error || '', usedProfileUrl: res?.usedProfileUrl || '' }] }, 'pm').slice(0, 50)
  });
  incSessionStat('رسالة خاصة', !!(res && res.success));
  updateCompetitorSummary(res && res.success ? 'تمت محاولة رسالة خاصة فردية' : 'فشل إرسال الرسالة');
  toast(res && res.success ? `تمت محاولة إرسال رسالة إلى ${item.name}` : ((res && res.error) || 'فشل إرسال الرسالة'));
}

async function bulkPrivateMessages() {
  const messageText = $('#privateMessageInput').value.trim() || $('#replyTemplateInput').value.trim();
  const maxOps = bulkMax();
  const profiles = extractedComments.filter(x => x.profileUrl && !isDoNotReply(x)).slice(0, maxOps);
  if (!profiles.length || !messageText) return toast('اسحب التعليقات واكتب نص الرسالة');
  bulkProgressStart(profiles.length);
  $('#competitorSummary').textContent = `جاري إرسال الرسائل الخاصة إلى ${profiles.length} شخص...`;
  const startedAt = Date.now();
  const res = await chrome.runtime.sendMessage({
    action: 'BULK_SEND_PRIVATE_MESSAGES',
    payload: { profiles, messageText, delayMs: bulkDelaySec() }
  });
  bulkProgressEnd();
  const log = { kind: 'رسائل جماعية', name: `عدد ${profiles.length}`, success: !!(res && res.success), message: res && res.success ? `تم ${res.sent || 0} • فشل ${res.failed || 0} • تخطى ${res.skipped || 0}` : '', error: (res && res.error) || '', durationMs: Date.now() - startedAt };
  await appendInteractionLog(log);
  await setLastBulkReport({
    type: 'bulk_pm',
    title: `رسائل خاصة جماعية إلى ${profiles.length} حساب`,
    totals: { attempted: profiles.length, success: Number(res?.sent || 0), failed: Number(res?.failed || 0), skipped: Number(res?.skipped || 0) },
    items: normalizeBulkReportItems(res, 'pm').slice(0, 300)
  });
  incSessionStat('رسائل جماعية', res && res.success ? res.sent || 0 : 0);
  updateCompetitorSummary(res && res.success ? `الرسائل الخاصة: نجاح ${res.sent || 0} • فشل ${res.failed || 0} • تخطى ${res.skipped || 0}` : 'فشل الإرسال الجماعي');
  toast(res && res.success ? 'تمت محاولة الإرسال الجماعي' : ((res && res.error) || 'فشل الإرسال الجماعي'));
}

async function saveReplyTemplate() {
  const val = $('#replyTemplateInput').value.trim();
  if (!val) return toast('اكتب قالب رد أولاً');
  const data = await storageGet(['competitorTemplates']);
  const arr = data.competitorTemplates || [];
  arr.unshift({ text: val, type: ($('#replyTemplateType')?.value || 'عام'), savedAt: Date.now() });
  await storageSet({ competitorTemplates: arr.slice(0, 50) });
  toast('تم حفظ قالب الرد');
}

// ══════════════════════════════════════════════════════════════════
//  PRESET TEMPLATES — v16.1
//  Seeded on first load only. User can delete/edit freely.
//  قوالب جاهزة لكل مجال — تُحمَّل تلقائياً عند أول تشغيل
// ══════════════════════════════════════════════════════════════════
const PRESET_TEMPLATES = [
  // ── عقارات ──────────────────────────────────────────────────────
  {
    name: '🏠 بيع شقة — عقارات',
    category: 'عقارات',
    title: 'شقة للبيع',
    price: '',
    condition: 'جديدة/مستعملة',
    location: 'المنطقة',
    body: 'شقة للبيع',
    result: `{🏠|🔑|🏡} {شقة|وحدة سكنية|دور} للبيع — {فرصة نادرة|عرض حصري|لا تفوّتها}

📍 الموقع: {اكتب الموقع}
📐 المساحة: {اكتب المساحة} متر
🛏️ الغرف: {عدد الغرف} غرفة و{عدد الحمامات} حمام
💰 السعر: {اكتب السعر}

✨ المميزات:
{✅|⭐} {موقع متميز وهادئ|قريب من كل الخدمات|في قلب الحي}
{✅|⭐} {تشطيب سوبر لوكس|تشطيب ممتاز|بدون تشطيب}
{✅|⭐} {بدروم + أسانسير|راكب كامل|خدمات كاملة}

{🤝 للتواصل والمعاينة|📞 للاستفسار|💬 للتفاصيل} — {واتساب|تليفون|مباشر}
{#عقارات|#شقق_للبيع} {#عقارات_مصر|#شقق_مصر}`
  },
  {
    name: '🏢 إيجار شقة — عقارات',
    category: 'عقارات',
    title: 'شقة للإيجار',
    price: '',
    condition: 'مفروشة/فاضية',
    location: 'المنطقة',
    body: 'شقة للإيجار',
    result: `{🏢|🏠|🔑} {شقة|وحدة} للإيجار — {مفروشة بالكامل|نص فرش|فاضية} {🌟|✨}

📍 {اكتب المنطقة}
💵 الإيجار: {اكتب الإيجار} {شهرياً|ربع سنوي|سنوياً}
📐 المساحة: {اكتب المساحة} متر — {اكتب عدد الغرف} غرف

{🎯 مناسبة لـ|✅ مثالية لـ}: {العرسان|الأسر|المصريين العائدين|الموظفين}
{بدون كوميسيون|كوميسيون رمزي|إيجار أول بأول}

{للمعاينة والتفاصيل|للحجز الفوري|للاستفسار} — {تواصل معنا|واتساب فقط}
{#إيجار_شقق|#شقق_للإيجار} {#إيجار_مصر}`
  },

  // ── سيارات ──────────────────────────────────────────────────────
  {
    name: '🚗 بيع سيارة — سيارات',
    category: 'سيارات',
    title: 'سيارة للبيع',
    price: '',
    condition: 'حالة السيارة',
    location: 'المدينة',
    body: 'سيارة للبيع',
    result: `{🚗|🔥|⭐} {سيارة|عربية} للبيع — {فرصة|عرض لفترة محدودة|لا تفوّت}

🚘 الماركة والموديل: {اكتب الماركة والموديل}
📅 سنة الصنع: {اكتب السنة}
⚙️ الحالة: {ممتازة|جيدة جداً|جيدة} — {صيانة دورية|فل أوبشن|بدون حوادث}
💰 السعر: {اكتب السعر} — {قابل للتفاوض بشكل محدود|السعر نهائي|للجادين فقط}
📍 المكان: {اكتب المدينة}

{📸 صور إضافية عند الطلب|🎥 فيديو متاح|تفاصيل أكثر في الواتساب}
{🤝 جاد فقط|للمشتري الجاد|لا وسطاء}

{#سيارات_للبيع|#بيع_سيارات} {#سيارات_مصر|#سيارات_مستعملة}`
  },

  // ── تسويق خدمات ─────────────────────────────────────────────────
  {
    name: '💼 خدمة احترافية — تسويق',
    category: 'تسويق وخدمات',
    title: 'خدمة احترافية',
    price: '',
    condition: '',
    location: '',
    body: 'تسويق خدمة',
    result: `{🚀|💡|⚡} {هل تبحث عن|محتاج|عايز} {اكتب الخدمة}؟

{✅ نقدم لك|✨ نوفر لك|🎯 خدمتنا تشمل}:
{✔️|⭐} {اكتب ميزة 1}
{✔️|⭐} {اكتب ميزة 2}
{✔️|⭐} {نتائج مضمونة|خبرة 5+ سنوات|عملاء راضون}

💰 {أسعار تنافسية|عروض مميزة|ابدأ من ... جنيه فقط}
⏱️ {تنفيذ سريع|التسليم في وقته|بدون تأخير}

{📞 تواصل الآن|💬 واتساب|🤝 احجز موعدك} {للاستفسار|للبدء فوراً|للحصول على عرض مجاني}

{#خدمات|#تسويق} {#أعمال_مصر|#فريلانسر}`
  },

  // ── منتجات / متجر ───────────────────────────────────────────────
  {
    name: '🛍️ منتج للبيع — تجارة',
    category: 'تجارة ومنتجات',
    title: 'منتج للبيع',
    price: '',
    condition: 'جديد',
    location: '',
    body: 'منتج للبيع',
    result: `{🛍️|🔥|✨} {اكتب اسم المنتج} — {جودة عالية|الأفضل في السوق|لا مثيل له}

{📦 المنتج يشمل|✅ ماذا ستحصل|🎁 الحزمة تتضمن}:
{✔️} {اكتب تفصيلة 1}
{✔️} {اكتب تفصيلة 2}
{✔️} {ضمان|استرجاع خلال 7 أيام|جودة مضمونة}

💰 السعر: {اكتب السعر} {فقط|جنيه|دولار}
{🚚 شحن لجميع المحافظات|التوصيل لباب البيت|استلام أو شحن}
📦 {متوفر الآن|كميات محدودة|اطلب الآن قبل النفاد}

{💬 واتساب|📞 اتصل|🛒 اطلب الآن}: {اكتب طريقة التواصل}

{#منتجات|#بيع_اونلاين} {#تجارة_مصر|#شراء_وبيع}`
  },

  // ── وظائف ───────────────────────────────────────────────────────
  {
    name: '💼 إعلان وظيفة — توظيف',
    category: 'وظائف وتوظيف',
    title: 'وظيفة شاغرة',
    price: '',
    condition: '',
    location: 'المدينة',
    body: 'إعلان وظيفة',
    result: `{🔔|💼|🎯} {مطلوب|نبحث عن|فرصة عمل لـ}: {اكتب المسمى الوظيفي}

📍 مكان العمل: {اكتب المدينة/المنطقة}
⏰ طبيعة العمل: {دوام كامل|دوام جزئي|عن بُعد|هجين}
💰 الراتب: {اكتب الراتب أو "يُحدد بعد المقابلة"}

📋 المتطلبات:
{✅} {اكتب شرط 1}
{✅} {اكتب شرط 2}
{✅} {خبرة {0-1|1-3|3-5} سنوات في المجال}

{🎁 المزايا|✨ نوفر}: {تأمين طبي|حوافز شهرية|بيئة عمل محترمة}

{📩 أرسل سيرتك الذاتية|💬 تواصل معنا|📞 للاستفسار} — {واتساب|إيميل|من التعليقات}

{#وظائف|#توظيف} {#وظائف_مصر|#فرص_عمل}`
  },

  // ── تعليم / كورسات ───────────────────────────────────────────────
  {
    name: '📚 كورس تدريبي — تعليم',
    category: 'تعليم وتدريب',
    title: 'كورس تدريبي',
    price: '',
    condition: '',
    location: 'أونلاين/حضوري',
    body: 'إعلان كورس',
    result: `{📚|🎓|🚀} {كورس|دورة تدريبية} في {اكتب التخصص} — {احترف|تعلّم|ابدأ مسيرتك}

{🎯 ستتعلم في هذا الكورس|✅ محتوى الدورة|📋 ماذا ستكتسب}:
{✔️} {اكتب مهارة 1}
{✔️} {اكتب مهارة 2}
{✔️} شهادة {معتمدة|حضور|إتمام} عند الانتهاء

⏱️ المدة: {اكتب المدة}
📅 الموعد: {اكتب موعد البدء}
💰 السعر: {اكتب السعر} — {قابل للتقسيط|دفعة واحدة|أول درس مجاني}
🖥️ {أونلاين مباشر|حضوري|تسجيلات + دعم}

{🔥 الأماكن محدودة|سارع بالتسجيل|احجز مكانك الآن}
{💬 تواصل|📞 اتصل|📩 سجّل} لمزيد من التفاصيل

{#تعليم|#كورسات_اونلاين} {#تدريب_مصر|#تطوير_مهني}`
  },

  // ── صحة وجمال ────────────────────────────────────────────────────
  {
    name: '💊 منتج صحي — صحة وجمال',
    category: 'صحة وجمال',
    title: 'منتج صحي',
    price: '',
    condition: 'أصلي',
    location: '',
    body: 'منتج صحي',
    result: `{💊|🌿|✨} {اكتب اسم المنتج} — {نتائج حقيقية|مجرّب ومضمون|غيّر حياتك}

{✅ فوائد المنتج|🌟 لماذا تختاره|⭐ مميزاته}:
{✔️} {اكتب فائدة 1}
{✔️} {اكتب فائدة 2}
{✔️} {طبيعي 100%|خالٍ من المواد الضارة|معتمد صحياً}

💰 السعر: {اكتب السعر}
🚚 {شحن سريع لجميع المحافظات|توصيل لباب البيت|استلام أو توصيل}
{⚠️ أصلي 100%|ضمان الجودة|مع الفاتورة}

{📞 اطلب الآن|💬 واتساب|🛒 احجز قبل النفاد}

{#صحة|#جمال} {#منتجات_صحية|#صحة_مصر}`
  },

  // ── مطاعم / أكل ──────────────────────────────────────────────────
  {
    name: '🍽️ مطعم / طعام — مطاعم',
    category: 'مطاعم وأكل',
    title: 'إعلان مطعم',
    price: '',
    condition: '',
    location: 'المنطقة',
    body: 'إعلان مطعم',
    result: `{🍽️|😋|🔥} {اكتب اسم المطعم أو الأكل} — {جرّب الفرق|طعم لا يُنسى|يستاهل الزيارة}

{🌟 ليه تيجي عندنا|✅ مميزاتنا|⭐ اللي بيميزنا}:
{✔️} {خامات طازجة يومياً|طبخ بيتي بامتياز|وصفات أصيلة}
{✔️} {أسعار تنافسية|بورشن كبير|تجربة لا تُنسى}
{✔️} {توصيل سريع|خدمة كريمة|جلسات مريحة}

📍 موقعنا: {اكتب العنوان}
⏰ أوقات العمل: {اكتب الأوقات}
{🛵 بنوصل|📦 تيك أواي|🍽️ أكل في المكان} — {اتصل|واتساب|اطلب اونلاين}

{#مطاعم|#أكل_مصر} {#طعام_مصري|#توصيل_أكل}`
  },

  // ── تقنية / ديجيتال ──────────────────────────────────────────────
  {
    name: '💻 خدمة تقنية — تقنية',
    category: 'تقنية وديجيتال',
    title: 'خدمة تقنية',
    price: '',
    condition: '',
    location: 'أونلاين',
    body: 'خدمة تقنية',
    result: `{💻|🚀|⚡} {اكتب اسم الخدمة} — {احترافية|بدون مجهود منك|نتائج مضمونة}

{🎯 خدمتنا تشمل|✅ ماذا نقدم|🔥 لماذا نحن}:
{✔️} {اكتب تفصيلة 1}
{✔️} {اكتب تفصيلة 2}
{✔️} {تسليم في الوقت|دعم فني مستمر|تعديلات لحين الرضا}

💰 {يبدأ من|أسعار تبدأ من} {اكتب السعر}
⏱️ {وقت التسليم}: {اكتب الوقت}
{🌍 نخدم عملاء من كل العالم|عمل عن بُعد|تواصل اونلاين}

{📩 اطلب عرض سعر|💬 تواصل الآن|🤝 احجز استشارة مجانية}

{#تقنية|#ديجيتال_ماركتنج} {#برمجة|#تصميم_مصر}`
  }
];

async function seedPresetTemplates() {
  try {
    const data = await storageGet(['postTemplates', 'presetsSeeded_v16']);
    if (data.presetsSeeded_v16) return; // already seeded
    const existing = data.postTemplates || [];
    if (existing.length > 0) {
      // user already has templates — only seed if they confirm or just append presets
      await storageSet({ presetsSeeded_v16: true });
      return;
    }
    // First time: seed all presets
    await storageSet({ postTemplates: PRESET_TEMPLATES, presetsSeeded_v16: true });
    toast('✅ تم تحميل ' + PRESET_TEMPLATES.length + ' قوالب جاهزة لكل المجالات!');
  } catch(e) { /* silent */ }
}

document.addEventListener('DOMContentLoaded', async () => {
  connectDashboardKeepAlive();
  await seedPresetTemplates();

  const topPanelBindMap = { 'btn-tab-home': 'tab-home', 'btn-tab-tool1': 'tab-tool1', 'btn-tab-tool2': 'tab-tool2', 'btn-tab-pricing-page': 'tab-pricing-page' };
  Object.keys(topPanelBindMap).forEach(id => {
    const btn = $('#' + id);
    if (!btn) return;
    btn.addEventListener('click', function() {
      const panelId = topPanelBindMap[id];
      $$('.d-panel').forEach(p => p.classList.toggle('active', p.id === panelId));
      Object.keys(topPanelBindMap).forEach(otherId => { const b = $('#' + otherId); if (b) b.classList.toggle('active', otherId === id); });
      if (panelId === 'tab-tool1') {
        switchTab('discover');
        /* Belt-and-suspenders: force discover visible after every DOM paint */
        requestAnimationFrame(() => {
          const _ds = document.getElementById('tab-discover');
          if (_ds) { _ds.classList.add('active'); _ds.style.display = 'block'; }
        });
        setTimeout(() => {
          const _ds = document.getElementById('tab-discover');
          if (_ds) { _ds.classList.add('active'); _ds.style.display = 'block'; }
        }, 80);
      }
      if (panelId === 'tab-tool2' && !document.querySelector('.nav-btn.active[data-tab]')) switchTab('campaign');
      if (location.hash !== '#home' && panelId === 'tab-home') history.replaceState(null, '', '#home');
    });
  });
  $$('.nav-btn').forEach(btn => {
    btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
    const activateTab = evt => {
      if (evt && evt.cancelable) evt.preventDefault();
      switchTab(btn.dataset.tab);
    };
    btn.addEventListener('click', activateTab);
    btn.addEventListener('touchend', activateTab, { passive: false });
  });

  /* ── DISCOVER TAB GUARD ─────────────────────────────────────────────
     MutationObserver: whenever #tab-tool1 gains the 'active' class,
     immediately force #tab-discover to be visible — no matter what
     other code ran between the click and the DOM paint.
     ─────────────────────────────────────────────────────────────── */
  (function installDiscoverGuard() {
    const outerPanel   = document.getElementById('tab-tool1');
    const innerSection = document.getElementById('tab-discover');
    if (!outerPanel || !innerSection) return;

    function forceDiscoverVisible() {
      if (!outerPanel.classList.contains('active')) return;
      /* Make sure the inner section has its active class AND is displayed */
      if (!innerSection.classList.contains('active')) innerSection.classList.add('active');
      innerSection.style.display = 'block';
    }

    /* Watch for class changes on the outer d-panel */
    new MutationObserver(forceDiscoverVisible)
      .observe(outerPanel, { attributes: true, attributeFilter: ['class'] });

    /* Also re-enforce after every refreshAll (call to renderDiscoverResults
       can briefly touch related DOM; this makes the guard idempotent) */
    const origRenderDiscoverResults = window.renderDiscoverResults;
    if (typeof renderDiscoverResults === 'function') {
      const _orig = renderDiscoverResults;
      window._guardedRenderDiscoverResults = function() {
        _orig();
        requestAnimationFrame(forceDiscoverVisible);
      };
    }

    /* Touch-based navigation in Kiwi: fire on touchend of the outer tab too */
    const outerBtn = document.getElementById('btn-tab-tool1');
    if (outerBtn) {
      outerBtn.addEventListener('touchend', function() {
        requestAnimationFrame(forceDiscoverVisible);
        setTimeout(forceDiscoverVisible, 120);
      }, { passive: true });
    }
  })();

  const initialTab = (location.hash || '').replace('#', '');
  if (initialTab && document.getElementById(`tab-${initialTab}`)) switchTab(initialTab);
  $('#openFacebookBtn').onclick = () => chrome.tabs.create({ url: 'https://www.facebook.com/' });
  $('#openPopupBtn').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=full') });
  $('#stopNowBtn').onclick = stopCampaign;
  $('#runDiscoverBtn').onclick = runDiscovery;
  $('#saveSearchResultsBtn').onclick = saveLatestResultsAgain;
  if ($('#exportDiscoverJsonBtn')) $('#exportDiscoverJsonBtn').onclick = exportDiscoverJson;
  if ($('#exportDiscoverCsvBtn')) $('#exportDiscoverCsvBtn').onclick = exportDiscoverCsv;
  $('#librarySearch').oninput = refreshAll;
  $('#libraryCategoryFilter').onchange = refreshAll;
  $('#selectAllLibraryBtn').onclick = async () => {
    const data = await storageGet(['groupsLibrary']);
    await storageSet({ groupsLibrary: (data.groupsLibrary || []).map(g => ({ ...g, selected: true })) });
    await refreshAll();
  };
  $('#clearLibrarySelectionBtn').onclick = async () => {
    const data = await storageGet(['groupsLibrary']);
    await storageSet({ groupsLibrary: (data.groupsLibrary || []).map(g => ({ ...g, selected: false })) });
    await refreshAll();
  };
  $('#buildTemplateBtn').onclick = () => { $('#tplResult').value = buildTemplateText(); $('#campaignContent').value = $('#tplResult').value; toast('تم تجهيز النص'); };
  $('#saveTemplateBtn').onclick = saveTemplate;
  if ($('#tplPresetPicker')) $('#tplPresetPicker').onchange = e => { if (e.target.value) applyTemplatePreset(e.target.value); };
  if ($('#aiGenerateTplBtn')) $('#aiGenerateTplBtn').onclick = () => {
    const idea = ($('#tplAiIdea') && $('#tplAiIdea').value || '').trim();
    const industry = ($('#tplPresetPicker') && $('#tplPresetPicker').value) || '';
    generateTemplateWithAI(idea, industry);
  };
  $('#templatePicker').onchange = async e => {
    const idx = Number(e.target.value);
    if (Number.isNaN(idx)) return;
    const data = await storageGet(['postTemplates']);
    const t = (data.postTemplates || [])[idx];
    if (t) { $('#campaignContent').value = t.result || ''; toast('تم تحميل القالب للحملة'); }
  };
  $('#campaignMedia').onchange = async e => {
    mediaFiles = await filesToData(e.target.files);
    $('#mediaPreview').innerHTML = mediaFiles.map(f => `<span class="chip">${esc(f.name)}</span>`).join('');
    toast(`تم تحميل ${mediaFiles.length} ملف`);
  };
  $('#startCampaignBtn').onclick = startCampaign;
  $('#stopCampaignBtn').onclick = stopCampaign;
  if ($('#enableFirstComment')) {
    $('#enableFirstComment').addEventListener('change', function() {
      applyEnableFirstCommentUI();
      saveDashboardFormState();
    });
    applyEnableFirstCommentUI();
  }
  // حفظ تلقائي للحقول عند الكتابة أو تغيير التبويب/إخفاء الصفحة (موبايل)
  const autoSaveIds = ['campaignContent','campaignComment','campaignName','campaignMinDelay','campaignMaxDelay','campaignPostMode','repeatCycleValue','repeatCycleUnit','librarySearch','competitorPostUrl'];
  autoSaveIds.forEach(function(id) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('input', function() { clearTimeout(window.__fbbfSaveT); window.__fbbfSaveT = setTimeout(saveDashboardFormState, 400); });
    el.addEventListener('change', function() { saveDashboardFormState(); });
  });
  ['repeatCycleEnabled','libraryCategoryFilter'].forEach(function(id) {
    const el = $('#' + id);
    if (el) el.addEventListener('change', function() { saveDashboardFormState(); });
  });
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) saveDashboardFormState();
  });
  window.addEventListener('pagehide', function() { saveDashboardFormState(); });
  window.addEventListener('beforeunload', function() { saveDashboardFormState(); });
  $('#extractCommentsBtn').onclick = extractComments;
  $('#exportCommentsBtn').onclick = exportComments;
  if ($('#exportCommentsCsvBtn')) $('#exportCommentsCsvBtn').onclick = exportCommentsCsv;
  if ($('#exportLogJsonBtn')) $('#exportLogJsonBtn').onclick = exportLogJson;
  if ($('#exportLogCsvBtn')) $('#exportLogCsvBtn').onclick = exportLogCsv;
  if ($('#exportBulkReportJsonBtn')) $('#exportBulkReportJsonBtn').onclick = exportLastBulkReportJson;
  if ($('#exportBulkReportCsvBtn')) $('#exportBulkReportCsvBtn').onclick = exportLastBulkReportCsv;
  if ($('#clearLogBtn')) $('#clearLogBtn').onclick = clearInteractionLog;
  if ($('#pasteToFavBtn')) $('#pasteToFavBtn').onclick = pasteNamesToFavorites;
  if ($('#pasteToDNRBtn')) $('#pasteToDNRBtn').onclick = pasteNamesToDNR;
  $('#saveReplyTemplateBtn').onclick = saveReplyTemplate;
  $('#bulkReplyBtn').onclick = bulkReply;
  $('#bulkMessageBtn').onclick = bulkPrivateMessages;
  ['commentSearchInput','excludeNamesInput','excludeKeywordsInput','minCommentLengthInput'].forEach(id => { const el = $('#' + id); if (el) el.oninput = applyCommentFilters; });
  ['commentSortSelect','onlyProfileComments','onlyReplyThreads','skipSpamComments','uniqueProfilesOnly'].forEach(id => { const el = $('#' + id); if (el) el.onchange = applyCommentFilters; });

  chrome.tabs.query({ url: ['*://www.facebook.com/*', '*://facebook.com/*', '*://m.facebook.com/*', '*://web.facebook.com/*'] }, tabs => {
    const text = tabs && tabs.length ? 'Facebook مفتوح' : 'افتح Facebook';
    $('#sessionIndicator').textContent = text;
    if ($('#overviewSession')) $('#overviewSession').textContent = text;
  });

  await refreshAll();
  renderDiscoverResults();
  renderComments();
  setInterval(refreshTracking, 2000);

  // ── Boot new features ──
  initScheduler();
  initAnalyticsChart();
  initABTest();
  initMultiProfile();
  initReferral();
  initWebhook();
  renderBestGroups();
  setInterval(renderBestGroups, 60000);

  // زرار "تحديث" أفضل المجموعات — كان inline onclick قبل كده وده بيتعارض
  // مع CSP (script-src 'self')، فبيتفشل بصمت. اتحول لـ addEventListener.
  var refreshBestGroupsBtn = $('#refreshBestGroupsBtn');
  if (refreshBestGroupsBtn) {
    refreshBestGroupsBtn.addEventListener('click', renderBestGroups);
  }
});

/* ════════════════════════════════════════════════════════════════════
   FEATURE 2 — SCHEDULER: Schedule campaigns for a future date/time
   Fully isolated from live posting queue. Uses SCHEDULE_CAMPAIGN
   message → background.js alarm → fireScheduledCampaign().
   ════════════════════════════════════════════════════════════════════ */
function initScheduler() {
  const form       = $('#scheduleForm');
  const dtInput    = $('#scheduleDateTime');
  const titleInput = $('#scheduleTitle');
  const saveBtn    = $('#scheduleBtn');
  const listEl     = $('#scheduleList');
  if (!form || !saveBtn) return;

  // Set min datetime to now + 2 minutes
  const setMin = () => {
    const now = new Date(Date.now() + 120000);
    const pad = n => String(n).padStart(2, '0');
    dtInput.min = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  };
  setMin();
  setInterval(setMin, 60000);

  saveBtn.onclick = async () => {
    const dt = dtInput.value;
    if (!dt) { toast('⚠️ حدد التاريخ والوقت'); return; }
    const scheduledAt = new Date(dt).getTime();
    if (isNaN(scheduledAt) || scheduledAt - Date.now() < 30000) { toast('⚠️ اختر وقتاً بعد الآن بـ 30 ثانية على الأقل'); return; }

    const payload = await buildCurrentCampaignPayload();
    if (!payload.groups || payload.groups.length === 0) { toast('⚠️ لا توجد مجموعات محددة للجدولة'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ جاري الجدولة…';
    try {
      const resp = await msgBg({ action: 'SCHEDULE_CAMPAIGN', payload, scheduledAt, title: titleInput.value.trim() || `حملة ${dt}` });
      if (resp && resp.ok) {
        toast('✅ تم جدولة الحملة بنجاح!');
        dtInput.value = ''; titleInput.value = '';
        renderScheduleList();
      } else {
        toast('❌ ' + ((resp && resp.message) || 'فشل الجدولة'));
      }
    } catch (e) { toast('❌ خطأ: ' + e.message); }
    finally { saveBtn.disabled = false; saveBtn.innerHTML = '📅 جدول الحملة'; }
  };

  renderScheduleList();
  setInterval(renderScheduleList, 15000);
}

async function buildCurrentCampaignPayload() {
  const data = await storageGet(null);
  return {
    content:       data.campaignContent || data.postContent || '',
    groups:        data.selectedGroups  || data.targetGroups || [],
    delay:         data.delayBetweenPosts || 30,
    mediaFiles:    [],
    randomizeOrder: !!data.randomizeOrder,
    spintax:       !!data.spintaxEnabled
  };
}

async function renderScheduleList() {
  const el = $('#scheduleList');
  if (!el) return;
  let resp;
  try { resp = await msgBg({ action: 'GET_SCHEDULES' }); } catch (_) { return; }
  const list = (resp && resp.list) || [];
  if (!list.length) { el.innerHTML = '<div class="empty-state">لا توجد حملات مجدولة بعد.</div>'; return; }
  const statusLabel = { pending: '⏳ منتظر', running: '🔄 يعمل', completed: '✅ منتهي', failed: '❌ فشل', cancelled: '🚫 ملغي' };
  const statusClass = { pending: 'warn', running: 'ok', completed: 'ok', failed: 'fail', cancelled: '' };
  el.innerHTML = list.slice().reverse().map(s => `
    <div class="row-item">
      <div style="flex:1;min-width:0;">
        <div class="row-title">${esc(s.title || 'حملة مجدولة')}</div>
        <div class="row-meta">📅 ${new Date(s.scheduledAt).toLocaleString('ar-EG')} &nbsp;|&nbsp; ${s.payload && s.payload.groups ? s.payload.groups.length + ' مجموعة' : ''}</div>
        ${s.resultSummary ? `<div class="row-meta">${esc(s.resultSummary)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
        <span class="pill ${statusClass[s.status] || ''}">${statusLabel[s.status] || s.status}</span>
        ${s.status === 'pending' ? `<button class="small-btn warn-btn" onclick="cancelSchedule('${esc(s.id)}')">إلغاء</button>` : ''}
      </div>
    </div>`).join('');
}

async function cancelSchedule(id) {
  if (!confirm('إلغاء الحملة المجدولة؟')) return;
  await msgBg({ action: 'CANCEL_SCHEDULE', id });
  toast('تم الإلغاء');
  renderScheduleList();
}

function msgBg(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, r => resolve(r)));
}

/* ════════════════════════════════════════════════════════════════════
   FEATURE 3 — ANALYTICS CHART
   Canvas-based (no external libs, CSP-safe). Shows last-14-days
   posting activity from existing postLog storage key.
   ════════════════════════════════════════════════════════════════════ */
function initAnalyticsChart() {
  const canvas = $('#analyticsCanvas');
  if (!canvas) return;
  renderAnalyticsChart();
  setInterval(renderAnalyticsChart, 30000);
}

async function renderAnalyticsChart() {
  const canvas = $('#analyticsCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 600;
  const H = canvas.height = 180;

  const data = await storageGet(['postLog']);
  const log = data.postLog || [];

  // Aggregate last 14 days
  const days = 14;
  const buckets = {};
  const labels = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { ok: 0, fail: 0, commentFail: 0 };
    labels.push(key.slice(5)); // MM-DD
  }
  log.forEach(entry => {
    const k = new Date(entry.timestamp || entry.ts || entry.time || 0).toISOString().slice(0, 10);
    if (buckets[k]) {
      if (entry.status === 'ok' || entry.success) buckets[k].ok++;
      else buckets[k].fail++;
      if (entry.commentStatus === 'failed') buckets[k].commentFail++;
    }
  });

  const vals = Object.values(buckets);
  const maxVal = Math.max(1, ...vals.map(v => v.ok + v.fail));

  // Draw
  ctx.clearRect(0, 0, W, H);

  const padL = 32, padR = 16, padT = 16, padB = 38;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = Math.floor(chartW / days) - 4;

  // Grid lines
  ctx.strokeStyle = 'rgba(45,212,191,0.10)';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(t => {
    const y = padT + chartH * (1 - t);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(45,212,191,0.35)';
    ctx.font = '10px Cairo,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * t), padL - 4, y + 3);
  });

  // Bars
  vals.forEach((v, i) => {
    const x = padL + i * (chartW / days) + 2;
    const totalH = Math.max(0, chartH * (v.ok + v.fail) / maxVal);
    const okH    = Math.max(0, chartH * v.ok   / maxVal);
    const failH  = totalH - okH;

    // fail (red, top)
    if (failH > 0) {
      ctx.fillStyle = 'rgba(252,165,165,0.55)';
      ctx.beginPath();
      ctx.roundRect(x, padT + chartH - totalH, barW, failH, [3, 3, 0, 0]);
      ctx.fill();
    }
    // ok (gold)
    if (okH > 0) {
      const grad = ctx.createLinearGradient(0, padT + chartH - okH, 0, padT + chartH);
      grad.addColorStop(0, 'rgba(45,212,191,0.90)');
      grad.addColorStop(1, 'rgba(19,78,74,0.70)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, padT + chartH - okH, barW, okH, failH > 0 ? [0,0,0,0] : [3,3,0,0]);
      ctx.fill();
    }
    // label
    ctx.fillStyle = 'rgba(184,175,160,0.85)';
    ctx.font = '9px Cairo,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW / 2, H - 6);

    // نقطة كهرمانية صغيرة فوق العمود لو فيه فشل تعليق أول في هذا اليوم —
    // إشارة إضافية بدون التأثير على ارتفاع/شكل العمود نفسه
    if (v.commentFail > 0) {
      ctx.fillStyle = 'rgba(252,211,77,0.9)';
      ctx.beginPath();
      ctx.arc(x + barW / 2, padT + chartH - totalH - 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Legend
  ctx.font = '10px Cairo,sans-serif'; ctx.textAlign = 'right';
  [[W - padR, 'rgba(45,212,191,0.9)', 'نجاح'], [W - padR - 55, 'rgba(252,165,165,0.7)', 'فشل']].forEach(([lx, color, label]) => {
    ctx.fillStyle = color; ctx.fillRect(lx - 8, padT - 2, 8, 8);
    ctx.fillStyle = 'rgba(184,175,160,0.8)'; ctx.fillText(label, lx - 12, padT + 7);
  });
  // legend الخاص بمؤشر فشل التعليق — نقطة دائرية بدل مربع، اتساقًا مع رسمها فوق الأعمدة
  ctx.fillStyle = 'rgba(252,211,77,0.9)';
  ctx.beginPath(); ctx.arc(W - padR - 115, padT + 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(184,175,160,0.8)';
  ctx.fillText('💬 فشل تعليق', W - padR - 120, padT + 7);

  // Update summary numbers
  const totalOk   = vals.reduce((s, v) => s + v.ok,   0);
  const totalFail = vals.reduce((s, v) => s + v.fail,  0);
  if ($('#analyticsOk'))   $('#analyticsOk').textContent   = totalOk;
  if ($('#analyticsFail')) $('#analyticsFail').textContent  = totalFail;
  if ($('#analyticsTotal'))$('#analyticsTotal').textContent = totalOk + totalFail;
  if ($('#analyticsDays')) $('#analyticsDays').textContent  = days;
}

/* ════════════════════════════════════════════════════════════════════
   FEATURE 4 — A/B TESTING
   Stores two content variants A & B, tracks which performed better
   via the existing postLog (linked by campaignId tag).
   ════════════════════════════════════════════════════════════════════ */
function initABTest() {
  const runBtn = $('#abRunBtn');
  const saveBtn = $('#abSaveBtn');
  if (!runBtn) return;

  // Load saved variants
  (async () => {
    const d = await storageGet(['abVariants']);
    if (d.abVariants) {
      if ($('#abVariantA')) $('#abVariantA').value = d.abVariants.a || '';
      if ($('#abVariantB')) $('#abVariantB').value = d.abVariants.b || '';
    }
    renderABStats();
  })();

  if (saveBtn) saveBtn.onclick = async () => {
    const a = ($('#abVariantA') && $('#abVariantA').value.trim()) || '';
    const b = ($('#abVariantB') && $('#abVariantB').value.trim()) || '';
    if (!a || !b) { toast('⚠️ اكتب النسختين A و B'); return; }
    await storageSet({ abVariants: { a, b, savedAt: Date.now() } });
    toast('✅ تم حفظ النسختين');
  };

  runBtn.onclick = async () => {
    const a = ($('#abVariantA') && $('#abVariantA').value.trim()) || '';
    const b = ($('#abVariantB') && $('#abVariantB').value.trim()) || '';
    if (!a || !b) { toast('⚠️ اكتب النسختين أولاً'); return; }
    // Pick a random variant for this run, tag the campaignContent
    const chosen = Math.random() < 0.5 ? 'A' : 'B';
    const content = chosen === 'A' ? a : b;
    await storageSet({ campaignContent: content, abActiveVariant: chosen, abTestRunAt: Date.now() });
    if ($('#campaignContent')) $('#campaignContent').value = content;
    toast(`🎲 تم اختيار النسخة ${chosen} عشوائياً — يمكنك البدء الآن`);
    if ($('#abActiveLabel')) $('#abActiveLabel').textContent = 'النسخة النشطة الآن: ' + chosen;
    renderABStats();
  };
}

async function renderABStats() {
  const el = $('#abStatsEl');
  if (!el) return;
  const data = await storageGet(['postLog', 'abVariants', 'abActiveVariant']);
  const log = data.postLog || [];
  const aLogs = log.filter(e => e.abVariant === 'A');
  const bLogs = log.filter(e => e.abVariant === 'B');
  const rate  = arr => arr.length ? Math.round(arr.filter(e => e.status === 'ok' || e.success).length / arr.length * 100) : 0;
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="row-item" style="flex-direction:column;gap:4px;">
        <div style="font-size:11px;font-weight:800;color:var(--p2);">النسخة A</div>
        <div style="font-size:22px;font-weight:900;color:var(--ok);">${rate(aLogs)}%</div>
        <div class="row-meta">${aLogs.length} تشغيل — ${aLogs.filter(e=>e.status==='ok'||e.success).length} نجاح</div>
      </div>
      <div class="row-item" style="flex-direction:column;gap:4px;">
        <div style="font-size:11px;font-weight:800;color:var(--p2);">النسخة B</div>
        <div style="font-size:22px;font-weight:900;color:var(--ok);">${rate(bLogs)}%</div>
        <div class="row-meta">${bLogs.length} تشغيل — ${bLogs.filter(e=>e.status==='ok'||e.success).length} نجاح</div>
      </div>
    </div>
    ${aLogs.length + bLogs.length === 0 ? '<div class="empty-state">ابدأ تشغيل A/B لترى الإحصاءات هنا</div>' : ''}
    ${rate(aLogs) !== rate(bLogs) && (aLogs.length + bLogs.length) > 4 ?
      `<div class="note" style="margin-top:10px;">🏆 النسخة ${rate(aLogs) > rate(bLogs) ? 'A' : 'B'} تؤدي أفضل بفارق ${Math.abs(rate(aLogs)-rate(bLogs))}%</div>` : ''}`;
}

/* ════════════════════════════════════════════════════════════════════
   FEATURE 5 — MULTI-PROFILE (Profile Switcher)
   Save/restore named profiles of key campaign settings. Zero server
   dependency — stored in chrome.storage.local only.
   ════════════════════════════════════════════════════════════════════ */
const PROFILE_FIELDS = ['campaignContent','selectedGroups','delayBetweenPosts','randomizeOrder',
                        'spintaxEnabled','apiKey','aiApiKey','groqApiKey','postTemplates',
                        'abVariants','scheduleTitle'];

function initMultiProfile() {
  const saveBtn   = $('#profileSaveBtn');
  const nameEl    = $('#profileNameInput');
  const listEl    = $('#profileList');
  if (!saveBtn) return;

  saveBtn.onclick = async () => {
    const name = (nameEl && nameEl.value.trim()) || '';
    if (!name) { toast('⚠️ اكتب اسماً للبروفايل'); return; }
    const snapshot = await storageGet(PROFILE_FIELDS);
    const d = await storageGet(['savedProfiles']);
    const profiles = d.savedProfiles || {};
    profiles[name] = { name, snapshot, savedAt: Date.now() };
    await storageSet({ savedProfiles: profiles });
    toast('✅ تم حفظ البروفايل: ' + name);
    renderProfileList();
  };

  renderProfileList();
}

async function renderProfileList() {
  const el = $('#profileList');
  if (!el) return;
  const d = await storageGet(['savedProfiles', 'activeProfile']);
  const profiles = d.savedProfiles || {};
  const active   = d.activeProfile || '';
  const keys = Object.keys(profiles);
  if (!keys.length) { el.innerHTML = '<div class="empty-state">لا توجد بروفايلات محفوظة بعد.</div>'; return; }
  el.innerHTML = keys.map(k => {
    const p = profiles[k];
    const isActive = k === active;
    const grpCount = (p.snapshot && p.snapshot.selectedGroups && p.snapshot.selectedGroups.length) || 0;
    return `<div class="row-item">
      <div style="flex:1;min-width:0;">
        <div class="row-title">${esc(k)} ${isActive ? '<span class="pill" style="font-size:10px;">نشط</span>' : ''}</div>
        <div class="row-meta">${grpCount} مجموعة — ${new Date(p.savedAt).toLocaleDateString('ar-EG')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="small-btn soft" onclick="loadProfile(${JSON.stringify(k)})">تحميل</button>
        <button class="small-btn warn-btn" onclick="deleteProfile(${JSON.stringify(k)})">حذف</button>
      </div>
    </div>`;
  }).join('');
}

async function loadProfile(name) {
  const d = await storageGet(['savedProfiles']);
  const p = d.savedProfiles && d.savedProfiles[name];
  if (!p) { toast('البروفايل غير موجود'); return; }
  await storageSet({ ...p.snapshot, activeProfile: name });
  toast('✅ تم تحميل البروفايل: ' + name);
  // Refresh visible fields if on campaign panel
  if ($('#campaignContent') && p.snapshot.campaignContent)
    $('#campaignContent').value = p.snapshot.campaignContent;
}

async function deleteProfile(name) {
  if (!confirm(`حذف البروفايل "${name}"؟`)) return;
  const d = await storageGet(['savedProfiles']);
  const profiles = d.savedProfiles || {};
  delete profiles[name];
  await storageSet({ savedProfiles: profiles });
  toast('تم الحذف');
  renderProfileList();
}

/* ════════════════════════════════════════════════════════════════════
   STEP 3 — REFERRAL SYSTEM
   Each user gets a unique referral code stored locally.
   They share it → referred users enter it at registration.
   Admin sees referral stats in the server admin panel.
   ════════════════════════════════════════════════════════════════════ */
function initReferral() {
  const el = $('#referralSection');
  if (!el) return;
  (async () => {
    const d = await storageGet(['userEmail','referralCode','referralCount']);
    let code = d.referralCode || '';
    if (!code && d.userEmail) {
      // Generate deterministic code from email
      code = 'BAB-' + btoa(d.userEmail).replace(/[^A-Z0-9]/gi,'').slice(0,6).toUpperCase();
      await storageSet({ referralCode: code });
    }
    const count = d.referralCount || 0;
    if ($('#referralCode'))  $('#referralCode').textContent  = code || '—';
    if ($('#referralCount')) $('#referralCount').textContent = count;
    if ($('#referralLink'))  $('#referralLink').textContent  = `https://faset.xo.je/?ref=${code}`;
  })();

  if ($('#copyReferralBtn')) $('#copyReferralBtn').onclick = async () => {
    const d = await storageGet(['referralCode']);
    const link = `https://faset.xo.je/?ref=${d.referralCode || ''}`;
    try { await navigator.clipboard.writeText(link); toast('✅ تم نسخ رابط الإحالة!'); }
    catch(_) { toast('اضغط مطولاً للنسخ'); }
  };

  if ($('#shareWhatsAppBtn')) $('#shareWhatsAppBtn').onclick = async () => {
    const d = await storageGet(['referralCode']);
    const msg = encodeURIComponent(
      `🚀 جرّب إضافة fb Bablushr F — أتمتة النشر على فيسبوك بالذكاء الاصطناعي!\nسجّل من هنا: https://faset.xo.je/?ref=${d.referralCode || ''}`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };
}

/* ════════════════════════════════════════════════════════════════════
   STEP 4 — SMART BEST GROUPS REPORT
   Reads existing postLog → ranks groups by success rate → shows top 10
   Zero extra data collection needed, uses what's already stored.
   ════════════════════════════════════════════════════════════════════ */
async function renderBestGroups() {
  const el = $('#bestGroupsEl');
  if (!el) return;

  const d = await storageGet(['postLog']);
  const log = d.postLog || [];

  if (log.length < 5) {
    el.innerHTML = '<div class="empty-state">انشر في 5+ مجموعات أولاً لتظهر هنا أفضل مجموعاتك.</div>';
    return;
  }

  // Aggregate by group name/url
  const map = {};
  log.forEach(e => {
    const key = e.groupName || e.groupUrl || e.group || '—';
    if (!map[key]) map[key] = { name: key, ok: 0, fail: 0 };
    if (e.success || e.status === 'ok') map[key].ok++;
    else map[key].fail++;
  });

  const ranked = Object.values(map)
    .filter(g => g.ok + g.fail >= 2)
    .map(g => ({ ...g, rate: Math.round(g.ok / (g.ok + g.fail) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.ok - a.ok)
    .slice(0, 10);

  if (!ranked.length) {
    el.innerHTML = '<div class="empty-state">لا توجد بيانات كافية بعد.</div>';
    return;
  }

  el.innerHTML = ranked.map((g, i) => `
    <div class="row-item">
      <div style="font-size:16px;font-weight:900;color:${i<3?'var(--p2)':'var(--t3)'};width:24px;flex-shrink:0;">#${i+1}</div>
      <div style="flex:1;min-width:0;">
        <div class="row-title">${esc(g.name)}</div>
        <div class="row-meta">✅ ${g.ok} نجاح &nbsp;|&nbsp; ❌ ${g.fail} فشل</div>
      </div>
      <div style="font-size:20px;font-weight:900;color:${g.rate>=80?'var(--ok)':g.rate>=50?'var(--warn)':'var(--err)'};">
        ${g.rate}%
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════════
   STEP 5 — WEBHOOK SETTINGS (WhatsApp / Telegram / Generic)
   Settings saved to chrome.storage → background.js reads on campaign end
   ════════════════════════════════════════════════════════════════════ */
function initWebhook() {
  const saveBtn = $('#webhookSaveBtn');
  if (!saveBtn) return;

  (async () => {
    const d = await storageGet(['webhookUrl','webhookEnabled']);
    if ($('#webhookUrl'))     $('#webhookUrl').value     = d.webhookUrl    || '';
    if ($('#webhookEnabled')) $('#webhookEnabled').checked = !!d.webhookEnabled;
  })();

  saveBtn.onclick = async () => {
    const url     = ($('#webhookUrl')     && $('#webhookUrl').value.trim())   || '';
    const enabled = ($('#webhookEnabled') && $('#webhookEnabled').checked)    || false;
    await storageSet({ webhookUrl: url, webhookEnabled: enabled });
    toast(enabled && url ? '✅ تم حفظ الإشعارات — ستصلك بعد كل حملة' : '💾 تم الحفظ');
  };

  if ($('#webhookTestBtn')) $('#webhookTestBtn').onclick = async () => {
    const d = await storageGet(['webhookUrl','webhookEnabled']);
    if (!d.webhookUrl) { toast('⚠️ أدخل الرابط أولاً'); return; }
    chrome.runtime.sendMessage({
      action: 'TEST_WEBHOOK', url: d.webhookUrl
    });
    toast('📤 تم إرسال تجريبي — تحقق من واتساب/تيليجرام');
  };
}