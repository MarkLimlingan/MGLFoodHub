<?php
// SEO and answer engines (AEO): what search engines, link previews (Facebook,
// Messenger) and AI crawlers see. Everything comes from the database, so it
// always matches the live menu, prices and settings.
//   seo_page($path)  title, description, link preview, structured data
//                    (JSON-LD) and a plain text copy of the page for crawlers
//                    that don't run JavaScript (api/page.php puts them in index.html)
//   faq_items()      the FAQ (also shown at /faq through get_faq)
//   sitemap_xml(), llms_txt()
declare(strict_types=1);

const SITE_NAME = 'MGL Food Hub';
// Same page as OWNER_MESSAGE_URL in src/components/common.tsx.
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61595178520402';
const SHARE_IMAGE = '/og-image.jpg';
// Malabon Fish Port (store and category): listed last everywhere, like listOrder in src/hooks/useCatalog.tsx.
const FISH_PORT_SLUG = 'wet-foods';
// Clean food pictures for store link previews (same as src/lib/storeImages.ts).
const STORE_CARD_IMAGES = [
    'judy-anns-crispy-pata', 'okoy-ni-jay-r', 'hazels-special-puto', 'sisig-ni-mutik', 'rody-days',
    'aurings-special-pancit-malabon', 'original-benjie-puto-pao', 'anny-dading-peachy-peachy', 'balsa-sa-niugan',
];

