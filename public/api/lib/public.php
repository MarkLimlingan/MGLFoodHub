<?php
// Customer functions. Same names, arguments and answers as the Supabase RPCs.
declare(strict_types=1);

/** Setup check: which step fails, in plain words, never a secret. ?fn=health */
function health(array $args): array
{
    $result = ['config' => false, 'database' => false, 'tables' => 0, 'php_ok' => PHP_VERSION_ID >= 80100, 'problem' => null];
    try {
        config();
        $result['config'] = true;
    } catch (Throwable) {
        $result['problem'] = 'mgl-config.php was not found in the folders above public_html.';
        return $result;
    }
    try {
        $result['tables'] = (int) val('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()');
        $result['database'] = true;
    } catch (PDOException $e) {
        $code = preg_match('/\[(\d{4})\]/', $e->getMessage(), $m) ? (int) $m[1] : (int) $e->getCode();
        $result['problem'] = match ($code) {
            1045 => 'The database refused the user or password in mgl-config.php.',
            1044, 1049 => 'The database name in mgl-config.php is wrong, or the user has no access to it.',
            2002, 2003, 2005 => 'Cannot reach the database server (check db.host in mgl-config.php).',
            default => "Database error {$code}.",
        };
    }
    return $result;
}

/** The whole menu in one call (the website used to read the seven tables). */
function get_catalog(array $args): array
{
    return [
        'hub_categories' => typed(all('SELECT id, name, slug, sort FROM hub_categories ORDER BY sort'), [], [], ['sort']),
        'stores' => typed(all(
            'SELECT id, slug, name, tagline, hub_category_id, open_time, close_time, address, contact_note,
                    cover_image_url, menu_image_url, is_accepting_orders, sort FROM stores ORDER BY sort'
        ), ['is_accepting_orders'], [], ['sort']),
        'menu_sections' => typed(all('SELECT id, store_id, name, note, sort FROM menu_sections ORDER BY sort'), [], [], ['sort']),
        'products' => typed(all(
            'SELECT id, store_id, section_id, name, description, badge, image_url, is_sold_out, sort FROM products ORDER BY sort'
        ), ['is_sold_out'], [], ['sort']),
        'product_variants' => typed(all(
            'SELECT id, product_id, label, price, addon_price, is_sold_out, sort FROM product_variants ORDER BY sort'
        ), ['is_sold_out'], ['price', 'addon_price'], ['sort']),
        'option_groups' => typed(all('SELECT id, product_id, name, is_required FROM option_groups ORDER BY id'), ['is_required']),
        'option_choices' => typed(all('SELECT id, group_id, label, price_delta, sort FROM option_choices ORDER BY sort'), [], ['price_delta'], ['sort']),
    ];
}

function get_checkout_info(array $args): array
{
    $w = delivery_window();
    $accounts = [];
    foreach (['gcash', 'maribank', 'gotyme'] as $m) {
        $accounts[$m] = [
            'account_name' => setting_text("{$m}_account_name"),
            'number' => setting_text("{$m}_number"),
            'qr_url' => setting_text("{$m}_qr_url"),
        ];
    }
    $guidelines = setting('ordering_guidelines', []);
    return [
        'today' => $w['today']->format('Y-m-d'),
        'min_date' => $w['min']->format('Y-m-d'),
        'max_date' => $w['max']->format('Y-m-d'),
        'cutoff_time' => $w['cutoff'],
        'blocked_dates' => blocked_dates(),
        'gcash_account_name' => $accounts['gcash']['account_name'],
        'gcash_number' => $accounts['gcash']['number'],
        'gcash_qr_url' => $accounts['gcash']['qr_url'],
        'payment_accounts' => $accounts,
        'delivery_fee_note' => setting_text('delivery_fee_note'),
        'email_notifications_enabled' => setting_bool('email_notifications_enabled'),
        'require_google_login' => setting_bool('require_google_login'),
        'google_client_id' => (string) (config()['google_client_id'] ?? ''),
        'ordering_guidelines' => is_array($guidelines) ? array_values($guidelines) : [],
    ];
}

