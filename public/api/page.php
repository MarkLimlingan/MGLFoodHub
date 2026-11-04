<?php
// Every page of the site (.htaccess sends them here): index.html with that
// page's title, description, link preview, structured data and a plain text
// copy for crawlers that don't run JavaScript (lib/seo.php). The app itself
// loads exactly as before. If anything fails, index.html is sent unchanged.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/orders.php';
require __DIR__ . '/lib/public.php';
require __DIR__ . '/lib/seo.php';

$index = null;
try {
    $index = (string) (config()['index_html'] ?? dirname(__DIR__) . '/index.html');
    $html = file_get_contents($index);
    if ($html === false) {
        throw new RuntimeException("Cannot read {$index}");
    }
    $page = seo_page((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));

    $head = '<link rel="canonical" href="' . h($page['canonical']) . '" />'
        . '<meta name="robots" content="' . h($page['robots']) . '" />'
        . '<meta property="og:site_name" content="' . h(SITE_NAME) . '" />'
        . '<meta property="og:locale" content="en_PH" />'
        . '<meta property="og:type" content="' . h($page['type']) . '" />'
        . '<meta property="og:title" content="' . h($page['title']) . '" />'
        . '<meta property="og:description" content="' . h($page['description']) . '" />'
        . '<meta property="og:url" content="' . h($page['canonical']) . '" />'
        . '<meta property="og:image" content="' . h($page['image']) . '" />'
        . ($page['image_size'] ? '<meta property="og:image:width" content="' . $page['image_size'][0] . '" /><meta property="og:image:height" content="' . $page['image_size'][1] . '" />' : '')
        . '<meta name="twitter:card" content="summary_large_image" />'
        . '<meta name="twitter:title" content="' . h($page['title']) . '" />'
        . '<meta name="twitter:description" content="' . h($page['description']) . '" />'
        . '<meta name="twitter:image" content="' . h($page['image']) . '" />';
    if ($page['schema']) {
        // JSON_HEX_TAG: no "</script>" can end the block early.
        $json = json_encode(['@context' => 'https://schema.org', '@graph' => $page['schema']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);
        $head .= '<script type="application/ld+json">' . $json . '</script>';
    }

    $html = preg_replace('#<title>.*?</title>#s', '<title>' . h($page['title']) . '</title>', $html, 1);
    $html = preg_replace('#<meta name="description"[^>]*>#', '<meta name="description" content="' . h($page['description']) . '" />', $html, 1);
    $html = str_replace('</head>', $head . "\n  </head>", $html);
    if ($page['body'] !== '') {
        $html = preg_replace('#<div id="root"></div>#', '<div id="root"></div><noscript><div class="seo-text">' . $page['body'] . '</div></noscript>', $html, 1);
    }

    http_response_code($page['status']);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    echo $html;
} catch (Throwable $e) {
    error_log('MGL page: ' . $e);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    if ($index && is_file($index)) {
        readfile($index);
    } else {
        http_response_code(500);
    }
}