function site_url(string $path = '/'): string
{
    return rtrim((string) (config()['site_url'] ?? 'https://mglfoodhub.com'), '/') . $path;
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Cuts plain text to about $max characters at a word break. */
function clip(string $s, int $max = 158): string
{
    $s = trim(preg_replace('/\s+/', ' ', $s));
    if (mb_strlen($s) <= $max) {
        return $s;
    }
    $cut = mb_substr($s, 0, $max - 1);
    return rtrim(mb_substr($cut, 0, (int) mb_strrpos($cut, ' ')), ' ,.;:') . '…';
}

/** "A, B and C" */
function and_list(array $items): string
{
    $items = array_values($items);
    return count($items) < 2 ? (string) ($items[0] ?? '') : implode(', ', array_slice($items, 0, -1)) . ' and ' . end($items);
}

// ---------------------------------------------------------------------
// Facts from the database (read once per request)
// ---------------------------------------------------------------------
function seo_stores(): array
{
    static $stores = null;
    return $stores ??= all(
        "SELECT s.id, s.slug, s.name, s.tagline, s.address, s.contact_note, s.cover_image_url, s.menu_image_url,
                s.open_time, s.close_time, s.is_accepting_orders, c.name AS category, c.slug AS category_slug
           FROM stores s JOIN hub_categories c ON c.id = s.hub_category_id
          ORDER BY s.slug = '" . FISH_PORT_SLUG . "', s.sort, s.name"
    );
}

function seo_categories(): array
{
    static $cats = null;
    return $cats ??= all(
        "SELECT c.name, c.slug, COUNT(s.id) AS stores FROM hub_categories c
           JOIN stores s ON s.hub_category_id = c.id GROUP BY c.id, c.name, c.slug, c.sort ORDER BY c.slug = '" . FISH_PORT_SLUG . "', c.sort"
    );
}

/** A store's menu: sections with products and their sizes and prices. */
function seo_menu(string $storeId): array
{
    $sections = all('SELECT id, name, note FROM menu_sections WHERE store_id = ? ORDER BY sort', [$storeId]);
    $products = all('SELECT id, section_id, name, description, image_url, is_sold_out FROM products WHERE store_id = ? ORDER BY sort', [$storeId]);
    $variants = all(
        'SELECT v.product_id, v.label, v.price, v.is_sold_out FROM product_variants v
           JOIN products p ON p.id = v.product_id WHERE p.store_id = ? ORDER BY v.sort',
        [$storeId]
    );
    $byProduct = [];
    foreach ($variants as $v) {
        $byProduct[$v['product_id']][] = $v;
    }
    $bySection = [];
    foreach ($products as $p) {
        $p['variants'] = $byProduct[$p['id']] ?? [];
        $bySection[$p['section_id']][] = $p;
    }
    $menu = [];
    foreach ($sections as $s) {
        if (!empty($bySection[$s['id']])) {
            $menu[] = $s + ['products' => $bySection[$s['id']]];
        }
    }
    return $menu;
}

function store_image(array $s): string
{
    $original = "/menus/{$s['slug']}.jpg";
    if ($s['cover_image_url'] && $s['cover_image_url'] !== $original) {
        $img = $s['cover_image_url'];
    } elseif (in_array($s['slug'], STORE_CARD_IMAGES, true)) {
        $img = "/stores/{$s['slug']}.webp";
    } else {
        $img = SHARE_IMAGE;
    }
    return str_starts_with($img, 'http') ? $img : site_url($img);
}

/** Delivery hours across all stores ("12:00 PM to 8:00 PM"). */
function delivery_hours(): string
{
    $stores = seo_stores();
    if (!$stores) {
        return '';
    }
    $open = min(array_column($stores, 'open_time'));
    $close = max(array_column($stores, 'close_time'));
    return time_label($open) . ' to ' . time_label($close);
}

function owner_phone(): string
{
    return get_owner_contact([])['phone'];
}

/** "0917 555 1234" → "+639175551234" */
function intl_phone(string $phone): string
{
    $digits = preg_replace('/\D/', '', $phone);
    return str_starts_with($digits, '0') ? '+63' . substr($digits, 1) : '+' . $digits;
}

// ---------------------------------------------------------------------
// FAQ: plain answers built from the settings, so they never go out of date
// ---------------------------------------------------------------------
function faq_items(): array
{
    $stores = seo_stores();
    $w = delivery_window();
    $maxDays = max((int) setting('max_days_ahead', 30) ?: 30, 1);
    $cutoff = time_label($w['cutoff']);
    $hours = delivery_hours();
    $feeNote = setting_text('delivery_fee_note');
    $phone = owner_phone();
    $guidelines = array_values(array_filter((array) setting('ordering_guidelines', []), 'is_string'));
    $wet = current(array_filter($stores, fn ($s) => $s['slug'] === FISH_PORT_SLUG)) ?: null;
    $online = 'GCash, MariBank or GoTyme';
    $cod = '₱' . number_format(COD_MAX_CENTS / 100);
    $names = array_column($stores, 'name');

    $faq = [
        [
            'q' => 'What is MGL Food Hub?',
            'a' => 'MGL Food Hub is an online food ordering site for Malabon. You can order from ' . count($stores)
                . ' local merchants in one cart, including ' . and_list(array_slice($names, 0, 4))
                . ', and get one scheduled delivery to your door.',
        ],
        [
            'q' => 'How do I order?',
            'a' => 'Open a merchant and add food to your cart. You can mix food from different merchants in the same cart. At checkout, enter your delivery address, pick a delivery date and a one hour time slot, and choose how to pay. You get an order number and a private tracking link right away.',
        ],
        [
            'q' => 'Can I order for same day delivery?',
            'a' => "No. Every order is scheduled. The earliest delivery date is tomorrow, or the day after tomorrow once {$cutoff} (Philippine time) has passed. You can book up to {$maxDays} days ahead.",
        ],
        [
            'q' => 'What are your delivery hours?',
            'a' => ($hours !== '' ? "Deliveries arrive from {$hours}, in one hour time slots. " : '')
                . 'When your cart has food from several merchants, you pick a time slot within the hours they share.',
        ],
        [
            'q' => 'How much is the delivery fee?',
            'a' => trim(($feeNote !== '' ? rtrim($feeNote, '.') . '. ' : '') . 'You pay one delivery fee for the whole order, even when it has food from several merchants.'),
        ],
        [
            'q' => 'How can I pay?',
            'a' => "Cash on Delivery for orders up to {$cod}, or online via {$online}. For online payment, pay to the account shown at checkout, then enter the reference number and upload a screenshot of your payment. We confirm your order once the payment is checked.",
        ],
        [
            'q' => 'How do I track my order?',
            'a' => 'After you order, you get a private tracking link that shows every update, from confirmation to delivery. If you lose it, open Find my order and enter your order number and the phone number you used.',
        ],
        [
            'q' => 'Can I cancel my order?',
            'a' => 'While your order is still waiting for confirmation, you can request a cancellation on its tracking page. After it is confirmed, please message us on Facebook' . ($phone !== '' ? " or call {$phone}" : '') . '.',
        ],
        [
            'q' => 'Do I need an account to order?',
            'a' => setting_bool('require_google_login')
                ? 'You do not need to create an account. To stop fake orders, we ask you to sign in with your Google (Gmail) account at checkout. We only use your name, email and profile photo to confirm you are a real customer.'
                : 'No. You only enter your name, phone number, email and delivery address at checkout.',
        ],
    ];
    if ($wet) {
        $faq[] = [
            'q' => 'Can I order fresh fish and seafood?',
            'a' => 'Yes. ' . $wet['name'] . ' delivers fresh catch in the same cart as your food. Looking for a fish that is not on the list? Open ' . $wet['name'] . ' and tap Request a Fish to ask the owner.',
        ];
    }
    if ($guidelines) {
        $faq[] = ['q' => 'What should I know before ordering?', 'a' => implode(' ', $guidelines)];
    }
    $faq[] = [
        'q' => 'How do I contact MGL Food Hub?',
        'a' => 'Message us on our Facebook page' . ($phone !== '' ? " or call {$phone}" : '') . '. You can also find your order anytime with Find my order.',
    ];
    return $faq;
}

/** For the /faq page. */
function get_faq(array $args): array
{
    return faq_items();
}

// ---------------------------------------------------------------------
// Structured data (schema.org JSON-LD)
// ---------------------------------------------------------------------
function org_schema(): array
{
    $org = [
        '@type' => 'Organization',
        '@id' => site_url('/#organization'),
        'name' => SITE_NAME,
        'url' => site_url(),
        'logo' => site_url('/logo.png'),
        'image' => site_url(SHARE_IMAGE),
        'description' => 'Online food ordering for Malabon: many local merchants in one cart with scheduled delivery.',
        'areaServed' => 'Metro Manila, Philippines',
        'sameAs' => [FACEBOOK_URL],
    ];
    $phone = owner_phone();
    if ($phone !== '') {
        $org['contactPoint'] = ['@type' => 'ContactPoint', 'telephone' => intl_phone($phone), 'contactType' => 'customer service', 'areaServed' => 'PH', 'availableLanguage' => ['English', 'Filipino']];
    }
    return $org;
}

function website_schema(): array
{
    return ['@type' => 'WebSite', '@id' => site_url('/#website'), 'name' => SITE_NAME, 'url' => site_url(), 'inLanguage' => 'en-PH', 'publisher' => ['@id' => site_url('/#organization')]];
}

function breadcrumbs(array $trail): array
{
    $items = [];
    foreach (array_values($trail) as $i => [$name, $path]) {
        $items[] = ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $name, 'item' => site_url($path)];
    }
    return ['@type' => 'BreadcrumbList', 'itemListElement' => $items];
}

