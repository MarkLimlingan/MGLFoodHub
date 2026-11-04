<?php
// Order confirmation email (with the tracking link), sent right after checkout
// when Admin → Settings → Email notifications is on. Uses Hostinger's PHP
// mail(); mail_from in config.php must be a mailbox on the domain.
declare(strict_types=1);

function esc(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function slot_label(string $slot): string
{
    return implode(' to ', array_map(fn ($t) => time_label($t), explode('-', $slot)));
}

function order_email_html(array $o, array $items, string $link): string
{
    $rows = '';
    foreach ($items as $i) {
        $opts = array_merge(
            $i['variant_label_snapshot'] !== 'Regular' ? [$i['variant_label_snapshot']] : [],
            array_map(fn ($x) => "{$x['group']}: {$x['choice']}", json_decode($i['options_snapshot'], true) ?: [])
        );
        $opts = implode(' · ', $opts);
        $rows .= '<tr><td style="padding:6px 0;border-bottom:1px solid #f1e6da"><strong>' . (int) $i['quantity'] . '× ' . esc($i['product_name_snapshot']) . '</strong><br>'
            . '<span style="color:#6b7280;font-size:13px">' . esc($i['store_name_snapshot']) . ($opts !== '' ? ' · ' . esc($opts) : '') . '</span></td>'
            . '<td style="padding:6px 0;border-bottom:1px solid #f1e6da;text-align:right;white-space:nowrap">' . peso(cents($i['line_total'])) . '</td></tr>';
    }
    $date = (new DateTimeImmutable($o['delivery_date']))->format('l, F j, Y');
    $link = esc($link);
    return '<!doctype html><html><body style="margin:0;background:#FFF9F3;font-family:Inter,Arial,sans-serif;color:#0D2B4E">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-family:Poppins,Arial,sans-serif;font-size:22px;margin:0 0 4px">Thank you, ' . esc($o['customer_name']) . '!</h1>
  <p style="margin:0 0 16px;color:#4b5563">We received your order <strong>' . esc($o['order_number']) . '</strong>.</p>
  <div style="background:#fff3e0;border:2px solid #F7941D;border-radius:12px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 8px;font-weight:700">⚠️ SAVE THIS ORDER LINK. This is the only way to check your order status.</p>
    <a href="' . $link . '" style="display:inline-block;background:linear-gradient(135deg,#F7941D,#E2382B);background-color:#F7941D;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">Track my order</a>
    <p style="margin:8px 0 0;font-size:12px;word-break:break-all;color:#6b7280">' . $link . '</p>
  </div>
  <p style="margin:0 0 4px"><strong>Delivery:</strong> ' . esc($date) . ', ' . esc(slot_label($o['delivery_slot'])) . '</p>
  <p style="margin:0 0 16px"><strong>Payment:</strong> ' . esc(payment_label($o['payment_method'])) . '</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">' . $rows . '
    <tr><td style="padding:8px 0;font-weight:700">Food subtotal</td><td style="padding:8px 0;text-align:right;font-weight:700">' . peso(cents($o['subtotal'])) . '</td></tr>
  </table>
  <p style="font-size:12px;color:#6b7280;margin-top:16px">Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries).</p>
</div></body></html>';
}

/** Sends the confirmation once. Never throws: the order is already placed. */
function send_order_email(string $orderId): void
{
    try {
        $from = trim((string) (config()['mail_from'] ?? ''));
        if (!setting_bool('email_notifications_enabled') || $from === '') {
            return;
        }
        $o = one('SELECT * FROM orders WHERE id = ? AND email_sent_at IS NULL', [$orderId]);
        if (!$o) {
            return;
        }
        $items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no', [$orderId]);
        $site = rtrim((string) (config()['site_url'] ?? ''), '/');
        $html = order_email_html($o, $items, "{$site}/track/{$o['tracking_token']}");
        $subject = "Your MGL Food Hub order {$o['order_number']}";

        $transport = (string) (config()['mail_transport'] ?? 'mail');
        if (str_starts_with($transport, 'file:')) {
            // For tests: write the email to a folder instead of sending it.
            file_put_contents(substr($transport, 5) . "/{$o['order_number']}.eml", "To: {$o['email']}\nFrom: {$from}\nSubject: {$subject}\n\n{$html}");
            $sent = true;
        } else {
            preg_match('/<([^>]+)>/', $from, $m);
            $envelope = $m[1] ?? $from;
            $headers = implode("\r\n", [
                "From: {$from}",
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
            ]);
            $sent = mail($o['email'], mb_encode_mimeheader($subject, 'UTF-8'), $html, $headers, '-f' . $envelope);
        }
        if ($sent) {
            q('UPDATE orders SET email_sent_at = UTC_TIMESTAMP(3) WHERE id = ?', [$orderId]);
        } else {
            error_log("MGL email: could not send the confirmation for {$o['order_number']}");
        }
    } catch (Throwable $e) {
        error_log('MGL email: ' . $e);
    }
}
