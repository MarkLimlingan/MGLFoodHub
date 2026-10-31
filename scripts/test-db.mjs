// Runs every migration against an in-process Postgres (PGlite) with small
// stand-ins for Supabase's auth / storage / realtime schemas, then exercises
// the security rules and RPCs. Usage: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMenu, uid } from './generate-seed.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create schema realtime;
create table realtime.sent (payload jsonb, event text, topic text, private boolean, at timestamptz default now());
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent values (payload, event, topic, private) $$;
create publication supabase_realtime;
`

let passed = 0
let failed = 0
const ok = (cond, name) => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}
async function expectError(pg, sql, params, match, name) {
  try {
    await pg.query(sql, params)
    ok(false, `${name} (expected error, got success)`)
  } catch (e) {
    const hit = match ? new RegExp(match, 'i').test(e.message) : true
    if (!hit) console.log(`      got: ${e.message}`)
    ok(hit, name)
  }
}

process.on('unhandledRejection', (e) => {
  console.error('\nUNEXPECTED ERROR:', e.message)
  process.exit(1)
})
const pg = new PGlite({ extensions: { pgcrypto } })
await pg.exec(SUPABASE_STUBS)

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await pg.exec(readFileSync(path.join(migrationsDir, file), 'utf8'))
    console.log(`applied ${file}`)
  } catch (e) {
    console.error(`FAILED ${file}: ${e.message}`)
    process.exit(1)
  }
}
// Running everything twice proves the migrations are re-runnable.
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(path.join(migrationsDir, file), 'utf8'))
}
console.log('re-applied all migrations (idempotent)')

const asRole = async (role, sub = null, email = null, claims = {}) => {
  await pg.exec(`reset role;`)
  await pg.query(`select set_config('request.jwt.claims', $1, false)`, [
    sub ? JSON.stringify({ sub, email, role, ...claims }) : '',
  ])
  await pg.exec(`set role ${role};`)
}
// A customer signed in with Google, as Supabase Auth puts it in the access token.
const asGoogle = (sub, name, email) =>
  asRole('authenticated', sub, email, {
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: name, email, avatar_url: 'https://lh3.googleusercontent.com/a/photo', iss: 'https://accounts.google.com' },
  })
// The same for Facebook.
const asFacebook = (sub, name, email) =>
  asRole('authenticated', sub, email, {
    app_metadata: { provider: 'facebook', providers: ['facebook'] },
    user_metadata: { full_name: name, name, email, avatar_url: 'https://platform-lookaside.fbsbx.com/platform/profilepic/?asid=1' },
  })
const asSuper = () => pg.exec('reset role;')

// ---------------------------------------------------------------------
console.log('\nSeeded prices')
const stores = parseMenu()
const variants = (await pg.query('select id, price::text, addon_price::text from product_variants')).rows
const byId = new Map(variants.map((v) => [v.id, v]))
let mismatches = 0
let expected = 0
stores.forEach((s) =>
  s.sections.forEach((sec, ci) =>
    sec.products.forEach((p, pi) =>
      p.variants.forEach((v, vi) => {
        expected++
        const row = byId.get(uid(`variant:${s.slug}:${ci}:${pi}:${vi}`))
        if (!row || row.price !== v.price.toFixed(2) || (row.addon_price ?? null) !== (v.addon === null ? null : v.addon.toFixed(2))) {
          mismatches++
          console.log('      mismatch', s.slug, p.name, v.label)
        }
      }),
    ),
  ),
)
ok(mismatches === 0 && variants.length === expected, `all ${expected} variant prices match the menu data`)
const productsWithoutVariant = (await pg.query(
  'select count(*)::int n from products p where not exists (select 1 from product_variants v where v.product_id = p.id)',
)).rows[0].n
ok(productsWithoutVariant === 0, 'every product has at least one variant')
const spot = async (store, product, label) =>
  (await pg.query(
    `select v.price::text from product_variants v join products p on p.id = v.product_id join stores s on s.id = p.store_id
     where s.slug = $1 and p.name = $2 and v.label = $3`, [store, product, label])).rows.map((r) => r.price)
ok((await spot('hazels-special-puto', 'Mix', '12pcs'))[0] === '417.60', "Hazel's Mix 12pcs = 417.60")
ok((await spot('original-benjie-puto-pao', 'Puto', 'Regular'))[0] === '28.80', 'Benjie Puto = 28.80')
ok((await spot('aurings-special-pancit-malabon', 'Pancit Malabon Bilao', 'For 30 persons'))[0] === '3600.00', "Auring's 30 persons = 3600.00")
ok((await spot('raves-diner', 'Beef Belly', '1kg'))[0] === '2340.00', 'Raves Beef Belly 1kg = 2340.00')

const photos = (await pg.query(`select s.slug, p.name, p.image_url from products p join stores s on s.id = p.store_id where p.image_url is not null order by 1, 2`)).rows
ok(photos.length === 16 && photos.every((r) => existsSync(path.join(root, 'public', r.image_url))), '16 products have menu photos (9 of them Wet Foods) and every photo file exists')
// A photo the admin uploads must survive re-running the setup.
await pg.query(`update products set image_url = '/admin-upload.jpg' where image_url = '/products/hazels-puto.jpg'`)
await pg.exec(readFileSync(path.join(migrationsDir, '20261007000300_seed_menu.sql'), 'utf8'))
ok((await pg.query(`select count(*)::int n from products where image_url = '/admin-upload.jpg'`)).rows[0].n === 1, "re-running the seed keeps the admin's uploaded photo")
await pg.query(`update products set image_url = '/products/hazels-puto.jpg' where image_url = '/admin-upload.jpg'`)

// ---------------------------------------------------------------------
console.log('\nPrice lock')
await expectError(pg, `update product_variants set price = price + 1 where id = (select id from product_variants limit 1)`, [], 'Prices are fixed', 'superuser cannot change a variant price')
await expectError(pg, `update product_variants set addon_price = 1 where addon_price is not null and id = (select id from product_variants where addon_price is not null limit 1)`, [], 'Prices are fixed', 'superuser cannot change an addon price')
await expectError(pg, `update option_choices set price_delta = 5 where id = (select id from option_choices limit 1)`, [], 'Prices are fixed', 'superuser cannot change an option price')

// ---------------------------------------------------------------------
console.log('\nAnonymous access')
await asRole('anon')
ok((await pg.query('select count(*)::int n from products')).rows[0].n === 423, 'anon can read products')
await expectError(pg, 'select * from orders', [], 'permission denied', 'anon cannot select orders')
await expectError(pg, `insert into orders (order_number) values ('x')`, [], 'permission denied', 'anon cannot insert orders')
await expectError(pg, 'select * from settings', [], 'permission denied', 'anon cannot read settings table')
await expectError(pg, 'update products set is_sold_out = true', [], 'permission denied', 'anon cannot update products')
await expectError(pg, `select admin_order_action(gen_random_uuid(), 'confirm')`, [], 'permission denied', 'anon cannot call admin_order_action')
const info = (await pg.query('select get_checkout_info() as i')).rows[0].i
ok(['gcash', 'maribank', 'gotyme'].every((m) => info.payment_accounts?.[m] && 'number' in info.payment_accounts[m]), 'checkout info lists GCash, MariBank and GoTyme accounts')
ok(info.ordering_guidelines.some((g) => g.includes('MariBank') && g.includes('GoTyme')), 'guidelines mention MariBank and GoTyme')
const storeOrder = (await pg.query('select slug from stores order by sort')).rows.map((r) => r.slug)
ok(storeOrder[0] === 'sisig-ni-mutik' && storeOrder[1] === 'judy-anns-crispy-pata', 'Sisig ni Mutik first, Judy Ann\'s Crispy Pata second')
ok(storeOrder.at(-2) === 'aling-melys-carinderia' && storeOrder.at(-1) === 'raves-diner', 'Aling Mely\'s and Raves Diner last')
const dashText = (await pg.query(`select count(*)::int n from (select tagline t from stores union all select name from products) x where t ~ '[–—]'`)).rows[0].n
ok(dashText === 0, 'no dashes in store taglines or product names')
ok(Array.isArray(info.ordering_guidelines) && info.ordering_guidelines.length === 6, 'checkout info includes the 6 ordering guidelines')
ok(info.ordering_guidelines[0].includes('12:00 PM to 8:00 PM'), 'guidelines say deliveries run 12:00 PM to 8:00 PM')
ok(info.min_date > info.today, `checkout min date (${info.min_date}) is after today (${info.today})`)

const variantOf = async (store, product, label = 'Regular') =>
  (await pg.query(
    `select v.id from product_variants v join products p on p.id = v.product_id join stores s on s.id = p.store_id
     where s.slug = $1 and p.name = $2 and v.label = $3`, [store, product, label])).rows[0].id
const choiceOf = async (store, product, choice) =>
  (await pg.query(
    `select c.id from option_choices c join option_groups g on g.id = c.group_id join products p on p.id = g.product_id
     join stores s on s.id = p.store_id where s.slug = $1 and p.name = $2 and c.label = $3`, [store, product, choice])).rows[0].id

const base = {
  device_id: 'device-a',
  customer_name: 'Juan Dela Cruz',
  phone: '09171234567',
  email: 'juan@gmail.com',
  address: '12 Rizal St.',
  barangay: 'Niugan',
  city: 'Malabon',
  delivery_date: info.min_date,
  delivery_slot: '12:00-13:00', // every store delivers 12:00 PM to 8:00 PM
  payment_method: 'cod',
  agree_terms: true,
}
const place = (payload) => pg.query('select place_order($1::jsonb) as r', [JSON.stringify(payload)])

console.log('\nplace_order')
const okoy = await variantOf('okoy-ni-jay-r', 'Special Okoy')
const r1 = (await place({ ...base, items: [{ variant_id: okoy, quantity: 2, unit_price: 1, price: 1 }] })).rows[0].r
ok(/^MGL-\d{6}-[2-9A-HJ-NP-Z]{4}$/.test(r1.order_number), `order number format (${r1.order_number})`)
ok(/^[A-Za-z0-9_-]{32}$/.test(r1.tracking_token), 'tracking token is 32 url-safe chars')
const o1 = (await pg.query('select get_order_by_token($1) as o', [r1.tracking_token])).rows[0].o
ok(Number(o1.subtotal) === 240, 'server recomputed subtotal (2 × ₱120) ignoring client price')
ok(!('admin_notes' in o1) && !('email' in o1) && !('device_id' in o1), 'tracking payload hides admin notes / email / device id')
ok(o1.order_status === 'processing' && o1.payment_status === 'cod_unpaid', 'COD order starts as processing / cod_unpaid')
ok(o1.history.length === 1 && o1.history[0].status === 'processing', 'first status history row created')
await asSuper()
const social = (await pg.query('select social_media from orders where order_number = $1', [r1.order_number])).rows[0].social_media
ok(social === null, 'orders are placed without a social media account')
await asRole('anon')
ok((await pg.query('select get_order_by_token($1) as o', ['x'.repeat(32)])).rows[0].o === null, 'unknown token returns nothing')

const r2 = (await place({ ...base, device_id: 'device-b', customer_name: 'Maria', phone: '+639181112222', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
ok(r2.tracking_token !== r1.tracking_token && r2.order_number !== r1.order_number, 'two simultaneous customers get separate orders')

await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_date: info.today, items: [{ variant_id: okoy, quantity: 1 }] })], 'Same day', 'today is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_date: '2099-01-01', items: [{ variant_id: okoy, quantity: 1 }] })], 'up to', 'date beyond max days is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_slot: '11:00-12:00', items: [{ variant_id: okoy, quantity: 1 }] })], 'outside the store hours', 'slot before 12 noon is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '12345', items: [{ variant_id: okoy, quantity: 1 }] })], 'valid PH mobile', 'bad phone rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, email: 'nope', items: [{ variant_id: okoy, quantity: 1 }] })], 'valid email', 'bad email rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, website: 'spam', items: [{ variant_id: okoy, quantity: 1 }] })], 'could not place', 'honeypot rejects bots')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, agree_terms: false, items: [{ variant_id: okoy, quantity: 1 }] })], 'acknowledgement', 'acknowledgement checkbox required')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, items: [] })], 'empty', 'empty cart rejected')

// Every store delivers 12:00 PM to 8:00 PM, so any mix of stores shares the same 8 slots.
const hours = (await pg.query(`select count(*)::int n from stores where open_time = '12:00' and close_time = '20:00'`)).rows[0].n
ok(hours === 14, 'all 14 stores deliver 12:00 PM to 8:00 PM')

// Wet Foods: its own category and store, right after Restaurants / Rody Day's, every price as the client supplied it.
const wet = (await pg.query(`select s.sort, s.menu_image_url, c.slug as cat, c.sort as cat_sort from stores s join hub_categories c on c.id = s.hub_category_id where s.slug = 'wet-foods'`)).rows[0]
const restaurantsSort = (await pg.query(`select sort from hub_categories where slug = 'restaurants'`)).rows[0].sort
const rodySort = (await pg.query(`select sort from stores where slug = 'rody-days'`)).rows[0].sort
ok(wet && wet.cat === 'wet-foods' && wet.cat_sort === restaurantsSort + 1 && wet.sort === rodySort + 1, 'Wet Foods is its own category after Restaurants, listed right after Rody Day\'s')
ok(wet.menu_image_url === null, 'Wet Foods has no menu photo, so the store page hides "View original menu"')
const wetPrices = (await pg.query(
  `select p.name || ' / ' || v.label || ' = ' || v.price as line from product_variants v join products p on p.id = v.product_id
   join stores s on s.id = p.store_id join menu_sections m on m.id = p.section_id where s.slug = 'wet-foods' order by m.sort, p.sort, v.sort`)).rows.map((r) => r.line)
ok(JSON.stringify(wetPrices) === JSON.stringify([
  'Fresh Shrimp (Suahe) / Small (24 grams) = 750.00', 'Fresh Shrimp (Suahe) / Medium (31 grams) = 800.00', 'Fresh Shrimp (Suahe) / Large (45 grams) = 850.00',
  'Salmon Belly / 500g = 320.00', 'Salmon Head / Per kilo = 250.00',
  'Tilapia / Large = 250.00', 'Tilapia / Medium = 230.00',
  'Tulingan / Regular = 310.00', 'Alumahan / Regular = 550.00', 'Hasa / Small = 600.00', 'Hasa / Big = 650.00', 'Bisugong Dilat / Regular = 700.00',
  'Dagupan Bangus / 1 to 1.2 kg = 400.00', 'Dagupan Bangus / 400g, 3 pcs = 440.00', 'Dagupan Bangus / 300g, 4 pcs = 450.00',
]), 'Wet Foods has all 15 options at the client\'s prices')
const shrimpLarge = await variantOf('wet-foods', 'Fresh Shrimp (Suahe)', 'Large (45 grams)')
const bangus4 = await variantOf('wet-foods', 'Dagupan Bangus', '300g, 4 pcs')
const rw = (await place({ ...base, phone: '09170000050', items: [{ variant_id: shrimpLarge, quantity: 1 }, { variant_id: bangus4, quantity: 1 }, { variant_id: okoy, quantity: 1 }] })).rows[0].r
await asSuper()
const wetOrder = (await pg.query(`select o.subtotal, json_agg(i.store_name_snapshot || ': ' || i.product_name_snapshot || ' (' || i.variant_label_snapshot || ') x' || i.quantity || ' = ' || i.line_total order by i.line_no) as lines from orders o join order_items i on i.order_id = o.id where o.order_number = $1 group by o.subtotal`, [rw.order_number])).rows[0]
const okoyPrice = Number((await pg.query('select price from product_variants where id = $1', [okoy])).rows[0].price)
ok(Number(wetOrder.subtotal) === 850 + 450 + okoyPrice && wetOrder.lines[0] === 'Wet Foods: Fresh Shrimp (Suahe) (Large (45 grams)) x1 = 850.00' && wetOrder.lines[1] === 'Wet Foods: Dagupan Bangus (300g, 4 pcs) x1 = 450.00', 'Wet Foods order with another store keeps each size, price and store')
await asRole('anon')
const hazel = await variantOf('hazels-special-puto', 'Puto Pao', '10pcs')
const raves = await variantOf('raves-diner', 'Classic')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000001', delivery_slot: '20:00-21:00', items: [{ variant_id: hazel, quantity: 1 }, { variant_id: raves, quantity: 1 }] })], 'outside the store hours', "Hazel's + Raves rejects a slot after 8 PM")
const r3 = (await place({ ...base, phone: '09170000001', delivery_slot: '19:00-20:00', items: [{ variant_id: hazel, quantity: 1 }, { variant_id: raves, quantity: 1 }] })).rows[0].r
ok(!!r3.order_number, "Hazel's + Raves accepts the last slot, 7 to 8 PM")

// Required option + extra toppings
const peachy = await variantOf('anny-dading-peachy-peachy', 'Peachy-Peachy', 'Small 10 pcs')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000002', delivery_slot: '12:00-13:00', items: [{ variant_id: peachy, quantity: 1 }] })], 'choose a topping', 'required option enforced')
const cheese = await choiceOf('anny-dading-peachy-peachy', 'Peachy-Peachy', 'Cheese')
const benjieYema = await choiceOf('original-benjie-puto-pao', 'Flavored Puto Pao', 'Yema')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000002', delivery_slot: '12:00-13:00', items: [{ variant_id: peachy, quantity: 1, choice_ids: [benjieYema] }] })], 'Invalid option', "another product's option is rejected")
const r4 = (await place({ ...base, phone: '09170000002', delivery_slot: '12:00-13:00', items: [{ variant_id: peachy, quantity: 1, choice_ids: [cheese], extra_toppings: true }] })).rows[0].r
const o4 = (await pg.query('select get_order_by_token($1) as o', [r4.tracking_token])).rows[0].o
ok(Number(o4.subtotal) === 168, 'Peachy Small 10 pcs + extra toppings = ₱168.00')
ok(o4.items[0].options.length === 2, 'options snapshot stores topping + extra toppings')

// Anti-spam: 5 per phone per day
for (let i = 0; i < 4; i++) await place({ ...base, phone: '09175550000', items: [{ variant_id: okoy, quantity: 1 }] })
await place({ ...base, phone: '09175550000', items: [{ variant_id: okoy, quantity: 1 }] })
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '0917-555-0000', items: [{ variant_id: okoy, quantity: 1 }] })], 'limit of 5', '6th order from the same phone in a day is blocked')

// find_order / cancellation
ok((await pg.query('select find_order($1, $2) t', [r1.order_number.toLowerCase(), '0917 123 4567'])).rows[0].t === r1.tracking_token, 'find_order matches number + phone')
ok((await pg.query('select find_order($1, $2) t', [r1.order_number, '09999999999'])).rows[0].t === null, 'find_order with wrong phone returns nothing')
await pg.query('select request_cancellation($1, $2)', [r2.tracking_token, 'Changed my mind'])
const o2 = (await pg.query('select get_order_by_token($1) as o', [r2.tracking_token])).rows[0].o
ok(o2.cancel_requested === true && o2.history.at(-1).status === 'cancel_requested', 'cancellation request recorded')

// GCash: proof upload (insert-only) + order
console.log('\nGCash + storage')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-a/proof1.png')`)
ok(true, 'anon can upload a payment proof')
ok((await pg.query(`select count(*)::int n from storage.objects`)).rows[0].n === 0, 'anon cannot read payment proofs back')
await expectError(pg, `insert into storage.objects (bucket_id, name) values ('product-images', 'x.png')`, [], 'row-level security', 'anon cannot upload product images')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000003', payment_method: 'gcash', gcash_reference: '1234567890', gcash_proof_path: 'proofs/device-a/missing.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'screenshot', 'GCash requires an uploaded proof')
const r5 = (await place({ ...base, phone: '09170000003', payment_method: 'gcash', gcash_reference: '1234 567 890', gcash_proof_path: 'proofs/device-a/proof1.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const o5 = (await pg.query('select get_order_by_token($1) as o', [r5.tracking_token])).rows[0].o
ok(o5.payment_status === 'pending_verification' && o5.gcash_reference === '1234567890', 'GCash order starts as pending_verification')

// Cash on Delivery: orders up to ₱2,000 only (Special Okoy is ₱120)
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000010', items: [{ variant_id: okoy, quantity: 17 }] })], 'up to ₱2,000', 'COD over ₱2,000 is rejected (17 × ₱120 = ₱2,040)')
const rCod = (await place({ ...base, phone: '09170000010', items: [{ variant_id: okoy, quantity: 16 }] })).rows[0].r
ok(!!rCod.order_number, 'COD up to ₱2,000 is accepted (16 × ₱120 = ₱1,920)')
const rBig = (await place({ ...base, phone: '09170000010', payment_method: 'gcash', gcash_reference: '1234 567 890', gcash_proof_path: 'proofs/device-a/proof1.png', items: [{ variant_id: okoy, quantity: 17 }] })).rows[0].r
ok(!!rBig.order_number, 'GCash over ₱2,000 is accepted')
ok(info.ordering_guidelines.some((g) => g.includes('COD') && g.includes('₱2,000')), 'guidelines say COD is for orders up to ₱2,000')

// ---------------------------------------------------------------------
console.log('\nAdmin')
await asSuper()
const adminId = (await pg.query(`insert into auth.users (email) values ('admin@mgl.ph') returning id`)).rows[0].id
const userId = (await pg.query(`insert into auth.users (email) values ('random@x.ph') returning id`)).rows[0].id
await pg.query('insert into admin_users (user_id) values ($1)', [adminId])
const orderId = async (token) => (await pg.query('select id from orders where tracking_token = $1', [token])).rows[0].id
const id1 = await orderId(r1.tracking_token)
const id5 = await orderId(r5.tracking_token)

await asRole('authenticated', userId, 'random@x.ph')
ok((await pg.query('select count(*)::int n from orders')).rows[0].n === 0, 'non-admin user sees no orders')
await expectError(pg, `select admin_order_action($1, 'confirm')`, [id1], 'Not authorized', 'non-admin cannot change orders')
ok((await pg.query('select is_admin() a')).rows[0].a === false, 'is_admin() false for normal user')

await asRole('authenticated', adminId, 'admin@mgl.ph')
ok((await pg.query('select is_admin() a')).rows[0].a === true, 'is_admin() true for admin')
ok((await pg.query('select count(*)::int n from orders')).rows[0].n > 5, 'admin sees all orders')
await expectError(pg, `update product_variants set price = 1 where id = $1`, [okoy], 'permission denied', 'admin cannot edit prices (column grant)')
await expectError(pg, `update products set name = 'x' where id = (select product_id from product_variants where id = $1)`, [okoy], 'permission denied', 'admin cannot rename products')
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])
ok(true, 'admin can toggle variant sold out')
await pg.query(`update orders set admin_notes = 'VIP' where id = $1`, [id1])
await expectError(pg, `update orders set subtotal = 1 where id = $1`, [id1], 'permission denied', 'admin cannot edit order totals directly')

await expectError(pg, `select admin_order_action($1, 'preparing')`, [id1], 'confirmed', 'cannot skip straight to preparing')
await pg.query(`select admin_order_action($1, 'confirm')`, [id1])
await pg.query(`select admin_order_action($1, 'set_delivery_fee', null, 80)`, [id1])
await pg.query(`select admin_order_action($1, 'preparing')`, [id1])
await pg.query(`select admin_order_action($1, 'out_for_delivery')`, [id1])
await pg.query(`select admin_order_action($1, 'delivered')`, [id1])
await expectError(pg, `select admin_order_action($1, 'reject_payment')`, [id5], 'reason is required', 'rejecting a payment requires a reason')
await pg.query(`select admin_order_action($1, 'reject_payment', 'Blurry')`, [id5])
await pg.query(`insert into call_logs (order_id, result, note) values ($1, 'answered', 'ok')`, [id1])
const log = (await pg.query('select created_by::text, created_by_email from call_logs limit 1')).rows[0]
ok(log.created_by === adminId && log.created_by_email === 'admin@mgl.ph', 'call log records the admin')

await asRole('anon')
const d1 = (await pg.query('select get_order_by_token($1) as o', [r1.tracking_token])).rows[0].o
ok(d1.order_status === 'delivered' && Number(d1.delivery_fee) === 80 && Number(d1.total) === 320, 'delivered with fee; total = subtotal + fee')
ok(d1.history.map((h) => h.status).join(',') === 'processing,confirmed,delivery_fee_updated,preparing,out_for_delivery,delivered', 'full history visible to customer')
ok(!JSON.stringify(d1).includes('VIP'), 'admin notes never reach the tracking page')

// GCash reject → re-upload → mark paid
await asRole('authenticated', adminId, 'admin@mgl.ph')
const o5r = (await pg.query('select payment_status from orders where id = $1', [id5])).rows[0]
ok(o5r.payment_status === 'rejected', 'admin rejected GCash payment')
await asRole('anon')
const o5c = (await pg.query('select get_order_by_token($1) as o', [r5.tracking_token])).rows[0].o
ok(o5c.payment_rejection_reason === 'Blurry', 'customer sees the rejection reason')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-a/proof2.png')`)
await pg.query('select resubmit_gcash_proof($1, $2, $3)', [r5.tracking_token, 'ABC123456', 'proofs/device-a/proof2.png'])
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'mark_paid')`, [id5])
const o5p = (await pg.query('select payment_status, order_status from orders where id = $1', [id5])).rows[0]
ok(o5p.payment_status === 'paid' && o5p.order_status === 'confirmed', 'mark paid → paid / confirmed')
const proofs = (await pg.query(`select count(*)::int n from storage.objects where bucket_id = 'payment-proofs'`)).rows[0].n
ok(proofs === 2, 'admin can read payment proofs')
await expectError(pg, `select admin_order_action($1, 'confirm')`, [id5], 'awaiting confirmation', 'an already-confirmed order cannot be confirmed twice')

// "Confirm Order" also works for GCash (verifies the payment in one step)
await asRole('anon')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-c/proof3.png')`)
await asSuper()
await pg.query(`update product_variants set is_sold_out = false where id = $1`, [okoy])
await asRole('anon')
const r6 = (await place({ ...base, phone: '09170000006', payment_method: 'gcash', gcash_reference: '7788990011', gcash_proof_path: 'proofs/device-c/proof3.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
await asSuper()
const id6 = await orderId(r6.tracking_token)
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'confirm')`, [id6])
const o6 = (await pg.query('select payment_status, order_status from orders where id = $1', [id6])).rows[0]
ok(o6.payment_status === 'paid' && o6.order_status === 'confirmed', 'Confirm Order on a GCash order → paid + confirmed')
await asRole('anon')
const t6 = (await pg.query('select get_order_by_token($1) as o', [r6.tracking_token])).rows[0].o
ok(t6.history.at(-1).status === 'payment_confirmed', 'customer sees "Payment Confirmed" after Confirm Order')
await asRole('authenticated', adminId, 'admin@mgl.ph')
await asSuper()
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])
await asRole('authenticated', adminId, 'admin@mgl.ph')

// MariBank and GoTyme work like GCash: reference + screenshot, admin verifies
console.log('\nMariBank + GoTyme')
await asSuper()
await pg.query(`update product_variants set is_sold_out = false where id = $1`, [okoy])
await asRole('anon')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-d/mari.png'), ('payment-proofs', 'proofs/device-d/goty.png'), ('payment-proofs', 'proofs/device-d/goty2.png')`)
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'maribank', gcash_reference: '', gcash_proof_path: 'proofs/device-d/mari.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'MariBank reference', 'MariBank requires a reference number')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'gotyme', gcash_reference: '55556666', gcash_proof_path: 'proofs/device-d/nope.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'GoTyme payment', 'GoTyme requires an uploaded screenshot')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'paypal', items: [{ variant_id: okoy, quantity: 1 }] })], 'choose a payment method', 'unknown payment method rejected')
const r7 = (await place({ ...base, phone: '09170000007', payment_method: 'maribank', gcash_reference: 'MB 123 456', gcash_proof_path: 'proofs/device-d/mari.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const r8 = (await place({ ...base, phone: '09170000008', payment_method: 'gotyme', gcash_reference: 'GT998877', gcash_proof_path: 'proofs/device-d/goty.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const o7 = (await pg.query('select get_order_by_token($1) as o', [r7.tracking_token])).rows[0].o
const o8 = (await pg.query('select get_order_by_token($1) as o', [r8.tracking_token])).rows[0].o
ok(o7.payment_method === 'maribank' && o7.payment_status === 'pending_verification' && o7.gcash_reference === 'MB123456', 'MariBank order placed, waiting for verification')
ok(o8.payment_method === 'gotyme' && o8.payment_status === 'pending_verification', 'GoTyme order placed, waiting for verification')
ok(o7.history[0].note.startsWith('MariBank payment submitted') && o8.history[0].note.startsWith('GoTyme payment submitted'), 'history notes name the right bank')
await asSuper()
const id7 = await orderId(r7.tracking_token)
const id8 = await orderId(r8.tracking_token)
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'confirm')`, [id7])
const p7 = (await pg.query('select payment_status, order_status from orders where id = $1', [id7])).rows[0]
ok(p7.payment_status === 'paid' && p7.order_status === 'confirmed', 'Confirm Order on MariBank → paid + confirmed')
await pg.query(`select admin_order_action($1, 'reject_payment', 'Wrong amount')`, [id8])
await asRole('anon')
await pg.query('select resubmit_gcash_proof($1, $2, $3)', [r8.tracking_token, 'GT111222', 'proofs/device-d/goty2.png'])
const t8 = (await pg.query('select get_order_by_token($1) as o', [r8.tracking_token])).rows[0].o
ok(t8.payment_status === 'pending_verification' && t8.history.at(-1).note.startsWith('New GoTyme payment proof'), 'GoTyme: rejected → customer sends a new proof')
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'mark_paid')`, [id8])
const t8b = (await pg.query('select payment_status, order_status from orders where id = $1', [id8])).rows[0]
ok(t8b.payment_status === 'paid' && t8b.order_status === 'confirmed', 'GoTyme: Mark as Paid → paid + confirmed')
await expectError(pg, `select admin_order_action($1, 'reject_payment', 'x')`, [id1], 'no online payment', 'cannot reject payment on a COD order')
await asSuper()
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])

