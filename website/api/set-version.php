<?php
/**
 * api/set-version.php — Admin: update extension version + upload ZIP
 * POST (multipart):
 *   version    string  required  e.g. "17.0.0"
 *   filename   string  required  e.g. "fb-bablushr-f-v17-extension.zip"
 *   zipfile    file    optional  upload new ZIP directly
 *   notes      string  optional  release notes
 */
declare(strict_types=1);
require dirname(__DIR__) . '/includes/bootstrap.php';

fbbf_handle_options();

// Must be installed & admin logged in
if (!fbbf_is_installed()) {
    fbbf_json_response(['ok' => false, 'message' => 'server_not_configured'], 503);
}
if (!fbbf_admin_logged_in()) {
    fbbf_json_response(['ok' => false, 'message' => 'unauthorized'], 401);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fbbf_json_response(['ok' => false, 'message' => 'POST only'], 405);
}

$version  = trim((string)($_POST['version']  ?? ''));
$filename = trim((string)($_POST['filename'] ?? ''));
$notes    = trim((string)($_POST['notes']    ?? ''));

// Validate version format  x.y.z
if (!preg_match('/^\d+\.\d+\.\d+$/', $version)) {
    fbbf_json_response(['ok' => false, 'message' => 'رقم الإصدار يجب أن يكون بصيغة مثل: 16.0.0'], 422);
}
// Validate filename
if (!preg_match('/^[\w\-. ]+\.zip$/i', $filename)) {
    fbbf_json_response(['ok' => false, 'message' => 'اسم الملف غير صالح — يجب أن ينتهي بـ .zip'], 422);
}
// No path traversal
if (str_contains($filename, '/') || str_contains($filename, '\\')) {
    fbbf_json_response(['ok' => false, 'message' => 'اسم الملف غير مسموح'], 422);
}

$rootDir    = dirname(__DIR__);          // website root
$destZip    = $rootDir . '/' . $filename;
$updatesXml = $rootDir . '/updates.xml';
$siteUrl    = 'https://faset.xo.je';

// ── Handle ZIP upload (optional) ────────────────────────────────
$uploadedZip = false;
if (!empty($_FILES['zipfile']['tmp_name'])) {
    $tmp      = $_FILES['zipfile']['tmp_name'];
    $origName = $_FILES['zipfile']['name'] ?? '';
    $mimeOk   = in_array(mime_content_type($tmp), [
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream',
    ], true);
    if (!$mimeOk) {
        fbbf_json_response(['ok' => false, 'message' => 'الملف المرفوع ليس ZIP صالحاً'], 422);
    }
    if (!move_uploaded_file($tmp, $destZip)) {
        fbbf_json_response(['ok' => false, 'message' => 'فشل رفع الملف — تحقق من صلاحيات المجلد'], 500);
    }
    $uploadedZip = true;
}

// ── Generate updates.xml ─────────────────────────────────────────
$xmlContent = <<<XML
<?xml version='1.0' encoding='UTF-8'?>
<!--
  fb Bablushr F — Auto-Update Manifest
  آخر تحديث: {$version}  /  {$filename}
  تم التوليد تلقائياً من لوحة الإدارة
-->
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='dmcbokioicahkkemfjo'>
    <updatecheck
      codebase='{$siteUrl}/{$filename}'
      version='{$version}'
    />
  </app>
</gupdate>
XML;

if (file_put_contents($updatesXml, $xmlContent) === false) {
    fbbf_json_response(['ok' => false, 'message' => 'فشل كتابة updates.xml — تحقق من الصلاحيات'], 500);
}

// ── Save release log in app-config ──────────────────────────────
$config = fbbf_read_json(FBBF_APP_CONFIG, []);
$config['extension_version']  = $version;
$config['extension_filename'] = $filename;

$releaseLog   = $config['release_log'] ?? [];
$releaseLog[] = [
    'version'    => $version,
    'filename'   => $filename,
    'notes'      => $notes,
    'uploaded_at'=> date('Y-m-d H:i:s'),
    'zip_uploaded' => $uploadedZip,
];
// Keep last 50 entries
$config['release_log'] = array_slice($releaseLog, -50);
fbbf_write_json(FBBF_APP_CONFIG, $config);

fbbf_json_response([
    'ok'          => true,
    'version'     => $version,
    'filename'    => $filename,
    'zip_url'     => $siteUrl . '/' . $filename,
    'zip_uploaded'=> $uploadedZip,
    'xml_url'     => $siteUrl . '/updates.xml',
    'message'     => 'تم تحديث updates.xml بنجاح' . ($uploadedZip ? ' ورفع الملف ZIP' : ''),
]);
