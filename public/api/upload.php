<?php
// Admin photo uploads (product photos, store covers and menus, payment QR codes).
//   POST file + kind (product-images | store-assets) + folder → { "url": "/uploads/…" }
// Saved in uploads_dir (mgl-config.php), outside public_html; api/file.php shows them.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

send_cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new ApiError('Method not allowed.', 405);
    }
    require_admin();
    $kind = (string) ($_POST['kind'] ?? '');
    if (!in_array($kind, ['product-images', 'store-assets'], true)) {
        throw new ApiError('Unknown upload.');
    }
    $folder = substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($_POST['folder'] ?? '')), 0, 64) ?: 'misc';
    $file = $_FILES['file'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        throw new ApiError('No image received.');
    }
    if ($file['size'] <= 0 || $file['size'] > MAX_BYTES) {
        throw new ApiError('Image is too large (max 10 MB).', 413);
    }
    $info = @getimagesize($file['tmp_name']);
    $ext = $info ? (TYPES[$info['mime']] ?? null) : null;
    if (!$ext) {
        throw new ApiError('Please upload a JPG, PNG or WEBP image.', 415);
    }

    $rel = "{$kind}/{$folder}/" . (int) floor(microtime(true) * 1000) . '-' . bin2hex(random_bytes(3)) . ".{$ext}";
    $dir = rtrim((string) (config()['uploads_dir'] ?? ''), '/\\');
    if ($dir === '') {
        throw new RuntimeException('uploads_dir is not set in mgl-config.php');
    }
    $target = "{$dir}/{$rel}";
    if (!is_dir(dirname($target)) && !@mkdir(dirname($target), 0755, true)) {
        throw new RuntimeException('Could not create ' . dirname($target));
    }
    if (!move_uploaded_file($file['tmp_name'], $target)) {
        throw new RuntimeException("Could not save {$target}");
    }
    @chmod($target, 0644);
    json_reply(200, ['url' => "/uploads/{$rel}"]);
} catch (ApiError $e) {
    json_reply($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('MGL upload: ' . $e);
    json_reply(500, ['error' => 'Could not save the image. Please try again.']);
}