function get_owner_contact(array $args): array
{
    $phone = setting_text('owner_phone');
    $ok = preg_match('/^\+?[0-9() -]{7,20}$/', $phone) && strlen(preg_replace('/\D/', '', $phone)) >= 7;
    return ['phone' => $ok ? $phone : ''];
}

function place_order(array $args): array
{
    $p = is_array($args['payload'] ?? null) ? $args['payload'] : [];
    $name = text_arg($p, 'customer_name', 120);
    $phone = normalize_ph_phone($p['phone'] ?? null);
    $email = mb_strtolower(text_arg($p, 'email', 200));
    $address = text_arg($p, 'address', 300);
    $barangay = text_arg($p, 'barangay', 120);
    $city = text_arg($p, 'city', 120);
    $landmark = text_arg($p, 'landmark', 200) ?: null;
    $notes = text_arg($p, 'customer_notes', 1000) ?: null;
    $device = text_arg($p, 'device_id', 64) ?: null;
    $slot = text_arg($p, 'delivery_slot', 20);
    $method = is_string($p['payment_method'] ?? null) ? $p['payment_method'] : '';
    $ref = strtoupper(preg_replace('/\s/', '', is_scalar($p['gcash_reference'] ?? null) ? (string) $p['gcash_reference'] : '')) ?: null;
    $proof = text_arg($p, 'gcash_proof_path', 255) ?: null;
    $customer = current_customer();

    // Anti-spam honeypot: real customers never fill this hidden field.
    if (text_arg($p, 'website', 200) !== '') {
        throw new ApiError('We could not place your order. Please try again.');
    }
    // Anti-scam: Admin → Settings → Require Google account at checkout.
    if (!$customer && setting_bool('require_google_login')) {
        throw new ApiError('Please sign in with Google before placing your order.');
    }
    if (!truthy($p['agree_terms'] ?? false)) {
        throw new ApiError('Please tick the delivery fee and food quality acknowledgement before placing your order.');
    }

    // Customer details
    if (mb_strlen($name) < 2) {
        throw new ApiError('Please enter your full name.');
    }
    if ($phone === null) {
        throw new ApiError('Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
    }
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $email)) {
        throw new ApiError('Please enter a valid email address.');
    }
    if (mb_strlen($address) < 4 || mb_strlen($barangay) < 2 || mb_strlen($city) < 2) {
        throw new ApiError('Please complete your delivery address (house/unit and street, barangay, city).');
    }

    // Payment: GCash, MariBank and GoTyme all need a reference number + screenshot.
    if (!in_array($method, ['cod', 'gcash', 'maribank', 'gotyme'], true)) {
        throw new ApiError('Please choose a payment method.');
    }
    if ($method !== 'cod') {
        if ($ref === null || !preg_match('/^[A-Z0-9-]{4,40}$/', $ref)) {
            throw new ApiError('Please enter your ' . payment_label($method) . ' reference number.');
        }
        if (!proof_exists($proof)) {
            throw new ApiError('Please upload a screenshot of your ' . payment_label($method) . ' payment.');
        }
    } else {
        $ref = null;
        $proof = null;
    }

    // Delivery date (scheduled only)
    $w = delivery_window();
    $rawDate = is_string($p['delivery_date'] ?? null) ? $p['delivery_date'] : '';
    $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $rawDate)
        ? DateTimeImmutable::createFromFormat('!Y-m-d', $rawDate, new DateTimeZone('Asia/Manila'))
        : false;
    if (!$date || $date->format('Y-m-d') !== $rawDate) {
        throw new ApiError('Please choose a delivery date.');
    }
    if ($date <= $w['today']) {
        throw new ApiError('Same day delivery is not available. Please choose a future delivery date.');
    }
    if ($date < $w['min']) {
        throw new ApiError(sprintf(
            'The cutoff for %s deliveries has passed (%s PH time). The earliest available date is %s.',
            date_label($date, false), (new DateTimeImmutable('2000-01-01 ' . $w['cutoff']))->format('h:i A'), date_label($w['min'])
        ));
    }
    if ($date > $w['max']) {
        throw new ApiError('Orders can only be scheduled up to ' . date_label($w['max']) . '.');
    }
    if (in_array($rawDate, blocked_dates(), true)) {
        throw new ApiError('Sorry, we are not accepting deliveries on ' . date_label($date) . '. Please choose another date.');
    }

    $items = $p['items'] ?? null;
    if (!is_array($items) || !array_is_list($items) || count($items) === 0) {
        throw new ApiError('Your cart is empty.');
    }
    if (count($items) > 60) {
        throw new ApiError('Too many items in one order. Please split it into separate orders.');
    }

    // One order at a time per phone (and per Google account), so the daily limit holds.
    return with_lock("place_order:{$phone}", fn () => with_lock('place_order_user:' . ($customer['google_sub'] ?? '-'), function () use (
        $p, $items, $name, $phone, $email, $address, $barangay, $city, $landmark, $notes, $device, $slot, $method, $ref, $proof, $customer, $rawDate
    ) {
        $limit = (int) setting('max_orders_per_phone_per_day', 5) ?: 5;
        [$dayStart, $dayEnd] = manila_day_utc(manila_now());
        $count = (int) val('SELECT COUNT(*) FROM orders WHERE phone = ? AND created_at >= ? AND created_at < ?', [$phone, $dayStart, $dayEnd]);
        if ($count >= $limit) {
            throw new ApiError("This phone number has reached the limit of {$limit} orders today. Please try again tomorrow or contact us.");
        }
        // The same daily limit per Google account, so switching phone numbers doesn't get around it.
        if ($customer) {
            $count = (int) val('SELECT COUNT(*) FROM orders WHERE google_sub = ? AND created_at >= ? AND created_at < ?', [$customer['google_sub'], $dayStart, $dayEnd]);
            if ($count >= $limit) {
                throw new ApiError("This account has reached the limit of {$limit} orders today. Please try again tomorrow or contact us.");
            }
        }

        // Items: every price is read from the database. Prices sent by the browser are ignored.
        $lines = [];
        $subtotal = 0;
        $storeIds = [];
        foreach ($items as $item) {
            $variantId = is_array($item) ? ($item['variant_id'] ?? null) : null;
            $qty = is_array($item) ? ($item['quantity'] ?? null) : null;
            $qty = is_int($qty) || (is_string($qty) && preg_match('/^\d+$/', $qty)) ? (int) $qty : null;
            if (!is_uuid($variantId) || $qty === null || $qty < 1 || $qty > 99) {
                throw new ApiError('One of the items in your cart is invalid. Please refresh your cart.');
            }
            $v = load_variant($variantId);
            if (!$v) {
                throw new ApiError('One of the items in your cart is no longer available. Please remove it and try again.');
            }
            if ((int) $v['product_sold_out'] === 1 || (int) $v['variant_sold_out'] === 1) {
                throw new ApiError("{$v['product_name']} ({$v['label']}) from {$v['store_name']} is SOLD OUT. Please remove it from your cart.");
            }
            if ((int) $v['is_accepting_orders'] !== 1) {
                throw new ApiError("{$v['store_name']} is temporarily not accepting orders. Please remove its items from your cart.");
            }
            [$unit, $options] = price_with_options($v, $item['choice_ids'] ?? null, truthy($item['extra_toppings'] ?? false));
            $lines[] = ['v' => $v, 'options' => $options, 'unit' => $unit, 'qty' => $qty];
            $subtotal += $unit * $qty;
            $storeIds[$v['store_id']] = $v['store_id'];
        }

        check_slot($slot, $storeIds, true);

        if ($method === 'cod' && $subtotal > COD_MAX_CENTS) {
            throw new ApiError('Cash on Delivery is only for orders up to ₱2,000. Please pay online via GCash, MariBank or GoTyme.');
        }

        // Readable order number + unguessable tracking token
        do {
            $number = 'MGL-' . manila_now()->format('ymd') . '-' . random_code(4);
        } while (val('SELECT 1 FROM orders WHERE order_number = ?', [$number]));
        do {
            $token = random_token(32);
        } while (val('SELECT 1 FROM orders WHERE tracking_token = ?', [$token]));

        $orderId = uuid();
        transaction(function () use ($orderId, $number, $token, $device, $name, $phone, $email, $address, $barangay, $city, $landmark, $rawDate, $slot, $method, $ref, $proof, $subtotal, $notes, $customer, $lines) {
            q(
                'INSERT INTO orders (id, order_number, tracking_token, device_id, customer_name, phone, email, address, barangay, city, landmark,
                                     delivery_date, delivery_slot, payment_method, payment_status, order_status, gcash_reference, gcash_proof_path,
                                     subtotal, delivery_fee, total, customer_notes, google_sub, google_name, google_email, google_picture, verified_with)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'processing\', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $orderId, $number, $token, $device, $name, $phone, $email, $address, $barangay, $city, $landmark,
                    $rawDate, $slot, $method, $method === 'cod' ? 'cod_unpaid' : 'pending_verification', $ref, $proof,
                    dec($subtotal), dec($subtotal), $notes,
                    $customer['google_sub'] ?? null, $customer['google_name'] ?? null, $customer['google_email'] ?? null,
                    $customer['google_picture'] ?? null, $customer ? 'google' : null,
                ]
            );
            foreach ($lines as $i => $l) {
                q(
                    'INSERT INTO order_items (id, order_id, line_no, store_id, product_id, variant_id, store_name_snapshot, section_name_snapshot,
                                              product_name_snapshot, variant_label_snapshot, options_snapshot, unit_price_snapshot, quantity, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        uuid(), $orderId, $i + 1, $l['v']['store_id'], $l['v']['product_id'], $l['v']['variant_id'], $l['v']['store_name'],
                        $l['v']['section_name'], $l['v']['product_name'], $l['v']['label'], json_encode($l['options'], JSON_UNESCAPED_UNICODE),
                        dec($l['unit']), $l['qty'], dec($l['unit'] * $l['qty']),
                    ]
                );
            }
            add_history($orderId, 'processing', $method !== 'cod'
                ? payment_label($method) . " payment submitted for verification (Ref: {$ref})."
                : 'Order received. Our team will call you to confirm.');
        });
        send_order_email($orderId);

        return ['order_number' => $number, 'tracking_token' => $token];
    }));
}

