// Tests the Hostinger PHP API (public/api) end to end:
// a throwaway MySQL/MariaDB database with a small test menu, PHP's built-in
// web server, and real HTTP calls. Usage: npm run test:api
// Needs PHP 8.1+ and MySQL/MariaDB. Defaults to XAMPP on Windows; override
// with PHP_BIN, MYSQL_BIN and MYSQL_ARGS (e.g. "-u root -psecret -h 127.0.0.1").
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const PHP = process.env.PHP_BIN || (win ? 'C:\\xampp\\php\\php.exe' : 'php')
const MYSQL = process.env.MYSQL_BIN || (win ? 'C:\\xampp\\mysql\\bin\\mysql.exe' : 'mysql')
const MYSQL_ARGS = (process.env.MYSQL_ARGS || '-u root -h 127.0.0.1').split(' ')
const DB = 'mgl_api_test'
const PORT = 8711
const GOOGLE_PORT = 8712
const API = `http://127.0.0.1:${PORT}/api`
const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const SETUP_KEY = 'test-setup-key-0123456789'

let passed = 0
let failed = 0
const ok = (cond, name) => {
  if (cond) passed++
  else failed++
  console.log(`  ${cond ? '✓' : '✗'} ${name}`)
}

function sql(statements, { database = DB, quiet = false } = {}) {
  const r = spawnSync(MYSQL, [...MYSQL_ARGS, '--default-character-set=utf8mb4', '-N', '-B', ...(database ? [database] : [])], { input: statements, encoding: 'utf8' })
  if (r.status !== 0 && !quiet) throw new Error(`mysql: ${r.stderr || r.error}`)
  return r.stdout.trim()
}

// ---------------------------------------------------------------------
// Setup: database, test menu, config, PHP servers
// ---------------------------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), 'mgl-api-'))
const storage = path.join(tmp, 'proofs')
const uploads = path.join(tmp, 'uploads')
const mail = path.join(tmp, 'mail')
for (const dir of [storage, uploads, mail]) mkdirSync(dir)

sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`, { database: null })
const r0 = spawnSync(MYSQL, [...MYSQL_ARGS, '--default-character-set=utf8mb4', DB], { input: readFileSync(path.join(root, 'hostinger', 'mysql', 'schema.sql'), 'utf8'), encoding: 'utf8' })
if (r0.status !== 0) throw new Error(`schema.sql: ${r0.stderr}`)

// ids: c=category s=store m=section p=product v=variant g=group o=choice
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const I = {
  cat: id('c', 1),
  storeA: id('a', 1), storeB: id('a', 2), storeEarly: id('a', 3), storeClosed: id('a', 4),
  secA: id('d', 1), secB: id('d', 2), secEarly: id('d', 3), secClosed: id('d', 4),
  okoy: id('b', 1), pancit: id('b', 2), pizza: id('b', 3), soldOut: id('b', 4), early: id('b', 5), closedItem: id('b', 6), lechon: id('b', 7),
  vOkoy: id('e', 1), vPancitSmall: id('e', 2), vPancitBig: id('e', 3), vPizza: id('e', 4), vSold: id('e', 5), vEarly: id('e', 6), vClosed: id('e', 7), vLechon: id('e', 8),
  gSauce: id('f', 1), gDrink: id('f', 2),
  oSpicy: id('9', 1), oSweet: id('9', 2), oCoke: id('9', 3), oOther: id('9', 4),
}
sql(`
INSERT INTO hub_categories VALUES ('${I.cat}', 'Restaurants', 'restaurants', 1);
INSERT INTO stores (id, slug, name, hub_category_id, open_time, close_time, is_accepting_orders, sort) VALUES
  ('${I.storeA}', 'okoy', 'Okoy ni Jay R!', '${I.cat}', '12:00', '20:00', 1, 1),
  ('${I.storeB}', 'rody', 'Rody Day''s', '${I.cat}', '12:00', '18:00', 1, 2),
  ('${I.storeEarly}', 'early', 'Early Bird', '${I.cat}', '08:00', '10:00', 1, 3),
  ('${I.storeClosed}', 'closed', 'Closed Kitchen', '${I.cat}', '12:00', '20:00', 0, 4);
INSERT INTO menu_sections (id, store_id, name, sort) VALUES
  ('${I.secA}', '${I.storeA}', 'Okoy', 1), ('${I.secB}', '${I.storeB}', 'Mains', 1),
  ('${I.secEarly}', '${I.storeEarly}', 'Breakfast', 1), ('${I.secClosed}', '${I.storeClosed}', 'All', 1);
INSERT INTO products (id, store_id, section_id, name, is_sold_out, sort) VALUES
  ('${I.okoy}', '${I.storeA}', '${I.secA}', 'Special Okoy', 0, 1),
  ('${I.pancit}', '${I.storeB}', '${I.secB}', 'Pancit', 0, 1),
  ('${I.pizza}', '${I.storeB}', '${I.secB}', 'Pizza', 0, 2),
  ('${I.soldOut}', '${I.storeB}', '${I.secB}', 'Sold Out Lumpia', 1, 3),
  ('${I.early}', '${I.storeEarly}', '${I.secEarly}', 'Tapsilog', 0, 1),
  ('${I.closedItem}', '${I.storeClosed}', '${I.secClosed}', 'Adobo', 0, 1),
  ('${I.lechon}', '${I.storeB}', '${I.secB}', 'Lechon', 0, 4);
INSERT INTO product_variants (id, product_id, label, price, addon_price, is_sold_out, sort) VALUES
  ('${I.vOkoy}', '${I.okoy}', 'Regular', 28.80, NULL, 0, 1),
  ('${I.vPancitSmall}', '${I.pancit}', 'Small', 150.00, NULL, 0, 1),
  ('${I.vPancitBig}', '${I.pancit}', 'Bilao', 650.50, NULL, 0, 2),
  ('${I.vPizza}', '${I.pizza}', 'Regular', 299.00, 45.00, 0, 1),
  ('${I.vSold}', '${I.soldOut}', 'Regular', 50.00, NULL, 0, 1),
  ('${I.vEarly}', '${I.early}', 'Regular', 99.00, NULL, 0, 1),
  ('${I.vClosed}', '${I.closedItem}', 'Regular', 120.00, NULL, 0, 1),
  ('${I.vLechon}', '${I.lechon}', 'Whole', 2500.00, NULL, 0, 1);
INSERT INTO option_groups (id, product_id, name, is_required) VALUES
  ('${I.gSauce}', '${I.pancit}', 'Sauce', 1), ('${I.gDrink}', '${I.pancit}', 'Drink', 0);
INSERT INTO option_choices (id, group_id, label, price_delta, sort) VALUES
  ('${I.oSpicy}', '${I.gSauce}', 'Spicy', 0, 1), ('${I.oSweet}', '${I.gSauce}', 'Sweet', 5.00, 2),
  ('${I.oCoke}', '${I.gDrink}', 'Coke', 25.00, 1);
