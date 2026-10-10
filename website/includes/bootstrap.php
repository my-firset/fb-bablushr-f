<?php
declare(strict_types=1);

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name('fbbf_sess');
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params([
            'lifetime' => 60 * 60 * 24 * 30,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } else {
        session_set_cookie_params(60 * 60 * 24 * 30, '/; samesite=Lax', '', $secure, true);
    }
    session_start();
}

date_default_timezone_set('UTC');


define('FBBF_ROOT', dirname(__DIR__));
define('FBBF_DATA', FBBF_ROOT . '/data');
define('FBBF_APP_CONFIG', FBBF_ROOT . '/data/app-config.json');
define('FBBF_USERS_FILE', FBBF_ROOT . '/data/users.json');
define('FBBF_DELETED_USERS_FILE', FBBF_ROOT . '/data/deleted-users.json');
define('FBBF_PAYMENTS_FILE', FBBF_ROOT . '/data/payment-requests.json');
define('FBBF_DEVICE_TRIALS_FILE', FBBF_ROOT . '/data/device-trials.json');
define('FBBF_NOTIFICATIONS_FILE', FBBF_ROOT . '/data/notifications.json');
define('FBBF_ANNOUNCEMENTS_FILE', FBBF_ROOT . '/data/announcements.json');
define('FBBF_DOWNLOAD_TOKENS_FILE', FBBF_ROOT . '/data/download-tokens.json');

function fbbf_ensure_storage(): void {
    if (!is_dir(FBBF_DATA)) {
        mkdir(FBBF_DATA, 0775, true);
    }
    foreach ([
        FBBF_APP_CONFIG => null,
        FBBF_USERS_FILE => [],
        FBBF_DELETED_USERS_FILE => [],
        FBBF_PAYMENTS_FILE => [],
        FBBF_DEVICE_TRIALS_FILE => [],
        FBBF_NOTIFICATIONS_FILE => [],
        FBBF_ANNOUNCEMENTS_FILE => [],
        FBBF_DOWNLOAD_TOKENS_FILE => [],
    ] as $file => $default) {
        if (!file_exists($file)) {
            $payload = $default === null ? '' : json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            file_put_contents($file, $payload);
        }
    }
}

fbbf_ensure_storage();

/**
 * قراءة JSON مع إعادة محاولة عند فراغ مؤقت (سباق كتابة).
 * ترجع null لو الملف موجود لكن غير قابل للقراءة بعد كل المحاولات والنسخة الاحتياطية.
 * لا تُرجع [] في هذه الحالة — كان ده بيتفسَّر user_not_found ويطرد العملاء.
 */
function fbbf_read_json_strict(string $file): ?array {
    if (!file_exists($file)) {
        return [];
    }
    $raw = false;
    for ($attempt = 0; $attempt < 6; $attempt++) {
        $fp = @fopen($file, 'rb');
        if ($fp !== false) {
            @flock($fp, LOCK_SH);
            $raw = stream_get_contents($fp);
            @flock($fp, LOCK_UN);
            fclose($fp);
        } else {
            $raw = false;
        }
        if ($raw !== false && trim((string)$raw) !== '') {
            $decoded = json_decode((string)$raw, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        usleep(25000 + ($attempt * 20000));
    }
    $bak = $file . '.bak';
    if (is_file($bak)) {
        $rawBak = @file_get_contents($bak);
        if ($rawBak !== false && trim($rawBak) !== '') {
            $decodedBak = json_decode($rawBak, true);
            if (is_array($decodedBak)) {
                return $decodedBak;
            }
        }
    }
    return null;
}

function fbbf_read_json(string $file, $default = []) {
    $decoded = fbbf_read_json_strict($file);
    if ($decoded === null) {
        return $default;
    }
    return $decoded;
}

function &fbbf_users_lock_state(): array {
    static $state = ['held' => false, 'depth' => 0, 'fp' => null, 'dir' => ''];
    return $state;
}

/**
 * قفل حصري لـ users.json.
 * mkdir ذرّي (يشتغل حتى لو flock ضعيف على الاستضافة) + flock.
 * نفس العملية لو حازت القفل مرتين لا تنتظر نفسها.
 */
function fbbf_users_lock(float $timeoutSeconds = 8.0): bool {
    $state = &fbbf_users_lock_state();
    if (!empty($state['held'])) {
        $state['depth']++;
        return true;
    }
    $dir = FBBF_USERS_FILE . '.lockdir';
    $deadline = microtime(true) + $timeoutSeconds;
    $acquired = false;
    while (microtime(true) < $deadline) {
        if (@mkdir($dir, 0775)) {
            $acquired = true;
            break;
        }
        $mtime = (int)@filemtime($dir);
        if ($mtime > 0 && (time() - $mtime) > 20) {
            @rmdir($dir);
            continue;
        }
        usleep(20000);
    }
    if (!$acquired) {
        return false;
    }
    @file_put_contents($dir . '/owner', (string)getmypid());
    $fp = @fopen(FBBF_USERS_FILE . '.lock', 'c+');
    if ($fp !== false) {
        $flockDeadline = microtime(true) + 2.0;
        $flocked = false;
        do {
            $flocked = @flock($fp, LOCK_EX | LOCK_NB);
            if ($flocked) break;
            usleep(15000);
        } while (microtime(true) < $flockDeadline);
        if (!$flocked) {
            fclose($fp);
            @unlink($dir . '/owner');
            @rmdir($dir);
            return false;
        }
    }
    $state['held'] = true;
    $state['depth'] = 1;
    $state['fp'] = $fp;
    $state['dir'] = $dir;
    return true;
}

function fbbf_users_unlock(): void {
    $state = &fbbf_users_lock_state();
    if (empty($state['held'])) return;
    $state['depth'] = max(0, (int)$state['depth'] - 1);
    if ($state['depth'] > 0) return;
    if (is_resource($state['fp'])) {
        @flock($state['fp'], LOCK_UN);
        fclose($state['fp']);
    }
    if (!empty($state['dir'])) {
        @unlink($state['dir'] . '/owner');
        @rmdir($state['dir']);
    }
    $state['held'] = false;
    $state['fp'] = null;
    $state['dir'] = '';
    $state['depth'] = 0;
}

/**
 * كتابة JSON ذرّية: ملف مؤقت فريد لكل طلب + rename.
 * ممنوع ملف .tmp مشترك، وممنوع حذف الملف الأصلي قبل نجاح الاستبدال.
 */
function fbbf_write_json_unlocked(string $file, $data): bool {
    $dir = dirname($file);
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        return false;
    }
    if ($file === FBBF_USERS_FILE && is_array($data) && count($data) === 0 && is_file($file)) {
        $existing = fbbf_read_json_strict($file);
        if (is_array($existing) && count($existing) > 0) {
            return false;
        }
    }
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }
    if (is_file($file) && @filesize($file) > 2) {
        $primaryRaw = @file_get_contents($file);
        $primaryOk = false;
        if ($primaryRaw !== false && trim($primaryRaw) !== '') {
            $primaryDecoded = json_decode($primaryRaw, true);
            $primaryOk = is_array($primaryDecoded) && ($file !== FBBF_USERS_FILE || count($primaryDecoded) > 0);
        }
        if ($primaryOk) {
            @copy($file, $file . '.bak');
        }
    }
    try {
        $suffix = bin2hex(random_bytes(4));
    } catch (Throwable $e) {
        $suffix = (string)mt_rand(100000, 999999);
    }
    $temp = $file . '.tmp.' . getmypid() . '.' . $suffix;
    $fp = @fopen($temp, 'wb');
    if ($fp === false) {
        return false;
    }
    $written = @fwrite($fp, $json);
    @fflush($fp);
    if (function_exists('fsync')) {
        @fsync($fp);
    }
    fclose($fp);
    if ($written !== strlen($json)) {
        @unlink($temp);
        return false;
    }
    if (!@rename($temp, $file)) {
        @unlink($temp);
        return false;
    }
    return true;
}