// Sold-out variant is rejected at checkout
await asRole('anon')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000009', items: [{ variant_id: okoy, quantity: 1 }] })], 'SOLD OUT', 'sold-out item rejected')

await asSuper()
const sent = (await pg.query(`select count(*)::int n from realtime.sent where topic = 'order:' || $1 and private = false`, [r1.tracking_token])).rows[0].n
ok(sent >= 6, `realtime ping sent on the order's token channel (${sent} pings)`)

// ---------------------------------------------------------------------
console.log('\nGoogle or Facebook verification')
const gUser = (await pg.query(`insert into auth.users (email) values ('juan@gmail.com') returning id`)).rows[0].id
const emailUser = (await pg.query(`insert into auth.users (email) values ('sneaky@x.ph') returning id`)).rows[0].id
const gOrder = (phone) => place({ ...base, phone, items: [{ variant_id: hazel, quantity: 1 }] })
const order = (phone) => ['select place_order($1::jsonb)', [JSON.stringify({ ...base, phone, items: [{ variant_id: hazel, quantity: 1 }] })]]
ok((await pg.query(`select value from settings where key = 'require_google_login'`)).rows[0].value === false, 'Google requirement starts off')
ok((await pg.query(`select count(*)::int n from settings where key = 'require_facebook_login'`)).rows[0].n === 0, 'old Facebook setting is removed')
ok((await pg.query(`select count(*)::int n from information_schema.columns where table_name = 'orders' and column_name like 'facebook%'`)).rows[0].n === 0, 'old Facebook columns are removed')
await pg.query(`update settings set value = 'true' where key = 'require_google_login'`)
await asRole('anon')
ok((await pg.query('select get_checkout_info() as i')).rows[0].i.require_google_login === true, 'checkout info tells the site Google is required')
await expectError(pg, ...order('09170000020'), 'sign in with Google or Facebook', 'guest order blocked once Google is required')
await asRole('authenticated', emailUser, 'sneaky@x.ph', { app_metadata: { provider: 'email', providers: ['email'] } })
await expectError(pg, ...order('09170000020'), 'sign in with Google or Facebook', 'an email sign up cannot skip Google or Facebook')
await asRole('authenticated', emailUser, 'sneaky@x.ph', { user_metadata: { providers: ['google'] } })
await expectError(pg, ...order('09170000020'), 'sign in with Google or Facebook', 'faking Google in user_metadata does not work')
await asGoogle(gUser, 'Juan Dela Cruz', 'juan@gmail.com')
const rg = (await gOrder('09170000020')).rows[0].r
ok(!!rg.order_number, 'Google-verified customer can order')
await asSuper()
const gRow = (await pg.query('select customer_user_id, google_name, google_email, google_picture, verified_with from orders where order_number = $1', [rg.order_number])).rows[0]
ok(gRow.customer_user_id === gUser && gRow.google_name === 'Juan Dela Cruz' && gRow.google_email === 'juan@gmail.com' && gRow.google_picture.includes('googleusercontent'), 'order saves the Google account, name, Gmail and photo')
ok(gRow.verified_with === 'google', 'order says it was verified with Google')
await pg.query(`update settings set value = '2' where key = 'max_orders_per_phone_per_day'`)
await asGoogle(gUser, 'Juan Dela Cruz', 'juan@gmail.com')
await gOrder('09170000021')
await expectError(pg, ...order('09170000022'), 'This account has reached', 'daily limit per Google account, even with new phone numbers')
ok((await pg.query('select count(*)::int n from orders')).rows[0].n === 0, 'a Google customer cannot read anyone\'s orders, not even their own')
await asSuper()
const fUser = (await pg.query(`insert into auth.users (email) values ('maria@yahoo.com') returning id`)).rows[0].id
await asFacebook(fUser, 'Maria Santos', 'maria@yahoo.com')
const rf = (await gOrder('09170000030')).rows[0].r
ok(!!rf.order_number, 'Facebook-verified customer can order')
await asSuper()
const fRow = (await pg.query('select customer_user_id, google_name, google_email, google_picture, verified_with from orders where order_number = $1', [rf.order_number])).rows[0]
ok(fRow.customer_user_id === fUser && fRow.google_name === 'Maria Santos' && fRow.google_email === 'maria@yahoo.com' && fRow.google_picture.includes('fbsbx'), 'order saves the Facebook account, name, email and photo')
ok(fRow.verified_with === 'facebook', 'order says it was verified with Facebook')
await asFacebook(fUser, 'Maria Santos', 'maria@yahoo.com')
await gOrder('09170000031')
await expectError(pg, ...order('09170000032'), 'This account has reached', 'daily limit per Facebook account, even with new phone numbers')
await asRole('authenticated', emailUser, 'sneaky@x.ph', { user_metadata: { providers: ['facebook'] } })
await expectError(pg, ...order('09170000033'), 'sign in with Google or Facebook', 'faking Facebook in user_metadata does not work')
// Same email on both: the order records whichever was used last.
await asSuper()
const bUser = (await pg.query(`insert into auth.users (email) values ('both@gmail.com') returning id`)).rows[0].id
await asRole('authenticated', bUser, 'both@gmail.com', { app_metadata: { provider: 'google', providers: ['google', 'facebook'] }, user_metadata: { full_name: 'Ben' } })
const rb = (await gOrder('09170000040')).rows[0].r
await asSuper()
ok((await pg.query('select verified_with from orders where order_number = $1', [rb.order_number])).rows[0].verified_with === 'facebook', 'both linked, last used Facebook: saved as Facebook')
await pg.query(`update settings set value = '5' where key = 'max_orders_per_phone_per_day'`)
await pg.query(`update settings set value = 'false' where key = 'require_google_login'`)

