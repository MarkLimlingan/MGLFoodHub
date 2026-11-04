<?php
// Admin functions. Every one starts with require_admin().
// Order actions and Edit Order are ported from the Supabase functions.
declare(strict_types=1);

const ADMIN_FUNCTIONS = [
    'admin_poll', 'admin_dashboard', 'admin_calendar', 'admin_orders', 'admin_orders_export', 'admin_order_detail',
    'admin_order_action', 'admin_edit_order', 'admin_settle_balance', 'admin_save_notes', 'admin_add_call_log',
    'admin_update_store', 'admin_update_product', 'admin_update_variant', 'admin_get_settings', 'admin_save_settings',
    'admin_prep_list', 'admin_report',
];

const ORDER_STATUSES = ['processing', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['cod_unpaid', 'pending_verification', 'paid', 'rejected'];
const PAYMENT_METHODS = ['cod', 'gcash', 'maribank', 'gotyme'];

// ---------------------------------------------------------------------
// Rows as the admin pages expect them (same fields as the Supabase tables)
// ---------------------------------------------------------------------
function order_row(array $o): array
{
    foreach (['subtotal', 'delivery_fee', 'total', 'paid_amount'] as $k) {
        $o[$k] = $o[$k] === null ? null : num(cents($o[$k]));
    }
    $o['cancel_requested'] = (int) $o['cancel_requested'] === 1;
    foreach (['created_at', 'updated_at', 'email_sent_at'] as $k) {
        $o[$k] = iso($o[$k]);
    }
    $o['customer_user_id'] = $o['google_sub'];
    return $o;
}

function item_row(array $i): array
{
    $i['options_snapshot'] = json_decode($i['options_snapshot'], true) ?: [];
    $i['unit_price_snapshot'] = num(cents($i['unit_price_snapshot']));
    $i['line_total'] = num(cents($i['line_total']));
    $i['quantity'] = (int) $i['quantity'];
    $i['line_no'] = (int) $i['line_no'];
    return $i;
}

function iso_rows(array $rows, string ...$keys): array
{
    foreach ($rows as &$r) {
        foreach ($keys as $k) {
            $r[$k] = iso($r[$k]);
        }
    }
    return $rows;
}

function date_arg(array $args, string $key): string
{
    $v = $args[$key] ?? '';
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !DateTimeImmutable::createFromFormat('!Y-m-d', $v) || DateTimeImmutable::createFromFormat('!Y-m-d', $v)->format('Y-m-d') !== $v) {
        throw new ApiError('Please choose a valid date.');
    }
    return $v;
}

function id_arg(array $args, string $key): string
{
    $v = $args[$key] ?? null;
    return is_uuid($v) ? strtolower($v) : throw new ApiError('Order not found.');
}

// ---------------------------------------------------------------------
// Live updates: the admin pages ask every few seconds what changed
// ---------------------------------------------------------------------
function admin_poll(array $args): array
{
    require_admin();
    $now = (string) val('SELECT UTC_TIMESTAMP(3)');
    $since = is_string($args['since'] ?? null) ? $args['since'] : null;
    // A little overlap, so nothing saved in the same instant is missed; the page skips ids it has seen.
    $next = iso((new DateTimeImmutable($now, new DateTimeZone('UTC')))->modify('-2 seconds')->format('Y-m-d H:i:s.v'));
    try {
        $from = $since === null ? null : (new DateTimeImmutable($since))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
    } catch (Exception) {
        $from = null;
    }
    if ($from === null) {
        return ['since' => $next, 'changed' => false, 'new_orders' => [], 'events' => []];
    }
    $newOrders = all(
        'SELECT id, order_number, customer_name, payment_method, subtotal FROM orders WHERE created_at > ? ORDER BY created_at',
        [$from]
    );
    $events = all(
        "SELECT id, order_id, status, note FROM order_status_history
          WHERE created_at > ? AND status IN ('cancel_requested', 'proof_resubmitted') ORDER BY created_at",
        [$from]
    );
    $changed = $newOrders || $events || val('SELECT 1 FROM orders WHERE updated_at > ? LIMIT 1', [$from])
        || val('SELECT 1 FROM order_status_history WHERE created_at > ? LIMIT 1', [$from]);
    return [
        'since' => $next,
        'changed' => (bool) $changed,
        'new_orders' => typed($newOrders, [], ['subtotal']),
        'events' => $events,
    ];
}