function fbbf_write_json(string $file, $data): bool {
    if ($file === FBBF_USERS_FILE) {
        return fbbf_save_users(is_array($data) ? $data : []);
    }
    $lockPath = $file . '.lock';
    $lockFp = @fopen($lockPath, 'c+');
    if ($lockFp === false) {
        return false;
    }
    $deadline = microtime(true) + 3.0;
    $locked = false;
    do {
        $locked = @flock($lockFp, LOCK_EX | LOCK_NB);
        if ($locked) break;
        usleep(15000);
    } while (microtime(true) < $deadline);
    if (!$locked) {
        fclose($lockFp);
        return false;
    }
    try {
        return fbbf_write_json_unlocked($file, $data);
    } finally {
        @flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
}

/**
 * تعديل JSON تحت قفل حصري (قراءة → تعديل → كتابة) لتفادي lost update.
 */
function fbbf_mutate_json(string $file, callable $mutator, $default = []) {
    if ($file === FBBF_USERS_FILE) {
        if (!fbbf_users_lock()) return false;
        try {
            $current = fbbf_read_users_disk();
            if ($current === null) return false;
            $next = $mutator($current);
            if (!is_array($next)) return false;
            return fbbf_write_json_unlocked($file, $next) ? $next : false;
        } finally {
            fbbf_users_unlock();
        }
    }
    $lockPath = $file . '.lock';
    $lockFp = @fopen($lockPath, 'c+');
    if ($lockFp === false) return false;
    $deadline = microtime(true) + 3.0;
    $locked = false;
    do {
        $locked = @flock($lockFp, LOCK_EX | LOCK_NB);
        if ($locked) break;
        usleep(15000);
    } while (microtime(true) < $deadline);
    if (!$locked) {
        fclose($lockFp);
        return false;
    }
    try {
        $current = fbbf_read_json_strict($file);
        if ($current === null) $current = is_array($default) ? $default : [];
        $next = $mutator($current);
        if (!is_array($next)) return false;
        return fbbf_write_json_unlocked($file, $next) ? $next : false;
    } finally {
        @flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
}

function fbbf_is_installed(): bool {
    $config = fbbf_read_json(FBBF_APP_CONFIG, []);
    return !empty($config['installed']) && !empty($config['admin_email']) && !empty($config['admin_password_hash']);
}

function fbbf_require_install_or_redirect(): void {
    $script = basename($_SERVER['SCRIPT_NAME'] ?? '');
    if (!fbbf_is_installed() && $script !== 'install.php') {
        header('Location: /install.php');
        exit;
    }
}

function fbbf_config(): array {
    return fbbf_read_json(FBBF_APP_CONFIG, []);
}

function fbbf_save_config(array $config): bool {
    return fbbf_write_json(FBBF_APP_CONFIG, $config);
}

/** تذكر جلسة المستخدم عبر كوكي موقعة (InfinityFree أحيانًا يفقد PHP session) */
function fbbf_session_secret(): string {
    $c = fbbf_config();
    if (!empty($c['session_secret'])) {
        return (string)$c['session_secret'];
    }
    // سر ثابت مشتق من بيانات التثبيت — لا يتغيّر بين الطلبات (سبب اختفاء الجلسة سابقًا)
    if (!empty($c['admin_password_hash'])) {
        $secret = hash('sha256', (string)$c['admin_password_hash'] . '|fbbf_uid_v1');
        $c['session_secret'] = $secret;
        @fbbf_save_config($c);
        return $secret;
    }
    return hash('sha256', FBBF_ROOT . '|fbbf-preinstall');
}

function fbbf_user_login_remember(string $email): void {
    $email = fbbf_normalize_email($email);
    if ($email === '') return;
    $_SESSION['fbbf_user_email'] = $email;
    $_SESSION['fbbf_user_logged_in'] = true;
    $exp = time() + 60 * 60 * 24 * 30;
    $payload = $email . '|' . $exp;
    $sig = hash_hmac('sha256', $payload, fbbf_session_secret());
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $val = base64_encode($payload . '|' . $sig);
    if (PHP_VERSION_ID >= 70300) {
        setcookie('fbbf_uid', $val, [
            'expires' => $exp,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } else {
        setcookie('fbbf_uid', $val, $exp, '/');
    }
}

function fbbf_user_logout_clear(): void {
    unset($_SESSION['fbbf_user_logged_in'], $_SESSION['fbbf_user_email']);
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    if (PHP_VERSION_ID >= 70300) {
        setcookie('fbbf_uid', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    } else {
        setcookie('fbbf_uid', '', time() - 3600, '/');
    }
}

function fbbf_current_user_email(): string {
    if (!empty($_SESSION['fbbf_user_logged_in']) && !empty($_SESSION['fbbf_user_email'])) {
        return fbbf_normalize_email((string)$_SESSION['fbbf_user_email']);
    }
    $raw = (string)($_COOKIE['fbbf_uid'] ?? '');
    if ($raw === '') return '';
    $dec = base64_decode($raw, true);
    if ($dec === false) return '';
    $parts = explode('|', $dec);
    if (count($parts) !== 3) return '';
    [$email, $exp, $sig] = $parts;
    if ((int)$exp < time()) return '';
    $payload = $email . '|' . $exp;
    $expect = hash_hmac('sha256', $payload, fbbf_session_secret());
    if (!hash_equals($expect, $sig)) return '';
    $email = fbbf_normalize_email($email);
    $_SESSION['fbbf_user_email'] = $email;
    $_SESSION['fbbf_user_logged_in'] = true;
    return $email;
}



function fbbf_now(): int {
    return time();
}

function fbbf_iso(?int $ts): string {
    if (!$ts) return '—';
    try {
        $dt = new DateTime('@' . (int)$ts);
        $dt->setTimezone(new DateTimeZone('Africa/Cairo'));
        return $dt->format('Y-m-d H:i');
    } catch (Throwable $e) {
        return gmdate('Y-m-d H:i', (int)$ts) . ' UTC';
    }
}

function fbbf_h(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function fbbf_normalize_email(string $email): string {
    return strtolower(trim($email));
}

function fbbf_trial_days(): int {
    $config = fbbf_config();
    $days = (int)($config['trial_days'] ?? 3);
    return $days > 0 ? $days : 3;
}

function fbbf_plan_catalog(): array {
    $config = fbbf_config();
    return $config['plans'] ?? [
        'monthly' => ['label' => 'الخطة الشهرية', 'days' => 30, 'price' => 99],
        'quarterly' => ['label' => 'الخطة الربع سنوية', 'days' => 90, 'price' => 499],
        'semiannual' => ['label' => 'الخطة النصف سنوية', 'days' => 180, 'price' => 899],
        'annual' => ['label' => 'الخطة السنوية', 'days' => 365, 'price' => 1499],
    ];
}

function fbbf_find_user_index(array $users, string $email): int {
    $email = fbbf_normalize_email($email);
    foreach ($users as $i => $user) {
        if (fbbf_normalize_email((string)($user['email'] ?? '')) === $email) return $i;
    }
    return -1;
}

function fbbf_issue_token(): string {
    return bin2hex(random_bytes(24));
}

function fbbf_registration_enabled(): bool {
    $config = fbbf_config();
    return array_key_exists('registration_enabled', $config) ? !empty($config['registration_enabled']) : true;
}

function fbbf_max_devices(): int {
    $config = fbbf_config();
    $n = (int)($config['max_devices_per_user'] ?? 3);
    return $n > 0 ? $n : 1;
}

function fbbf_public_downloads_enabled(): bool {
    $config = fbbf_config();
    // كان الافتراضي true (أي حد يقدر يحمّل الملف من غير حساب).
    // اتغيّر الافتراضي لـ false: التحميل بقى يحتاج جلسة مصرح بها ما لم يفعّلها الأدمن يدويًا من الإعدادات.
    return array_key_exists('public_downloads', $config) ? !empty($config['public_downloads']) : false;
}

/**
 * توقيع HMAC لردود API الحساسة (مثل check.php) عشان الإضافة تقدر
 * تتأكد إن الرد فعلاً جاي من السيرفر الحقيقي ومحدش عمل proxy مزيف.
 * السر بيتولد تلقائيًا أول مرة ويتخزن في app-config.json (مش في الكود).
 */
function fbbf_signing_secret(): string {
    $config = fbbf_config();
    $secret = (string)($config['signing_secret'] ?? '');
    if ($secret === '') {
        $secret = bin2hex(random_bytes(32));
        $config['signing_secret'] = $secret;
        fbbf_save_config($config);
    }
    return $secret;
}

function fbbf_sign_payload(array $payload): string {
    $secret = fbbf_signing_secret();
    // نبني نص ثابت الترتيب من أهم الحقول عشان التوقيع يكون متسق
    $basis = implode('|', [
        (string)($payload['email'] ?? ''),
        (string)($payload['status'] ?? ''),
        $payload['access_granted'] ? '1' : '0',
        (string)($payload['trial_ends_at'] ?? 0),
        (string)($payload['subscription_expires_at'] ?? 0),
        (string)($payload['device_id'] ?? ''),
        (string)($payload['_ts'] ?? ''),
    ]);
    return hash_hmac('sha256', $basis, $secret);
}

/**
 * يضيف طابع زمني وتوقيعًا لأي رد قبل إرساله، عشان العميل (الإضافة)
 * يقدر يتحقق إن الرد أصلي ومحدّث (مش replay قديم).
 */
function fbbf_sign_response(array $payload): array {
    $payload['_ts'] = fbbf_now();
    $payload['_sig'] = fbbf_sign_payload($payload);
    return $payload;
}

/* ── Rate limiting بسيط قائم على ملف، ضد محاولات تخمين الباسورد/التوكين ── */
function fbbf_rate_limit_key(string $bucket): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return $bucket . ':' . $ip;
}

function fbbf_rate_limit_check(string $bucket, int $maxAttempts = 8, int $windowSeconds = 60): bool {
    $file = FBBF_DATA . '/.rate-limit.json';
    $all = fbbf_read_json($file, []);
    $key = fbbf_rate_limit_key($bucket);
    $now = fbbf_now();
    $entry = $all[$key] ?? ['count' => 0, 'window_start' => $now];
    if ($now - (int)$entry['window_start'] > $windowSeconds) {
        $entry = ['count' => 0, 'window_start' => $now];
    }
    $entry['count']++;
    $all[$key] = $entry;
    // تنظيف الإدخالات القديمة (أكتر من ساعة) عشان الملف مايكبرش
    foreach ($all as $k => $v) {
        if ($now - (int)($v['window_start'] ?? 0) > 3600) unset($all[$k]);
    }
    fbbf_write_json($file, $all);
    return $entry['count'] <= $maxAttempts;
}

function fbbf_enforce_rate_limit(string $bucket, int $maxAttempts = 8, int $windowSeconds = 60): void {
    if (!fbbf_rate_limit_check($bucket, $maxAttempts, $windowSeconds)) {
        fbbf_json_response(['ok' => false, 'message' => 'too_many_requests'], 429);
    }
}

/**
 * تحقق بسيط إن الطلب جاي من الإضافة نفسها (مش أي حد بيضرب على الـ API من برا).
 * مش حماية قوية 100% (أي حد يقدر يقلّد الهيدر)، لكنها بترفع سقف المجهود المطلوب
 * وبتفلتر أغلب المحاولات العشوائية/الآلية غير المقصودة.
 */
function fbbf_looks_like_extension_request(): bool {
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    // طلبات من إضافات كروم/إيدج غالبًا بييجي منها origin يبدأ بـ chrome-extension://
    // أو بدون Origin أصلًا (زي بعض متصفحات الموبايل مثل Kiwi). فبنسمح بالحالتين
    // ونرفض بس الحالة اللي فيها Origin واضح إنه متصفح عادي بيفتح الـ API مباشرة كصفحة.
    if ($origin === '') return true;
    if (str_starts_with($origin, 'chrome-extension://')) return true;
    if (str_starts_with($origin, 'moz-extension://')) return true;
    return false;
}

function fbbf_normalize_device_id(string $deviceId): string {
    $deviceId = strtolower(trim($deviceId));
    $deviceId = preg_replace('/[^a-z0-9._:-]+/', '-', $deviceId);
    return trim((string)$deviceId, '-');
}

function fbbf_user_devices(array $user): array {
    $devices = $user['devices'] ?? [];
    return is_array($devices) ? array_values($devices) : [];
}

function fbbf_find_device_index(array $user, string $deviceId): int {
    $deviceId = fbbf_normalize_device_id($deviceId);
    foreach (fbbf_user_devices($user) as $i => $device) {
        if (fbbf_normalize_device_id((string)($device['id'] ?? '')) === $deviceId) return $i;
    }
    return -1;
}

function fbbf_parse_user_agent(?string $ua = null): array {
    $ua = (string)($ua ?? ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $uaLower = strtolower($ua);
    $isMobile = (bool)preg_match('/mobile|android|iphone|ipad|ipod|webos|blackberry|opera mini|iemobile/i', $ua);
    $isTablet = (bool)preg_match('/ipad|tablet|kindle|silk/i', $ua);
    $form = $isTablet ? 'تابلت' : ($isMobile ? 'هاتف' : 'كمبيوتر');
    $browser = 'متصفح';
    if (strpos($uaLower, 'edg/') !== false || strpos($uaLower, 'edge/') !== false) $browser = 'Edge';
    elseif (strpos($uaLower, 'opr/') !== false || strpos($uaLower, 'opera') !== false) $browser = 'Opera';
    elseif (strpos($uaLower, 'firefox/') !== false || strpos($uaLower, 'fxios') !== false) $browser = 'Firefox';
    elseif (strpos($uaLower, 'crios') !== false || strpos($uaLower, 'chrome/') !== false) $browser = 'Chrome';
    elseif (strpos($uaLower, 'safari/') !== false) $browser = 'Safari';
    if (strpos($uaLower, 'kiwi') !== false) $browser = 'Kiwi';
    elseif (strpos($uaLower, 'lemur') !== false) $browser = 'Lemur';
    elseif (strpos($uaLower, 'quetta') !== false) $browser = 'Quetta';
    elseif (strpos($uaLower, 'brave') !== false) $browser = 'Brave';
    $os = 'غير معروف';
    if (strpos($uaLower, 'android') !== false) $os = 'Android';
    elseif (strpos($uaLower, 'iphone') !== false || strpos($uaLower, 'ipad') !== false || strpos($uaLower, 'ios') !== false) $os = 'iOS';
    elseif (strpos($uaLower, 'windows') !== false) $os = 'Windows';
    elseif (strpos($uaLower, 'mac os') !== false || strpos($uaLower, 'macintosh') !== false) $os = 'macOS';
    elseif (strpos($uaLower, 'linux') !== false) $os = 'Linux';
    elseif (strpos($uaLower, 'cros') !== false) $os = 'ChromeOS';
    $label = trim($browser . ' · ' . $os . ' · ' . $form);
    return [
        'form_factor' => $form,
        'browser' => $browser,
        'os' => $os,
        'is_mobile' => $isMobile && !$isTablet,
        'is_tablet' => $isTablet,
        'is_desktop' => !$isMobile && !$isTablet,
        'label' => $label !== '' ? $label : 'جهاز غير معروف',
        'user_agent' => substr($ua, 0, 255),
    ];
}

function fbbf_normalize_device_label(string $label, ?string $ua = null): string {
    $label = trim($label);
    $meta = fbbf_parse_user_agent($ua);
    // لو الإضافة بعتت الافتراضي القديم "Kiwi Android" نستبدل بتحليل حقيقي من User-Agent
    if ($label === '' || strcasecmp($label, 'Kiwi Android') === 0 || strcasecmp($label, 'unknown') === 0) {
        return $meta['label'];
    }
    // لو التسمية عامة جدًا نضيف نوع الجهاز من UA
    if (!preg_match('/هاتف|كمبيوتر|تابلت|Android|Windows|iOS|macOS|Linux|Chrome|Kiwi|Lemur|Quetta/i', $label)) {
        return $label . ' · ' . $meta['form_factor'];
    }
    return $label;
}

function fbbf_touch_device(array $user, string $deviceId, string $deviceLabel = '', string $version = ''): array {
    $deviceId = fbbf_normalize_device_id($deviceId);
    if ($deviceId === '') return $user;
    $devices = fbbf_user_devices($user);
    $idx = fbbf_find_device_index(['devices' => $devices], $deviceId);
    $now = fbbf_now();
    $ua = substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    $ip = substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64);
    $meta = fbbf_parse_user_agent($ua);
    $label = fbbf_normalize_device_label($deviceLabel, $ua);
    $payload = [
        'id' => $deviceId,
        'label' => $label,
        'first_seen_at' => $now,
        'last_seen_at' => $now,
        'last_version' => $version,
        'user_agent' => $ua,
        'last_ip' => $ip,
        'form_factor' => $meta['form_factor'],
        'browser' => $meta['browser'],
        'os' => $meta['os'],
    ];
    if ($idx === -1) {
        $devices[] = $payload;
    } else {
        $prev = $devices[$idx];
        $devices[$idx] = array_merge($prev, $payload, [
            'first_seen_at' => (int)($prev['first_seen_at'] ?? $now),
        ]);
    }
    $user['devices'] = array_values($devices);
    $user['last_login_device_id'] = $deviceId;
    return $user;
}

function fbbf_can_attach_device(array $user, string $deviceId): bool {
    $deviceId = fbbf_normalize_device_id($deviceId);
    if ($deviceId === '') return false;
    if (fbbf_find_device_index($user, $deviceId) !== -1) return true;
    return count(fbbf_user_devices($user)) < fbbf_max_devices();
}

function fbbf_compute_user_state(array $user): array {
    $now = fbbf_now();
    $blocked = !empty($user['blocked']);
    $trialEnds = (int)($user['trial_ends_at'] ?? 0);
    $subEnds = (int)($user['subscription_expires_at'] ?? 0);
    $trialActive = !$blocked && $trialEnds > $now;
    $subscriptionActive = !$blocked && $subEnds > $now;
    $accessGranted = $trialActive || $subscriptionActive;
    if ($blocked) {
        $status = 'blocked';
        $statusLabel = 'محظور';
    } elseif ($subscriptionActive) {
        $status = 'active';
        $statusLabel = 'مفعّل';
    } elseif ($trialActive) {
        $status = 'trial';
        $statusLabel = 'تجربة';
    } elseif ($trialEnds || $subEnds) {
        $status = 'expired';
        $statusLabel = 'منتهي';
    } else {
        $status = 'pending';
        $statusLabel = 'معلّق';
    }
    return [
        'status' => $status,
        'status_label' => $statusLabel,
        'access_granted' => $accessGranted,
        'trial_active' => $trialActive,
        'subscription_active' => $subscriptionActive,
        'trial_ends_at' => $trialEnds,
        'subscription_expires_at' => $subEnds,
    ];
}

function fbbf_enrich_user(array $user): array {
    return array_merge($user, fbbf_compute_user_state($user));
}

function fbbf_users_read_failed(): bool {
    return !empty($GLOBALS['fbbf_users_read_failed']);
}

/** قراءة users.json. null = الملف تالف/غير مقروء، وليس «لا يوجد مستخدمون». */
function fbbf_read_users_disk(): ?array {
    if (!is_file(FBBF_USERS_FILE)) {
        $GLOBALS['fbbf_users_read_failed'] = false;
        return [];
    }
    $users = fbbf_read_json_strict(FBBF_USERS_FILE);
    if ($users === null) {
        $GLOBALS['fbbf_users_read_failed'] = true;
        return null;
    }
    $GLOBALS['fbbf_users_read_failed'] = false;
    return $users;
}

function fbbf_deleted_users_map(): array {
    if (!is_file(FBBF_DELETED_USERS_FILE)) return [];
    $map = fbbf_read_json_strict(FBBF_DELETED_USERS_FILE);
    return is_array($map) ? $map : [];
}

function fbbf_index_users_by_email(array $users): array {
    $by = [];
    foreach ($users as $user) {
        if (!is_array($user)) continue;
        $email = fbbf_normalize_email((string)($user['email'] ?? ''));
        if ($email === '') continue;
        $by[$email] = $user;
    }
    return $by;
}

/** دمج أجهزة الطرفين بالمعرّف. لا نسقط جهازًا موجودًا إلا لو الأحدث صفّر القائمة عمدًا. */
function fbbf_merge_devices(array $diskUser, array $incomingUser): array {
    $diskUpdated = (int)($diskUser['updated_at'] ?? 0);
    $inUpdated = (int)($incomingUser['updated_at'] ?? 0);
    $diskDevs = fbbf_user_devices($diskUser);
    $inDevs = fbbf_user_devices($incomingUser);
    $diskCleared = $diskUpdated > $inUpdated && array_key_exists('devices', $diskUser) && count($diskDevs) === 0;
    $inCleared = $inUpdated > $diskUpdated && array_key_exists('devices', $incomingUser) && count($inDevs) === 0;
    if ($diskCleared || $inCleared) return [];
    $merged = [];
    foreach (array_merge($diskDevs, $inDevs) as $device) {
        if (!is_array($device)) continue;
        $id = fbbf_normalize_device_id((string)($device['id'] ?? ''));
        if ($id === '' || str_starts_with($id, 'web-')) continue;
        $prev = isset($merged[$id]) ? (int)($merged[$id]['last_seen_at'] ?? 0) : -1;
        if ((int)($device['last_seen_at'] ?? 0) >= $prev) $merged[$id] = $device;
    }
    return array_values($merged);
}

function fbbf_merge_user_record(array $disk, array $incoming): array {
    $diskUpdated = (int)($disk['updated_at'] ?? 0);
    $inUpdated = (int)($incoming['updated_at'] ?? 0);
    $base = $inUpdated >= $diskUpdated ? $incoming : $disk;
    $base['devices'] = fbbf_merge_devices($disk, $incoming);
    foreach (['last_check_at', 'last_login_at', 'created_at', 'updated_at'] as $key) {
        $base[$key] = max((int)($disk[$key] ?? 0), (int)($incoming[$key] ?? 0));
    }
    if ($inUpdated > $diskUpdated) {
        $base['subscription_expires_at'] = (int)($incoming['subscription_expires_at'] ?? 0);
        $base['trial_ends_at'] = (int)($incoming['trial_ends_at'] ?? 0);
        $base['blocked'] = !empty($incoming['blocked']);
    } elseif ($diskUpdated > $inUpdated) {
        $base['subscription_expires_at'] = (int)($disk['subscription_expires_at'] ?? 0);
        $base['trial_ends_at'] = (int)($disk['trial_ends_at'] ?? 0);
        $base['blocked'] = !empty($disk['blocked']);
        if ((string)($disk['password_hash'] ?? '') !== '') $base['password_hash'] = $disk['password_hash'];
        if ((string)($disk['access_token'] ?? '') !== '') $base['access_token'] = $disk['access_token'];
    } else {
        $base['subscription_expires_at'] = max((int)($disk['subscription_expires_at'] ?? 0), (int)($incoming['subscription_expires_at'] ?? 0));
        $base['trial_ends_at'] = max((int)($disk['trial_ends_at'] ?? 0), (int)($incoming['trial_ends_at'] ?? 0));
        // updated_at has second precision. On a tie, disk is the last committed
        // token; do not let a stale concurrent snapshot overwrite it.
        if ((string)($disk['access_token'] ?? '') !== '') {
            $base['access_token'] = $disk['access_token'];
        }
    }
    if ((string)($base['password_hash'] ?? '') === '' && (string)($disk['password_hash'] ?? '') !== '') {
        $base['password_hash'] = $disk['password_hash'];
    }
    if ((string)($base['password_hash'] ?? '') === '' && (string)($incoming['password_hash'] ?? '') !== '') {
        $base['password_hash'] = $incoming['password_hash'];
    }
    if ((string)($base['access_token'] ?? '') === '' && (string)($disk['access_token'] ?? '') !== '') {
        $base['access_token'] = $disk['access_token'];
    }
    if ((string)($base['access_token'] ?? '') === '' && (string)($incoming['access_token'] ?? '') !== '') {
        $base['access_token'] = $incoming['access_token'];
    }
    if ((string)($base['email'] ?? '') === '') {
        $base['email'] = (string)($disk['email'] ?? $incoming['email'] ?? '');
    }
    return $base;
}

/**
 * لقطة قديمة لا يحق لها حذف مستخدم أو جهاز ظهر بعد قراءتها.
 * الحذف الصريح يمر عبر fbbf_delete_user_by_email (tombstone).
 */
function fbbf_reconcile_users(array $disk, array $incoming): array {
    $tomb = fbbf_deleted_users_map();
    $diskBy = fbbf_index_users_by_email($disk);
    $inBy = fbbf_index_users_by_email($incoming);
    $emails = array_keys($diskBy);
    foreach (array_keys($inBy) as $email) {
        if (!isset($diskBy[$email])) $emails[] = $email;
    }
    $out = [];
    $tombChanged = false;
    foreach ($emails as $email) {
        $tombAt = (int)($tomb[$email] ?? 0);
        $in = $inBy[$email] ?? null;
        $onDisk = $diskBy[$email] ?? null;
        if ($tombAt > 0) {
            $created = (int)(($in['created_at'] ?? 0) ?: ($onDisk['created_at'] ?? 0));
            if ($in === null || $created <= $tombAt) continue;
            unset($tomb[$email]);
            $tombChanged = true;
        }
        if ($onDisk === null && is_array($in)) $out[] = $in;
        elseif ($in === null && is_array($onDisk)) $out[] = $onDisk;
        elseif (is_array($onDisk) && is_array($in)) $out[] = fbbf_merge_user_record($onDisk, $in);
    }
    if ($tombChanged) {
        fbbf_write_json_unlocked(FBBF_DELETED_USERS_FILE, $tomb);
    }
    return array_values($out);
}

function fbbf_users(): array {
    $users = fbbf_read_users_disk();
    if ($users === null || !is_array($users)) return [];
    // إصلاح ذاتي: حسابات اتسجلت قبل التصحيح كانت بتحجز خانة جهاز وهمية باسم
    // "web-*" وقت التسجيل من الموقع، وده كان بيمنع جهاز الإضافة الحقيقي من
    // الدخول (device_limit_reached) لو max_devices_per_user = 1. بنشيلها هنا
    // تلقائيًا من كل قراءة، فمفيش تدخل يدوي مطلوب على الحسابات القديمة.
    foreach ($users as &$u) {
        if (!is_array($u)) continue;
        if (!empty($u['devices']) && is_array($u['devices'])) {
            $u['devices'] = array_values(array_filter($u['devices'], function ($d) {
                return strpos((string)($d['id'] ?? ''), 'web-') !== 0;
            }));
        }
        if (strpos((string)($u['last_login_device_id'] ?? ''), 'web-') === 0) {
            $u['last_login_device_id'] = '';
        }
    }
    unset($u);
    return array_map('fbbf_enrich_user', $users);
}

function fbbf_save_users(array $users): bool {
    if (!fbbf_users_lock()) return false;
    try {
        $disk = fbbf_read_users_disk();
        if ($disk === null) return false;
        if (count($users) === 0 && count($disk) > 0) return false;
        $next = fbbf_reconcile_users($disk, array_values($users));
        if (count($next) === 0 && count($disk) > 0) return false;
        return fbbf_write_json_unlocked(FBBF_USERS_FILE, $next);
    } finally {
        fbbf_users_unlock();
    }
}

function fbbf_delete_user_by_email(string $email): bool {
    $email = fbbf_normalize_email($email);
    if ($email === '' || !fbbf_users_lock()) return false;
    try {
        $disk = fbbf_read_users_disk();
        if ($disk === null) return false;
        $next = [];
        $found = false;
        foreach ($disk as $user) {
            if (!is_array($user)) continue;
            if (fbbf_normalize_email((string)($user['email'] ?? '')) === $email) {
                $found = true;
                continue;
            }
            $next[] = $user;
        }
        if (!$found) return false;
        $tomb = fbbf_deleted_users_map();
        $tomb[$email] = fbbf_now();
        if (!fbbf_write_json_unlocked(FBBF_DELETED_USERS_FILE, $tomb)) return false;
        return fbbf_write_json_unlocked(FBBF_USERS_FILE, array_values($next));
    } finally {
        fbbf_users_unlock();
    }
}

function fbbf_payments(): array {
    $items = fbbf_read_json(FBBF_PAYMENTS_FILE, []);
    return is_array($items) ? $items : [];
}

function fbbf_save_payments(array $items): bool {
    return fbbf_write_json(FBBF_PAYMENTS_FILE, array_values($items));
}

function fbbf_json_response(array $payload, int $status = 200): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fbbf_handle_options(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        exit;
    }
}

function fbbf_request_json(): array {
    $raw = file_get_contents('php://input') ?: '';
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function fbbf_admin_logged_in(): bool {
    return !empty($_SESSION['fbbf_admin_logged_in']);
}

function fbbf_require_admin(): void {
    if (!fbbf_admin_logged_in()) {
        header('Location: /admin/index.php');
        exit;
    }
}

function fbbf_flash(?string $message = null, string $type = 'ok'): ?array {
    if ($message !== null) {
        $_SESSION['fbbf_flash'] = ['message' => $message, 'type' => $type];
        return null;
    }
    $flash = $_SESSION['fbbf_flash'] ?? null;
    unset($_SESSION['fbbf_flash']);
    return $flash;
}

function fbbf_redirect(string $url): void {
    header('Location: ' . $url);
    exit;
}

/* ═══════════════════════════════════════════════════════════════
   DEVICE TRIAL LOCK
   يمنع نفس الجهاز (device_id) من فتح تجربة مجانية جديدة بإيميل
   مختلف بعد أن استخدم تجربته الأولى — مستقل عن نظام max_devices_per_user
   الحالي (اللي بيحدد عدد الأجهزة المسموحة *للحساب الواحد*).
   ═══════════════════════════════════════════════════════════════ */

function fbbf_device_trials(): array {
    return fbbf_read_json(FBBF_DEVICE_TRIALS_FILE, []);
}

function fbbf_save_device_trials(array $trials): bool {
    return fbbf_write_json(FBBF_DEVICE_TRIALS_FILE, $trials);
}

function fbbf_device_trial_lock_enabled(): bool {
    $config = fbbf_config();
    return !isset($config['device_trial_lock_enabled']) || !empty($config['device_trial_lock_enabled']);
}

/**
 * هل الجهاز ده سبق واستخدم تجربة مجانية بإيميل مختلف عن ده؟
 * بيرجع true لو لازم يتمنع، false لو مسموح يكمل.
 */
function fbbf_normalize_fingerprint(string $raw): string {
    $raw = trim($raw);
    if ($raw === '') return '';
    // بصمة المتصفح بتتبعت كنص خام (user agent + دقة الشاشة + المنطقة الزمنية
    // + عدد الأنوية + المنصة، مفصولين بـ |) من الإضافة، وبنخزّن هنا الـ hash
    // بتاعها بس — مش النص الخام نفسه (خصوصية + مساحة تخزين أقل).
    return hash('sha256', $raw);
}

function fbbf_device_trial_blocked(string $deviceId, string $email, string $fingerprintHash = ''): bool {
    if (!fbbf_device_trial_lock_enabled()) return false;
    $deviceId = fbbf_normalize_device_id($deviceId);
    $trials = fbbf_device_trials();

    if ($deviceId !== '') {
        $record = $trials[$deviceId] ?? null;
        if ($record) {
            $emailsSeen = array_map('strtolower', (array)($record['emails_seen'] ?? []));
            if (!in_array(strtolower($email), $emailsSeen, true) && !empty($record['trial_used'])) {
                return true;
            }
        }
    }

    // طبقة إضافية: بصمة المتصفح (fingerprint) — بتتغيّر أقل بكتير من device_id
    // العشوائي حتى لو المستخدم مسح chrome.storage بالكامل أو أعاد تثبيت
    // الإضافة، لأنها مبنية على خصائص المتصفح/الجهاز الفعلية (user agent،
    // دقة الشاشة، المنطقة الزمنية، عدد الأنوية، المنصة). مش مثالية (متصفح
    // incognito أو تغيير user-agent يدوي ممكن يتحايلوا عليها)، لكنها أقوى
    // فعليًا من الاعتماد على device_id العشوائي وحده.
    if ($fingerprintHash !== '') {
        foreach ($trials as $record) {
            if (($record['fingerprint'] ?? '') !== $fingerprintHash) continue;
            $emailsSeen = array_map('strtolower', (array)($record['emails_seen'] ?? []));
            if (!in_array(strtolower($email), $emailsSeen, true) && !empty($record['trial_used'])) {
                return true;
            }
        }
    }

    // طبقة إضافية: device_id بيتولّد من جوه الإضافة نفسها (Math.random) وممكن
    // يتغيّر بسهولة لو حد مسح chrome.storage — فبنضيف تقييد تكميلي على IP:
    // لو نفس الـ IP فتح 3+ تجارب مختلفة (device_id مختلف) خلال 24 ساعة،
    // نعتبره تحايل واضح ونمنعه حتى لو الـ device_id "جديد" ظاهريًا.
    // ده تحسين مكمّل مش بديل — VPN/شبكات مشتركة ممكن يتحايلوا عليه، لكنه
    // بيرفع تكلفة التحايل السهل (مسح storage بس) بشكل حقيقي.
    return fbbf_ip_trial_abuse_detected($email);
}

function fbbf_ip_trial_abuse_detected(string $email): bool {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if ($ip === '') return false;
    $trials = fbbf_device_trials();
    $now = fbbf_now();
    $windowSeconds = 86400; // 24 ساعة
    $maxDistinctTrialsPerIp = 3;
    $seenEmailsForIp = [];
    foreach ($trials as $record) {
        if (($record['last_ip'] ?? '') !== $ip) continue;
        if (($now - (int)($record['last_seen_at'] ?? 0)) > $windowSeconds) continue;
        foreach ((array)($record['emails_seen'] ?? []) as $e) {
            $seenEmailsForIp[strtolower($e)] = true;
        }
    }
    // لو الإيميل ده نفسه سبق شافه نفس الـ IP، مش تحايل — كمّل عادي
    if (isset($seenEmailsForIp[strtolower($email)])) return false;
    return count($seenEmailsForIp) >= $maxDistinctTrialsPerIp;
}

/**
 * تسجيل أن الجهاز ده استخدم تجربته (بيتنادى بعد نجاح التسجيل فقط).
 */
function fbbf_record_device_trial(string $deviceId, string $email, string $fingerprintHash = ''): void {
    $deviceId = fbbf_normalize_device_id($deviceId);
    if ($deviceId === '') return;
    $trials = fbbf_device_trials();
    $now = fbbf_now();
    $existing = $trials[$deviceId] ?? null;
    $emailsSeen = $existing ? (array)($existing['emails_seen'] ?? []) : [];
    if (!in_array(strtolower($email), array_map('strtolower', $emailsSeen), true)) {
        $emailsSeen[] = strtolower($email);
    }
    $trials[$deviceId] = [
        'first_email' => $existing['first_email'] ?? $email,
        'first_trial_started_at' => (int)($existing['first_trial_started_at'] ?? $now),
        'trial_used' => true,
        'emails_seen' => array_values($emailsSeen),
        'last_seen_at' => $now,
        'user_agent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        'last_ip' => substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 64),
        'fingerprint' => $fingerprintHash !== '' ? $fingerprintHash : ($existing['fingerprint'] ?? ''),
    ];
    fbbf_save_device_trials($trials);
}

/* ═══════════════════════════════════════════════════════════════
   OWNER NOTIFICATIONS — لوحة تحكم + تيليجرام + واتساب
   الطبقات الثلاث تعمل بالتوازي؛ فشل أي قناة خارجية لا يوقف التسجيل
   أو التحميل ولا يوقف باقي القنوات.
   ═══════════════════════════════════════════════════════════════ */

function fbbf_notifications(): array {
    return fbbf_read_json(FBBF_NOTIFICATIONS_FILE, []);
}

function fbbf_add_dashboard_notification(string $type, string $title, string $body, array $meta = []): void {
    $notifications = fbbf_notifications();
    array_unshift($notifications, [
        'id' => bin2hex(random_bytes(6)),
        'type' => $type,
        'title' => $title,
        'body' => $body,
        'meta' => $meta,
        'created_at' => fbbf_now(),
        'read' => false,
    ]);
    // الاحتفاظ بآخر 200 إشعار فقط لمنع تضخم الملف
    if (count($notifications) > 200) {
        $notifications = array_slice($notifications, 0, 200);
    }
    fbbf_write_json(FBBF_NOTIFICATIONS_FILE, $notifications);
}

/**
 * سجل نشاط الأدمن — بيستخدم نفس تخزين الإشعارات (notifications.json) بنوع
 * مخصص "admin_action" عشان نوثّق كل إجراء إداري حساس (تفعيل، حظر، حذف،
 * تجديد تجربة، توليد رابط) مع الوقت والإيميل المستهدف، من غير ما نبني
 * نظام تخزين منفصل لنفس الغرض.
 */
function fbbf_log_admin_action(string $action, string $targetEmail, string $details = ''): void {
    fbbf_add_dashboard_notification(
        'admin_action',
        $action,
        $targetEmail . ($details !== '' ? ' — ' . $details : ''),
        ['target_email' => $targetEmail, 'admin_action' => $action]
    );
}


function fbbf_normalize_telegram_token(string $token): string {
    $token = trim($token);
    $token = preg_replace('/\s+/', '', $token) ?? $token;
    // إصلاح اللصق المعكوس الشائع: SECRET:123456789 → 123456789:SECRET
    if (preg_match('/^([A-Za-z0-9_-]{20,}):(\d{6,12})$/', $token, $m)) {
        $token = $m[2] . ':' . $m[1];
    }
    return $token;
}

function fbbf_telegram_api(string $token, string $method, array $params = []): ?array {
    $token = fbbf_normalize_telegram_token($token);
    if ($token === '' || !preg_match('/^\d+:[A-Za-z0-9_-]+$/', $token)) {
        return ['_error' => 'invalid_token', 'ok' => false, 'description' => 'صيغة التوكن غير صحيحة. يجب أن تكون: 123456789:AAH...'];
    }
    $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
    $usePost = in_array($method, ['sendMessage', 'editMessageText', 'answerCallbackQuery'], true) || strlen(http_build_query($params)) > 1500;
    if ($params && !$usePost) {
        $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($params);
    }
    // InfinityFree وغيرها أحيانًا تفشل في DNS لـ api.telegram.org — نجرّب IPs معروفة مع SNI
    $resolveIps = [
        '149.154.167.220',
        '149.154.167.50',
        '149.154.167.99',
        '149.154.167.91',
    ];
    $lastError = '';
    $httpCode = 0;
    if (function_exists('curl_init')) {
        $attempts = array_merge([null], $resolveIps); // null = DNS عادي أولاً
        foreach ($attempts as $ip) {
            $ch = curl_init($url);
            $opts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 12,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: fb-Bablushr-F'],
            ];
            if ($usePost) {
                $opts[CURLOPT_POST] = true;
                $opts[CURLOPT_POSTFIELDS] = http_build_query($params);
                $opts[CURLOPT_HTTPHEADER][] = 'Content-Type: application/x-www-form-urlencoded';
            }
            if ($ip !== null) {
                $opts[CURLOPT_RESOLVE] = ['api.telegram.org:443:' . $ip];
            }
            curl_setopt_array($ch, $opts);
            $raw = curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $cerr = (string)curl_error($ch);
            curl_close($ch);
            if ($raw !== false && $raw !== '') {
                $data = json_decode((string)$raw, true);
                if (is_array($data)) return $data;
                $lastError = 'رد غير مفهوم من تيليجرام (HTTP ' . $httpCode . ')';
                continue;
            }
            $lastError = $cerr !== '' ? $cerr : ('HTTP ' . $httpCode);
        }
        return ['_error' => 'curl', 'ok' => false, 'description' => 'الاستضافة لا تصل لتيليجرام (' . $lastError . '). استخدم الاكتشاف من المتصفح في لوحة الأدمن.'];
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 12,
            'header' => "Accept: application/json\r\nUser-Agent: fb-Bablushr-F\r\n",
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false || $raw === '') {
        return ['_error' => 'fopen', 'ok' => false, 'description' => 'الاستضافة تمنع الاتصال بتيليجرام. اربط التوكن والـ Chat ID عبر أزرار المتصفح في الأدمن.'];
    }
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : ['_error' => 'json', 'ok' => false, 'description' => 'رد غير مفهوم من تيليجرام'];
}

/** يستخرج آخر chat_id خاص بعد ما المستخدم يراسل البوت */
function fbbf_telegram_discover_chat_id(string $token): array {
    $token = fbbf_normalize_telegram_token($token);
    $data = fbbf_telegram_api($token, 'getUpdates', ['limit' => 30]);
    if (!is_array($data)) {
        return ['ok' => false, 'error' => 'تعذر الاتصال بتيليجرام.'];
    }
    if (isset($data['_error']) || (isset($data['ok']) && $data['ok'] === false && empty($data['result']))) {
        $desc = (string)($data['description'] ?? 'تعذر الاتصال بتيليجرام. تحقق من التوكن أو اتصال السيرفر.');
        return ['ok' => false, 'error' => $desc];
    }
    if (empty($data['ok'])) {
        $desc = (string)($data['description'] ?? 'توكن غير صالح');
        return ['ok' => false, 'error' => $desc];
    }
    $updates = $data['result'] ?? [];
    if (!is_array($updates) || !$updates) {
        return ['ok' => false, 'error' => 'لا توجد رسائل بعد. افتح تيليجرام → البوت → Start أو اكتب أي رسالة، ثم اضغط الاكتشاف خلال دقيقة.'];
    }
    $chatId = null;
    $chatTitle = '';
    for ($i = count($updates) - 1; $i >= 0; $i--) {
        $msg = $updates[$i]['message'] ?? $updates[$i]['edited_message'] ?? $updates[$i]['my_chat_member'] ?? null;
        $chat = is_array($msg) ? ($msg['chat'] ?? null) : null;
        if (!$chat && isset($updates[$i]['my_chat_member']['chat'])) {
            $chat = $updates[$i]['my_chat_member']['chat'];
        }
        if (!$chat || empty($chat['id'])) continue;
        $chatId = (string)$chat['id'];
        $chatTitle = trim((string)($chat['first_name'] ?? '') . ' ' . (string)($chat['username'] ?? $chat['title'] ?? ''));
        break;
    }
    if ($chatId === null) {
        return ['ok' => false, 'error' => 'وُجدت تحديثات لكن بدون chat id. راسل البوت برسالة نصية عادية ثم أعد المحاولة.'];
    }
    return ['ok' => true, 'chat_id' => $chatId, 'label' => trim($chatTitle), 'token' => $token];
}

function fbbf_telegram_test_message(string $token, string $chatId): array {
    $token = fbbf_normalize_telegram_token($token);
    $data = fbbf_telegram_api($token, 'sendMessage', [
        'chat_id' => $chatId,
        'text' => "✅ fb Bablushr F\nتم ربط الإشعارات بنجاح.\nالوقت: " . fbbf_iso(time()),
    ]);
    if (!is_array($data)) return ['ok' => false, 'error' => 'تعذر الإرسال'];
    if (!empty($data['ok'])) return ['ok' => true];
    return ['ok' => false, 'error' => (string)($data['description'] ?? 'فشل الإرسال')];
}

function fbbf_send_telegram(string $message, ?array $replyMarkup = null, ?string $chatIdOverride = null): bool {
    $config = fbbf_config();
    $token = fbbf_normalize_telegram_token((string)($config['telegram_bot_token'] ?? ''));
    $chatId = trim((string)($chatIdOverride ?? ($config['telegram_chat_id'] ?? '')));
    if ($token === '' || $chatId === '') return false;
    $params = [
        'chat_id' => $chatId,
        'text' => mb_substr($message, 0, 4000),
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => '1',
    ];
    if ($replyMarkup) {
        $params['reply_markup'] = json_encode($replyMarkup, JSON_UNESCAPED_UNICODE);
    }
    // نستخدم curl + IP fallback (InfinityFree)
    if (function_exists('fbbf_telegram_api')) {
        $res = fbbf_telegram_api($token, 'sendMessage', $params);
        return is_array($res) && !empty($res['ok']);
    }
    $url = "https://api.telegram.org/bot{$token}/sendMessage";
    $payload = http_build_query($params);
    return fbbf_fire_and_forget_post($url, $payload, 'application/x-www-form-urlencoded');
}

/** هل الإضافة مفعّلة عالميًا من الأدمن/تيليجرام؟ */
function fbbf_extension_globally_enabled(): bool {
    $c = fbbf_config();
    if (array_key_exists('extension_globally_enabled', $c)) {
        return !empty($c['extension_globally_enabled']);
    }
    return true; // افتراضي مفعّلة
}

function fbbf_set_extension_globally_enabled(bool $on): bool {
    $c = fbbf_config();
    $c['extension_globally_enabled'] = $on;
    $c['extension_toggle_at'] = fbbf_now();
    return fbbf_save_config($c);
}

/** تفعيل خطة لمستخدم بالبريد (مشترك بين الأدمن والبوت) */
function fbbf_admin_apply_plan_to_email(string $email, string $planKey = 'monthly'): array {
    $email = fbbf_normalize_email($email);
    $plans = fbbf_plan_catalog();
    if (!isset($plans[$planKey])) {
        return ['ok' => false, 'error' => 'خطة غير معروفة: ' . $planKey];
    }
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $email);
    if ($i === -1) return ['ok' => false, 'error' => 'المستخدم غير موجود'];
    $days = (int)$plans[$planKey]['days'];
    $base = max(fbbf_now(), (int)($users[$i]['subscription_expires_at'] ?? 0));
    $users[$i]['plan_key'] = $planKey;
    $users[$i]['plan_label'] = $plans[$planKey]['label'];
    $users[$i]['subscription_expires_at'] = $base + ($days * 86400);
    $users[$i]['blocked'] = false;
    // لا تمسح الأجهزة ولا التوكن — مسحها كان يسبب طرد العملاء بعد التفعيل
    $users[$i]['updated_at'] = fbbf_now();
    fbbf_save_users($users);
    return ['ok' => true, 'email' => $email, 'plan' => $plans[$planKey]['label'], 'until' => $users[$i]['subscription_expires_at']];
}

function fbbf_admin_set_block(string $email, bool $block): array {
    $email = fbbf_normalize_email($email);
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $email);
    if ($i === -1) return ['ok' => false, 'error' => 'المستخدم غير موجود'];
    $users[$i]['blocked'] = $block;
    $users[$i]['updated_at'] = fbbf_now();
    fbbf_save_users($users);
    return ['ok' => true, 'email' => $email, 'blocked' => $block];
}

function fbbf_admin_renew_trial_email(string $email): array {
    $email = fbbf_normalize_email($email);
    $users = fbbf_users();
    $i = fbbf_find_user_index($users, $email);
    if ($i === -1) return ['ok' => false, 'error' => 'المستخدم غير موجود'];
    $now = fbbf_now();
    $users[$i]['trial_started_at'] = $now;
    $users[$i]['trial_ends_at'] = $now + (fbbf_trial_days() * 86400);
    $users[$i]['blocked'] = false;
    $users[$i]['devices'] = [];
    $users[$i]['last_login_device_id'] = '';
    $users[$i]['updated_at'] = $now;
    fbbf_save_users($users);
    return ['ok' => true, 'email' => $email, 'until' => $users[$i]['trial_ends_at']];
}

function fbbf_admin_stats_snapshot(): array {
    $users = fbbf_users();
    $payments = fbbf_payments();
    $stats = ['all'=>0,'active'=>0,'trial'=>0,'expired'=>0,'blocked'=>0,'pending'=>0,'pending_payments'=>0];
    foreach ($users as $u) {
        $stats['all']++;
        $s = $u['status'] ?? 'pending';
        if (isset($stats[$s])) $stats[$s]++;
    }
    foreach ($payments as $p) {
        if (($p['status'] ?? '') === 'pending') $stats['pending_payments']++;
    }
    $day = date('Y-m-d');
    $activeToday = 0;
    foreach ($users as $u) {
        $t = (int)($u['last_check_at'] ?? $u['last_login_at'] ?? 0);
        if ($t > 0 && date('Y-m-d', $t) === $day) $activeToday++;
    }
    $stats['active_today'] = $activeToday;
    $stats['ext_on'] = fbbf_extension_globally_enabled();
    return $stats;
}

/** تقرير يومي مرة واحدة كل 24 ساعة (يُستدعى من check/admin) */
function fbbf_maybe_daily_telegram_report(): void {
    $c = fbbf_config();
    if (empty($c['telegram_bot_token']) || empty($c['telegram_chat_id'])) return;
    $last = (int)($c['telegram_daily_report_at'] ?? 0);
    if ($last > 0 && (fbbf_now() - $last) < 86400) return;
    $s = fbbf_admin_stats_snapshot();
    $msg = "📊 <b>تقرير يومي — fb Bablushr F</b>
"
        . "المستخدمون: {$s['all']}
"
        . "نشطون: {$s['active']} · تجربة: {$s['trial']}
"
        . "منتهية: {$s['expired']} · محظور: {$s['blocked']}
"
        . "نشط اليوم: {$s['active_today']}
"
        . "دفع معلّق: {$s['pending_payments']}
"
        . "الإضافة: " . ($s['ext_on'] ? '✅ مفعّلة' : '⏸ متوقفة') . "
"
        . "⏰ " . date('Y-m-d H:i');
    if (fbbf_send_telegram($msg)) {
        $c['telegram_daily_report_at'] = fbbf_now();
        fbbf_save_config($c);
    }
}

function fbbf_telegram_support_url(): string {
    $c = fbbf_config();
    $bot = trim((string)($c['telegram_bot_username'] ?? 'fbpublisher_bot'));
    $bot = ltrim($bot, '@');
    if ($bot === '') $bot = 'fbpublisher_bot';
    return 'https://t.me/' . $bot;
}

function fbbf_support_whatsapp_number(): string {
    $c = fbbf_config();
    $n = preg_replace('/\D+/', '', (string)($c['support_whatsapp'] ?? $c['whatsapp_phone'] ?? '201277181217'));
    return $n !== '' ? $n : '201277181217';
}

function fbbf_user_whatsapp_ready_link(string $email, string $name = '', string $context = 'تسجيل'): string {
    $phone = fbbf_support_whatsapp_number();
    $msg = "مرحباً، تم {$context} في fb Bablushr F
"
        . "الاسم: " . ($name !== '' ? $name : '—') . "
"
        . "الإيميل: {$email}
"
        . "أرجو المتابعة/التفعيل.";
    return 'https://wa.me/' . $phone . '?text=' . rawurlencode($msg);
}

function fbbf_send_whatsapp(string $message): bool {
    $config = fbbf_config();
    $phone = trim((string)($config['whatsapp_phone'] ?? ''));
    $apiKey = trim((string)($config['whatsapp_callmebot_apikey'] ?? ''));
    if ($phone === '' || $apiKey === '') return false;
    $url = 'https://api.callmebot.com/whatsapp.php?' . http_build_query([
        'phone' => $phone,
        'text' => $message,
        'apikey' => $apiKey,
    ]);
    $response = fbbf_fire_and_forget_get_with_response($url);
    // نخزّن آخر رد فعلي من CallMeBot (مش بس نجاح/فشل الاتصال) عشان الأدمن
    // يقدر يشوف السبب الحقيقي للفشل (زي "APIKey is invalid" أو "not allowed
    // to send messages") بدل ما يفضل الموضوع غامض ومفيش وسيلة تشخيص.
    fbbf_save_last_whatsapp_result($response);
    if ($response === null) return false;
    // ردود CallMeBot الناجحة بتحتوي على "Message queued" عادةً؛ أي حاجة
    // تانية (خطأ، حظر، مفتاح غلط) بنعتبرها فشل حقيقي مش مجرد نجاح اتصال
    return stripos($response, 'Message queued') !== false || stripos($response, 'sent') !== false;
}

function fbbf_save_last_whatsapp_result(?string $response): void {
    $config = fbbf_config();
    $config['whatsapp_last_result'] = $response ?? '(لا يوجد رد من CallMeBot — تحقق من اتصال السيرفر)';
    $config['whatsapp_last_attempt_at'] = fbbf_now();
    fbbf_save_config($config);
}

/**
 * نسخة من fbbf_fire_and_forget_post بترجع نص الرد الفعلي بدل true/false بس،
 * مطلوبة تحديدًا هنا عشان نقدر نشخّص أسباب فشل CallMeBot الحقيقية.
 */
function fbbf_fire_and_forget_get_with_response(string $url): ?string {
    if (!function_exists('curl_init')) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $result = @curl_exec($ch);
    curl_close($ch);
    return $result === false ? null : strip_tags((string)$result);
}

/**
 * إرسال HTTP بأقصر مهلة ممكنة (3 ثواني) بحيث لو الشبكة بطيئة أو القناة
 * واقعة، الطلب الأساسي (تسجيل/تحميل) ميتأخرش ولا يفشل بسبب الإشعار.
 */
function fbbf_fire_and_forget_post(string $url, ?string $body, ?string $contentType): bool {
    if (!function_exists('curl_init')) return false;
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => true,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = $body;
        if ($contentType) {
            $opts[CURLOPT_HTTPHEADER] = ["Content-Type: {$contentType}"];
        }
    }
    curl_setopt_array($ch, $opts);
    $result = @curl_exec($ch);
    $ok = $result !== false;
    curl_close($ch);
    return $ok;
}

/**
 * نقطة الدخول الموحدة لإرسال إشعار لصاحب الموقع عبر كل القنوات المفعّلة.
 * $type: 'register' | 'download'
 */
function fbbf_notify_owner(string $type, array $context): void {
    $config = fbbf_config();
    $enabledKey = $type === 'register' ? 'notify_on_register' : 'notify_on_download';
    $enabled = !isset($config[$enabledKey]) || !empty($config[$enabledKey]);
    if (!$enabled) return;

    if ($type === 'register') {
        $title = '👤 تسجيل حساب جديد';
        $body = sprintf(
            'الإيميل: %s%sالجهاز: %s%sالوقت: %s',
            $context['email'] ?? '-', "\n",
            $context['device_label'] ?? ($context['device_id'] ?? '-'), "\n",
            date('Y-m-d H:i')
        );
        $tgMessage = "👤 <b>تسجيل حساب جديد</b>\nالإيميل: {$context['email']}\nالجهاز: " . ($context['device_label'] ?? $context['device_id'] ?? '-') . "\nالوقت: " . date('Y-m-d H:i');
    } else {
        $title = '⬇️ تحميل جديد';
        $body = sprintf(
            'الإيميل: %s%sالوقت: %s',
            $context['email'] ?? '-', "\n",
            date('Y-m-d H:i')
        );
        $tgMessage = "⬇️ <b>تحميل جديد للإضافة</b>\nالإيميل: " . ($context['email'] ?? '-') . "\nالوقت: " . date('Y-m-d H:i');
    }

    // الطبقة 1: لوحة التحكم — تعمل دائمًا، صفر اعتماديات خارجية
    fbbf_add_dashboard_notification($type, $title, $body, $context);

    // الطبقة 2 و3: تيليجرام وواتساب — بأمان تام (فشلهما لا يوقف أي شيء)
    try { fbbf_send_telegram($tgMessage); } catch (\Throwable $e) { /* silent */ }
    try { fbbf_send_whatsapp($body); } catch (\Throwable $e) { /* silent */ }
}

/* ═══════════════════════════════════════════════════════════════
   DOWNLOAD TOKENS — توكين مؤقت منفصل تمامًا عن access_token الدائم
   ═══════════════════════════════════════════════════════════════
   المشكلة اللي بيحلّها: قبل كده كان رابط التحميل بيحتوي على نفس
   access_token الدائم بتاع جلسة الإضافة نفسها (login-download.php
   كان بيولّد access_token جديد ويحطه في رابط ?token=... مباشرة).
   لو الرابط ده اتسرب (سجلات السيرفر، تاريخ المتصفح، إلخ)، أي حد
   يقدر يستخدم نفس التوكين ليدخل بيانات الحساب فعليًا من check.php.

   الحل: توكين تحميل منفصل تمامًا — عمره 5 دقايق بس، استخدام واحد،
   مخزّن في ملف منفصل عن users.json، وبيتمسح فور الاستخدام. حتى لو
   اتسرب رابط التحميل، مفيش أي علاقة له بجلسة الدخول الحقيقية.
   ═══════════════════════════════════════════════════════════════ */

function fbbf_download_tokens(): array {
    $tokens = fbbf_read_json(FBBF_DOWNLOAD_TOKENS_FILE, []);
    $now = fbbf_now();
    // تنظيف تلقائي: أي توكين قديم منتهي الصلاحية يتمسح عند كل قراءة
    return array_filter($tokens, fn($t) => ($t['expires_at'] ?? 0) > $now);
}

/**
 * إصدار توكين تحميل مؤقت جديد لإيميل معيّن. صالح 5 دقايق، استخدام واحد.
 */
function fbbf_issue_download_token(string $email, int $ttlSeconds = 900): string {
    $tokens = fbbf_download_tokens();
    $token = bin2hex(random_bytes(24));
    $tokens[$token] = [
        'email' => $email,
        'expires_at' => fbbf_now() + $ttlSeconds,
        'used' => false,
    ];
    fbbf_write_json(FBBF_DOWNLOAD_TOKENS_FILE, $tokens);
    return $token;
}

/**
 * التحقق من توكين تحميل ومسحه فورًا (استخدام واحد فقط). بيرجع الإيميل
 * المرتبط بالتوكين لو صالح، أو null لو غير صالح/منتهي/مُستخدم من قبل.
 */
function fbbf_consume_download_token(string $token): ?string {
    if ($token === '') return null;
    $tokens = fbbf_download_tokens();
    if (!isset($tokens[$token]) || !empty($tokens[$token]['used'])) {
        return null;
    }
    $email = (string)($tokens[$token]['email'] ?? '');
    // مسح فوري بعد الاستخدام — single-use حقيقي، مش بس علامة "مُستخدم"
    unset($tokens[$token]);
    fbbf_write_json(FBBF_DOWNLOAD_TOKENS_FILE, $tokens);
    return $email !== '' ? $email : null;
}

/* ═══════════════════════════════════════════════════════════════
   AUDIT LOG — سجل عمليات الأدمن
   ═══════════════════════════════════════════════════════════════ */
define('FBBF_AUDIT_FILE', FBBF_DATA . '/audit-log.json');
define('FBBF_VERIFICATION_CODES_FILE', FBBF_DATA . '/verification-codes.json');

function fbbf_audit_log(string $action, string $target = '', string $details = ''): void {
    $logs = fbbf_read_json(FBBF_AUDIT_FILE, []);
    if (!is_array($logs)) $logs = [];
    array_unshift($logs, [
        'ts' => fbbf_now(),
        'action' => $action,
        'target' => $target,
        'details' => $details,
        'ip' => (string)($_SERVER['REMOTE_ADDR'] ?? ''),
    ]);
    // احتفظ بآخر 500 سجل فقط
    $logs = array_slice($logs, 0, 500);
    fbbf_write_json(FBBF_AUDIT_FILE, $logs);
}

function fbbf_audit_logs(int $limit = 100): array {
    $logs = fbbf_read_json(FBBF_AUDIT_FILE, []);
    return array_slice(is_array($logs) ? $logs : [], 0, $limit);
}

/* ═══════════════════════════════════════════════════════════════
   VERIFICATION / EMAIL CODES — أكواد التأكيد والترحيب
   يعمل على InfinityFree بدون SMTP إلزامي: يخزّن الكود ويعرضه للأدمن
   ويحاول mail() إن وُجد إعداد، ويدعم تيليجرام كقناة بديلة.
   ═══════════════════════════════════════════════════════════════ */
function fbbf_verification_codes(): array {
    $codes = fbbf_read_json(FBBF_VERIFICATION_CODES_FILE, []);
    $now = fbbf_now();
    $clean = [];
    foreach ((array)$codes as $email => $entry) {
        if (($entry['expires_at'] ?? 0) > $now) {
            $clean[$email] = $entry;
        }
    }
    if (count($clean) !== count((array)$codes)) {
        fbbf_write_json(FBBF_VERIFICATION_CODES_FILE, $clean);
    }
    return $clean;
}

function fbbf_issue_verification_code(string $email, string $purpose = 'welcome', int $ttl = 900): string {
    $email = fbbf_normalize_email($email);
    $code = (string)random_int(100000, 999999);
    $all = fbbf_verification_codes();
    $all[$email] = [
        'code' => $code,
        'purpose' => $purpose,
        'expires_at' => fbbf_now() + $ttl,
        'created_at' => fbbf_now(),
        'attempts' => 0,
    ];
    fbbf_write_json(FBBF_VERIFICATION_CODES_FILE, $all);

    // محاولة إرسال بريد (قد يفشل على الاستضافة المجانية — لا مشكلة)
    $config = fbbf_config();
    $subject = $purpose === 'welcome'
        ? 'مرحبًا بك في fb Bablushr F — كود التأكيد'
        : 'كود التحقق — fb Bablushr F';
    $body = "مرحبًا،\n\nكود التحقق الخاص بك: {$code}\nصالح لمدة " . (int)($ttl / 60) . " دقيقة.\n\n— فريق fb Bablushr F";
    if (!empty($config['mail_from'])) {
        $headers = 'From: ' . $config['mail_from'] . "\r\n" .
            'Content-Type: text/plain; charset=UTF-8';
        @mail($email, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
    } else {
        @mail($email, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body);
    }

    // إشعار تيليجرام للأدمن (اختياري)
    try {
        fbbf_send_telegram("📧 كود {$purpose} لـ {$email}: {$code}");
    } catch (\Throwable $e) { /* silent */ }

    return $code;
}

function fbbf_verify_code(string $email, string $code): bool {
    $email = fbbf_normalize_email($email);
    $all = fbbf_verification_codes();
    if (!isset($all[$email])) return false;
    $entry = $all[$email];
    $entry['attempts'] = (int)($entry['attempts'] ?? 0) + 1;
    if ($entry['attempts'] > 8) {
        unset($all[$email]);
        fbbf_write_json(FBBF_VERIFICATION_CODES_FILE, $all);
        return false;
    }
    if (!hash_equals((string)$entry['code'], trim($code))) {
        $all[$email] = $entry;
        fbbf_write_json(FBBF_VERIFICATION_CODES_FILE, $all);
        return false;
    }
    unset($all[$email]);
    fbbf_write_json(FBBF_VERIFICATION_CODES_FILE, $all);
    return true;
}

/* ═══════════════════════════════════════════════════════════════
   THEME ENGINE — Obsidian Aurora + ثيمات قابلة للتبديل
   ═══════════════════════════════════════════════════════════════ */
function fbbf_theme_presets(): array {
    return [
        'publisher' => [
            'label' => 'FB Publisher X',
            'bg' => '#0a0e17',
            's1' => '#121826',
            's2' => '#1a2233',
            'p1' => '#4a6fa5',
            'p2' => '#6b8fc5',
            'p3' => '#8b9cb8',
            'warn' => '#c4a35a',
            't1' => '#e6eaf2',
            't2' => '#9aa3b5',
            'glow' => 'rgba(74,111,165,0.28)',
            'pg' => 'linear-gradient(135deg,#2a3f6a,#3d5a8a,#4a6fa5)',
            'radius' => '14px',
            'btn_style' => 'gradient',
        ],
        'obsidian_aurora' => [
            'label' => 'Obsidian Aurora',
            'bg' => '#0B0F14',
            's1' => '#12181F',
            's2' => '#1A222D',
            'p1' => '#00C9A7',
            'p2' => '#7C5CFC',
            'p3' => '#2EE59D',
            'warn' => '#FF6B4A',
            't1' => '#E8F0F7',
            't2' => '#8B9BB0',
            'glow' => 'rgba(0,201,167,0.25)',
            'pg' => 'linear-gradient(135deg,#0B0F14 0%,#12181F 40%,#1A222D 100%)',
        ],
        'verdigris' => [
            'label' => 'Verdigris',
            'bg' => '#0a1a18',
            's1' => '#0f2a26',
            's2' => '#143530',
            'p1' => '#14b8a6',
            'p2' => '#2dd4bf',
            'p3' => '#5eead4',
            'warn' => '#f59e0b',
            't1' => '#ecfdf5',
            't2' => '#99f6e4',
            'glow' => 'rgba(20,184,166,0.28)',
            'pg' => 'linear-gradient(135deg,#0d5f58 0%,#0f766e 48%,#2dd4bf 100%)',
        ],
        'blue' => [
            'label' => 'Ocean Blue',
            'bg' => '#0c1222',
            's1' => '#111827',
            's2' => '#1e293b',
            'p1' => '#3b82f6',
            'p2' => '#60a5fa',
            'p3' => '#93c5fd',
            'warn' => '#f59e0b',
            't1' => '#f1f5f9',
            't2' => '#94a3b8',
            'glow' => 'rgba(59,130,246,0.36)',
            'pg' => 'linear-gradient(135deg,#1e3a8a,#1d4ed8,#3b82f6)',
        ],
        'purple' => [
            'label' => 'Deep Purple',
            'bg' => '#0f0a1a',
            's1' => '#1a1229',
            's2' => '#2a1a3d',
            'p1' => '#8b5cf6',
            'p2' => '#a78bfa',
            'p3' => '#c4b5fd',
            'warn' => '#f472b6',
            't1' => '#f5f3ff',
            't2' => '#c4b5fd',
            'glow' => 'rgba(139,92,246,0.36)',
            'pg' => 'linear-gradient(135deg,#4c1d95,#6d28d9,#8b5cf6)',
        ],
        'red' => [
            'label' => 'Crimson',
            'bg' => '#1a0a0a',
            's1' => '#291414',
            's2' => '#3d1a1a',
            'p1' => '#ef4444',
            'p2' => '#f87171',
            'p3' => '#fca5a5',
            'warn' => '#fbbf24',
            't1' => '#fef2f2',
            't2' => '#fecaca',
            'glow' => 'rgba(239,68,68,0.36)',
            'pg' => 'linear-gradient(135deg,#7f1d1d,#991b1b,#ef4444)',
        ],
    ];
}

function fbbf_active_theme_key(): string {
    $config = fbbf_config();
    // يدعم المفتاحين: site_theme (لوحة الأدمن) و theme (قديم)
    $key = (string)($config['site_theme'] ?? $config['theme'] ?? 'publisher');
    // مرادفات قديمة
    if ($key === 'gold') $key = 'publisher';
    $presets = fbbf_theme_presets();
    return isset($presets[$key]) ? $key : 'publisher';
}

function fbbf_active_theme(): array {
    $presets = fbbf_theme_presets();
    return $presets[fbbf_active_theme_key()];
}

function fbbf_theme_css_vars(?array $theme = null): string {
    $t = $theme ?: fbbf_active_theme();
    $lines = [];
    foreach ($t as $k => $v) {
        if ($k === 'label') continue;
        $lines[] = '--' . $k . ':' . $v;
    }
    return implode(';', $lines) . ';';
}

/* ═══════════════════════════════════════════════════════════════
   CLOUDFLARE TURNSTILE
   ═══════════════════════════════════════════════════════════════ */
function fbbf_public_theme_payload(): array {
    $key = fbbf_active_theme_key();
    $presets = fbbf_theme_presets();
    $theme = $presets[$key] ?? $presets['publisher'] ?? reset($presets);
    $config = fbbf_config();
    $radius = (string)($config['theme_radius'] ?? ($theme['radius'] ?? '14px'));
    $btnStyle = (string)($config['theme_btn_style'] ?? ($theme['btn_style'] ?? 'gradient'));
    $iconSet = (string)($config['theme_icon_set'] ?? 'modern');
    $applyExt = array_key_exists('theme_apply_extension', $config) ? !empty($config['theme_apply_extension']) : true;
    return [
        'ok' => true,
        'key' => $key,
        'label' => (string)($theme['label'] ?? $key),
        'apply_extension' => $applyExt,
        'radius' => $radius,
        'btn_style' => $btnStyle,
        'icon_set' => $iconSet,
        'vars' => [
            '--bg' => (string)($theme['bg'] ?? '#050810'),
            '--s1' => (string)($theme['s1'] ?? '#0c1222'),
            '--s2' => (string)($theme['s2'] ?? '#121a30'),
            '--p1' => (string)($theme['p1'] ?? '#3b82f6'),
            '--p2' => (string)($theme['p2'] ?? '#22d3ee'),
            '--p3' => (string)($theme['p3'] ?? '#a78bfa'),
            '--t1' => (string)($theme['t1'] ?? '#f0f4ff'),
            '--t2' => (string)($theme['t2'] ?? '#a5b4d4'),
            '--warn' => (string)($theme['warn'] ?? '#fbbf24'),
            '--pg' => (string)($theme['pg'] ?? 'linear-gradient(135deg,#2563eb,#7c3aed,#22d3ee)'),
            '--glow' => (string)($theme['glow'] ?? 'rgba(59,130,246,0.35)'),
            '--radius' => $radius,
        ],
        'updated_at' => (int)($config['theme_updated_at'] ?? 0),
    ];
}


function fbbf_turnstile_enabled(): bool {
    $c = fbbf_config();
    return !empty($c['turnstile_site_key']) && !empty($c['turnstile_secret_key']);
}

function fbbf_verify_turnstile(?string $token): bool {
    if (!fbbf_turnstile_enabled()) return true; // معطّل = نمرّر
    if (!$token) return false;
    $secret = (string)(fbbf_config()['turnstile_secret_key'] ?? '');
    $data = http_build_query([
        'secret' => $secret,
        'response' => $token,
        'remoteip' => (string)($_SERVER['REMOTE_ADDR'] ?? ''),
    ]);
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $data,
            'timeout' => 8,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $ctx);
    if ($raw === false) return false;
    $json = json_decode($raw, true);
    return !empty($json['success']);
}

/* ═══════════════════════════════════════════════════════════════
   GOOGLE OAUTH (إعدادات فقط — يحتاج Client ID/Secret من Google Console)
   ═══════════════════════════════════════════════════════════════ */
function fbbf_google_oauth_enabled(): bool {
    $c = fbbf_config();
    $id = trim((string)($c['google_client_id'] ?? ''));
    $sec = trim((string)($c['google_client_secret'] ?? ''));
    return $id !== '' && $sec !== '';
}

function fbbf_google_auth_url(string $redirectUri): string {
    $c = fbbf_config();
    $params = [
        'client_id' => trim((string)($c['google_client_id'] ?? '')),
        'redirect_uri' => $redirectUri,
        'response_type' => 'code',
        'scope' => 'openid email profile',
        'access_type' => 'online',
        'prompt' => 'select_account',
    ];
    return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
}

function fbbf_google_exchange_code(string $code, string $redirectUri): ?array {
    $c = fbbf_config();
    $data = http_build_query([
        'code' => $code,
        'client_id' => trim((string)($c['google_client_id'] ?? '')),
        'client_secret' => trim((string)($c['google_client_secret'] ?? '')),
        'redirect_uri' => $redirectUri,
        'grant_type' => 'authorization_code',
    ]);
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $data,
            'timeout' => 12,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents('https://oauth2.googleapis.com/token', false, $ctx);
    if ($raw === false) return null;
    $tok = json_decode($raw, true);
    if (empty($tok['access_token'])) return null;

    $ctx2 = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => 'Authorization: Bearer ' . $tok['access_token'] . "\r\n",
            'timeout' => 10,
            'ignore_errors' => true,
        ],
    ]);
    $infoRaw = @file_get_contents('https://www.googleapis.com/oauth2/v2/userinfo', false, $ctx2);
    if ($infoRaw === false) return null;
    $info = json_decode($infoRaw, true);
    if (empty($info['email'])) return null;
    return $info;
}

