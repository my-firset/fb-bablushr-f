<?php
/**
 * version.php — نقطة فحص التحديثات اللي الإضافة بتناديها تلقائيًا كل 4
 * ساعات (UPDATE_CHECK_URL في background.js). كانت الإضافة بتحاول تتصل
 * بيها من البداية لكن الملف نفسه ما كانش موجود، فالتنبيه كان بيفشل
 * بصمت طول الوقت (try/catch بيبلع الخطأ).
 *
 * بيرجّع نفس شكل البيانات اللي الكود في background.js متوقعه بالظبط:
 * { ok, version, notes, zip_url }
 */
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';
fbbf_handle_options();

// حد أقصى معقول جدًا (الإضافة بتنادي كل 4 ساعات لكل مستخدم، فمفيش داعي
// لحد صارم، لكن بيمنع أي استغلال غريب للـ endpoint العام)
fbbf_enforce_rate_limit('version_check', 30, 60);

$config = fbbf_config();
$releaseLog = $config['release_log'] ?? [];
// نفس افتراض الترتيب المستخدم في admin/index.php (array_reverse لعرض الأحدث
// فوق) — يعني آخر عنصر في المصفوفة هو الأحدث زمنيًا، مش الأول.
$latestRelease = $releaseLog ? end($releaseLog) : null;

fbbf_json_response([
    'ok'      => true,
    'version' => (string)($config['extension_version'] ?? ''),
    'notes'   => (string)($latestRelease['notes'] ?? ''),
    'zip_url' => 'https://faset.xo.je/' . (string)($config['extension_filename'] ?? ''),
]);
