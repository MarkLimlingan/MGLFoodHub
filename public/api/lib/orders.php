<?php
// Order rules shared by checkout (public.php) and Admin → Edit Order (admin.php).
// Ported from the Supabase functions; error messages are the same.
declare(strict_types=1);

const COD_MAX_CENTS = 200000;

/** Delivery window in Asia/Manila. Same day is never allowed; after the cutoff the earliest date moves one more day. */
function delivery_window(): array
{
    $now = manila_now();
    $cutoff = setting_text('cutoff_time', '20:00');
    $cutoff = preg_match('/^([01]\d|2[0-3]):[0-5]\d/', $cutoff) ? substr($cutoff, 0, 5) : '20:00';
    $maxDays = max((int) setting('max_days_ahead', 30) ?: 30, 1);
    $today = $now->setTime(0, 0);
    $min = $today->modify($now->format('H:i') >= $cutoff ? '+2 days' : '+1 day');
    $max = $today->modify("+{$maxDays} days");
    if ($max < $min) {
        $max = $min;
    }
    return ['today' => $today, 'min' => $min, 'max' => $max, 'cutoff' => $cutoff];
}

function blocked_dates(): array
{
    $v = setting('blocked_dates', []);
    return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
}

/** "Mon DD, YYYY" like Postgres to_char. */
function date_label(DateTimeImmutable $d, bool $year = true): string
{
    return $d->format($year ? 'M d, Y' : 'M d');
}

function time_label(string $time): string
{
    return (new DateTimeImmutable('2000-01-01 ' . $time))->format('g:i A');
}

/** A variant with its product, store and section, or null. */
function load_variant(string $variantId): ?array
{
    return one(
        'SELECT pv.id AS variant_id, pv.label, pv.price, pv.addon_price, pv.is_sold_out AS variant_sold_out,
                p.id AS product_id, p.name AS product_name, p.is_sold_out AS product_sold_out,
                s.id AS store_id, s.name AS store_name, s.is_accepting_orders, ms.name AS section_name
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
           JOIN stores s ON s.id = p.store_id
           JOIN menu_sections ms ON ms.id = p.section_id
          WHERE pv.id = ?',
        [strtolower($variantId)]
    );
}

/**
 * Unit price (centavos) and options snapshot for a variant with the chosen
 * options: each choice must belong to the product, one per group, required
 * groups filled. Same as place_order.
 */
function price_with_options(array $v, mixed $choiceIds, bool $extraToppings): array
{
    $ids = [];
    if (is_array($choiceIds)) {
        foreach ($choiceIds as $id) {
            if (!is_uuid($id)) {
                throw new ApiError("Invalid option selected for {$v['product_name']}.");
            }
            $ids[strtolower($id)] = true;
        }
    }
    $choices = all(
        'SELECT oc.id, oc.group_id, oc.label, oc.price_delta FROM option_choices oc
           JOIN option_groups og ON og.id = oc.group_id WHERE og.product_id = ?',
        [$v['product_id']]
    );
    $known = array_column($choices, null, 'id');
    foreach (array_keys($ids) as $id) {
        if (!isset($known[$id])) {
            throw new ApiError("Invalid option selected for {$v['product_name']}.");
        }
    }

    $unit = cents($v['price']);
    $options = [];
    $groups = all('SELECT id, name, is_required FROM option_groups WHERE product_id = ? ORDER BY name', [$v['product_id']]);
    foreach ($groups as $g) {
        $picked = array_values(array_filter($choices, fn ($c) => $c['group_id'] === $g['id'] && isset($ids[$c['id']])));
        $name = mb_strtolower($g['name']);
        if (count($picked) > 1) {
            throw new ApiError("Please choose only one {$name} for {$v['product_name']}.");
        }
        if (!$picked && (int) $g['is_required'] === 1) {
            throw new ApiError("Please choose a {$name} for {$v['product_name']}.");
        }
        if ($picked) {
            $unit += cents($picked[0]['price_delta']);
            $options[] = ['group' => $g['name'], 'choice' => $picked[0]['label'], 'price_delta' => num(cents($picked[0]['price_delta']))];
        }
    }
    if ($extraToppings) {
        if ($v['addon_price'] === null) {
            throw new ApiError("Extra toppings are not available for {$v['product_name']}.");
        }
        $unit += cents($v['addon_price']);
        $options[] = ['group' => 'Extra Toppings', 'choice' => 'Yes', 'price_delta' => num(cents($v['addon_price']))];
    }
    return [$unit, $options];
}

