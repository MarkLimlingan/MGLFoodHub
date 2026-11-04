<?php
// /sitemap.xml, /llms.txt and /llms-full.txt (.htaccess sends them here), made from the database.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/orders.php';
require __DIR__ . '/lib/public.php';
require __DIR__ . '/lib/seo.php';

try {
    $file = (string) ($_GET['file'] ?? '');
    $body = match ($file) {
        'sitemap' => sitemap_xml(),
        'llms' => llms_txt(false),
        'llms-full' => llms_txt(true),
        default => null,
    };
    if ($body === null) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: ' . ($file === 'sitemap' ? 'application/xml' : 'text/plain') . '; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    echo $body;
} catch (Throwable $e) {
    error_log('MGL seo-files: ' . $e);
    http_response_code(503);
}