/** One order by its tracking token (customer-safe fields only), or null. */
function get_order_by_token(array $args): ?array
{
    $token = is_string($args['p_token'] ?? null) ? $args['p_token'] : '';
    if (!preg_match('/^[A-Za-z0-9_-]{32}$/', $token)) {
        return null;
    }
    $o = one('SELECT * FROM orders WHERE tracking_token = ?', [$token]);
    if (!$o) {
        return null;
    }
    $history = all('SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at, id', [$o['id']]);
    return [
        'order_number' => $o['order_number'],
        'tracking_token' => $o['tracking_token'],
        'customer_name' => $o['customer_name'],
        'phone' => $o['phone'],
        'address' => $o['address'],
        'barangay' => $o['barangay'],
        'city' => $o['city'],
        'landmark' => $o['landmark'],
        'delivery_date' => $o['delivery_date'],
        'delivery_slot' => $o['delivery_slot'],
        'payment_method' => $o['payment_method'],
        'payment_status' => $o['payment_status'],
        'order_status' => $o['order_status'],
        'gcash_reference' => $o['gcash_reference'],
        'payment_rejection_reason' => $o['payment_rejection_reason'],
        'subtotal' => num(cents($o['subtotal'])),
        'delivery_fee' => num(cents($o['delivery_fee'])),
        'total' => num(cents($o['total'])),
        'customer_notes' => $o['customer_notes'],
        'cancel_reason' => $o['cancel_reason'],
        'cancel_requested' => (int) $o['cancel_requested'] === 1,
        // Online payment with no screenshot yet (rejected, or switched to online by the admin): the page asks for one.
        'needs_payment_proof' => needs_payment_proof($o),
        'amount_paid' => $o['paid_amount'] === null ? null : num(cents($o['paid_amount'])),
        'created_at' => iso($o['created_at']),
        'updated_at' => iso($o['updated_at']),
        'items' => order_items_json($o['id']),
        'history' => array_map(fn ($h) => ['status' => $h['status'], 'note' => $h['note'], 'created_at' => iso($h['created_at'])], $history),
    ];
}

