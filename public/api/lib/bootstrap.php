<?php
// Shared by every API file: config, database, errors and small helpers.
declare(strict_types=1);

/** An error the customer or admin should see as is (everything else is logged and hidden). */
final class ApiError extends Exception
{
    public function __construct(string $message, public readonly int $status = 400)
    {
        parent::__construct($message);
    }
}

/**
 * mgl-config.php (database password, keys) is kept OUTSIDE public_html, e.g.
 * domains/mglfoodhub.com/mgl-config.php, so deploys from GitHub never touch it
 * and it is never in the repository. Found by looking in each folder above
 * this one. MGL_API_CONFIG points elsewhere (npm run dev:api, test:api).
 */
function config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $file = getenv('MGL_API_CONFIG') ?: null;
    // From the site's folder as the web server sees it (public_html), and from
    // where this code really is (a deploy may keep it in a versions folder).
    $starts = array_unique(array_filter([(string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), dirname(__DIR__, 2)]));
    foreach ($starts as $dir) {
        for (; !$file && $dir !== dirname($dir); $dir = dirname($dir)) {
            // @: folders above the hosting account are outside open_basedir.
            if (@is_file("{$dir}/mgl-config.php")) {
                $file = "{$dir}/mgl-config.php";
            }
        }
    }
    if (!$file) {
        throw new RuntimeException('mgl-config.php not found above ' . __DIR__);
    }
    return $config = require $file;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $c = config()['db'];
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'] ?? 3306, $c['name']),
        $c['user'],
        $c['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function one(string $sql, array $params = []): ?array
{
    return q($sql, $params)->fetch() ?: null;
}

function all(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function val(string $sql, array $params = []): mixed
{
    $v = q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

/** Runs $fn in a transaction; rolls back on any error. */
function transaction(callable $fn): mixed
{
    db()->beginTransaction();
    try {
        $result = $fn();
        db()->commit();
        return $result;
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
}

/** A named lock held until $fn returns (Postgres used pg_advisory_xact_lock). */
function with_lock(string $name, callable $fn): mixed
{
    $name = 'mgl:' . sha1($name);
    if ((int) val('SELECT GET_LOCK(?, 10)', [$name]) !== 1) {
        throw new ApiError('We are busy right now. Please try again in a moment.', 503);
    }
    try {
        return $fn();
    } finally {
        q('SELECT RELEASE_LOCK(?)', [$name]);
    }
}

function uuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function is_uuid(mixed $v): bool
{
    return is_string($v) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v) === 1;
}

/** Unguessable, URL-safe token (nanoid alphabet). */
function random_token(int $len): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    $out = '';
    foreach (str_split(random_bytes($len)) as $byte) {
        $out .= $alphabet[ord($byte) & 63];
    }
    return $out;
}

/** Human-friendly code: no 0/O/1/I to avoid confusion when read over the phone. */
function random_code(int $len): string
{
    $alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    $out = '';
    foreach (str_split(random_bytes($len)) as $byte) {
        $out .= $alphabet[ord($byte) & 31];
    }
    return $out;
}

// ---------------------------------------------------------------------
// Time: stored in UTC, business rules in Asia/Manila
// ---------------------------------------------------------------------
function manila_now(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
}

/** UTC "Y-m-d H:i:s.v" range of one Manila calendar day, for created_at queries. */
function manila_day_utc(DateTimeImmutable $day): array
{
    $utc = new DateTimeZone('UTC');
    $start = new DateTimeImmutable($day->format('Y-m-d') . ' 00:00:00', new DateTimeZone('Asia/Manila'));
    return [$start->setTimezone($utc)->format('Y-m-d H:i:s.v'), $start->modify('+1 day')->setTimezone($utc)->format('Y-m-d H:i:s.v')];
}

/** Database UTC time → ISO 8601 for the website. */
function iso(?string $utc): ?string
{
    if ($utc === null) {
        return null;
    }
    return (new DateTimeImmutable($utc, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

// ---------------------------------------------------------------------
// Money: whole centavos in PHP, DECIMAL(10,2) in MySQL
// ---------------------------------------------------------------------
function cents(string|int|float|null $v): int
{
    return (int) round(((float) $v) * 100);
}

function dec(int $cents): string
{
    return number_format($cents / 100, 2, '.', '');
}

function num(int $cents): float|int
{
    return $cents % 100 === 0 ? intdiv($cents, 100) : $cents / 100;
}

function peso(int $cents): string
{
    return '₱' . number_format($cents / 100, 2);
}

// ---------------------------------------------------------------------
// Settings and labels
// ---------------------------------------------------------------------
function setting(string $key, mixed $default = null): mixed
{
    $raw = val('SELECT value FROM settings WHERE `key` = ?', [$key]);
    if ($raw === null) {
        return $default;
    }
    $v = json_decode((string) $raw, true);
    return $v ?? $default;
}

function setting_text(string $key, string $default = ''): string
{
    $v = setting($key, $default);
    return is_scalar($v) ? trim((string) $v) : $default;
}

function setting_bool(string $key): bool
{
    $v = setting($key, false);
    return $v === true || $v === 'true';
}

function payment_label(string $method): string
{
    return ['gcash' => 'GCash', 'maribank' => 'MariBank', 'gotyme' => 'GoTyme', 'cod' => 'Cash on Delivery'][$method] ?? $method;
}

/** 09XXXXXXXXX / +639XXXXXXXXX (spaces and dashes allowed) → 09XXXXXXXXX, or null. */
function normalize_ph_phone(mixed $p): ?string
{
    $v = preg_replace('/[\s().-]/', '', is_string($p) ? $p : '');
    if (preg_match('/^09[0-9]{9}$/', $v)) {
        return $v;
    }
    if (preg_match('/^\+639[0-9]{9}$/', $v)) {
        return '0' . substr($v, 3);
    }
    return null;
}

function text_arg(array $args, string $key, int $max): string
{
    $v = $args[$key] ?? '';
    return mb_substr(trim(is_scalar($v) ? (string) $v : ''), 0, $max);
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

/** At most $max events of $kind per $subject in $seconds, or an error. */
function rate_limit(string $kind, string $subject, int $max, int $seconds, string $message = 'Too many attempts. Please wait a few minutes and try again.'): void
{
    $count = (int) val(
        'SELECT COUNT(*) FROM rate_events WHERE kind = ? AND subject = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL ? SECOND',
        [$kind, $subject, $seconds]
    );
    if ($count >= $max) {
        throw new ApiError($message, 429);
    }
    q('INSERT INTO rate_events (kind, subject) VALUES (?, ?)', [$kind, $subject]);
    if (random_int(1, 200) === 1) {
        q('DELETE FROM rate_events WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL 2 DAY');
    }
}

function header_value(string $name): string
{
    return trim((string) ($_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? ''));
}

/** CORS for the origins in config (local development); the live site is same origin. */
function send_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, config()['allowed_origins'] ?? [], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Admin-Token, X-Customer-Token');
        header('Access-Control-Max-Age: 86400');
    }
    header('X-Content-Type-Options: nosniff');
}

function json_reply(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------------
// Payment screenshots (saved by proof.php outside public_html)
// ---------------------------------------------------------------------
const PROOF_PATH_RE = '~^proofs/[A-Za-z0-9_-]{1,64}/[0-9]{10,16}-[0-9a-f]{8}\.(jpg|png|webp)$~';

function proof_file(string $path): string
{
    return rtrim(config()['storage_dir'], '/\\') . '/' . $path;
}

function proof_exists(?string $path): bool
{
    return $path !== null && preg_match(PROOF_PATH_RE, $path) === 1 && is_file(proof_file($path));
}