/* ═══════════════════════════════════════════════════════════════
   STATS HELPERS للأدمن
   ═══════════════════════════════════════════════════════════════ */
function fbbf_admin_stats(): array {
    $users = fbbf_users();
    $now = fbbf_now();
    $active = 0;
    $trial = 0;
    $expired = 0;
    $blocked = 0;
    $devices = 0;
    foreach ($users as $u) {
        $st = $u['status'] ?? '';
        if ($st === 'active') $active++;
        elseif ($st === 'trial') $trial++;
        elseif ($st === 'expired' || $st === 'pending') $expired++;
        if (!empty($u['blocked'])) $blocked++;
        $devices += count(fbbf_user_devices($u));
    }
    $payments = fbbf_payments();
    $pendingPay = 0;
    foreach ((array)$payments as $p) {
        if (($p['status'] ?? '') === 'pending') $pendingPay++;
    }
    return [
        'total_users' => count($users),
        'active' => $active,
        'trial' => $trial,
        'expired' => $expired,
        'blocked' => $blocked,
        'devices' => $devices,
        'pending_payments' => $pendingPay,
        'extension_version' => (string)(fbbf_config()['extension_version'] ?? '—'),
    ];
}


/* ═══════════════════════════════════════════════════════════════
   USER ANNOUNCEMENTS — إشعارات موجّهة للمستخدمين (إضافة + موقع + إيميل)
   ═══════════════════════════════════════════════════════════════ */
