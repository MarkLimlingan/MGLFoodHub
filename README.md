# MGL Food Hub

Multi-store food ordering site: 14 partner stores, one cart, **scheduled delivery only**.
Customers never need an account (Google sign in at checkout is optional, see §6). Admins sign in at a hidden URL.

React + Vite + TypeScript + Tailwind (shadcn-style components) · PHP 8.1+ API and MySQL/MariaDB on Hostinger (`hostinger/`).

---

## 1. Set up the database (Hostinger → phpMyAdmin)

1. **hPanel → Databases → MySQL Databases**: create the database and its user (or use the existing `u406950319_MGLFOODHUB`).
2. **phpMyAdmin → the database → Import**: `hostinger/mysql/schema.sql` (all tables and default settings; safe to import again).
3. Then import the menu and settings. To copy them from the old Supabase project: `npm run export:supabase` (asks for an admin email and password; writes `hostinger/mysql/data.local.sql` and downloads photos uploaded through the admin into `public/uploads/`), then import `data.local.sql`. Orders are not copied.

## 2. Configure and deploy

**Deploys come from GitHub.** Hostinger builds `main` of `MarkLimlingan/MGLFoodHub` on every push (`npm run build`, publishes `dist/` to `public_html`). The PHP API (`public/api`) and `.htaccess` are in `public/`, so they are part of every build. Nothing secret is in the repository.

1. **Settings, once:** copy `hostinger/mgl-config.example.php`, fill it in (database password, Google Client ID (§6), a long random `setup_key`, email sender (§5)), and save it on the server as **`domains/mglfoodhub.com/mgl-config.php`** (hPanel → Files → File Manager; next to `public_html`, not inside it). The API finds it by looking in the folders above `public_html/api`. Keep your copy as `hostinger/mgl-config.php` (git ignored).
2. **hPanel → Databases → MySQL Databases**: the database user's password must match `db.password` in that file.
3. Push to `main`. Payment screenshots and admin photo uploads are saved in `mgl-data/` next to `mgl-config.php`, so deploys never erase them (`api/file.php` serves the photos at `/uploads/…`).
4. Open `https://mglfoodhub.com/<VITE_ADMIN_PATH>`, tap **First time setup**, and create the first admin with the `setup_key`. It only works while there are no admins; you can then blank `setup_key`.

| Env var (`.env`) | Purpose |
| --- | --- |
| `VITE_ADMIN_PATH` | Hidden admin login route (default `/mgl-hub-admin-portal`). **Change it** to something only your team knows. Hostinger builds without `.env`, so on the live site the default is used unless the variable is set in Hostinger's build settings. |
| `VITE_API_URL` | Optional. Where the API lives (default `/api`, same site). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Only for `npm run export:supabase`. |

Admin login: `https://mglfoodhub.com/<VITE_ADMIN_PATH>`. After sign in you land on `/admin`. It isn't linked anywhere, it's `noindex`, and `/admin/*` shows a normal 404 to anyone who isn't an admin. Wrong passwords are slowed down (10 tries per 15 minutes), and changing your password signs out your other devices.

### Run it on this computer

```bash
npm install
npm run dev:api   # PHP API on 127.0.0.1:8710, using hostinger/config.dev.php (a local MySQL/MariaDB, e.g. XAMPP)
npm run dev       # the site; /api and /uploads go to the PHP server
```

## 3. Add the images

| File | Used for |
| --- | --- |
| `public/logo.png` | Navbar, footer, admin login, Apple touch icon. A vector stand-in is shown until this file exists. |
| `public/menus/<slug>.jpg` | Each store's cover and "View original menu" photo |
| `public/products/*.jpg` | Product photos (16:10), linked with `; !/products/<file>.jpg` in `scripts/menu-data.mjs`. |

Store slugs: `hazels-special-puto`, `aling-melys-carinderia`, `okoy-ni-jay-r`, `aurings-special-pancit-malabon`, `normas-special-pancit-bilao`, `balsa-sa-niugan`, `original-benjie-puto-pao`, `raves-diner`, `mary-jay`, `rody-days`, `anny-dading-peachy-peachy`, `judy-anns-crispy-pata`, `sisig-ni-mutik`, `wet-foods`.

Admins can also replace any store cover, menu photo or product photo from **Admin → Products & Stores** (saved in `public_html/uploads/`).

## 4. Admin settings to fill in first

**Admin → Settings**: account name, number and QR image for GCash, MariBank and GoTyme (each works the same way: the customer pays, then sends the reference number and a screenshot); cutoff time (default 8:00 PM); max days ahead (default 30); blocked dates; email toggle; owner contact number (Wet Foods "Request a Fish").

## 5. Prices and menu

- Admins can update variant and add-on prices from **Admin → Products & Stores** (`admin_update_variant`), while `place_order` still ignores any price sent by the customer's browser and reads every price from the database. Existing orders keep the price snapshots they were placed at.
- New products or option-choice adjustments are made in phpMyAdmin (`products`, `product_variants`, `option_choices`).
- `scripts/menu-data.mjs` holds the menu as transcribed from the store menus (`npm run seed:generate` writes the old Supabase seed from it).

> **Needs your input:** Balsa sa Niugan → *Balsa Chicken → Buttered Half* was marked `₱[CONFIRM]` on the menu, so it is **not on the menu**.

## 5b. Optional: email confirmations