function truthy(mixed $v): bool
{
    return $v === true || $v === 'true' || $v === 1 || $v === '1';
}

function seconds_of(string $time): int
{
    [$h, $m, $s] = array_map('intval', explode(':', $time . ':0:0'));
    return $h * 3600 + $m * 60 + $s;
}

/**
 * A 1-hour slot inside the hours of EVERY store. The messages say "your cart"
 * at checkout and "this order" in Edit Order, as in Postgres.
 */
function check_slot(string $slot, array $storeIds, bool $checkout): void
{
    $valid = preg_match('/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/', $slot, $m)
        && (int) $m[1] < 24 && (int) $m[2] < 60 && (int) $m[3] < 24 && (int) $m[4] < 60;
    if (!$valid) {
        throw new ApiError($checkout ? 'Please choose a preferred delivery time slot.' : 'Please choose a delivery time slot.');
    }
    $start = ((int) $m[1]) * 3600 + ((int) $m[2]) * 60;
    $end = ((int) $m[3]) * 3600 + ((int) $m[4]) * 60;

    $in = implode(',', array_fill(0, count($storeIds), '?'));
    $stores = all("SELECT name, open_time, close_time FROM stores WHERE id IN ({$in}) ORDER BY name", array_values($storeIds));
    $maxOpen = max(array_map(fn ($s) => seconds_of($s['open_time']), $stores));
    $minClose = min(array_map(fn ($s) => seconds_of($s['close_time']), $stores));
    $hours = implode(', ', array_map(fn ($s) => "{$s['name']} (" . time_label($s['open_time']) . ' to ' . time_label($s['close_time']) . ')', $stores));

    if ($minClose - $maxOpen < 3600) {
        throw new ApiError($checkout
            ? "The stores in your cart have no common delivery hours: {$hours}. Please place separate orders."
            : "The stores in this order have no common delivery hours: {$hours}.");
    }
    if ($end - $start !== 3600 || $start < $maxOpen || $end > $minClose || ($start - $maxOpen) % 3600 !== 0) {
        throw new ApiError($checkout
            ? "The selected time slot is outside the store hours of your cart ({$hours}). Please choose another slot."
            : "The time slot is outside the store hours of this order ({$hours}). Please choose another slot.");
    }
}

/** Typed rows for JSON: 0/1 → true/false, DECIMAL strings → numbers. */
function typed(array $rows, array $bools = [], array $money = [], array $ints = []): array
{
    foreach ($rows as &$r) {
        foreach ($bools as $k) {
            $r[$k] = (int) $r[$k] === 1;
        }
        foreach ($money as $k) {
            $r[$k] = $r[$k] === null ? null : num(cents($r[$k]));
        }
        foreach ($ints as $k) {
            $r[$k] = $r[$k] === null ? null : (int) $r[$k];
        }
    }
    return $rows;
}

function order_items_json(string $orderId): array
{
    $items = all(
        'SELECT store_name_snapshot, section_name_snapshot, product_name_snapshot, variant_label_snapshot,
                options_snapshot, unit_price_snapshot, quantity, line_total
           FROM order_items WHERE order_id = ? ORDER BY line_no',
        [$orderId]
    );
    return array_map(fn ($i) => [
        'store_name' => $i['store_name_snapshot'],
        'section_name' => $i['section_name_snapshot'],
        'product_name' => $i['product_name_snapshot'],
        'variant_label' => $i['variant_label_snapshot'],
        'options' => json_decode($i['options_snapshot'], true) ?: [],
        'unit_price' => num(cents($i['unit_price_snapshot'])),
        'quantity' => (int) $i['quantity'],
        'line_total' => num(cents($i['line_total'])),
    ], $items);
}

function add_history(string $orderId, string $status, ?string $note, ?array $admin = null): void
{
    q(
        'INSERT INTO order_status_history (id, order_id, status, note, changed_by, changed_by_email) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), $orderId, $status, $note, $admin['id'] ?? null, $admin['email'] ?? null]
    );
}