function fbbf_announcements(): array {
    return fbbf_read_json(FBBF_ANNOUNCEMENTS_FILE, []);
}

function fbbf_save_announcements(array $items): bool {
    return fbbf_write_json(FBBF_ANNOUNCEMENTS_FILE, array_values($items));
}

function fbbf_active_announcements(?string $email = null): array {
    $now = fbbf_now();
    $email = $email !== null ? fbbf_normalize_email($email) : '';
    $out = [];
    foreach (fbbf_announcements() as $a) {
        if (empty($a['active'])) continue;
        $exp = (int)($a['expires_at'] ?? 0);
        if ($exp > 0 && $exp < $now) continue;
        $item = $a;
        $seen = false;
        if ($email !== '' && !empty($a['seen_by'][$email])) {
            $seen = true;
        }
        $item['seen'] = $seen;
        // لا نرسل قائمة seen_by كاملة للعميل
        unset($item['seen_by']);
        $out[] = $item;
    }
    return $out;
}

function fbbf_mark_announcement_seen(string $id, string $email): bool {
    $email = fbbf_normalize_email($email);
    if ($id === '' || $email === '') return false;
    $all = fbbf_announcements();
    $changed = false;
    foreach ($all as &$a) {
        if (($a['id'] ?? '') === $id) {
            if (!isset($a['seen_by']) || !is_array($a['seen_by'])) $a['seen_by'] = [];
            $a['seen_by'][$email] = fbbf_now();
            $changed = true;
            break;
        }
    }
    unset($a);
    return $changed ? fbbf_save_announcements($all) : false;
}