// ---------------------------------------------------------------------
// Dashboard, calendar, orders list
// ---------------------------------------------------------------------
function admin_dashboard(array $args): array
{
    require_admin();
    $now = manila_now();
    $today = $now->format('Y-m-d');
    $tomorrow = $now->modify('+1 day')->format('Y-m-d');
    $weekStart = $now->modify('-' . (((int) $now->format('N')) - 1) . ' days')->format('Y-m-d');
    $monthStart = $now->format('Y-m-01');
    [$dayStart] = manila_day_utc($now);
    $count = fn (string $where, array $p = []) => (int) val("SELECT COUNT(*) FROM orders WHERE {$where}", $p);
    $revenue = fn (string $from) => num(cents(val(
        "SELECT COALESCE(SUM(subtotal), 0) FROM orders WHERE order_status = 'delivered' AND delivery_date BETWEEN ? AND ?",
        [$from, $today]
    )));
    return [
        'newToday' => $count('created_at >= ?', [$dayStart]),
        'gcashToVerify' => $count("payment_method <> 'cod' AND payment_status = 'pending_verification' AND order_status = 'processing'"),
        'codToCall' => $count("payment_method = 'cod' AND order_status = 'processing'"),
        'tomorrow' => $count("delivery_date = ? AND order_status <> 'cancelled'", [$tomorrow]),
        'cancelRequests' => $count('cancel_requested = 1'),
        'revenueWeek' => $revenue($weekStart),
        'revenueMonth' => $revenue($monthStart),
        'recent' => array_map('order_row', all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8')),
    ];
}

/** Non-cancelled orders' delivery dates and statuses between two dates (the dashboard calendar). */
function admin_calendar(array $args): array
{
    require_admin();
    return all(
        "SELECT delivery_date, order_status FROM orders WHERE delivery_date BETWEEN ? AND ? AND order_status <> 'cancelled' LIMIT 10000",
        [date_arg($args, 'from'), date_arg($args, 'to')]
    );
}

/** WHERE clause for the Orders page filters (same as its URL parameters). */
function order_filters(array $f): array
{
    $where = ['1 = 1'];
    $p = [];
    $s = fn (string $k) => is_string($f[$k] ?? null) ? trim($f[$k]) : '';
    if ($s('date') !== '') {
        $where[] = 'o.delivery_date = ?';
        $p[] = $s('date');
    }
    if ($s('created') !== '' && ($day = DateTimeImmutable::createFromFormat('!Y-m-d', $s('created'), new DateTimeZone('Asia/Manila')))) {
        [$start, $end] = manila_day_utc($day);
        $where[] = 'o.created_at >= ? AND o.created_at < ?';
        array_push($p, $start, $end);
    }
    $status = $s('status');
    if ($status === 'cancel_requested') {
        $where[] = 'o.cancel_requested = 1';
    } elseif ($status === 'active') {
        $where[] = "o.order_status NOT IN ('delivered', 'cancelled')";
    } elseif ($status !== '') {
        $where[] = 'o.order_status = ?';
        $p[] = $status;
    }
    $method = $s('method');
    if ($method === 'online') {
        $where[] = "o.payment_method <> 'cod'";
    } elseif ($method !== '') {
        $where[] = 'o.payment_method = ?';
        $p[] = $method;
    }
    if ($s('pstatus') !== '') {
        $where[] = 'o.payment_status = ?';
        $p[] = $s('pstatus');
    }
    if ($s('store') !== '') {
        $where[] = 'EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.store_id = ?)';
        $p[] = $s('store');
    }
    $q = trim(preg_replace('/[,()%*\\\\_]/', ' ', $s('q')));
    if ($q !== '') {
        $where[] = '(o.customer_name LIKE ? OR o.phone LIKE ? OR o.order_number LIKE ?)';
        array_push($p, "%{$q}%", "%{$q}%", "%{$q}%");
    }
    $order = $s('sort') === 'delivery' ? 'o.delivery_date ASC, o.delivery_slot ASC, o.id' : 'o.created_at DESC, o.id';
    return [implode(' AND ', $where), $p, $order, $s('store')];
}

/** Items of the given orders, grouped by order id (only one store's items when filtering by store). */
function items_by_order(array $orderIds, string $columns, string $store = ''): array
{
    if (!$orderIds) {
        return [];
    }
    $in = implode(',', array_fill(0, count($orderIds), '?'));
    $params = $orderIds;
    $storeSql = '';
    if ($store !== '') {
        $storeSql = ' AND store_id = ?';
        $params[] = $store;
    }
    $grouped = [];
    foreach (all("SELECT order_id, {$columns} FROM order_items WHERE order_id IN ({$in}){$storeSql} ORDER BY line_no", $params) as $i) {
        $orderId = $i['order_id'];
        unset($i['order_id']);
        if (isset($i['options_snapshot'])) {
            $i['options_snapshot'] = json_decode($i['options_snapshot'], true) ?: [];
        }
        foreach (['quantity'] as $k) {
            if (isset($i[$k])) {
                $i[$k] = (int) $i[$k];
            }
        }
        if (isset($i['line_total'])) {
            $i['line_total'] = num(cents($i['line_total']));
        }
        $grouped[$orderId][] = $i;
    }
    return $grouped;
}

function admin_orders(array $args): array
{
    require_admin();
    [$where, $p, $order, $store] = order_filters(is_array($args['filters'] ?? null) ? $args['filters'] : []);
    $size = min(max((int) ($args['page_size'] ?? 30), 1), 200);
    $offset = max((int) ($args['page'] ?? 0), 0) * $size;
    $total = (int) val("SELECT COUNT(*) FROM orders o WHERE {$where}", $p);
    $rows = all("SELECT o.* FROM orders o WHERE {$where} ORDER BY {$order} LIMIT {$size} OFFSET {$offset}", $p);
    $items = items_by_order(array_column($rows, 'id'), 'store_id, store_name_snapshot', $store);
    return [
        'total' => $total,
        'rows' => array_map(fn ($o) => order_row($o) + ['order_items' => $items[$o['id']] ?? []], $rows),
    ];
}

function admin_orders_export(array $args): array
{
    require_admin();
    [$where, $p, $order, $store] = order_filters(is_array($args['filters'] ?? null) ? $args['filters'] : []);
    $rows = all("SELECT o.* FROM orders o WHERE {$where} ORDER BY {$order} LIMIT 5000", $p);
    $items = items_by_order(
        array_column($rows, 'id'),
        'store_id, store_name_snapshot, product_name_snapshot, variant_label_snapshot, options_snapshot, quantity, line_total',
        $store
    );
    return array_map(fn ($o) => order_row($o) + ['order_items' => $items[$o['id']] ?? []], $rows);
}

function admin_order_detail(array $args): ?array
{
    require_admin();
    $id = id_arg($args, 'id');
    $o = one('SELECT * FROM orders WHERE id = ?', [$id]);
    if (!$o) {
        return null;
    }
    $account = null;
    if ($o['google_sub'] !== null) {
        $account = [
            'total' => (int) val('SELECT COUNT(*) FROM orders WHERE google_sub = ?', [$o['google_sub']]),
            'cancelled' => (int) val("SELECT COUNT(*) FROM orders WHERE google_sub = ? AND order_status = 'cancelled'", [$o['google_sub']]),
        ];
    }
    $edits = all('SELECT * FROM order_edits WHERE order_id = ? ORDER BY created_at DESC', [$id]);
    foreach ($edits as &$e) {
        $e['changes'] = json_decode($e['changes'], true) ?: [];
    }
    return [
        'order' => order_row($o),
        'items' => array_map('item_row', all('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no', [$id])),
        'history' => iso_rows(all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC, id DESC', [$id]), 'created_at'),
        'calls' => iso_rows(all('SELECT * FROM call_logs WHERE order_id = ? ORDER BY created_at DESC', [$id]), 'created_at'),
        'edits' => iso_rows($edits, 'created_at'),
        'account' => $account,
    ];
}

function order_for_update(string $id): array
{
    return one('SELECT * FROM orders WHERE id = ? FOR UPDATE', [$id]) ?? throw new ApiError('Order not found.');
}

// ---------------------------------------------------------------------
// Order actions: every status change is checked and written to the history
// ---------------------------------------------------------------------
function admin_order_action(array $args): bool
{
    $admin = require_admin();
    $id = id_arg($args, 'p_order_id');
    $action = is_string($args['p_action'] ?? null) ? $args['p_action'] : '';
    $note = text_arg($args, 'p_note', 2000) ?: null;
    $amount = $args['p_amount'] ?? null;

    transaction(function () use ($admin, $id, $action, $note, $amount) {
        $o = order_for_update($id);
        $label = payment_label($o['payment_method']);
        switch ($action) {
            // "Confirm Order" works for every payment method. For online payments it also verifies the payment.
            case 'confirm':
                if ($o['order_status'] !== 'processing') {
                    throw new ApiError('Only orders awaiting confirmation can be confirmed.');
                }
                if ($o['payment_method'] !== 'cod') {
                    if (!in_array($o['payment_status'], ['pending_verification', 'rejected'], true)) {
                        throw new ApiError("This {$label} order has no payment waiting for verification.");
                    }
                    q("UPDATE orders SET payment_status = 'paid', order_status = 'confirmed', payment_rejection_reason = NULL, cancel_requested = 0 WHERE id = ?", [$id]);
                    $status = 'payment_confirmed';
                    $note ??= "{$label} payment verified. Your order is confirmed.";
                } else {
                    q("UPDATE orders SET order_status = 'confirmed', cancel_requested = 0 WHERE id = ?", [$id]);
                    $status = 'confirmed';
                    $note ??= 'Your order has been confirmed by phone.';
                }
                break;

            case 'mark_paid':
                if ($o['payment_method'] === 'cod' || !in_array($o['payment_status'], ['pending_verification', 'rejected'], true) || $o['order_status'] !== 'processing') {
                    throw new ApiError('This order has no online payment waiting for verification.');
                }
                q("UPDATE orders SET payment_status = 'paid', order_status = 'confirmed', payment_rejection_reason = NULL, cancel_requested = 0 WHERE id = ?", [$id]);
                $status = 'payment_confirmed';
                $note ??= "{$label} payment verified.";
                break;

            case 'reject_payment':
                if ($o['payment_method'] === 'cod' || $o['payment_status'] !== 'pending_verification' || $o['order_status'] !== 'processing') {
                    throw new ApiError('This order has no online payment waiting for verification.');
                }
                if ($note === null) {
                    throw new ApiError('A reason is required to reject a payment.');
                }
                q("UPDATE orders SET payment_status = 'rejected', payment_rejection_reason = ? WHERE id = ?", [$note, $id]);
                $status = 'payment_rejected';
                break;

            case 'preparing':
                if ($o['order_status'] !== 'confirmed') {
                    throw new ApiError('Only confirmed orders can be marked as Preparing.');
                }
                q("UPDATE orders SET order_status = 'preparing' WHERE id = ?", [$id]);
                $status = 'preparing';
                break;

            case 'out_for_delivery':
                if ($o['order_status'] !== 'preparing') {
                    throw new ApiError('Only orders being prepared can be marked Out for Delivery.');
                }
                q("UPDATE orders SET order_status = 'out_for_delivery' WHERE id = ?", [$id]);
                $status = 'out_for_delivery';
                break;

            case 'delivered':
                if ($o['order_status'] !== 'out_for_delivery') {
                    throw new ApiError('Only orders out for delivery can be marked Delivered.');
                }
                q(
                    "UPDATE orders SET order_status = 'delivered', payment_status = IF(payment_method = 'cod', 'paid', payment_status) WHERE id = ?",
                    [$id]
                );
                $status = 'delivered';
                break;

            case 'cancel':
                if (in_array($o['order_status'], ['delivered', 'cancelled'], true)) {
                    throw new ApiError('This order can no longer be cancelled.');
                }
                if ($note === null) {
                    throw new ApiError('A reason is required to cancel an order.');
                }
                q("UPDATE orders SET order_status = 'cancelled', cancel_reason = ?, cancel_requested = 0 WHERE id = ?", [$note, $id]);
                $status = 'cancelled';
                break;

            case 'decline_cancel_request':
                if ((int) $o['cancel_requested'] !== 1) {
                    throw new ApiError('There is no pending cancellation request.');
                }
                q('UPDATE orders SET cancel_requested = 0 WHERE id = ?', [$id]);
                $status = 'cancel_request_declined';
                $note ??= 'Your cancellation request was declined. Please contact us if you have questions.';
                break;

            case 'set_delivery_fee':
                $fee = is_numeric($amount) ? cents($amount) : null;
                if ($fee === null || $fee < 0 || $fee > 10000000) {
                    throw new ApiError('Please enter a valid delivery fee.');
                }
                if ($o['order_status'] === 'cancelled') {
                    throw new ApiError('Cannot set a delivery fee on a cancelled order.');
                }
                q('UPDATE orders SET delivery_fee = ?, total = subtotal + ? WHERE id = ?', [dec($fee), dec($fee), $id]);
                $status = 'delivery_fee_updated';
                $note = 'Delivery fee set to ' . peso($fee) . '.';
                break;

            default:
                throw new ApiError("Unknown action: {$action}");
        }
        add_history($id, $status, $note, $admin);
    });
    return true;
}

function admin_save_notes(array $args): bool
{
    require_admin();
    $id = id_arg($args, 'id');
    $notes = text_arg($args, 'admin_notes', 5000) ?: null;
    if (!val('SELECT 1 FROM orders WHERE id = ?', [$id])) {
        throw new ApiError('Order not found.');
    }
    q('UPDATE orders SET admin_notes = ? WHERE id = ?', [$notes, $id]);
    return true;
}

function admin_add_call_log(array $args): bool
{
    $admin = require_admin();
    $id = id_arg($args, 'order_id');
    $result = $args['result'] ?? '';
    if (!in_array($result, ['answered', 'no_answer', 'wrong_number'], true)) {
        throw new ApiError('Please choose how the call went.');
    }
    if (!val('SELECT 1 FROM orders WHERE id = ?', [$id])) {
        throw new ApiError('Order not found.');
    }
    q(
        'INSERT INTO call_logs (id, order_id, result, note, created_by, created_by_email) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), $id, $result, text_arg($args, 'note', 1000) ?: null, $admin['id'], $admin['email']]
    );
    return true;
}

// ---------------------------------------------------------------------
// Edit Order
// ---------------------------------------------------------------------

/** Readable line for the edit history: "2× Bangus (4 pcs) · Spicy". */
function order_line_text(int $qty, string $product, string $variant, array $options): string
{
    $text = "{$qty}× {$product}" . ($variant !== 'Regular' ? " ({$variant})" : '');
    if ($options) {
        $text .= ' · ' . implode(', ', array_map(fn ($o) => ($o['group'] ?? '') === 'Extra Toppings' ? 'Extra toppings' : (string) ($o['choice'] ?? ''), $options));
    }
    return $text;
}

function status_words(string $status): string
{
    return $status === 'out_for_delivery' ? 'out for delivery' : $status;
}

/**
 * p_changes holds the full edited order; keys left out stay as they are:
 *   customer_name, phone, email, address, barangay, city, landmark,
 *   delivery_date, delivery_slot, delivery_fee, payment_method,
 *   items: [{ id?: existing order_items.id, variant_id, quantity, choice_ids?, extra_toppings? }]
 * p_expected_updated_at: the order's updated_at when the editor opened, so a
 * change made meanwhile (status, payment, another admin) is never overwritten.
 */
function admin_edit_order(array $args): array
{
    $admin = require_admin();
    $id = id_arg($args, 'p_order_id');
    $c = is_array($args['p_changes'] ?? null) ? $args['p_changes'] : [];
    $expected = is_string($args['p_expected_updated_at'] ?? null) ? $args['p_expected_updated_at'] : null;
    $has = fn (string $k) => array_key_exists($k, $c);

    return transaction(function () use ($admin, $id, $c, $expected, $has) {
        $o = order_for_update($id);
        if ($expected !== null && iso($o['updated_at']) !== iso((new DateTimeImmutable($expected))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v'))) {
            throw new ApiError('This order was updated while you were editing it (for example a status or payment change). Reload to see the latest, then make your changes again.');
        }
        if ($o['order_status'] === 'cancelled') {
            throw new ApiError('Cancelled orders cannot be edited.');
        }
        $locked = !in_array($o['order_status'], ['processing', 'confirmed', 'preparing'], true);
        $today = manila_now()->format('Y-m-d');

        // Customer details: same rules as checkout.
        $name = $has('customer_name') ? text_arg($c, 'customer_name', 120) : $o['customer_name'];
        $phone = $has('phone') ? normalize_ph_phone($c['phone']) : $o['phone'];
        $email = $has('email') ? mb_strtolower(text_arg($c, 'email', 200)) : $o['email'];
        $address = $has('address') ? text_arg($c, 'address', 300) : $o['address'];
        $barangay = $has('barangay') ? text_arg($c, 'barangay', 120) : $o['barangay'];
        $city = $has('city') ? text_arg($c, 'city', 120) : $o['city'];
        $landmark = $has('landmark') ? (text_arg($c, 'landmark', 200) ?: null) : $o['landmark'];
        if (mb_strlen($name) < 2) {
            throw new ApiError("Please enter the customer's full name.");
        }
        if ($phone === null) {
            throw new ApiError('Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
        }
        if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $email)) {
            throw new ApiError('Please enter a valid email address.');
        }
        if (mb_strlen($address) < 4 || mb_strlen($barangay) < 2 || mb_strlen($city) < 2) {
            throw new ApiError('Please complete the delivery address (house/unit and street, barangay, city).');
        }

        // Delivery date and slot
        $date = $o['delivery_date'];
        if ($has('delivery_date')) {
            $raw = is_string($c['delivery_date']) ? $c['delivery_date'] : '';
            $d = preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) ? DateTimeImmutable::createFromFormat('!Y-m-d', $raw) : false;
            if (!$d || $d->format('Y-m-d') !== $raw) {
                throw new ApiError('Please choose a delivery date.');
            }
            $date = $raw;
        }
        $slot = $has('delivery_slot') ? text_arg($c, 'delivery_slot', 20) : $o['delivery_slot'];
        if (($date !== $o['delivery_date'] || $slot !== $o['delivery_slot']) && $locked) {
            throw new ApiError('This order is already ' . status_words($o['order_status']) . ', so the delivery schedule can no longer be changed.');
        }
        // A new date follows the checkout rules: no same day delivery, no blocked dates.
        if ($date !== $o['delivery_date']) {
            if ($date < $today) {
                throw new ApiError('The delivery date cannot be in the past.');
            }
            if ($date === $today) {
                throw new ApiError('Same day delivery is not available. Please choose tomorrow or a later date.');
            }
            if ($date > manila_now()->modify('+365 days')->format('Y-m-d')) {
                throw new ApiError('Please choose a delivery date within the next year.');
            }
            if (in_array($date, blocked_dates(), true)) {
                throw new ApiError('We are not accepting deliveries on ' . date_label(new DateTimeImmutable($date)) . ' (blocked in Settings). Please choose another date.');
            }
        }

        // Delivery fee: total is always food subtotal + delivery fee.
        $fee = cents($o['delivery_fee']);
        if ($has('delivery_fee')) {
            $fee = is_numeric($c['delivery_fee']) ? cents($c['delivery_fee']) : null;
            if ($fee === null || $fee < 0 || $fee > 10000000) {
                throw new ApiError('Please enter a valid delivery fee.');
            }
        }

        // Payment method: only before the order is confirmed and paid.
        $method = is_string($c['payment_method'] ?? null) && $c['payment_method'] !== '' ? $c['payment_method'] : $o['payment_method'];
        if (!in_array($method, PAYMENT_METHODS, true)) {
            throw new ApiError('Please choose a payment method.');
        }
        $paymentStatus = $o['payment_status'];
        if ($method !== $o['payment_method']) {
            if ($o['order_status'] !== 'processing' || $o['payment_status'] === 'paid') {
                throw new ApiError('The payment method can only be changed before the order is confirmed and paid.');
            }
            if ($method === 'cod') {
                $paymentStatus = 'cod_unpaid';
            } elseif ($o['payment_method'] === 'cod') {
                $paymentStatus = 'pending_verification';
            }
        }

        // Items: the full new list. Kept lines keep their snapshots; every new price is read from the menu.
        $old = array_map('item_row', all('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no', [$id]));
        $oldById = array_column($old, null, 'id');
        $lines = [];
        if (is_array($c['items'] ?? null) && array_is_list($c['items'])) {
            if (!$c['items']) {
                throw new ApiError('An order needs at least one item. To drop everything, cancel the order instead.');
            }
            if (count($c['items']) > 60) {
                throw new ApiError('Too many items in one order.');
            }
            $kept = [];
            foreach ($c['items'] as $pos => $item) {
                $item = is_array($item) ? $item : [];
                $qty = $item['quantity'] ?? null;
                $qty = is_int($qty) || (is_string($qty) && preg_match('/^\d+$/', $qty)) ? (int) $qty : null;
                if ($qty === null || $qty < 1 || $qty > 99) {
                    throw new ApiError('Each item needs a quantity from 1 to 99.');
                }
                $itemId = is_uuid($item['id'] ?? null) ? strtolower($item['id']) : null;
                $variantId = is_uuid($item['variant_id'] ?? null) ? strtolower($item['variant_id']) : null;

                if ($itemId !== null) {
                    // An item already in this order: quantity and size can change.
                    $prev = $oldById[$itemId] ?? throw new ApiError('One of the items is no longer part of this order. Reload and try again.');
                    if (isset($kept[$itemId])) {
                        throw new ApiError('The same order item was listed twice.');
                    }
                    $kept[$itemId] = true;
                    $variantId ??= $prev['variant_id'];
                    if ($variantId === $prev['variant_id']) {
                        $line = [
                            'id' => $itemId, 'store_id' => $prev['store_id'], 'product_id' => $prev['product_id'], 'variant_id' => $prev['variant_id'],
                            'store_name' => $prev['store_name_snapshot'], 'section_name' => $prev['section_name_snapshot'],
                            'product_name' => $prev['product_name_snapshot'], 'variant_label' => $prev['variant_label_snapshot'],
                            'options' => $prev['options_snapshot'], 'unit' => cents($prev['unit_price_snapshot']),
                        ];
                    } else {
                        $v = load_variant($variantId);
                        if (!$v || $v['product_id'] !== $prev['product_id']) {
                            throw new ApiError("Please choose a size of {$prev['product_name_snapshot']} for that item.");
                        }
                        if ((int) $v['product_sold_out'] === 1 || (int) $v['variant_sold_out'] === 1) {
                            throw new ApiError("{$v['product_name']} ({$v['label']}) is SOLD OUT.");
                        }
                        if ((int) $v['is_accepting_orders'] !== 1) {
                            throw new ApiError("{$v['store_name']} is temporarily not accepting orders.");
                        }
                        // Same choices as before; Extra Toppings follow the new size's add-on price.
                        $unit = cents($v['price']);
                        $options = [];
                        foreach ($prev['options_snapshot'] as $opt) {
                            if (($opt['group'] ?? '') === 'Extra Toppings') {
                                if ($v['addon_price'] === null) {
                                    throw new ApiError("Extra toppings are not available for {$v['product_name']} ({$v['label']}).");
                                }
                                $unit += cents($v['addon_price']);
                                $opt['price_delta'] = num(cents($v['addon_price']));
                            } else {
                                $unit += cents($opt['price_delta'] ?? 0);
                            }
                            $options[] = $opt;
                        }
                        $line = [
                            'id' => $itemId, 'store_id' => $v['store_id'], 'product_id' => $v['product_id'], 'variant_id' => $v['variant_id'],
                            'store_name' => $v['store_name'], 'section_name' => $v['section_name'], 'product_name' => $v['product_name'],
                            'variant_label' => $v['label'], 'options' => $options, 'unit' => $unit,
                        ];
                    }
                } else {
                    // A new item: checked and priced exactly like checkout.
                    if ($variantId === null) {
                        throw new ApiError('One of the new items is invalid. Please choose it again.');
                    }
                    $v = load_variant($variantId) ?? throw new ApiError('One of the new items is no longer on the menu.');
                    if ((int) $v['product_sold_out'] === 1 || (int) $v['variant_sold_out'] === 1) {
                        throw new ApiError("{$v['product_name']} ({$v['label']}) from {$v['store_name']} is SOLD OUT.");
                    }
                    if ((int) $v['is_accepting_orders'] !== 1) {
                        throw new ApiError("{$v['store_name']} is temporarily not accepting orders.");
                    }
                    [$unit, $options] = price_with_options($v, $item['choice_ids'] ?? null, truthy($item['extra_toppings'] ?? false));
                    $line = [
                        'id' => null, 'store_id' => $v['store_id'], 'product_id' => $v['product_id'], 'variant_id' => $v['variant_id'],
                        'store_name' => $v['store_name'], 'section_name' => $v['section_name'], 'product_name' => $v['product_name'],
                        'variant_label' => $v['label'], 'options' => $options, 'unit' => $unit,
                    ];
                }
                $lines[] = $line + ['quantity' => $qty, 'line_no' => $pos + 1];
            }
        } else {
            foreach ($old as $i) {
                $lines[] = [
                    'id' => $i['id'], 'store_id' => $i['store_id'], 'product_id' => $i['product_id'], 'variant_id' => $i['variant_id'],
                    'store_name' => $i['store_name_snapshot'], 'section_name' => $i['section_name_snapshot'],
                    'product_name' => $i['product_name_snapshot'], 'variant_label' => $i['variant_label_snapshot'],
                    'options' => $i['options_snapshot'], 'unit' => cents($i['unit_price_snapshot']), 'quantity' => $i['quantity'], 'line_no' => $i['line_no'],
                ];
            }
        }

        // Item changes, for the edit history.
        $changes = [];
        $byId = [];
        foreach ($lines as $l) {
            if ($l['id'] !== null) {
                $byId[$l['id']] = $l;
            }
        }
        foreach ($old as $i) {
            $before = order_line_text($i['quantity'], $i['product_name_snapshot'], $i['variant_label_snapshot'], $i['options_snapshot']);
            $l = $byId[$i['id']] ?? null;
            if ($l === null) {
                $changes[] = ['field' => 'item', 'from' => $before, 'to' => null];
            } else {
                $after = order_line_text($l['quantity'], $l['product_name'], $l['variant_label'], $l['options']);
                if ($after !== $before) {
                    $changes[] = ['field' => 'item', 'from' => $before, 'to' => $after];
                }
            }
        }
        foreach ($lines as $l) {
            if ($l['id'] === null) {
                $changes[] = ['field' => 'item', 'from' => null, 'to' => order_line_text($l['quantity'], $l['product_name'], $l['variant_label'], $l['options'])];
            }
        }
        $itemsChanged = (bool) $changes;
        foreach ($lines as $l) {
            if ($l['id'] !== null && $oldById[$l['id']]['line_no'] !== $l['line_no']) {
                $itemsChanged = true;
            }
        }
        if ($itemsChanged && $locked) {
            throw new ApiError('This order is already ' . status_words($o['order_status']) . ', so its items can no longer be changed.');
        }

        $subtotal = array_sum(array_map(fn ($l) => $l['unit'] * $l['quantity'], $lines));
        $storeIds = array_values(array_unique(array_column($lines, 'store_id')));

        // Time slot: a 1-hour slot inside the hours of EVERY store in the order (same as checkout).
        if ($itemsChanged || $slot !== $o['delivery_slot']) {
            check_slot($slot, $storeIds, false);
        }

        // Cash on Delivery is only for orders up to ₱2,000.
        if ($method === 'cod' && $subtotal > COD_MAX_CENTS && ($subtotal !== cents($o['subtotal']) || $method !== $o['payment_method'])) {
            throw new ApiError('Cash on Delivery is only for orders up to ₱2,000, and this change makes the food subtotal ' . peso($subtotal) . '. Switch the payment to GCash, MariBank or GoTyme, or remove some items.');
        }

        // Field changes, for the edit history.
        $fields = [
            ['customer_name', $o['customer_name'], $name],
            ['phone', $o['phone'], $phone],
            ['email', $o['email'], $email],
            ['address', $o['address'], $address],
            ['barangay', $o['barangay'], $barangay],
            ['city', $o['city'], $city],
            ['landmark', $o['landmark'], $landmark],
            ['delivery_date', $o['delivery_date'], $date],
            ['delivery_slot', $o['delivery_slot'], $slot],
            ['payment_method', $o['payment_method'], $method],
            ['subtotal', dec(cents($o['subtotal'])), dec($subtotal)],
            ['delivery_fee', dec(cents($o['delivery_fee'])), dec($fee)],
            ['total', dec(cents($o['total'])), dec($subtotal + $fee)],
        ];
        foreach ($fields as [$field, $from, $to]) {
            if ($from !== $to) {
                $changes[] = ['field' => $field, 'from' => $from, 'to' => $to];
            }
        }
        if (!$changes && !$itemsChanged) {
            throw new ApiError('There are no changes to save.');
        }

        // Paid online and the food subtotal changes: remember what was actually paid, so the
        // balance due or refund due shows until the admin marks it settled.
        $paid = $o['paid_amount'];
        if ($paid === null && $o['payment_method'] !== 'cod' && $o['payment_status'] === 'paid' && $subtotal !== cents($o['subtotal'])) {
            $paid = $o['subtotal'];
        }

        // Save. Order id, number, tracking token, status and created_at never change.
        if ($itemsChanged) {
            $keep = array_keys($byId);
            if ($keep) {
                $in = implode(',', array_fill(0, count($keep), '?'));
                q("DELETE FROM order_items WHERE order_id = ? AND id NOT IN ({$in})", [$id, ...$keep]);
            } else {
                q('DELETE FROM order_items WHERE order_id = ?', [$id]);
            }
            foreach ($lines as $l) {
                $values = [
                    $l['line_no'], $l['store_id'], $l['product_id'], $l['variant_id'], $l['store_name'], $l['section_name'], $l['product_name'],
                    $l['variant_label'], json_encode($l['options'], JSON_UNESCAPED_UNICODE), dec($l['unit']), $l['quantity'], dec($l['unit'] * $l['quantity']),
                ];
                if ($l['id'] !== null) {
                    q(
                        'UPDATE order_items SET line_no = ?, store_id = ?, product_id = ?, variant_id = ?, store_name_snapshot = ?, section_name_snapshot = ?,
                                product_name_snapshot = ?, variant_label_snapshot = ?, options_snapshot = ?, unit_price_snapshot = ?, quantity = ?, line_total = ?
                          WHERE id = ? AND order_id = ?',
                        [...$values, $l['id'], $id]
                    );
                } else {
                    q(
                        'INSERT INTO order_items (line_no, store_id, product_id, variant_id, store_name_snapshot, section_name_snapshot, product_name_snapshot,
                                                  variant_label_snapshot, options_snapshot, unit_price_snapshot, quantity, line_total, id, order_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [...$values, uuid(), $id]
                    );
                }
            }
        }

        q(
            'UPDATE orders SET customer_name = ?, phone = ?, email = ?, address = ?, barangay = ?, city = ?, landmark = ?,
                    delivery_date = ?, delivery_slot = ?, payment_method = ?, payment_status = ?,
                    payment_rejection_reason = IF(? = \'cod\', NULL, payment_rejection_reason),
                    subtotal = ?, delivery_fee = ?, total = ?, paid_amount = ?, updated_at = UTC_TIMESTAMP(3)
              WHERE id = ?',
            [$name, $phone, $email, $address, $barangay, $city, $landmark, $date, $slot, $method, $paymentStatus, $method,
             dec($subtotal), dec($fee), dec($subtotal + $fee), $paid, $id]
        );

        // The delivery fee is shown to the customer, same as Admin → Save fee.
        if ($fee !== cents($o['delivery_fee'])) {
            add_history($id, 'delivery_fee_updated', 'Delivery fee set to ' . peso($fee) . '.', $admin);
        }
        // Anything else the customer can see on the tracking page: tell them it changed (the details stay private).
        if (array_filter($changes, fn ($x) => !in_array($x['field'], ['email', 'delivery_fee', 'total'], true))) {
            add_history($id, 'order_updated', 'Our team updated your order details. Please check them below.', $admin);
        }
        q(
            'INSERT INTO order_edits (id, order_id, changes, edited_by, edited_by_email) VALUES (?, ?, ?, ?, ?)',
            [uuid(), $id, json_encode($changes, JSON_UNESCAPED_UNICODE), $admin['id'], $admin['email']]
        );

        return ['subtotal' => num($subtotal), 'delivery_fee' => num($fee), 'total' => num($subtotal + $fee), 'changes' => count($changes)];
    });
}

/** The balance due or refund due of an edited paid order was settled with the customer. */
function admin_settle_balance(array $args): bool
{
    $admin = require_admin();
    $id = id_arg($args, 'p_order_id');
    transaction(function () use ($admin, $id) {
        $o = order_for_update($id);
        if ($o['paid_amount'] === null || cents($o['paid_amount']) === cents($o['subtotal'])) {
            throw new ApiError('This order has no balance to settle.');
        }
        q('UPDATE orders SET paid_amount = subtotal WHERE id = ?', [$id]);
        q(
            'INSERT INTO order_edits (id, order_id, changes, edited_by, edited_by_email) VALUES (?, ?, ?, ?, ?)',
            [uuid(), $id, json_encode([['field' => 'paid_amount', 'from' => dec(cents($o['paid_amount'])), 'to' => dec(cents($o['subtotal']))]]), $admin['id'], $admin['email']]
        );
    });
    return true;
}

// ---------------------------------------------------------------------
// Menu: availability, badges, photos and order (prices never change)
// ---------------------------------------------------------------------
function image_url_ok(mixed $v): bool
{
    return $v === null || (is_string($v) && strlen($v) <= 1000 && (str_starts_with($v, '/uploads/') || str_starts_with($v, '/menus/') || str_starts_with($v, '/stores/') || str_starts_with($v, '/products/') || str_starts_with($v, 'https://')));
}

/** Only the listed columns can change; each value is checked. */
function update_row(string $table, array $args, array $rules): bool
{
    $id = is_uuid($args['id'] ?? null) ? strtolower($args['id']) : throw new ApiError('Not found.');
    $values = is_array($args['values'] ?? null) ? $args['values'] : [];
    $set = [];
    $params = [];
    foreach ($values as $col => $v) {
        $check = $rules[$col] ?? throw new ApiError("{$col} cannot be changed here.");
        if (!$check($v)) {
            throw new ApiError("Invalid value for {$col}.");
        }
        $set[] = "`{$col}` = ?";
        $params[] = is_bool($v) ? (int) $v : $v;
    }
    if (!$set) {
        throw new ApiError('Nothing to change.');
    }
    if (!val("SELECT 1 FROM {$table} WHERE id = ?", [$id])) {
        throw new ApiError('Not found.');
    }
    q("UPDATE {$table} SET " . implode(', ', $set) . ' WHERE id = ?', [...$params, $id]);
    return true;
}

function admin_update_store(array $args): bool
{
    require_admin();
    return update_row('stores', $args, [
        'is_accepting_orders' => 'is_bool',
        'cover_image_url' => 'image_url_ok',
        'menu_image_url' => 'image_url_ok',
    ]);
}

function admin_update_product(array $args): bool
{
    require_admin();
    return update_row('products', $args, [
        'is_sold_out' => 'is_bool',
        'badge' => fn ($v) => $v === null || in_array($v, ['best_seller', 'new', 'all_time_favorite'], true),
        'image_url' => 'image_url_ok',
        'sort' => fn ($v) => is_int($v) && $v >= -1000000 && $v <= 1000000,
    ]);
}

function admin_update_variant(array $args): bool
{
    require_admin();
    return update_row('product_variants', $args, ['is_sold_out' => 'is_bool']);
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
function setting_rules(): array
{
    $text = fn (int $max) => fn ($v) => is_string($v) && mb_strlen($v) <= $max;
    $rules = [
        'cutoff_time' => fn ($v) => is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v),
        'max_days_ahead' => fn ($v) => is_int($v) && $v >= 1 && $v <= 365,
        'blocked_dates' => fn ($v) => is_array($v) && array_is_list($v) && count($v) <= 1000
            && !array_filter($v, fn ($d) => !is_string($d) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)),
        'delivery_fee_note' => $text(500),
        'email_notifications_enabled' => 'is_bool',
        'max_orders_per_phone_per_day' => fn ($v) => is_int($v) && $v >= 1 && $v <= 1000,
        'ordering_guidelines' => fn ($v) => is_array($v) && array_is_list($v) && count($v) <= 50
            && !array_filter($v, fn ($g) => !is_string($g) || mb_strlen($g) > 500),
        'require_google_login' => 'is_bool',
        'owner_phone' => fn ($v) => $v === '' || (is_string($v) && preg_match('/^\+?[0-9() -]{7,20}$/', $v) && strlen(preg_replace('/\D/', '', $v)) >= 7),
    ];
    foreach (['gcash', 'maribank', 'gotyme'] as $m) {
        $rules["{$m}_account_name"] = $text(200);
        $rules["{$m}_number"] = $text(100);
        $rules["{$m}_qr_url"] = fn ($v) => $v === '' || image_url_ok($v);
    }
    return $rules;
}

function admin_get_settings(array $args): array
{
    require_admin();
    return array_map(fn ($r) => ['key' => $r['key'], 'value' => json_decode($r['value'], true)], all('SELECT `key`, value FROM settings ORDER BY `key`'));
}

function admin_save_settings(array $args): bool
{
    require_admin();
    $rows = is_array($args['rows'] ?? null) ? $args['rows'] : [];
    $rules = setting_rules();
    foreach ($rows as $row) {
        $key = is_array($row) && is_string($row['key'] ?? null) ? $row['key'] : '';
        $check = $rules[$key] ?? throw new ApiError("Unknown setting: {$key}");
        if (!$check($row['value'] ?? null)) {
            throw new ApiError("Please check the value of {$key}.");
        }
    }
    transaction(function () use ($rows) {
        foreach ($rows as $row) {
            q(
                'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
                [$row['key'], json_encode($row['value'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]
            );
        }
    });
    return true;
}

// ---------------------------------------------------------------------
// Prep list and reports
// ---------------------------------------------------------------------
function admin_prep_list(array $args): array
{
    require_admin();
    $rows = all(
        "SELECT i.store_name_snapshot, i.section_name_snapshot, i.product_name_snapshot, i.variant_label_snapshot, i.options_snapshot, i.quantity,
                o.order_number, o.delivery_slot, o.order_status, o.delivery_date
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.delivery_date = ? AND o.order_status <> 'cancelled'
          ORDER BY o.delivery_slot, o.order_number, i.line_no LIMIT 10000",
        [date_arg($args, 'date')]
    );
    return array_map(fn ($r) => [
        'store_name_snapshot' => $r['store_name_snapshot'],
        'section_name_snapshot' => $r['section_name_snapshot'],
        'product_name_snapshot' => $r['product_name_snapshot'],
        'variant_label_snapshot' => $r['variant_label_snapshot'],
        'options_snapshot' => json_decode($r['options_snapshot'], true) ?: [],
        'quantity' => (int) $r['quantity'],
        'orders' => ['order_number' => $r['order_number'], 'delivery_slot' => $r['delivery_slot'], 'order_status' => $r['order_status'], 'delivery_date' => $r['delivery_date']],
    ], $rows);
}

function admin_report(array $args): array
{
    require_admin();
    $scope = ($args['scope'] ?? '') === 'delivered' ? "order_status = 'delivered'" : "order_status <> 'cancelled'";
    $rows = all(
        "SELECT id, delivery_date, order_status, payment_method, subtotal, delivery_fee FROM orders
          WHERE delivery_date BETWEEN ? AND ? AND {$scope} LIMIT 10000",
        [date_arg($args, 'from'), date_arg($args, 'to')]
    );
    $items = items_by_order(array_column($rows, 'id'), 'store_name_snapshot, quantity, line_total');
    return array_map(function ($o) use ($items) {
        $row = typed([$o], [], ['subtotal', 'delivery_fee'])[0] + ['order_items' => $items[$o['id']] ?? []];
        unset($row['id']);
        return $row;
    }, $rows);
}
