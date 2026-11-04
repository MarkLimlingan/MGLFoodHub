<?php
// Router for PHP's built-in server (npm run dev:api, npm run test:api): does
// what public/.htaccess does on Hostinger for photos uploaded through the admin.
$uri = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/uploads/(.+)$#', $uri, $m) && !is_file($_SERVER['DOCUMENT_ROOT'] . $uri)) {
    $_GET['path'] = $m[1];
    require $_SERVER['DOCUMENT_ROOT'] . '/api/file.php';
    return true;
}
return false; // everything else as is (PHP files run, other files are sent)