function fbbf_send_user_email(string $to, string $subject, string $bodyText): bool {
    $to = fbbf_normalize_email($to);
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    $config = fbbf_config();
    $from = trim((string)($config['mail_from'] ?? ''));
    if ($from === '' || !filter_var($from, FILTER_VALIDATE_EMAIL)) {
        $from = 'noreply@faset.xo.je';
    }
    $subject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: fb Bablushr F <' . $from . '>',
        'Reply-To: ' . $from,
        'X-Mailer: fb-Bablushr-F',
    ];
    return @mail($to, $subject, $bodyText, implode("\r\n", $headers));
}

function fbbf_broadcast_announcement_emails(array $announcement): array {
    $users = fbbf_users();
    $sent = 0;
    $failed = 0;
    $title = (string)($announcement['title'] ?? 'إشعار');
    $body = (string)($announcement['body'] ?? '');
    $cta = trim((string)($announcement['cta_url'] ?? ''));
    $msg = "fb Bablushr F\n\n" . $title . "\n\n" . $body;
    if ($cta !== '') {
        $msg .= "\n\nرابط: " . $cta;
    }
    $msg .= "\n\n— فريق fb Bablushr F\nhttps://faset.xo.je";
    foreach ($users as $u) {
        if (!empty($u['blocked'])) continue;
        $email = fbbf_normalize_email((string)($u['email'] ?? ''));
        if ($email === '') continue;
        if (fbbf_send_user_email($email, $title, $msg)) $sent++;
        else $failed++;
    }
    return ['sent' => $sent, 'failed' => $failed];
}