function needs_payment_proof(array $o): bool
{
    return $o['payment_method'] !== 'cod' && $o['order_status'] === 'processing'
        && ($o['payment_status'] === 'rejected' || ($o['payment_status'] === 'pending_verification' && $o['gcash_proof_path'] === null));
}

/** Status summary for the "My Orders on this device" page. */
function get_order_summaries(array $args): array
{
    $tokens = array_values(array_filter(
        array_slice(is_array($args['p_tokens'] ?? null) ? $args['p_tokens'] : [], 0, 50),
        fn ($t) => is_string($t) && preg_match('/^[A-Za-z0-9_-]{32}$/', $t)
    ));
    if (!$tokens) {
        return [];
    }
    $in = implode(',', array_fill(0, count($tokens), '?'));
    $rows = all(
        "SELECT tracking_token, order_number, order_status, payment_method, payment_status, delivery_date, delivery_slot, total, created_at
           FROM orders WHERE tracking_token IN ({$in}) ORDER BY created_at DESC",
        $tokens
    );
    return array_map(fn ($r) => ['total' => num(cents($r['total'])), 'created_at' => iso($r['created_at'])] + $r, $rows);
}

/** The tracking token, only when BOTH the order number and phone match. */
function find_order(array $args): ?string
{
    rate_limit('find_order_ip', client_ip(), 30, 3600, 'Too many searches. Please try again later.');
    $number = strtoupper(text_arg($args, 'p_order_number', 32));
    $phone = normalize_ph_phone($args['p_phone'] ?? null);
    if ($number === '' || $phone === null) {
        return null;
    }
    return val('SELECT tracking_token FROM orders WHERE order_number = ? AND phone = ? LIMIT 1', [$number, $phone]);
}

