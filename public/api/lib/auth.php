<?php
// Admin sign in (email + password) and customer Google sign in.
// Both hand out a random token; only its SHA-256 is stored.
declare(strict_types=1);

const ADMIN_SESSION_DAYS = 14;
const CUSTOMER_SESSION_DAYS = 30;

function new_session_token(): array
{
    $token = random_token(48);
    return [$token, hash('sha256', $token)];
}

function session_expiry(int $days): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify("+{$days} days")->format('Y-m-d H:i:s.v');
}

// ---------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------
function current_admin(): ?array
{
    static $admin = false;
    if ($admin !== false) {
        return $admin;
    }
    $token = header_value('X-Admin-Token');
    $admin = $token === '' ? null : one(
        'SELECT a.id, a.email FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id
          WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)',
        [hash('sha256', $token)]
    );
    return $admin;
}

function require_admin(): array
{
    return current_admin() ?? throw new ApiError('Not authorized.', 401);
}

function admin_sign_in(array $args): array
{
    $email = mb_strtolower(text_arg($args, 'email', 191));
    $password = is_string($args['password'] ?? null) ? $args['password'] : '';
    $limited = 'Too many sign in attempts. Please wait 15 minutes and try again.';
    rate_limit('admin_login_ip', client_ip(), 10, 900, $limited);
    rate_limit('admin_login_email', $email, 10, 900, $limited);

    $admin = one('SELECT id, email, password_hash FROM admin_users WHERE email = ?', [$email]);
    // Checked even for an unknown email, so the answer takes the same time.
    $ok = password_verify($password, $admin['password_hash'] ?? '$2y$10$0kQJMo3nCIcxwiXTf/aFM.Tb9oZC4Xo4i.7Jbz0GtIXTWpcrESB2.');
    if (!$admin || !$ok) {
        throw new ApiError('Incorrect email or password.', 401);
    }
    if (password_needs_rehash($admin['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE admin_users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $admin['id']]);
    }
    [$token, $hash] = new_session_token();
    q('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)', [$hash, $admin['id'], session_expiry(ADMIN_SESSION_DAYS)]);
    q('UPDATE admin_users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [$admin['id']]);
    q('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
    return ['token' => $token, 'email' => $admin['email']];
}

function admin_session(array $args): ?array
{
    $admin = current_admin();
    return $admin ? ['email' => $admin['email']] : null;
}

function admin_sign_out(array $args): bool
{
    $token = header_value('X-Admin-Token');
    if ($token !== '') {
        q('DELETE FROM admin_sessions WHERE token_hash = ?', [hash('sha256', $token)]);
    }
    return true;
}

function check_new_password(string $password): void
{
    if (mb_strlen($password) < 10) {
        throw new ApiError('Please use a password of at least 10 characters.');
    }
}

/** Creates the first admin. Only works while there are none, and only with the setup key from config.php. */
function create_first_admin(array $args): array
{
    rate_limit('admin_setup_ip', client_ip(), 5, 900);
    $key = (string) (config()['setup_key'] ?? '');
    if ($key === '' || !hash_equals($key, is_string($args['setup_key'] ?? null) ? $args['setup_key'] : '')) {
        throw new ApiError('Not authorized.', 401);
    }
    if ((int) val('SELECT COUNT(*) FROM admin_users') > 0) {
        throw new ApiError('An admin already exists. Sign in instead.');
    }
    $email = mb_strtolower(text_arg($args, 'email', 191));
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/', $email)) {
        throw new ApiError('Please enter a valid email address.');
    }
    $password = is_string($args['password'] ?? null) ? $args['password'] : '';
    check_new_password($password);
    q('INSERT INTO admin_users (id, email, password_hash) VALUES (?, ?, ?)', [uuid(), $email, password_hash($password, PASSWORD_DEFAULT)]);
    return admin_sign_in(['email' => $email, 'password' => $password]);
}

function admin_change_password(array $args): bool
{
    $admin = require_admin();
    $current = is_string($args['current_password'] ?? null) ? $args['current_password'] : '';
    $new = is_string($args['new_password'] ?? null) ? $args['new_password'] : '';
    rate_limit('admin_password_ip', client_ip(), 10, 900);
    $hash = (string) val('SELECT password_hash FROM admin_users WHERE id = ?', [$admin['id']]);
    if (!password_verify($current, $hash)) {
        throw new ApiError('Your current password is incorrect.');
    }
    check_new_password($new);
    q('UPDATE admin_users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $admin['id']]);
    // Signs out every other device.
    q('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?', [$admin['id'], hash('sha256', header_value('X-Admin-Token'))]);
    return true;
}

// ---------------------------------------------------------------------
// Customers: Google sign in
// ---------------------------------------------------------------------
function current_customer(): ?array
{
    static $customer = false;
    if ($customer !== false) {
        return $customer;
    }
    $token = header_value('X-Customer-Token');
    $customer = $token === '' ? null : one(
        'SELECT google_sub, google_name, google_email, google_picture FROM customer_sessions
          WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)',
        [hash('sha256', $token)]
    );
    return $customer;
}

function http_get_json(string $url): ?array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = is_string($body) ? json_decode($body, true) : null;
    return $status === 200 && is_array($data) ? $data : null;
}

/**
 * The ID token Google sent back to checkout, checked with Google. The nonce is
 * the one-time value the browser sent to Google, so a token can't be reused.
 */
function google_sign_in(array $args): array
{
    rate_limit('google_login_ip', client_ip(), 30, 3600);
    $credential = is_string($args['credential'] ?? null) ? $args['credential'] : '';
    $nonce = is_string($args['nonce'] ?? null) ? $args['nonce'] : '';
    $clientId = (string) (config()['google_client_id'] ?? '');
    if ($clientId === '') {
        throw new ApiError('Google sign in is not set up yet.', 503);
    }
    $url = (config()['google_tokeninfo_url'] ?? 'https://oauth2.googleapis.com/tokeninfo') . '?id_token=' . rawurlencode($credential);
    $info = $credential === '' ? null : http_get_json($url);
    $valid = $info
        && ($info['aud'] ?? '') === $clientId
        && in_array($info['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        && (int) ($info['exp'] ?? 0) > time()
        && ($info['sub'] ?? '') !== ''
        && $nonce !== '' && hash_equals($nonce, (string) ($info['nonce'] ?? ''))
        && in_array($info['email_verified'] ?? false, [true, 'true'], true);
    if (!$valid) {
        throw new ApiError('Google sign in did not work. Please try again.', 401);
    }

    $profile = [
        'google_sub' => mb_substr((string) $info['sub'], 0, 191),
        'google_name' => mb_substr(trim((string) ($info['name'] ?? '')), 0, 191) ?: null,
        'google_email' => mb_substr(mb_strtolower(trim((string) ($info['email'] ?? ''))), 0, 191) ?: null,
        'google_picture' => mb_substr(trim((string) ($info['picture'] ?? '')), 0, 1000) ?: null,
    ];
    [$token, $hash] = new_session_token();
    q(
        'INSERT INTO customer_sessions (token_hash, google_sub, google_name, google_email, google_picture, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [$hash, ...array_values($profile), session_expiry(CUSTOMER_SESSION_DAYS)]
    );
    if (random_int(1, 50) === 1) {
        q('DELETE FROM customer_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
    }
    return ['token' => $token, 'name' => $profile['google_name'], 'email' => $profile['google_email'], 'picture' => $profile['google_picture']];
}

function customer_session(array $args): ?array
{
    $c = current_customer();
    return $c ? ['name' => $c['google_name'], 'email' => $c['google_email'], 'picture' => $c['google_picture']] : null;
}

function customer_sign_out(array $args): bool
{
    $token = header_value('X-Customer-Token');
    if ($token !== '') {
        q('DELETE FROM customer_sessions WHERE token_hash = ?', [hash('sha256', $token)]);
    }
    return true;
}
