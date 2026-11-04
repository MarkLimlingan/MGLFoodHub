<?php
// The website's API: POST /api/rpc.php?fn=<name> with JSON arguments.
// Answers { "data": … } or { "error": "message" }.
// Admin functions (ADMIN_FUNCTIONS in lib/admin.php) check the X-Admin-Token
// header themselves (require_admin).
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/orders.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/public.php';
require __DIR__ . '/lib/admin.php';

const FUNCTIONS = [
    // Customers
    'get_catalog', 'get_checkout_info', 'get_owner_contact', 'place_order', 'get_order_by_token',
    'get_order_summaries', 'find_order', 'request_cancellation', 'resubmit_gcash_proof',
    'google_sign_in', 'customer_session', 'customer_sign_out',
    // Admins
    'admin_sign_in', 'admin_session', 'admin_sign_out', 'create_first_admin', 'admin_change_password',
];

send_cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    json_reply(405, ['error' => 'Method not allowed.']);
}

$fn = (string) ($_GET['fn'] ?? '');
if (!in_array($fn, [...FUNCTIONS, ...ADMIN_FUNCTIONS], true)) {
    json_reply(404, ['error' => 'Unknown function.']);
}

$body = file_get_contents('php://input') ?: '';
$args = $body === '' ? [] : json_decode($body, true);
if (!is_array($args)) {
    json_reply(400, ['error' => 'Invalid request.']);
}

try {
    json_reply(200, ['data' => $fn($args)]);
} catch (ApiError $e) {
    json_reply($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log("MGL API {$fn}: " . $e);
    json_reply(500, ['error' => 'Something went wrong. Please try again.']);
}