function store_schema(array $s, array $menu): array
{
    $sections = [];
    foreach ($menu as $sec) {
        $items = [];
        foreach ($sec['products'] as $p) {
            $offers = array_map(fn ($v) => [
                '@type' => 'Offer',
                'name' => $v['label'],
                'price' => dec(cents($v['price'])),
                'priceCurrency' => 'PHP',
                'availability' => ((int) $p['is_sold_out'] === 1 || (int) $v['is_sold_out'] === 1) ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
            ], $p['variants']);
            $item = ['@type' => 'MenuItem', 'name' => $p['name']];
            if ($p['description']) {
                $item['description'] = $p['description'];
            }
            if ($offers) {
                $item['offers'] = count($offers) === 1 ? $offers[0] : $offers;
            }
            $items[] = $item;
        }
        $sections[] = ['@type' => 'MenuSection', 'name' => $sec['name'], 'hasMenuItem' => $items];
    }
    $schema = [
        '@type' => 'FoodEstablishment',
        '@id' => site_url("/store/{$s['slug']}#store"),
        'name' => $s['name'],
        'url' => site_url("/store/{$s['slug']}"),
        'image' => store_image($s),
        'servesCuisine' => 'Filipino',
        'address' => array_filter([
            '@type' => 'PostalAddress',
            'streetAddress' => $s['address'] ?: null,
            'addressLocality' => 'Malabon',
            'addressRegion' => 'Metro Manila',
            'addressCountry' => 'PH',
        ]),
        'acceptsReservations' => false,
        'paymentAccepted' => 'Cash, GCash, MariBank, GoTyme',
        'currenciesAccepted' => 'PHP',
        'hasMenu' => ['@type' => 'Menu', 'name' => "{$s['name']} menu", 'hasMenuSection' => $sections],
        'potentialAction' => ['@type' => 'OrderAction', 'target' => site_url("/store/{$s['slug']}")],
        'brand' => ['@id' => site_url('/#organization')],
    ];
    if ($s['tagline']) {
        $schema['description'] = $s['tagline'];
    }
    return $schema;
}

function faq_schema(array $faq): array
{
    return [
        '@type' => 'FAQPage',
        'mainEntity' => array_map(fn ($f) => ['@type' => 'Question', 'name' => $f['q'], 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f['a']]], $faq),
    ];
}