`)

const php = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const userArg = MYSQL_ARGS.join(' ')
const dbUser = userArg.match(/-u\s*(\S+)/)?.[1] ?? 'root'
const dbPass = userArg.match(/-p(\S+)/)?.[1] ?? ''
const dbHost = userArg.match(/-h\s*(\S+)/)?.[1] ?? '127.0.0.1'
const configFile = path.join(tmp, 'config.php')
writeFileSync(configFile, `<?php
return [
  'db' => ['host' => ${php(dbHost)}, 'port' => 3306, 'name' => ${php(DB)}, 'user' => ${php(dbUser)}, 'password' => ${php(dbPass)}],
  'google_client_id' => ${php(CLIENT_ID)},
  'google_tokeninfo_url' => 'http://127.0.0.1:${GOOGLE_PORT}/tokeninfo.php',
  'setup_key' => ${php(SETUP_KEY)},
  'storage_dir' => ${php(storage)},
  'uploads_dir' => ${php(uploads)},
  'mail_from' => 'MGL Food Hub <orders@mglfoodhub.com>',
  'site_url' => 'https://mglfoodhub.com',
  'mail_transport' => ${php(`file:${mail}`)},
  'index_html' => ${php(path.join(root, 'index.html'))},
  'allowed_origins' => ['http://localhost:5173'],
];
`)

// Stand-in for https://oauth2.googleapis.com/tokeninfo: "good:<sub>:<email>:<nonce>" is a valid token.
const googleDir = path.join(tmp, 'google')
mkdirSync(googleDir)
writeFileSync(path.join(googleDir, 'tokeninfo.php'), `<?php
header('Content-Type: application/json');
$t = explode(':', (string) ($_GET['id_token'] ?? ''));
if (($t[0] ?? '') === 'good' || ($t[0] ?? '') === 'wrongaud') {
  echo json_encode(['aud' => $t[0] === 'good' ? ${php(CLIENT_ID)} : 'someone-else', 'iss' => 'https://accounts.google.com', 'sub' => $t[1],
    'email' => $t[2], 'email_verified' => 'true', 'name' => 'Juan Google', 'picture' => 'https://example.com/p.png', 'exp' => (string) (time() + 3600), 'nonce' => $t[3] ?? '']);
} else { http_response_code(400); echo '{"error":"invalid_token"}'; }
`)

const servers = [
  spawn(PHP, ['-S', `127.0.0.1:${PORT}`, '-t', path.join(root, 'public'), path.join(root, 'scripts', 'dev-router.php')], { env: { ...process.env, MGL_API_CONFIG: configFile }, stdio: ['ignore', 'ignore', 'pipe'] }),
  spawn(PHP, ['-S', `127.0.0.1:${GOOGLE_PORT}`, '-t', googleDir], { stdio: 'ignore' }),
]
let serverLog = ''
servers[0].stderr.on('data', (d) => (serverLog += d))
const cleanup = () => {
  for (const s of servers) s.kill()
  sql(`DROP DATABASE IF EXISTS ${DB};`, { database: null, quiet: true })
  rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)
for (let i = 0; ; i++) {
  const up = await fetch(`${API}/rpc.php?fn=get_owner_contact`, { method: 'POST' }).then(() => true, () => false)
  if (up) break
  if (i > 50) throw new Error('PHP server did not start')
  await new Promise((r) => setTimeout(r, 100))
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function rpc(fn, args = {}, headers = {}) {
  const res = await fetch(`${API}/rpc.php?fn=${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(args) })
  const body = await res.json().catch(() => ({ error: `not JSON (${res.status})` }))
  return { status: res.status, ...body }
}
async function expectError(promise, match, name) {
  const r = await promise
  ok(typeof r.error === 'string' && r.error.includes(match), r.error && !r.error.includes(match) ? `${name} (got: ${r.error})` : r.error ? name : `${name} (expected error, got success)`)
  return r
}
const manila = (days = 0) => {
  const d = new Date(Date.now() + days * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const setSetting = (key, value) => sql(`INSERT INTO settings (\`key\`, value) VALUES ('${key}', '${JSON.stringify(value).replace(/'/g, "''")}') ON DUPLICATE KEY UPDATE value = VALUES(value);`)
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function upload(bytes = PNG, type = 'image/png', device = 'device-a') {
  const form = new FormData()
  form.append('device', device)
  form.append('file', new Blob([bytes], { type }), 'proof.png')
  const res = await fetch(`${API}/proof.php`, { method: 'POST', body: form })
  return { status: res.status, ...(await res.json()) }
}

const day2 = manila(2)
let phoneN = 100
const nextPhone = () => `0917${String(++phoneN).padStart(7, '0')}`
const base = () => ({
  device_id: 'device-a', customer_name: 'Juan Dela Cruz', phone: nextPhone(), email: 'Juan@Gmail.com',
  address: '12 Rizal St.', barangay: 'Niugan', city: 'Malabon', delivery_date: day2, delivery_slot: '12:00-13:00',
  payment_method: 'cod', agree_terms: true, items: [{ variant_id: I.vOkoy, quantity: 2 }],
})
const place = (payload, headers) => rpc('place_order', { payload }, headers)

try {
  // -------------------------------------------------------------------
  console.log('\nRouting')
  ok((await fetch(`${API}/rpc.php?fn=get_catalog`)).status === 405, 'GET is refused (POST only)')
  ok((await rpc('nope')).status === 404, 'unknown function is refused')
  ok((await rpc('admin_session')).data === null, 'no admin token: not signed in')
  const health = (await rpc('health')).data
  ok(health?.config === true && health.database === true && health.tables >= 17 && health.php_ok === true && health.problem === null, `health check (${health?.tables} tables)`)
  ok((await fetch(`${API}/rpc.php?fn=get_owner_contact`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } })).headers.get('access-control-allow-origin') === 'http://localhost:5173', 'CORS allows the local dev site')
  ok((await fetch(`${API}/rpc.php?fn=get_owner_contact`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin') === null, 'CORS refuses other sites')

  // -------------------------------------------------------------------
  console.log('\nMenu and checkout info')
  const cat = (await rpc('get_catalog')).data
  ok(cat.stores.length === 4 && cat.products.length === 7 && cat.product_variants.length === 8 && cat.option_groups.length === 2 && cat.option_choices.length === 3, 'get_catalog returns every table')
  const vOkoy = cat.product_variants.find((v) => v.id === I.vOkoy)
  ok(vOkoy.price === 28.8 && vOkoy.addon_price === null && vOkoy.is_sold_out === false, 'prices are numbers, flags are true/false')
  ok(cat.stores.find((s) => s.id === I.storeClosed).is_accepting_orders === false && cat.stores[0].open_time === '12:00:00', 'store flags and hours')
  ok(cat.products.find((p) => p.id === I.soldOut).is_sold_out === true, 'sold out product')
  setSetting('gcash_number', '0917 555 0000')
  setSetting('gcash_qr_url', '/uploads/store-assets/gcash/qr.png')
  const info = (await rpc('get_checkout_info')).data
  ok(info.today === manila(0) && (info.min_date === manila(1) || info.min_date === manila(2)) && info.max_date === manila(30), 'delivery window in Manila time')
  ok(info.payment_accounts.gcash.number === '0917 555 0000' && info.gcash_qr_url === '/uploads/store-assets/gcash/qr.png', 'payment accounts from settings')
  ok(info.ordering_guidelines.length === 6 && info.require_google_login === false && info.google_client_id === CLIENT_ID, 'guidelines, Google setting and client id')
  ok((await rpc('get_owner_contact')).data.phone === '', 'owner number empty by default')
  setSetting('owner_phone', '0917 555 1234')
  ok((await rpc('get_owner_contact')).data.phone === '0917 555 1234', 'owner number from settings')
  setSetting('owner_phone', 'call me maybe')
  ok((await rpc('get_owner_contact')).data.phone === '', 'a value that is not a phone number is never shown')

  // -------------------------------------------------------------------
  console.log('\nPlace order: COD')
  const r1 = await place({ ...base(), items: [{ variant_id: I.vOkoy, quantity: 2, price: 1 }] })
  ok(/^MGL-\d{6}-[2-9A-HJ-NP-Z]{4}$/.test(r1.data?.order_number ?? '') && /^[A-Za-z0-9_-]{32}$/.test(r1.data?.tracking_token ?? ''), `order placed (${r1.data?.order_number ?? r1.error})`)
  const o1 = (await rpc('get_order_by_token', { p_token: r1.data.tracking_token })).data
  ok(o1.subtotal === 57.6 && o1.total === 57.6 && o1.delivery_fee === 0, 'subtotal comes from menu prices, not the browser')
  ok(o1.payment_status === 'cod_unpaid' && o1.order_status === 'processing' && o1.needs_payment_proof === false, 'COD order starts as processing, unpaid')
  ok(o1.items.length === 1 && o1.items[0].store_name === 'Okoy ni Jay R!' && o1.items[0].unit_price === 28.8 && o1.items[0].line_total === 57.6, 'items keep name and price snapshots')
  ok(o1.history.length === 1 && o1.history[0].note === 'Order received. Our team will call you to confirm.' && /Z$/.test(o1.history[0].created_at), 'history starts with the received note')
  ok(sql(`SELECT email FROM orders WHERE tracking_token = '${r1.data.tracking_token}'`) === 'juan@gmail.com', 'email saved in lower case')
  ok((await rpc('get_order_by_token', { p_token: 'x'.repeat(32) })).data === null && (await rpc('get_order_by_token', { p_token: "' OR 1=1 --" })).data === null, 'unknown or odd tokens find nothing')

  console.log('\nPlace order: options and pricing')
  await expectError(place({ ...base(), items: [{ variant_id: I.vPancitSmall, quantity: 1 }] }), 'Please choose a sauce for Pancit', 'required option group')
  await expectError(place({ ...base(), items: [{ variant_id: I.vPancitSmall, quantity: 1, choice_ids: [I.oSpicy, I.oSweet] }] }), 'Please choose only one sauce for Pancit', 'one choice per group')
  await expectError(place({ ...base(), items: [{ variant_id: I.vPancitSmall, quantity: 1, choice_ids: [I.oOther] }] }), 'Invalid option selected for Pancit', 'unknown option')
  await expectError(place({ ...base(), items: [{ variant_id: I.vOkoy, quantity: 1, choice_ids: [I.oSpicy] }] }), 'Invalid option selected for Special Okoy', 'option of another product')
  await expectError(place({ ...base(), items: [{ variant_id: I.vOkoy, quantity: 1, extra_toppings: true }] }), 'Extra toppings are not available for Special Okoy', 'extra toppings only where offered')
  const r2 = await place({ ...base(), delivery_slot: '13:00-14:00', items: [
    { variant_id: I.vPancitBig, quantity: 1, choice_ids: [I.oSweet, I.oCoke] },
    { variant_id: I.vPizza, quantity: 3, extra_toppings: true },
  ] })
  const o2 = (await rpc('get_order_by_token', { p_token: r2.data?.tracking_token })).data
  ok(o2?.subtotal === 650.5 + 5 + 25 + (299 + 45) * 3 && o2.items[0].options.length === 2, `options and extra toppings priced (${o2?.subtotal ?? r2.error})`)
  ok(JSON.stringify(o2.items[0].options) === JSON.stringify([{ group: 'Drink', choice: 'Coke', price_delta: 25 }, { group: 'Sauce', choice: 'Sweet', price_delta: 5 }]), 'options snapshot sorted by group name')
  ok(o2.items[1].options[0].group === 'Extra Toppings' && o2.items[1].unit_price === 344, 'extra toppings snapshot')

  console.log('\nPlace order: menu and schedule rules')
  await expectError(place({ ...base(), items: [{ variant_id: I.vSold, quantity: 1 }] }), 'Sold Out Lumpia (Regular) from Rody Day\'s is SOLD OUT', 'sold out product')
  sql(`UPDATE product_variants SET is_sold_out = 1 WHERE id = '${I.vOkoy}'`)
  await expectError(place(base()), 'is SOLD OUT', 'sold out size')
  sql(`UPDATE product_variants SET is_sold_out = 0 WHERE id = '${I.vOkoy}'`)
  await expectError(place({ ...base(), items: [{ variant_id: I.vClosed, quantity: 1 }] }), 'Closed Kitchen is temporarily not accepting orders', 'store not accepting orders')
  await expectError(place({ ...base(), items: [{ variant_id: id('e', 99), quantity: 1 }] }), 'no longer available', 'unknown item')
  await expectError(place({ ...base(), items: [{ variant_id: I.vOkoy, quantity: 100 }] }), 'is invalid', 'quantity over 99')
  await expectError(place({ ...base(), items: [{ variant_id: I.vOkoy, quantity: 0 }] }), 'is invalid', 'quantity 0')
  await expectError(place({ ...base(), items: [] }), 'Your cart is empty', 'empty cart')
  await expectError(place({ ...base(), items: Array.from({ length: 61 }, () => ({ variant_id: I.vOkoy, quantity: 1 })) }), 'Too many items', 'more than 60 lines')
  await expectError(place({ ...base(), delivery_slot: '19:00-20:00', items: [{ variant_id: I.vPancitSmall, quantity: 1, choice_ids: [I.oSpicy] }, { variant_id: I.vOkoy, quantity: 1 }] }), "outside the store hours of your cart (Okoy ni Jay R! (12:00 PM to 8:00 PM), Rody Day's (12:00 PM to 6:00 PM))", 'slot must fit every store in the cart')
  await expectError(place({ ...base(), delivery_slot: '12:30-13:30' }), 'outside the store hours', 'slot on the hour from opening')
  await expectError(place({ ...base(), delivery_slot: '12:00-14:00' }), 'outside the store hours', 'slot is one hour')
  await expectError(place({ ...base(), delivery_slot: 'noon' }), 'Please choose a preferred delivery time slot', 'slot format')
  await expectError(place({ ...base(), items: [{ variant_id: I.vEarly, quantity: 1 }, { variant_id: I.vOkoy, quantity: 1 }] }), 'have no common delivery hours', 'stores with no common hours')
  await expectError(place({ ...base(), delivery_date: manila(0) }), 'Same day delivery is not available', 'no same day delivery')
  await expectError(place({ ...base(), delivery_date: manila(31) }), 'Orders can only be scheduled up to', 'not beyond max days')
  await expectError(place({ ...base(), delivery_date: '2026-02-30' }), 'Please choose a delivery date', 'impossible date')
  setSetting('blocked_dates', [manila(3)])
  await expectError(place({ ...base(), delivery_date: manila(3) }), 'we are not accepting deliveries on', 'blocked date')
  setSetting('cutoff_time', '00:00')
  await expectError(place({ ...base(), delivery_date: manila(1) }), 'The cutoff for', 'after the cutoff tomorrow is closed')
  setSetting('cutoff_time', '20:00')

  console.log('\nPlace order: customer details and limits')
  await expectError(place({ ...base(), customer_name: 'J' }), 'Please enter your full name', 'name')
  await expectError(place({ ...base(), phone: '12345' }), 'valid PH mobile number', 'phone')
  await expectError(place({ ...base(), email: 'nope' }), 'valid email address', 'email')
  await expectError(place({ ...base(), barangay: '' }), 'complete your delivery address', 'address')
  await expectError(place({ ...base(), agree_terms: false }), 'tick the delivery fee', 'acknowledgement')
  await expectError(place({ ...base(), website: 'spam.example' }), 'We could not place your order', 'honeypot')
  await expectError(place({ ...base(), payment_method: 'bitcoin' }), 'Please choose a payment method', 'payment method')
  await expectError(place({ ...base(), items: [{ variant_id: I.vLechon, quantity: 1 }], delivery_slot: '12:00-13:00' }), 'Cash on Delivery is only for orders up to ₱2,000', 'COD limit')
  const plus63 = await place({ ...base(), phone: '+63 917 000 0999' })
  ok(sql(`SELECT phone FROM orders WHERE tracking_token = '${plus63.data?.tracking_token}'`) === '09170000999', '+63 number saved as 09…')
  setSetting('max_orders_per_phone_per_day', 2)
  const limited = { ...base(), phone: '09175550001' }
  await place(limited)
  await place(limited)
  await expectError(place(limited), 'reached the limit of 2 orders today', 'daily limit per phone')
  setSetting('max_orders_per_phone_per_day', 5)

  // -------------------------------------------------------------------
  console.log('\nOnline payment and screenshots')
  await expectError(place({ ...base(), payment_method: 'gcash' }), 'Please enter your GCash reference number', 'GCash needs a reference')
  await expectError(place({ ...base(), payment_method: 'gcash', gcash_reference: '1234567890' }), 'Please upload a screenshot of your GCash payment', 'GCash needs a screenshot')
  await expectError(place({ ...base(), payment_method: 'gcash', gcash_reference: '1234567890', gcash_proof_path: 'proofs/device-a/1762230000000-a1b2c3d4.png' }), 'screenshot', 'a screenshot that was never uploaded')
  await expectError(place({ ...base(), payment_method: 'gcash', gcash_reference: '1234567890', gcash_proof_path: '../config.php' }), 'screenshot', 'paths outside the screenshot folder')
  const notImage = await upload(Buffer.from('<?php echo 1;'), 'image/png')
  ok(notImage.status === 415, 'a file that is not an image is refused')
  const up = await upload()
  ok(up.status === 200 && /^proofs\/device-a\/\d+-[0-9a-f]{8}\.png$/.test(up.path ?? ''), 'screenshot uploaded')
  const r3 = await place({ ...base(), payment_method: 'gcash', gcash_reference: '1234 567 890', gcash_proof_path: up.path })
  const o3 = (await rpc('get_order_by_token', { p_token: r3.data?.tracking_token })).data
  ok(o3?.payment_status === 'pending_verification' && o3.gcash_reference === '1234567890', 'GCash order waits for verification')
  ok(o3.history[0].note === 'GCash payment submitted for verification (Ref: 1234567890).', 'GCash history note')
  await expectError(rpc('resubmit_gcash_proof', { p_token: r3.data.tracking_token, p_ref: 'NEW1234', p_path: up.path }), 'not waiting for a new payment proof', 'no second screenshot while one is waiting')
  sql(`UPDATE orders SET payment_status = 'rejected', payment_rejection_reason = 'Blurry' WHERE tracking_token = '${r3.data.tracking_token}'`)
  ok((await rpc('get_order_by_token', { p_token: r3.data.tracking_token })).data.needs_payment_proof === true, 'rejected payment asks for a new screenshot')
  const up2 = await upload(PNG, 'image/png', 'device-a')
  await expectError(rpc('resubmit_gcash_proof', { p_token: r3.data.tracking_token, p_ref: '!!', p_path: up2.path }), 'reference number', 'resubmit needs a reference')
  const re = await rpc('resubmit_gcash_proof', { p_token: r3.data.tracking_token, p_ref: 'gc 999 888', p_path: up2.path })
  const o3b = (await rpc('get_order_by_token', { p_token: r3.data.tracking_token })).data
  ok(re.data === true && o3b.payment_status === 'pending_verification' && o3b.gcash_reference === 'GC999888' && o3b.payment_rejection_reason === null, 'new screenshot sent')
  ok(o3b.history.at(-1).status === 'proof_resubmitted', 'resubmit is in the history')
  await expectError(rpc('resubmit_gcash_proof', { p_token: r1.data.tracking_token, p_ref: 'ABC1234', p_path: up2.path }), 'not waiting', 'COD orders have no screenshot')
  const proofUrl = `${API}/proof.php?path=${encodeURIComponent(up.path)}`
  ok((await fetch(proofUrl)).status === 401, 'screenshots are hidden without admin sign in')

  // -------------------------------------------------------------------
  console.log('\nTracking, my orders, find order, cancel')
  const sums = (await rpc('get_order_summaries', { p_tokens: [r1.data.tracking_token, r3.data.tracking_token, 'bogus'] })).data
  ok(sums.length === 2 && sums.every((s) => typeof s.total === 'number' && /Z$/.test(s.created_at)), 'my orders summaries')
  ok((await rpc('find_order', { p_order_number: r1.data.order_number.toLowerCase(), p_phone: o1.phone })).data === r1.data.tracking_token, 'find order by number + phone')
  ok((await rpc('find_order', { p_order_number: r1.data.order_number, p_phone: '09999999999' })).data === null, 'wrong phone finds nothing')
  await expectError(rpc('request_cancellation', { p_token: r1.data.tracking_token, p_reason: '  ' }), 'tell us why', 'cancel needs a reason')
  ok((await rpc('request_cancellation', { p_token: r1.data.tracking_token, p_reason: 'Changed my mind' })).data === true, 'cancellation requested')
  const o1b = (await rpc('get_order_by_token', { p_token: r1.data.tracking_token })).data
  ok(o1b.cancel_requested === true && o1b.history.at(-1).status === 'cancel_requested', 'request recorded')
  await expectError(rpc('request_cancellation', { p_token: r1.data.tracking_token, p_reason: 'again' }), 'already requested', 'only one request')
  await expectError(rpc('request_cancellation', { p_token: 'missing', p_reason: 'x' }), 'Order not found', 'unknown order')

  // -------------------------------------------------------------------
  console.log('\nGoogle sign in')
  setSetting('require_google_login', true)
  await expectError(place(base()), 'Please sign in with Google', 'Google required at checkout')
  await expectError(rpc('google_sign_in', { credential: 'wrongaud:123:a@gmail.com:n0', nonce: 'n0' }), 'Google sign in did not work', 'token for another app is refused')
  await expectError(rpc('google_sign_in', { credential: 'garbage' }), 'Google sign in did not work', 'invalid token is refused')
  await expectError(rpc('google_sign_in', { credential: 'good:g-111:Maria@Gmail.com:n1', nonce: 'other' }), 'Google sign in did not work', 'token made for another sign in (nonce) is refused')
  await expectError(rpc('google_sign_in', { credential: 'good:g-111:Maria@Gmail.com:n1' }), 'Google sign in did not work', 'a nonce is required')
  const g = (await rpc('google_sign_in', { credential: 'good:g-111:Maria@Gmail.com:n1', nonce: 'n1' })).data
  ok(g?.token?.length === 48 && g.email === 'maria@gmail.com' && g.name === 'Juan Google', 'signed in with Google')
  const asMaria = { 'X-Customer-Token': g.token }
  ok((await rpc('customer_session', {}, asMaria)).data?.email === 'maria@gmail.com', 'session remembers the Google account')
  const r4 = await place(base(), asMaria)
  ok(sql(`SELECT CONCAT(google_sub, '|', google_email, '|', verified_with) FROM orders WHERE tracking_token = '${r4.data?.tracking_token}'`) === 'g-111|maria@gmail.com|google', 'order saves the Google account')
  setSetting('max_orders_per_phone_per_day', 2)
  await place(base(), asMaria)
  await expectError(place(base(), asMaria), 'This account has reached the limit of 2 orders today', 'daily limit per Google account, even with new phone numbers')
  setSetting('max_orders_per_phone_per_day', 5)
  await rpc('customer_sign_out', {}, asMaria)
  ok((await rpc('customer_session', {}, asMaria)).data === null, 'signed out')
  await expectError(place(base(), asMaria), 'Please sign in with Google', 'old token no longer works')
  setSetting('require_google_login', false)

  // -------------------------------------------------------------------
  console.log('\nAdmin sign in')
  await expectError(rpc('admin_sign_in', { email: 'admin@mgl.ph', password: 'whatever123' }), 'Incorrect email or password', 'no admins yet')
  await expectError(rpc('create_first_admin', { setup_key: 'wrong', email: 'admin@mgl.ph', password: 'correct horse battery' }), 'Not authorized', 'setup key required')
  await expectError(rpc('create_first_admin', { setup_key: SETUP_KEY, email: 'admin@mgl.ph', password: 'short' }), 'at least 10 characters', 'strong password required')
  const first = (await rpc('create_first_admin', { setup_key: SETUP_KEY, email: 'Admin@MGL.ph', password: 'correct horse battery' })).data
  ok(first?.token && first.email === 'admin@mgl.ph', 'first admin created and signed in')
  await expectError(rpc('create_first_admin', { setup_key: SETUP_KEY, email: 'second@mgl.ph', password: 'correct horse battery' }), 'already exists', 'setup only works once')
  ok(!sql('SELECT password_hash FROM admin_users').includes('correct horse'), 'password is stored hashed')
  await expectError(rpc('admin_sign_in', { email: 'admin@mgl.ph', password: 'wrong password' }), 'Incorrect email or password', 'wrong password')
  const signIn = (await rpc('admin_sign_in', { email: 'ADMIN@mgl.ph', password: 'correct horse battery' })).data
  const asAdmin = { 'X-Admin-Token': signIn.token }
  ok((await rpc('admin_session', {}, asAdmin)).data?.email === 'admin@mgl.ph', 'admin session')
  ok(sql(`SELECT COUNT(*) FROM admin_sessions WHERE token_hash = '${signIn.token}'`) === '0', 'only a hash of the token is stored')
  const img = await fetch(proofUrl, { headers: asAdmin })
  ok(img.status === 200 && img.headers.get('content-type') === 'image/png' && Buffer.from(await img.arrayBuffer()).equals(PNG), 'admins can view screenshots')
  ok((await fetch(`${API}/proof.php?path=${encodeURIComponent('proofs/x/../../config.php')}`, { headers: asAdmin })).status === 404, 'no paths outside the screenshot folder')

  // -------------------------------------------------------------------
  console.log('\nAdmin: orders list, details and actions')
  const A = (fn, args = {}) => rpc(fn, args, asAdmin)
  const idOf = (token) => sql(`SELECT id FROM orders WHERE tracking_token = '${token}'`)
  const detail = async (orderId) => (await A('admin_order_detail', { id: orderId })).data
  ok((await rpc('admin_orders', {})).status === 401, 'admin functions need an admin sign in')
  ok((await rpc('admin_orders', {}, { 'X-Customer-Token': 'x'.repeat(48) })).status === 401, '…a customer sign in is not enough')
  const totalOrders = Number(sql('SELECT COUNT(*) FROM orders'))
  const list = (await A('admin_orders', { filters: {}, page: 0 })).data
  ok(list.total === totalOrders && list.rows.length === Math.min(30, totalOrders) && Array.isArray(list.rows[0].order_items), `orders list (${list.total})`)
  ok(typeof list.rows[0].subtotal === 'number' && typeof list.rows[0].cancel_requested === 'boolean' && /Z$/.test(list.rows[0].created_at), 'orders list types')
  const online = (await A('admin_orders', { filters: { method: 'online' } })).data
  ok(online.total >= 1 && online.rows.every((o) => o.payment_method !== 'cod'), 'filter: online payments')
  const byStore = (await A('admin_orders', { filters: { store: I.storeB } })).data
  ok(byStore.total >= 1 && byStore.rows.every((o) => o.order_items.length && o.order_items.every((i) => i.store_id === I.storeB)), 'filter: store')
  const found = (await A('admin_orders', { filters: { q: r1.data.order_number.slice(-6).toLowerCase() } })).data
  ok(found.rows.some((o) => o.order_number === r1.data.order_number), 'search by order number')
  ok((await A('admin_orders', { filters: { q: "%' OR 1=1 --" } })).data.total === 0, 'search text is never run as SQL')
  ok((await A('admin_orders', { filters: { status: 'cancel_requested' } })).data.rows.some((o) => o.order_number === r1.data.order_number), 'filter: cancellation requests')
  const exported = (await A('admin_orders_export', { filters: { store: I.storeB } })).data
  ok(exported.length === byStore.total && Array.isArray(exported[0].order_items[0].options_snapshot), 'CSV export rows')

  const id3 = idOf(r3.data.tracking_token)
  const d3 = await detail(id3)
  ok(d3.order.order_number === r3.data.order_number && d3.items.length === 1 && d3.history.length === 2 && d3.history[0].status === 'proof_resubmitted' && d3.account === null, 'order details (newest history first)')
  const dMaria = await detail(idOf(r4.data.tracking_token))
  ok(dMaria.account?.total === 2 && dMaria.account.cancelled === 0 && dMaria.order.customer_user_id === 'g-111', 'Google account order count')
  ok((await A('admin_order_detail', { id: id('0', 9) })).data === null, 'unknown order')

  await expectError(A('admin_order_action', { p_order_id: id3, p_action: 'preparing' }), 'Only confirmed orders can be marked as Preparing', 'status steps go in order')
  await expectError(A('admin_order_action', { p_order_id: id3, p_action: 'reject_payment' }), 'A reason is required to reject', 'rejecting needs a reason')
  await A('admin_order_action', { p_order_id: id3, p_action: 'confirm' })
  const d3b = await detail(id3)
  ok(d3b.order.payment_status === 'paid' && d3b.order.order_status === 'confirmed' && d3b.history[0].status === 'payment_confirmed'
    && d3b.history[0].note === 'GCash payment verified. Your order is confirmed.' && d3b.history[0].changed_by_email === 'admin@mgl.ph', 'confirm verifies the online payment')
  for (const step of ['preparing', 'out_for_delivery', 'delivered']) await A('admin_order_action', { p_order_id: id3, p_action: step })
  ok((await detail(id3)).order.order_status === 'delivered', 'preparing → out for delivery → delivered')
  await expectError(A('admin_order_action', { p_order_id: id3, p_action: 'cancel', p_note: 'x' }), 'can no longer be cancelled', 'delivered orders cannot be cancelled')
  const idCod = idOf(plus63.data.tracking_token)
  for (const step of ['confirm', 'preparing', 'out_for_delivery', 'delivered']) await A('admin_order_action', { p_order_id: idCod, p_action: step })
  const dCod = await detail(idCod)
  ok(dCod.order.payment_status === 'paid' && dCod.history.at(-2).note === 'Your order has been confirmed by phone.', 'COD: confirmed by phone, paid when delivered')
  const id2 = idOf(r2.data.tracking_token)
  await A('admin_order_action', { p_order_id: id2, p_action: 'set_delivery_fee', p_amount: 85.5 })
  const d2 = await detail(id2)
  ok(d2.order.delivery_fee === 85.5 && d2.order.total === 1712.5 + 85.5 && d2.history[0].note === 'Delivery fee set to ₱85.50.', 'delivery fee')
  await expectError(A('admin_order_action', { p_order_id: id2, p_action: 'set_delivery_fee', p_amount: -1 }), 'valid delivery fee', 'negative fee')
  await expectError(A('admin_order_action', { p_order_id: id2, p_action: 'bogus' }), 'Unknown action', 'unknown action')
  const id1 = idOf(r1.data.tracking_token)
  await A('admin_order_action', { p_order_id: id1, p_action: 'decline_cancel_request' })
  const t1 = (await rpc('get_order_by_token', { p_token: r1.data.tracking_token })).data
  ok(t1.cancel_requested === false && t1.history.at(-1).status === 'cancel_request_declined', 'decline a cancellation request (the customer sees it)')
  await expectError(A('admin_order_action', { p_order_id: id1, p_action: 'cancel' }), 'A reason is required to cancel', 'cancelling needs a reason')
  await A('admin_save_notes', { id: id1, admin_notes: 'Call the guard house' })
  ok((await detail(id1)).order.admin_notes === 'Call the guard house', 'admin notes')
  await expectError(A('admin_add_call_log', { order_id: id1, result: 'maybe' }), 'how the call went', 'call result checked')
  await A('admin_add_call_log', { order_id: id1, result: 'no_answer', note: 'Ring ring' })
  const calls = (await detail(id1)).calls
  ok(calls.length === 1 && calls[0].result === 'no_answer' && calls[0].created_by_email === 'admin@mgl.ph', 'call log')

  // -------------------------------------------------------------------
  console.log('\nAdmin: Edit Order')
  const rE = await place({ ...base(), delivery_slot: '13:00-14:00', items: [{ variant_id: I.vPancitSmall, quantity: 2, choice_ids: [I.oSweet] }] })
  const idE = idOf(rE.data.tracking_token)
  let dE = await detail(idE)
  const edit = (changes, expected = dE.order.updated_at) => A('admin_edit_order', { p_order_id: idE, p_changes: changes, p_expected_updated_at: expected })
  const line = dE.items[0]
  await expectError(edit({ customer_name: 'Maria S.' }, '2020-01-01T00:00:00.000Z'), 'was updated while you were editing', 'a stale editor is refused')
  await expectError(edit({}), 'There are no changes to save', 'nothing to save')
  const e1 = await edit({ customer_name: 'Maria S.', items: [{ id: line.id, quantity: 3 }, { variant_id: I.vPizza, quantity: 1, extra_toppings: true }] })
  dE = await detail(idE)
  ok(e1.data?.subtotal === 155 * 3 + 344 && dE.order.subtotal === 809 && dE.items.length === 2 && dE.items[0].id === line.id, `items edited and repriced (${e1.data?.subtotal ?? e1.error})`)
  const ch = dE.edits[0].changes
  ok(ch.some((c) => c.field === 'item' && c.from === '2× Pancit (Small) · Sweet' && c.to === '3× Pancit (Small) · Sweet')
    && ch.some((c) => c.field === 'item' && c.from === null && c.to === '1× Pizza · Extra toppings')
    && ch.some((c) => c.field === 'customer_name' && c.to === 'Maria S.') && ch.some((c) => c.field === 'subtotal' && c.from === '310.00' && c.to === '809.00')
    && dE.edits[0].edited_by_email === 'admin@mgl.ph', 'edit history')
  ok(dE.history[0].status === 'order_updated', 'the customer is told the order changed')
  await edit({ items: [{ id: line.id, variant_id: I.vPancitBig, quantity: 1 }] })
  dE = await detail(idE)
  ok(dE.items.length === 1 && dE.items[0].variant_label_snapshot === 'Bilao' && dE.items[0].unit_price_snapshot === 655.5 && dE.items[0].options_snapshot[0].choice === 'Sweet', 'a new size keeps the options')
  await expectError(edit({ items: [{ id: line.id, variant_id: I.vOkoy, quantity: 1 }] }), 'Please choose a size of Pancit', 'the size must be of the same product')
  await expectError(edit({ items: [{ variant_id: I.vLechon, quantity: 1 }] }), 'Cash on Delivery is only for orders up to ₱2,000, and this change makes the food subtotal ₱2,500.00', 'COD limit on edit')
  await expectError(edit({ items: [] }), 'needs at least one item', 'cannot remove every item')
  await expectError(edit({ delivery_date: manila(0) }), 'Same day delivery is not available', 'no same day delivery on edit')
  await expectError(edit({ delivery_slot: '19:00-20:00' }), "outside the store hours of this order (Rody Day's (12:00 PM to 6:00 PM))", 'slot checked on edit')
  await edit({ payment_method: 'gcash' })
  ok((await rpc('get_order_by_token', { p_token: rE.data.tracking_token })).data.needs_payment_proof === true, 'switched to GCash: the tracking page asks for a screenshot')
  dE = await detail(idE)
  await edit({ delivery_fee: 60 })
  dE = await detail(idE)
  ok(dE.order.total === 655.5 + 60 && dE.history.some((h) => h.status === 'delivery_fee_updated' && h.note === 'Delivery fee set to ₱60.00.'), 'delivery fee on edit')
  await A('admin_order_action', { p_order_id: idE, p_action: 'confirm' })
  dE = await detail(idE)
  await edit({ items: [{ id: line.id, quantity: 2 }] })
  dE = await detail(idE)
  ok(dE.order.paid_amount === 655.5 && dE.order.subtotal === 1311, 'paid order: what was paid is kept (balance due)')
  ok((await rpc('get_order_by_token', { p_token: rE.data.tracking_token })).data.amount_paid === 655.5, 'the customer sees the amount paid')
  await A('admin_settle_balance', { p_order_id: idE })
  dE = await detail(idE)
  ok(dE.order.paid_amount === 1311 && dE.edits[0].changes[0].field === 'paid_amount', 'balance settled')
  await expectError(A('admin_settle_balance', { p_order_id: idE }), 'no balance to settle', 'nothing left to settle')
  await expectError(edit({ payment_method: 'cod' }), 'only be changed before the order is confirmed and paid', 'payment method locked once paid')
  for (const step of ['preparing', 'out_for_delivery']) await A('admin_order_action', { p_order_id: idE, p_action: step })
  dE = await detail(idE)
  await expectError(edit({ delivery_date: manila(5) }), 'already out for delivery, so the delivery schedule', 'schedule locked once out for delivery')
  await expectError(edit({ items: [{ id: line.id, quantity: 1 }] }), 'so its items can no longer be changed', 'items locked once out for delivery')
  ok((await edit({ customer_name: 'Maria Santos' })).data?.changes === 1, 'details can still be fixed')
  await A('admin_order_action', { p_order_id: idE, p_action: 'cancel', p_note: 'Test' })
  dE = await detail(idE)
  await expectError(edit({ customer_name: 'Maria Cruz' }), 'Cancelled orders cannot be edited', 'cancelled orders are locked')

  // -------------------------------------------------------------------
  console.log('\nAdmin: menu, photos and settings')
  ok((await A('admin_update_product', { id: I.okoy, values: { is_sold_out: true, badge: 'best_seller', sort: 5 } })).data === true, 'product updated')
  let cat2 = (await rpc('get_catalog')).data
  const okoyP = cat2.products.find((p) => p.id === I.okoy)
  ok(okoyP.is_sold_out === true && okoyP.badge === 'best_seller' && okoyP.sort === 5, 'customers see the change')
  await A('admin_update_product', { id: I.okoy, values: { is_sold_out: false } })
  await expectError(A('admin_update_product', { id: I.okoy, values: { name: 'Hacked' } }), 'name cannot be changed here', 'only the allowed fields change')
  await expectError(A('admin_update_variant', { id: I.vOkoy, values: { price: 1 } }), 'price cannot be changed here', 'prices cannot be changed')
  await expectError(A('admin_update_product', { id: I.okoy, values: { image_url: 'javascript:alert(1)' } }), 'Invalid value for image_url', 'photo links are checked')
  await expectError(A('admin_update_product', { id: I.okoy, values: { badge: 'hot' } }), 'Invalid value for badge', 'badges are checked')
  await A('admin_update_variant', { id: I.vOkoy, values: { is_sold_out: true } })
  await A('admin_update_store', { id: I.storeA, values: { is_accepting_orders: false, cover_image_url: '/uploads/store-assets/okoy/cover.jpg' } })
  cat2 = (await rpc('get_catalog')).data
  const storeA = cat2.stores.find((s) => s.id === I.storeA)
  ok(cat2.product_variants.find((v) => v.id === I.vOkoy).is_sold_out === true && storeA.is_accepting_orders === false && storeA.cover_image_url === '/uploads/store-assets/okoy/cover.jpg', 'size and store availability, cover photo')
  await A('admin_update_variant', { id: I.vOkoy, values: { is_sold_out: false } })
  await A('admin_update_store', { id: I.storeA, values: { is_accepting_orders: true } })
  ok((await rpc('admin_update_product', { id: I.okoy, values: { is_sold_out: true } })).status === 401, 'customers cannot change the menu')

  const photo = new FormData()
  photo.append('kind', 'product-images')
  photo.append('folder', I.okoy)
  photo.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png')
  const photoRes = await fetch(`${API}/upload.php`, { method: 'POST', body: photo, headers: asAdmin })
  const photoUrl = (await photoRes.json()).url ?? ''
  ok(photoRes.status === 200 && /^\/uploads\/product-images\/[0-9a-f-]+\/\d+-[0-9a-f]{6}\.png$/.test(photoUrl) && existsSync(path.join(uploads, ...photoUrl.split('/').slice(2))), 'admin photo upload')
  ok((await fetch(`${API}/upload.php`, { method: 'POST', body: photo })).status === 401, 'only admins upload photos')
  const served = await fetch(`http://127.0.0.1:${PORT}${photoUrl}`)
  ok(served.status === 200 && served.headers.get('content-type') === 'image/png' && /immutable/.test(served.headers.get('cache-control') ?? '') && Buffer.from(await served.arrayBuffer()).equals(PNG), 'the uploaded photo is shown at its /uploads address')
  ok((await fetch(`http://127.0.0.1:${PORT}/uploads/product-images/x/..%2F..%2Fconfig.png`)).status === 404, 'no photo paths outside the uploads folder')

  const settings = (await A('admin_get_settings')).data
  ok(settings.find((s) => s.key === 'max_days_ahead').value === 30 && Array.isArray(settings.find((s) => s.key === 'ordering_guidelines').value), 'settings keep their types')
  await A('admin_save_settings', { rows: [{ key: 'cutoff_time', value: '18:30' }, { key: 'blocked_dates', value: ['2026-12-25'] }, { key: 'owner_phone', value: '' }, { key: 'gcash_qr_url', value: '/uploads/store-assets/gcash/qr-2.png' }] })
  const info2 = (await rpc('get_checkout_info')).data
  ok(info2.cutoff_time === '18:30' && info2.blocked_dates[0] === '2026-12-25' && info2.gcash_qr_url === '/uploads/store-assets/gcash/qr-2.png', 'settings saved and used at checkout')
  await expectError(A('admin_save_settings', { rows: [{ key: 'cutoff_time', value: '25:00' }] }), 'Please check the value of cutoff_time', 'settings are checked')
  await expectError(A('admin_save_settings', { rows: [{ key: 'is_admin', value: true }] }), 'Unknown setting', 'unknown settings are refused')
  await expectError(A('admin_save_settings', { rows: [{ key: 'gcash_qr_url', value: 'javascript:alert(1)' }] }), 'Please check the value of gcash_qr_url', 'QR links are checked')
  ok((await rpc('admin_get_settings')).status === 401, 'customers cannot read the settings')
  await A('admin_save_settings', { rows: [{ key: 'cutoff_time', value: '20:00' }] })

  // -------------------------------------------------------------------
  console.log('\nAdmin: dashboard, prep list, reports, live updates, email')
  const prep = (await A('admin_prep_list', { date: day2 })).data
  ok(prep.length > 0 && prep.every((r) => r.orders.delivery_date === day2 && r.orders.order_status !== 'cancelled') && Array.isArray(prep[0].options_snapshot), 'prep list for a delivery date')
  const rep = (await A('admin_report', { from: manila(0), to: manila(40), scope: 'active' })).data
  ok(rep.length === Number(sql("SELECT COUNT(*) FROM orders WHERE order_status <> 'cancelled'")) && Array.isArray(rep[0].order_items) && typeof rep[0].subtotal === 'number', 'report')
  const delivered = (await A('admin_report', { from: manila(0), to: manila(40), scope: 'delivered' })).data
  ok(delivered.length === 2 && delivered.every((r) => r.order_status === 'delivered'), 'report: delivered only')
  await expectError(A('admin_report', { from: 'yesterday', to: manila(1) }), 'valid date', 'report dates are checked')
  ok((await A('admin_calendar', { from: manila(0), to: manila(40) })).data.length === rep.length, 'calendar')
  const dash = (await A('admin_dashboard')).data
  ok(dash.newToday === Number(sql('SELECT COUNT(*) FROM orders')) && dash.recent.length === 8 && typeof dash.revenueMonth === 'number'
    && dash.gcashToVerify === Number(sql("SELECT COUNT(*) FROM orders WHERE payment_method <> 'cod' AND payment_status = 'pending_verification' AND order_status = 'processing'")), 'dashboard')

  const p0 = (await A('admin_poll')).data
  ok(typeof p0.since === 'string' && p0.changed === false, 'live updates: first check')
  const rLive = await place(base())
  await rpc('request_cancellation', { p_token: rLive.data.tracking_token, p_reason: 'Wrong address' })
  const p1 = (await A('admin_poll', { since: p0.since })).data
  ok(p1.changed && p1.new_orders.some((o) => o.order_number === rLive.data.order_number && typeof o.subtotal === 'number')
    && p1.events.some((e) => e.status === 'cancel_requested' && e.note === 'Wrong address'), 'live updates: new order and cancellation request')
  ok((await A('admin_poll', { since: new Date(Date.now() + 60000).toISOString() })).data.changed === false, 'live updates: nothing new')

  setSetting('email_notifications_enabled', true)
  const rMail = await place({ ...base(), email: 'buyer@example.com' })
  const eml = path.join(mail, `${rMail.data.order_number}.eml`)
  const emlText = existsSync(eml) ? readFileSync(eml, 'utf8') : ''
  ok(emlText.includes('To: buyer@example.com') && emlText.includes(`https://mglfoodhub.com/track/${rMail.data.tracking_token}`) && emlText.includes('2× Special Okoy') && emlText.includes('₱57.60'), 'confirmation email with the tracking link')
  ok(sql(`SELECT email_sent_at IS NOT NULL FROM orders WHERE tracking_token = '${rMail.data.tracking_token}'`) === '1', 'the email is marked as sent')
  setSetting('email_notifications_enabled', false)
  const rNoMail = await place(base())
  ok(!existsSync(path.join(mail, `${rNoMail.data.order_number}.eml`)), 'no email when turned off')
  await expectError(rpc('admin_change_password', { current_password: 'nope', new_password: 'another long password' }, asAdmin), 'current password is incorrect', 'change password checks the current one')
  ok((await rpc('admin_change_password', { current_password: 'correct horse battery', new_password: 'another long password' }, asAdmin)).data === true, 'password changed')
  ok((await rpc('admin_session', {}, { 'X-Admin-Token': first.token })).data === null, 'changing the password signs out other devices')
  ok((await rpc('admin_session', {}, asAdmin)).data !== null, '…but keeps this one')
  await rpc('admin_sign_out', {}, asAdmin)
  ok((await rpc('admin_session', {}, asAdmin)).data === null, 'signed out')
  for (let i = 0; i < 8; i++) await rpc('admin_sign_in', { email: 'admin@mgl.ph', password: `guess ${i}` })
  await expectError(rpc('admin_sign_in', { email: 'admin@mgl.ph', password: 'another long password' }), 'Too many sign in attempts', 'password guessing is slowed down')

  // -------------------------------------------------------------------
  console.log('\nSEO and answer engines')
  const SITE = `http://127.0.0.1:${PORT}`
  const page = async (p) => {
    const r = await fetch(SITE + p)
    const html = await r.text()
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
    return {
      status: r.status,
      html,
      title: html.match(/<title>(.*?)<\/title>/)?.[1],
      robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1],
      canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
      graph: ld ? JSON.parse(ld)['@graph'] : [],
      noscript: html.match(/<noscript>(.*?)<\/noscript>/s)?.[1] ?? '',
    }
  }
  const home = await page('/')
  ok(home.status === 200 && home.title === 'MGL Food Hub · Malabon Food Delivery, 4 Merchants in One Cart' && home.canonical === 'https://mglfoodhub.com/', 'home page: title and canonical')
  ok(home.graph.some((x) => x['@type'] === 'Organization') && home.graph.some((x) => x['@type'] === 'WebSite') && home.html.includes('property="og:image" content="https://mglfoodhub.com/og-image.jpg"'), 'home page: organization, website and link preview image')
  ok(home.html.includes('/src/main.tsx') && home.noscript.includes('Okoy ni Jay R!'), 'home page: the app still loads, and crawlers get the merchants as text')
  const storePage = await page('/store/okoy')
  const food = storePage.graph.find((x) => x['@type'] === 'FoodEstablishment')
  const okoyItem = food?.hasMenu.hasMenuSection[0].hasMenuItem[0]
  ok(storePage.title === 'Okoy ni Jay R! Menu and Prices · MGL Food Hub' && okoyItem?.name === 'Special Okoy' && okoyItem.offers.price === '28.80' && okoyItem.offers.priceCurrency === 'PHP', 'store page: menu with prices in structured data')
  ok(storePage.noscript.includes('Special Okoy') && storePage.noscript.includes('₱28.80') && storePage.graph.some((x) => x['@type'] === 'BreadcrumbList'), 'store page: menu as text, breadcrumbs')
  sql(`UPDATE products SET is_sold_out = 1 WHERE id = '${I.okoy}'`)
  ok((await page('/store/okoy')).graph.find((x) => x['@type'] === 'FoodEstablishment').hasMenu.hasMenuSection[0].hasMenuItem[0].offers.availability === 'https://schema.org/SoldOut', 'sold out shows as SoldOut')
  sql(`UPDATE products SET is_sold_out = 0 WHERE id = '${I.okoy}'`)
  sql(`UPDATE stores SET tagline = '</script><script>alert(1)</script> "quoted"' WHERE id = '${I.storeB}'`)
  const evil = await page('/store/rody')
  ok(!evil.html.includes('<script>alert(1)') && evil.graph.find((x) => x['@type'] === 'FoodEstablishment').description.startsWith('</script>'), 'store text can never break out of the page (escaped)')
  sql(`UPDATE stores SET tagline = NULL WHERE id = '${I.storeB}'`)
  const faqPage = await page('/faq')
  const faqLd = faqPage.graph.find((x) => x['@type'] === 'FAQPage')
  ok(faqLd?.mainEntity.length >= 10 && faqLd.mainEntity.some((q) => q.acceptedAnswer.text.includes('Cash on Delivery for orders up to ₱2,000,')), 'FAQ page: FAQPage structured data from the settings')
  const faqApi = (await rpc('get_faq')).data
  ok(faqApi.length === faqLd.mainEntity.length && faqApi[0].q === faqLd.mainEntity[0].name, 'the visible FAQ and the structured data are the same')
  ok(!/[–—]/.test(JSON.stringify(faqApi)), 'FAQ copy has no en or em dashes')
  for (const p of ['/checkout', '/cart', '/track/abc', '/my-orders']) {
    const r = await page(p)
    ok(r.status === 200 && r.robots === 'noindex, nofollow' && r.graph.length === 0, `${p}: kept out of search results`)
  }
  for (const p of ['/store/nope', '/mgl-hub-admin-portal', '/admin/orders', '/no-such-page']) {
    const r = await page(p)
    ok(r.status === 404 && r.robots === 'noindex, nofollow' && r.html.includes('/src/main.tsx'), `${p}: 404 for search engines, the app still loads`)
  }
  const sitemap = await fetch(`${SITE}/sitemap.xml`)
  const sitemapXml = await sitemap.text()
  ok(sitemap.headers.get('content-type')?.startsWith('application/xml') && sitemapXml.includes('<loc>https://mglfoodhub.com/store/okoy</loc>') && sitemapXml.includes('<loc>https://mglfoodhub.com/faq</loc>') && !sitemapXml.includes('checkout'), 'sitemap.xml lists public pages and every store')
  const llms = await (await fetch(`${SITE}/llms.txt`)).text()
  const llmsFull = await (await fetch(`${SITE}/llms-full.txt`)).text()
  ok(llms.startsWith('# MGL Food Hub') && llms.includes('[Okoy ni Jay R!](https://mglfoodhub.com/store/okoy)') && llms.includes('### How can I pay?'), 'llms.txt: merchants and FAQ for AI assistants')
  ok(llmsFull.includes('- Special Okoy: ₱28.80') && llmsFull.includes('- Pancit: Small ₱150.00, Bilao ₱650.50'), 'llms-full.txt: every menu with prices')

  // -------------------------------------------------------------------
  console.log('\nData checks')
  ok(sql('SELECT COUNT(*) FROM orders o WHERE o.total <> o.subtotal + o.delivery_fee OR o.subtotal <> (SELECT SUM(line_total) FROM order_items i WHERE i.order_id = o.id)') === '0', 'every order: subtotal = sum of items and total = subtotal + delivery fee')
} catch (e) {
  failed++
  console.error(e)
}

if (serverLog.match(/PHP (Fatal|Warning|Notice|Deprecated)/)) {
  failed++
  console.log('\nPHP reported problems:\n' + serverLog.split('\n').filter((l) => /PHP (Fatal|Warning|Notice|Deprecated)|MGL API/.test(l)).join('\n'))
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
