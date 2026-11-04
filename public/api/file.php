<?php
// Photos uploaded through the admin (product photos, store covers, QR codes),
// kept in uploads_dir OUTSIDE public_html so deploys never erase them.
// .htaccess sends /uploads/<path> here when it is not a file in the build.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

const TYPES = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

$path = (string) ($_GET['path'] ?? '');
if (!preg_match('~^(product-images|store-assets)/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,80}\.(jpg|png|webp)$~', $path, $m)) {
    http_response_code(404);
    exit;
}
$file = rtrim((string) (config()['uploads_dir'] ?? ''), '/\\') . '/' . $path;
if (!is_file($file)) {
    http_response_code(404);
    exit;
}
header('Content-Type: ' . TYPES[$m[2]]);
header('Content-Length: ' . filesize($file));
// Every upload gets a new name, so a photo never changes at the same address.
header('Cache-Control: public, max-age=31536000, immutable');
header('X-Content-Type-Options: nosniff');
readfile($file);
