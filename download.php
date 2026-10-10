<?php
/**
 * download.php — تقديم ملف الإضافة + عداد التحميلات
 * يقبل: تحميل عام | جلسة مستخدم مسجّل | dtoken لمرة واحدة
 */
declare(strict_types=1);
require __DIR__ . '/includes/bootstrap.php';

$root       = __DIR__;
$configFile = $root . '/data/app-config.json';
$statsFile  = $root . '/data/download-stats.json';

$email = '';
$allowed = false;

if (fbbf_public_downloads_enabled()) {
    $allowed = true;
    $email = fbbf_current_user_email();
} else {
    // 1) جلسة موقع (الأكثر ثباتًا بعد تسجيل الدخول)
    $sessEmail = fbbf_current_user_email();
    if ($sessEmail !== '') {
        $usersForCheck = fbbf_users();
        $checkIdx = fbbf_find_user_index($usersForCheck, $sessEmail);
        if ($checkIdx !== -1 && !empty(fbbf_compute_user_state($usersForCheck[$checkIdx])['access_granted'])) {
            $allowed = true;
            $email = $sessEmail;
        }
    }
    // 2) توكين تحميل لمرة واحدة
    if (!$allowed) {
        $emailGet = fbbf_normalize_email((string)($_GET['email'] ?? ''));
        $dtoken = (string)($_GET['dtoken'] ?? '');
        if (filter_var($emailGet, FILTER_VALIDATE_EMAIL) && $dtoken !== '') {
            $verifiedEmail = fbbf_consume_download_token($dtoken);
            if ($verifiedEmail !== null && strcasecmp($verifiedEmail, $emailGet) === 0) {
                $usersForCheck = fbbf_users();
                $checkIdx = fbbf_find_user_index($usersForCheck, $emailGet);
                if ($checkIdx !== -1 && !empty(fbbf_compute_user_state($usersForCheck[$checkIdx])['access_granted'])) {
                    $allowed = true;
                    $email = $emailGet;
                }
            }
        }
    }
}

if (!$allowed) {
    // رجوع لصفحة الدخول مع رسالة واضحة — لا حلقة صامتة
    fbbf_redirect('/login-download.php?need=download&err=session');
}

/* ── قراءة اسم الملف الحالي ──────────────────────────────── */
$filename = null;

if (file_exists($configFile)) {
    $cfg = json_decode(file_get_contents($configFile) ?: '{}', true);
    if (!empty($cfg['extension_filename'])) {
        $filename = basename((string)$cfg['extension_filename']);
    }
}
if (!$filename && file_exists($root . '/updates.xml')) {
    $xml = file_get_contents($root . '/updates.xml') ?: '';
    if (preg_match("/codebase='[^']*\/([^']+\.zip)'/", $xml, $m)) {
        $filename = basename($m[1]);
    }
}
if (!$filename) {
    $zips = glob($root . '/fb-bablushr-f-v*.zip') ?: [];
    // فضّل 16.5.19 ثم الأحدث بالتاريخ
    usort($zips, static function ($a, $b) {
        $pa = preg_match('/v(\d+\.\d+\.\d+)/', basename($a), $ma) ? $ma[1] : '0';
        $pb = preg_match('/v(\d+\.\d+\.\d+)/', basename($b), $mb) ? $mb[1] : '0';
        $vc = version_compare($pb, $pa);
        if ($vc !== 0) return $vc;
        return filemtime($b) <=> filemtime($a);
    });
    if ($zips) {
        $filename = basename($zips[0]);
    }
}

if (!$filename || !preg_match('/^[\w\-. ]+\.zip$/i', $filename)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'ملف الإضافة غير موجود على السيرفر — ارفع fb-bablushr-f-v16.5.19-extension.zip إلى جذر الموقع.';
    exit;
}
$filepath = $root . '/' . $filename;
if (!file_exists($filepath)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'الملف غير موجود على السيرفر: ' . htmlspecialchars($filename);
    exit;
}

$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$isBot = (bool)preg_match('/bot|crawl|spider|slurp|facebookexternalhit/i', $ua);

if (!$isBot) {
    $lockFile = $root . '/data/.dl-lock';
    $lock = @fopen($lockFile, 'c');
    if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
        $stats = [];
        if (file_exists($statsFile)) {
            $stats = json_decode(file_get_contents($statsFile) ?: '{}', true) ?: [];
        }
        $today = date('Y-m-d');
        $month = date('Y-m');
        $stats['total'] = (int)($stats['total'] ?? 0) + 1;
        $stats['by_day'][$today] = (int)($stats['by_day'][$today] ?? 0) + 1;
        $stats['by_month'][$month] = (int)($stats['by_month'][$month] ?? 0) + 1;
        $stats['last_at'] = date('Y-m-d H:i:s');
        if (isset($stats['by_day']) && count($stats['by_day']) > 90) {
            ksort($stats['by_day']);
            $stats['by_day'] = array_slice($stats['by_day'], -90, null, true);
        }
        @file_put_contents($statsFile, json_encode($stats, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($lock, LOCK_UN);
        fclose($lock);
        if (function_exists('fbbf_notify_owner')) {
            try {
                fbbf_notify_owner('download', ['email' => $email, 'ip' => $ip]);
            } catch (Throwable $e) { /* ignore */ }
        }
    } elseif ($lock) {
        fclose($lock);
    }
}

$filesize = filesize($filepath);
while (ob_get_level()) ob_end_clean();

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . (string)$filesize);
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Accept-Ranges: bytes');

if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $r)) {
    $start = (int)$r[1];
    $end = ($r[2] !== '') ? (int)$r[2] : $filesize - 1;
    if ($start > $end || $start >= $filesize) {
        http_response_code(416);
        exit;
    }
    $length = $end - $start + 1;
    http_response_code(206);
    header("Content-Range: bytes {$start}-{$end}/{$filesize}");
    header('Content-Length: ' . (string)$length);
    $fp = fopen($filepath, 'rb');
    fseek($fp, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($fp)) {
        $chunk = fread($fp, min(8192, $remaining));
        if ($chunk === false) break;
        echo $chunk;
        $remaining -= strlen($chunk);
    }
    fclose($fp);
    exit;
}

readfile($filepath);
exit;