function stores_list_schema(): array
{
    return [
        '@type' => 'ItemList',
        'name' => 'Merchants on ' . SITE_NAME,
        'itemListElement' => array_map(fn ($s, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $s['name'], 'url' => site_url("/store/{$s['slug']}")], seo_stores(), array_keys(seo_stores())),
    ];
}

// ---------------------------------------------------------------------
// Plain text copies of the pages (inside <noscript>)
// ---------------------------------------------------------------------
function stores_html(): string
{
    $out = '<ul>';
    foreach (seo_stores() as $s) {
        $out .= '<li><a href="/store/' . h($s['slug']) . '">' . h($s['name']) . '</a> (' . h($s['category']) . ')'
            . ($s['tagline'] ? ': ' . h($s['tagline']) : '') . '</li>';
    }
    return $out . '</ul>';
}

function faq_html(array $faq): string
{
    $out = '';
    foreach ($faq as $f) {
        $out .= '<h3>' . h($f['q']) . '</h3><p>' . h($f['a']) . '</p>';
    }
    return $out;
}

function menu_html(array $menu): string
{
    $out = '';
    foreach ($menu as $sec) {
        $out .= '<h2>' . h($sec['name']) . '</h2>' . ($sec['note'] ? '<p>' . h($sec['note']) . '</p>' : '') . '<ul>';
        foreach ($sec['products'] as $p) {
            $prices = implode(', ', array_map(fn ($v) => ($v['label'] !== 'Regular' ? h($v['label']) . ' ' : '') . h(peso(cents($v['price']))), $p['variants']));
            $out .= '<li><strong>' . h($p['name']) . '</strong>' . ($prices !== '' ? ': ' . $prices : '')
                . ((int) $p['is_sold_out'] === 1 ? ' (sold out)' : '')
                . ($p['description'] ? '<br>' . h($p['description']) : '') . '</li>';
        }
        $out .= '</ul>';
    }
    return $out;
}

function site_summary(): string
{
    $cats = array_map(fn ($c) => mb_strtolower($c['name']), seo_categories());
    return 'Order from ' . count(seo_stores()) . ' Malabon merchants in one cart: ' . and_list($cats)
        . '. Scheduled delivery. Pay by Cash on Delivery, GCash, MariBank or GoTyme.';
}

// ---------------------------------------------------------------------
// One page
// ---------------------------------------------------------------------
const PRIVATE_PAGES = ['/cart', '/checkout', '/my-orders', '/find-order'];
const PRIVATE_PREFIXES = ['/track/', '/order-placed/'];

/**
 * Everything the page's HTML needs. status 404 for unknown pages (the app
 * still loads and shows its own Page not found), robots noindex for
 * private ones (cart, checkout, tracking links).
 */