1. **hPanel → Emails**: create the mailbox in `mail_from` (e.g. `orders@mglfoodhub.com`).
2. Turn on **Email confirmations** in Admin → Settings.

`place_order` then emails the customer once, right after checkout, with the tracking link (PHP `mail()`).

## 6. Optional: Google (Gmail) verification at checkout (anti-scam)

When **Admin → Settings → Require Google account at checkout** is on, customers must sign in with Google before they can check out (the cart and checkout show **Continue with Google**), and `place_order` refuses anyone not signed in. Each order saves the Google name, Gmail address and photo, the admin order page shows how many orders and cancellations that Google account has, and the daily order limit also applies per Google account.

How it works: **Continue with Google** goes to Google's account chooser and comes back to `/checkout` with an ID token, which the API checks with Google (right app, not expired, verified email, and the one-time nonce this browser sent) before signing the customer in.

1. **Google Cloud Console**: in **Google Auth Platform**, set **Audience** to External, fill in **Branding** (app name, support email; links to `/privacy` and `/terms`), and check **Data Access** has `openid`, `userinfo.email` and `userinfo.profile`.
2. **Clients → your Web application client**: Authorized JavaScript origins `https://mglfoodhub.com` (and `http://localhost:5173` for local testing); Authorized redirect URIs **`https://mglfoodhub.com/checkout`** (and `http://localhost:5173/checkout`). Put the Client ID in `config.php` as `google_client_id`.
3. **Google Auth Platform → Audience → Publish app** so any Gmail can sign in (in Testing, only listed test users can).
4. Test a Google sign in from the cart, then turn the switch on in Admin → Settings.

Google sign in doesn't work inside Facebook's and Messenger's built-in browser, so there the cart shows a **Copy link** button to open the page in Chrome or Safari. Orders placed with Facebook before it was removed (2026-11-02) are still marked in `orders.verified_with`.

## 7. Notes

**Install as an app.** The site is installable on Android, iPhone and desktop (`public/manifest.webmanifest`, `public/sw.js`). The service worker only serves `public/offline.html` when a page can't load; it caches nothing else, so every deploy is live immediately.

**`supabase/`** is the old backend (Postgres functions and migrations), kept for reference and for `npm run export:supabase`. The site no longer uses it.

---

## How it works

- **API.** `public/api/rpc.php?fn=<name>` (POST, JSON) answers `{ "data": … }` or `{ "error": "message" }`. Customer functions are in `api/lib/public.php`, admin ones in `api/lib/admin.php` (each checks the admin sign in first), shared order rules in `api/lib/orders.php`. `api/proof.php` takes payment screenshots (kept outside `public_html`, admins only), `api/upload.php` admin photos and `api/file.php` shows them. `lib/` can't be opened from the web, and the settings file is outside `public_html`.
- **SEO and answer engines.** `.htaccess` sends every page to `api/page.php`, which adds that page's title, description, canonical, link preview (`/og-image.jpg` or the store's picture) and schema.org JSON-LD (Organization, WebSite, store menus with prices, FAQPage, breadcrumbs) to `index.html`, plus a plain text copy in `<noscript>` for crawlers that don't run JavaScript. Private pages (cart, checkout, tracking) are `noindex`; unknown pages answer 404. `/sitemap.xml`, `/llms.txt` and `/llms-full.txt` come from `api/seo-files.php`. All of it is built from the database (`api/lib/seo.php`), and the `/faq` page shows the same answers (`get_faq`), made from Admin → Settings. If any of it fails, `index.html` is sent unchanged.
- **Carts are per device.** A random `device_id` and the cart live only in `localStorage` (`mgl_cart_v1`). The cart clears only after an order succeeds. Sold-out or unavailable items are flagged and block checkout.
- **Scheduling.** The earliest date is tomorrow (Asia/Manila), or the day after once the cutoff passes. Blocked dates and max days are enforced in the date picker and again on the server. Slots are 1-hour windows inside the overlap of every cart store's hours.
- **Orders.** `place_order` re-checks everything: prices, sold out, store availability, date, slot, phone and email format, the honeypot, the COD limit (₱2,000) and 5 orders per phone (and per Google account) per day. It returns `MGL-YYMMDD-XXXX` plus a 32-character random tracking token.
- **Tracking.** `/track/<token>` reads one order via `get_order_by_token` (customer-safe fields only) and checks for changes every 15 seconds while open.
- **Admin.** Every status change goes through `admin_order_action`, which checks the step, writes `order_status_history` with the admin's email, and shows on the customer's tracking page. Admin pages ask `admin_poll` every 8 seconds what changed (new orders, cancellation requests, new payment proofs) and chime.
- **Edit Order.** `/admin/orders/<id>/edit` saves through `admin_edit_order`: it checks the customer details, schedule (store hours), items (menu prices, sold out, options), the COD limit and what the order's status allows, recalculates subtotal and total, keeps the order id, number, tracking link, status and payment records, and records who changed what in `order_edits` (admin only). Cancelled orders can't be edited; once out for delivery or delivered, only the customer details and delivery fee can change.

## Tests

```bash
npm run test:api    # the PHP API end to end: a throwaway MySQL/MariaDB database, PHP's built-in server, real HTTP calls
                    # (XAMPP by default; PHP_BIN, MYSQL_BIN and MYSQL_ARGS to change)
npm run test:db     # the old Supabase migrations in an in-process Postgres (PGlite)
npm run typecheck
```
