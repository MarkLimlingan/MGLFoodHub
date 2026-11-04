<?php
// Payment screenshots, kept outside public_html (storage_dir in config.php).
//   POST file + device  → saves the image, returns { "path": "proofs/…" }
//   GET  ?path=…        → the image, for signed-in admins only (X-Admin-Token)
// place_order and resubmit_gcash_proof only accept a path whose file exists.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

send_cors();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    if ($method === 'POST') {
        $file = $_FILES['file'] ?? null;
        if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            throw new ApiError('No image received.');
        }
        if ($file['size'] <= 0 || $file['size'] > MAX_BYTES) {
            throw new ApiError('Image is too large (max 8 MB).', 413);
        }
        $info = @getimagesize($file['tmp_name']);
        $ext = $info ? (TYPES[$info['mime']] ?? null) : null;
        if (!$ext) {
            throw new ApiError('Please upload a JPG, PNG or WEBP image.', 415);
        }
        rate_limit('proof_upload_ip', client_ip(), 30, 3600, 'Too many uploads. Please try again later.');

        $device = substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($_POST['device'] ?? '')), 0, 64) ?: 'anon';
        $path = "proofs/{$device}/" . (int) floor(microtime(true) * 1000) . '-' . bin2hex(random_bytes(4)) . ".{$ext}";
        $target = proof_file($path);
        if (!is_dir(dirname($target)) && !@mkdir(dirname($target), 0750, true)) {
            throw new RuntimeException('Could not create ' . dirname($target));
        }
        if (!move_uploaded_file($file['tmp_name'], $target)) {
            throw new RuntimeException("Could not save {$target}");
        }
        @chmod($target, 0640);
        json_reply(200, ['path' => $path]);
    }

    if ($method === 'GET') {
        $path = (string) ($_GET['path'] ?? '');
        if (!preg_match(PROOF_PATH_RE, $path, $m)) {
            throw new ApiError('Not found.', 404);
        }
        require_admin();
        if (!is_file(proof_file($path))) {
            throw new ApiError('Not found.', 404);
        }
        header('Content-Type: ' . array_search($m[1], TYPES, true));
        header('Content-Length: ' . filesize(proof_file($path)));
        header('Cache-Control: private, no-store');
        readfile(proof_file($path));
        exit;
    }

    json_reply(405, ['error' => 'Method not allowed.']);
} catch (ApiError $e) {
    json_reply($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('MGL proof: ' . $e);
    json_reply(500, ['error' => 'Could not save the image. Please try again.']);
}