function seo_page(string $path): array
{
    $path = '/' . trim($path, '/');
    $page = [
        'status' => 200,
        'title' => SITE_NAME . ' · Scheduled Food Delivery',
        'description' => clip(site_summary()),
        'canonical' => site_url($path === '/' ? '/' : $path),
        'image' => site_url(SHARE_IMAGE),
        'image_size' => [1200, 630],
        'type' => 'website',
        'robots' => 'index, follow, max-image-preview:large',
        'schema' => [org_schema(), website_schema()],
        'body' => '',
    ];
    $nav = '<p><a href="/">Home</a> · <a href="/merchants">Explore merchants</a> · <a href="/categories">Food categories</a> · '
        . '<a href="/faq">FAQ</a> · <a href="/about">About us</a> · <a href="/contact">Contact us</a></p>';

    if ($path === '/') {
        $page['title'] = SITE_NAME . ' · Malabon Food Delivery, ' . count(seo_stores()) . ' Merchants in One Cart';
        $page['schema'][] = stores_list_schema();
        $page['body'] = '<h1>' . h(SITE_NAME) . '</h1><p>' . h(site_summary()) . '</p><h2>Merchants</h2>' . stores_html()
            . '<h2>Frequently asked questions</h2>' . faq_html(array_slice(faq_items(), 0, 6)) . '<p><a href="/faq">All questions</a></p>';
    } elseif ($path === '/merchants') {
        $page['title'] = 'Explore Merchants · ' . SITE_NAME;
        $page['description'] = clip('All ' . count(seo_stores()) . ' Malabon merchants on MGL Food Hub: ' . and_list(array_column(seo_stores(), 'name')) . '. Order from many in one cart.');
        $page['schema'][] = stores_list_schema();
        $page['schema'][] = breadcrumbs([['Home', '/'], ['Explore Merchants', '/merchants']]);
        $page['body'] = '<h1>Explore merchants</h1>' . stores_html();
    } elseif ($path === '/categories') {
        $page['title'] = 'Food Categories · ' . SITE_NAME;
        $page['description'] = clip('Browse Malabon food by category: ' . and_list(array_column(seo_categories(), 'name')) . '. Scheduled delivery with MGL Food Hub.');
        $page['schema'][] = breadcrumbs([['Home', '/'], ['Food Categories', '/categories']]);
        $body = '<h1>Food categories</h1>';
        foreach (seo_categories() as $c) {
            $names = array_map(fn ($s) => '<a href="/store/' . h($s['slug']) . '">' . h($s['name']) . '</a>', array_filter(seo_stores(), fn ($s) => $s['category_slug'] === $c['slug']));
            $body .= '<h2>' . h($c['name']) . '</h2><p>' . implode(', ', $names) . '</p>';
        }
        $page['body'] = $body;
    } elseif (preg_match('#^/store/([a-z0-9-]+)$#', $path, $m)) {
        $s = current(array_filter(seo_stores(), fn ($x) => $x['slug'] === $m[1])) ?: null;
        if (!$s) {
            return not_found_page($page);
        }
        $menu = seo_menu($s['id']);
        $examples = [];
        foreach ($menu as $sec) {
            foreach ($sec['products'] as $p) {
                $examples[] = $p['name'];
            }
        }
        $page['title'] = "{$s['name']} Menu and Prices · " . SITE_NAME;
        $page['description'] = clip(($s['tagline'] ? rtrim($s['tagline'], '.!') . '. ' : '') . "Order {$s['name']} online: "
            . and_list(array_slice(array_unique($examples), 0, 4)) . ' and more. Scheduled delivery in Metro Manila.');
        $page['image'] = store_image($s);
        $page['image_size'] = null;
        $page['type'] = 'restaurant.restaurant';
        $page['schema'][] = store_schema($s, $menu);
        $page['schema'][] = breadcrumbs([['Home', '/'], ['Explore Merchants', '/merchants'], [$s['name'], "/store/{$s['slug']}"]]);
        $page['body'] = '<h1>' . h($s['name']) . '</h1>' . ($s['tagline'] ? '<p>' . h($s['tagline']) . '</p>' : '')
            . '<p>' . h($s['category']) . '. Delivery from ' . h(time_label($s['open_time'])) . ' to ' . h(time_label($s['close_time']))
            . ((int) $s['is_accepting_orders'] === 1 ? '' : '. Not accepting orders right now') . '.</p>'
            . ($s['contact_note'] ? '<p>' . h($s['contact_note']) . '</p>' : '') . menu_html($menu);
    } elseif ($path === '/faq') {
        $faq = faq_items();
        $page['title'] = 'Frequently Asked Questions · ' . SITE_NAME;
        $page['description'] = clip('Answers about ordering from MGL Food Hub: scheduled delivery, delivery hours and fees, payment by Cash on Delivery, GCash, MariBank or GoTyme, tracking and cancelling orders.');
        $page['schema'][] = faq_schema($faq);
        $page['schema'][] = breadcrumbs([['Home', '/'], ['FAQ', '/faq']]);
        $page['body'] = '<h1>Frequently asked questions</h1>' . faq_html($faq);
    } elseif ($path === '/about') {
        $page['title'] = 'About Us · ' . SITE_NAME;
        $page['description'] = clip('MGL Food Hub brings ' . count(seo_stores()) . ' Malabon food businesses together: kakanin makers, pancit bilao specialists, carinderias, diners, crispy favorites and fresh seafood. One cart, one delivery fee.');
        $page['schema'][] = breadcrumbs([['Home', '/'], ['About Us', '/about']]);
        $guidelines = array_filter((array) setting('ordering_guidelines', []), 'is_string');
        $page['body'] = '<h1>About MGL Food Hub</h1><p>' . h($page['description']) . '</p><h2>Merchants</h2>' . stores_html()
            . ($guidelines ? '<h2>Ordering guidelines</h2><ul>' . implode('', array_map(fn ($g) => '<li>' . h($g) . '</li>', $guidelines)) . '</ul>' : '');
    } elseif ($path === '/contact') {
        $phone = owner_phone();
        $page['title'] = 'Contact Us · ' . SITE_NAME;
        $page['description'] = clip('Contact MGL Food Hub: message us on Facebook' . ($phone !== '' ? " or call {$phone}" : '') . '. Check an order with your order number and phone number.');
        $page['schema'][] = breadcrumbs([['Home', '/'], ['Contact Us', '/contact']]);
        $page['body'] = '<h1>Contact us</h1><p><a href="' . h(FACEBOOK_URL) . '">Message us on Facebook</a>' . ($phone !== '' ? ' or call ' . h($phone) : '') . '.</p>';
    } elseif ($path === '/terms') {
        $page['title'] = 'Terms of Service · ' . SITE_NAME;
        $page['description'] = 'The terms for ordering from MGL Food Hub: orders, scheduled delivery, payment, delivery fees and cancellations.';
    } elseif ($path === '/privacy') {
        $page['title'] = 'Privacy Policy · ' . SITE_NAME;
        $page['description'] = 'How MGL Food Hub uses and protects the information you give when you order, and how to ask us to delete it.';
    } elseif (in_array($path, PRIVATE_PAGES, true) || array_filter(PRIVATE_PREFIXES, fn ($p) => str_starts_with($path, $p))) {
        $page['robots'] = 'noindex, nofollow';
        $page['schema'] = [];
    } else {
        return not_found_page($page);
    }
    if ($page['body'] !== '') {
        $page['body'] = $nav . $page['body'];
    }
    return $page;
}