function order_for_update_by_token(mixed $token): array
{
    $o = is_string($token) && $token !== '' ? one('SELECT * FROM orders WHERE tracking_token = ? FOR UPDATE', [$token]) : null;
    return $o ?? throw new ApiError('Order not found.');
}

function request_cancellation(array $args): bool
{
    $reason = text_arg($args, 'p_reason', 500);
    transaction(function () use ($args, $reason) {
        $o = order_for_update_by_token($args['p_token'] ?? null);
        if ($o['order_status'] !== 'processing') {
            throw new ApiError('This order can no longer be cancelled online. Please contact us directly.');
        }
        if ((int) $o['cancel_requested'] === 1) {
            throw new ApiError('You already requested a cancellation. Our team will get back to you.');
        }
        if ($reason === '') {
            throw new ApiError('Please tell us why you want to cancel.');
        }
        q('UPDATE orders SET cancel_requested = 1, cancel_request_reason = ? WHERE id = ?', [$reason, $o['id']]);
        add_history($o['id'], 'cancel_requested', $reason);
    });
    return true;
}

function resubmit_gcash_proof(array $args): bool
{
    $ref = strtoupper(preg_replace('/\s/', '', is_scalar($args['p_ref'] ?? null) ? (string) $args['p_ref'] : ''));
    $path = is_string($args['p_path'] ?? null) ? $args['p_path'] : null;
    transaction(function () use ($args, $ref, $path) {
        $o = order_for_update_by_token($args['p_token'] ?? null);
        if ($o['payment_method'] === 'cod' || $o['order_status'] !== 'processing'
            || !($o['payment_status'] === 'rejected' || ($o['payment_status'] === 'pending_verification' && $o['gcash_proof_path'] === null))) {
            throw new ApiError('This order is not waiting for a new payment proof.');
        }
        $label = payment_label($o['payment_method']);
        if (!preg_match('/^[A-Z0-9-]{4,40}$/', $ref)) {
            throw new ApiError("Please enter your {$label} reference number.");
        }
        if (!proof_exists($path)) {
            throw new ApiError("Please upload a screenshot of your {$label} payment.");
        }
        q(
            "UPDATE orders SET payment_status = 'pending_verification', gcash_reference = ?, gcash_proof_path = ?, payment_rejection_reason = NULL WHERE id = ?",
            [$ref, $path, $o['id']]
        );
        add_history($o['id'], 'proof_resubmitted', "New {$label} payment proof submitted (Ref: {$ref}).");
    });
    return true;
}
