<?php
// Router for PHP's built-in server (npm run dev:api, npm run test:api): does
// what public/.htaccess does on Hostinger.
$uri = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = $_SERVER['DOCUMENT_ROOT'];

// Photos uploaded through the admin.
if (preg_match('#^/uploads/(.+)$#', $uri, $m) && !is_file($root . $uri)) {
    $_GET['path'] = $m[1];
    require "{$root}/api/file.php";
    return true;
}
// sitemap.xml, llms.txt, llms-full.txt.
$files = ['/sitemap.xml' => 'sitemap', '/llms.txt' => 'llms', '/llms-full.txt' => 'llms-full'];
if (isset($files[$uri])) {
    $_GET['file'] = $files[$uri];
    require "{$root}/api/seo-files.php";
    return true;
}
// Pages: the home page and links without a file extension.
if ($uri === '/' || (!is_file($root . $uri) && !is_dir($root . $uri) && !preg_match('/\.[A-Za-z0-9]+$/', $uri))) {
    require "{$root}/api/page.php";
    return true;
}
return false; // everything else as is (PHP files run, other files are sent)