// ---------------------------------------------------------------------
console.log('\nEdit order')
await asRole('anon')
const rE = (await place({ ...base, phone: '09170000060', items: [{ variant_id: hazel, quantity: 1 }, { variant_id: raves, quantity: 2 }] })).rows[0].r
await asSuper()
const idE = await orderId(rE.tracking_token)
const orderOf = async (id) => (await pg.query('select *, updated_at::text as u, created_at::text as c, delivery_date::text as dd from orders where id = $1', [id])).rows[0]
const itemsOf = async (id) => (await pg.query('select * from order_items where order_id = $1 order by line_no', [id])).rows
const priceOf = async (v) => Number((await pg.query('select price from product_variants where id = $1', [v])).rows[0].price)
const edit = (id, changes, expected = null) => pg.query('select admin_edit_order($1, $2::jsonb, $3) as r', [id, JSON.stringify(changes), expected])
const editSql = 'select admin_edit_order($1, $2::jsonb)'
const hazelOther = (await pg.query('select id from product_variants where product_id = (select product_id from product_variants where id = $1) and id <> $1 order by sort limit 1', [hazel])).rows[0].id
const nextDay = new Date(Date.parse(`${info.min_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const e0 = await orderOf(idE)
const [hazelLine, ravesLine] = await itemsOf(idE)

await asRole('anon')
await expectError(pg, editSql, [idE, JSON.stringify({ customer_name: 'Hacker' })], 'permission denied', 'anon cannot edit orders')
await expectError(pg, 'select * from order_edits', [], 'permission denied', 'anon cannot read the edit history')
await asRole('authenticated', userId, 'random@x.ph')
await expectError(pg, editSql, [idE, JSON.stringify({ customer_name: 'Hacker' })], 'Not authorized', 'non-admin cannot edit orders')

await asRole('authenticated', adminId, 'admin@mgl.ph')
await edit(idE, { customer_name: 'Juan P. Dela Cruz', phone: '+63 917 000 0061', landmark: 'Near the chapel', delivery_date: nextDay, delivery_slot: '14:00-15:00' }, e0.u)
const e1 = await orderOf(idE)
ok(e1.customer_name === 'Juan P. Dela Cruz' && e1.phone === '09170000061' && e1.landmark === 'Near the chapel', 'edit saves customer details (phone normalized)')
ok(e1.dd === nextDay, 'edit saves the new delivery date')
ok(e1.delivery_slot === '14:00-15:00', 'edit saves the new time slot')
ok(e1.id === e0.id && e1.order_number === e0.order_number && e1.tracking_token === e0.tracking_token && e1.c === e0.c, 'order id, number, tracking link and creation time stay the same')
ok(e1.order_status === e0.order_status && e1.payment_status === e0.payment_status && e1.payment_method === e0.payment_method, 'status and payment stay the same')
const edits1 = (await pg.query('select changes, edited_by_email from order_edits where order_id = $1', [idE])).rows
ok(edits1.length === 1 && edits1[0].edited_by_email === 'admin@mgl.ph', 'edit history records the admin')
ok(['customer_name', 'phone', 'landmark', 'delivery_date', 'delivery_slot'].every((f) => edits1[0].changes.some((x) => x.field === f)), 'edit history lists every changed field')
ok(edits1[0].changes.find((x) => x.field === 'phone').from === '09170000060', 'edit history keeps the previous value')
await expectError(pg, 'select admin_edit_order($1, $2::jsonb, $3)', [idE, JSON.stringify({ customer_name: 'Someone' }), e0.u], 'updated while you were editing', 'a stale editor cannot overwrite newer changes')

// Items: change a size and a quantity, add a product with options, all priced from the menu.
await edit(idE, {
  items: [
    { id: hazelLine.id, variant_id: hazelOther, quantity: 2 },
    { id: ravesLine.id, variant_id: raves, quantity: 3, unit_price: 1 },
    { variant_id: peachy, quantity: 1, choice_ids: [cheese], extra_toppings: true, price: 1 },
  ],
})
const e2 = await orderOf(idE)
const it2 = await itemsOf(idE)
const expected2 = 2 * (await priceOf(hazelOther)) + 3 * (await priceOf(raves)) + 168
ok(Number(e2.subtotal) === expected2 && Number(e2.total) === expected2 + Number(e2.delivery_fee), `items edited: subtotal recalculated from menu prices (₱${expected2}), client prices ignored`)
ok(it2.length === 3 && it2[0].id === hazelLine.id && it2[1].id === ravesLine.id && it2.map((i) => i.line_no).join() === '1,2,3', 'existing items are updated in place, not duplicated')
ok(it2[0].variant_id === hazelOther && it2[1].quantity === 3 && it2[2].options_snapshot.length === 2, 'new size, new quantity and new product options saved')
ok(it2.every((i) => Number(i.line_total) === Number(i.unit_price_snapshot) * i.quantity), 'every line total = unit price × quantity')

await edit(idE, { items: [{ id: ravesLine.id, quantity: 3 }] })
const it3 = await itemsOf(idE)
const e3 = await orderOf(idE)
ok(it3.length === 1 && Number(e3.subtotal) === 3 * (await priceOf(raves)), 'removing items deletes them and lowers the subtotal')
const itemChanges = (await pg.query('select changes from order_edits where order_id = $1 order by created_at desc limit 1', [idE])).rows[0].changes
ok(itemChanges.filter((x) => x.field === 'item' && x.to === null).length === 2, 'edit history lists the removed items')

await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: ravesLine.id, quantity: 3 }] })], 'no changes', 'saving with no changes is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ items: [] })], 'at least one item', 'an order cannot be left empty')
await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: ravesLine.id, quantity: 0 }] })], 'quantity from 1 to 99', 'quantity must be 1 to 99')
await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: ravesLine.id, quantity: 3 }, { variant_id: okoy, quantity: 1 }] })], 'SOLD OUT', 'a sold-out product cannot be added')
await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: hazelLine.id, quantity: 1 }] })], 'no longer part of this order', 'a removed item cannot be brought back by id')
await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: ravesLine.id, variant_id: hazel, quantity: 1 }] })], 'choose a size of', 'a size must belong to the same product')
await expectError(pg, editSql, [idE, JSON.stringify({ delivery_slot: '10:00-11:00' })], 'outside the store hours', 'slot outside store hours is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ delivery_date: '2020-01-01' })], 'cannot be in the past', 'past delivery date is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ phone: '12345' })], 'valid PH mobile', 'bad phone is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ email: 'nope' })], 'valid email', 'bad email is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ customer_name: ' ' })], 'full name', 'empty name is refused')
await expectError(pg, editSql, [idE, JSON.stringify({ delivery_fee: -5 })], 'valid delivery fee', 'negative delivery fee is refused')

// Delivery fee: total follows, and the customer sees the fee like Admin → Save fee.
await edit(idE, { delivery_fee: 75 })
const e4 = await orderOf(idE)
ok(Number(e4.delivery_fee) === 75 && Number(e4.total) === Number(e4.subtotal) + 75, 'delivery fee edit: total = food subtotal + delivery fee')
const lastHist = (await pg.query('select status, note from order_status_history where order_id = $1 order by created_at desc, id desc limit 1', [idE])).rows[0]
ok(lastHist.status === 'delivery_fee_updated' && lastHist.note === 'Delivery fee set to ₱75.00.', 'a new delivery fee is added to the status history')

// Cash on Delivery limit, and switching to an online payment.
const ravesPrice = await priceOf(raves)
const overQty = Math.floor(2000 / ravesPrice) + 1
await expectError(pg, editSql, [idE, JSON.stringify({ items: [{ id: ravesLine.id, quantity: overQty }] })], 'up to ₱2,000', 'COD order cannot go over ₱2,000')
await edit(idE, { items: [{ id: ravesLine.id, quantity: overQty }], payment_method: 'gcash' })
const e5 = await orderOf(idE)
ok(e5.payment_method === 'gcash' && e5.payment_status === 'pending_verification' && Number(e5.subtotal) === overQty * ravesPrice, 'switching to GCash allows the bigger order (payment to verify)')
await expectError(pg, editSql, [idE, JSON.stringify({ payment_method: 'cod' })], 'up to ₱2,000', 'cannot switch back to COD while over ₱2,000')
await edit(idE, { items: [{ id: ravesLine.id, quantity: 2 }], payment_method: 'cod' })
ok((await orderOf(idE)).payment_status === 'cod_unpaid', 'switching back to COD sets it to COD unpaid')

// The customer's tracking page shows the updated order, never the edit history.
await asRole('anon')
const tE = (await pg.query('select get_order_by_token($1) as o', [rE.tracking_token])).rows[0].o
ok(tE.customer_name === 'Juan P. Dela Cruz' && tE.items.length === 1 && tE.items[0].quantity === 2, 'tracking link still works and shows the edited order')
ok(!('edits' in tE) && !JSON.stringify(tE).includes('admin@mgl.ph') && tE.history.every((h) => h.status !== 'order_edited'), 'tracking page does not show the edit history')
await asRole('authenticated', userId, 'random@x.ph')
ok((await pg.query('select count(*)::int n from order_edits')).rows[0].n === 0, 'non-admin sees no edit history')

// Status rules
await asRole('authenticated', adminId, 'admin@mgl.ph')
await edit(id1, { customer_name: 'Juan Dela Cruz Jr.' })
ok((await orderOf(id1)).customer_name === 'Juan Dela Cruz Jr.' && (await orderOf(id1)).order_status === 'delivered', 'delivered order: customer details can still be corrected')
const id1Item = (await itemsOf(id1))[0]
await expectError(pg, editSql, [id1, JSON.stringify({ items: [{ id: id1Item.id, quantity: 5 }] })], 'can no longer be changed', 'delivered order: items are locked')
await expectError(pg, editSql, [id1, JSON.stringify({ delivery_slot: '15:00-16:00' })], 'can no longer be changed', 'delivered order: schedule is locked')
await expectError(pg, editSql, [id7, JSON.stringify({ payment_method: 'cod' })], 'before the order is confirmed and paid', 'paid order: payment method is locked')
const id2 = await orderId(r2.tracking_token)
await pg.query(`select admin_order_action($1, 'cancel', 'Customer asked')`, [id2])
await expectError(pg, editSql, [id2, JSON.stringify({ customer_name: 'Maria S.' })], 'Cancelled orders cannot be edited', 'cancelled order cannot be edited')

await asSuper()
const badTotals = (await pg.query(`select count(*)::int n from orders o where o.total <> o.subtotal + o.delivery_fee or o.subtotal <> (select sum(line_total) from order_items i where i.order_id = o.id)`)).rows[0].n
ok(badTotals === 0, 'every order: subtotal = sum of items and total = subtotal + delivery fee')

// ---------------------------------------------------------------------
console.log('\nOwner contact (Wet Foods: Request a Fish)')
await asRole('anon')
ok((await pg.query('select get_owner_contact() as c')).rows[0].c.phone === '', 'owner number is empty until set, so the Call option stays hidden')
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`update settings set value = '"0917 555 1234"' where key = 'owner_phone'`)
await asRole('anon')
ok((await pg.query('select get_owner_contact() as c')).rows[0].c.phone === '0917 555 1234', 'customers get the owner number set in Admin → Settings')
await expectError(pg, `select value from settings where key = 'owner_phone'`, [], 'permission denied', 'customers still cannot read the settings table')
await asSuper()
await pg.query(`update settings set value = '"call me maybe"' where key = 'owner_phone'`)
ok((await pg.query('select get_owner_contact() as c')).rows[0].c.phone === '', 'a value that is not a phone number is never shown')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