function not_found_page(array $page): array
{
    return ['status' => 404, 'title' => 'Page not found · ' . SITE_NAME, 'robots' => 'noindex, nofollow', 'schema' => [], 'body' => ''] + $page;
}

// ---------------------------------------------------------------------
// sitemap.xml, llms.txt
// ---------------------------------------------------------------------
function sitemap_xml(): string
{
    $paths = ['/', '/merchants', '/categories', '/faq', '/about', '/contact', '/terms', '/privacy'];
    foreach (seo_stores() as $s) {
        $paths[] = "/store/{$s['slug']}";
    }
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    foreach ($paths as $p) {
        $xml .= '  <url><loc>' . h(site_url($p)) . "</loc></url>\n";
    }
    return $xml . "</urlset>\n";
}

/** llms.txt (https://llmstxt.org): a plain summary for AI assistants. $full adds every menu with prices. */
function llms_txt(bool $full): string
{
    $out = '# ' . SITE_NAME . "\n\n> " . site_summary() . "\n\n";
    $out .= "MGL Food Hub (" . site_url() . ") is an online food ordering site for Malabon, Metro Manila, Philippines. Customers add food from many local merchants to one cart and get one scheduled delivery.\n\n";
    $out .= "## Merchants\n\n";
    foreach (seo_stores() as $s) {
        $out .= '- [' . $s['name'] . '](' . site_url("/store/{$s['slug']}") . '): ' . $s['category'] . ($s['tagline'] ? '. ' . $s['tagline'] : '') . "\n";
    }
    $out .= "\n## Frequently asked questions\n\n";
    foreach (faq_items() as $f) {
        $out .= "### {$f['q']}\n\n{$f['a']}\n\n";
    }
    $out .= "## Pages\n\n- [Explore merchants](" . site_url('/merchants') . ")\n- [Food categories](" . site_url('/categories') . ")\n- [FAQ](" . site_url('/faq')
        . ")\n- [About us](" . site_url('/about') . ")\n- [Contact us](" . site_url('/contact') . ")\n- [Facebook page](" . FACEBOOK_URL . ")\n";
    if (!$full) {
        return $out . "\n## Optional\n\n- [Every menu with prices](" . site_url('/llms-full.txt') . ")\n";
    }
    $out .= "\n## Menus and prices\n\nPrices are in Philippine pesos (PHP), VAT inclusive, and set by each merchant.\n";
    foreach (seo_stores() as $s) {
        $out .= "\n### {$s['name']}\n\n" . site_url("/store/{$s['slug']}") . "\n";
        foreach (seo_menu($s['id']) as $sec) {
            $out .= "\n{$sec['name']}:\n";
            foreach ($sec['products'] as $p) {
                $prices = implode(', ', array_map(fn ($v) => ($v['label'] !== 'Regular' ? "{$v['label']} " : '') . peso(cents($v['price'])), $p['variants']));
                $out .= "- {$p['name']}" . ($prices !== '' ? ": {$prices}" : '') . ((int) $p['is_sold_out'] === 1 ? ' (sold out)' : '') . "\n";
            }
        }
    }
    return $out;
}
