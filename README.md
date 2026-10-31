# MGL Food Hub

Multi-store food ordering site: 13 partner stores, one cart, **scheduled delivery only**.
Customers never log in. Admins sign in at a hidden URL.

React + Vite + TypeScript + Tailwind (shadcn-style components) · Supabase (Postgres, Auth, Storage, Realtime, RPC).

---

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Quickest: paste **`supabase/setup-all.sql`** (all the migrations combined; safe to re-run) into **SQL Editor → Run**. If you change a migration, rebuild that file. Otherwise, run the migrations **in order**. Either paste each one into **SQL Editor → Run**, or use the CLI (`supabase link` then `supabase db push`):
   - `supabase/migrations/20261007000100_schema.sql`: tables, RLS, grants, the price-lock trigger, storage buckets, realtime
   - `supabase/migrations/20261007000200_functions.sql`: `place_order`, `get_order_by_token`, `find_order`, `request_cancellation`, `resubmit_gcash_proof`, `get_checkout_info`, `admin_order_action`
   - `supabase/migrations/20261007000300_seed_menu.sql`: all 14 stores, 81 sections, 423 products, 542 variants (generated, see §5)
   - `supabase/migrations/20261031000100_edit_order.sql`: Admin → Edit Order (`admin_edit_order` and the private `order_edits` history). On a database set up before Edit Order, run just this file.
   - `supabase/updates/20261102_qa_fixes.sql`: QA fixes for a database set up before 2026-11-02 (balance due after editing a paid order, payment screenshot after switching to online payment, Edit Order date rules, owner number check). New databases get all of it from the migrations.
   - `supabase/migrations/20261101000100_owner_contact.sql`: the **Owner contact number** in Admin → Settings, shown in the Wet Foods "Request a Fish" pop-up (`get_owner_contact`). On an existing database, run just this file.
3. **Auth → Providers → Email**: turn **off** "Allow new users to sign up" (turn it back **on** if you use Google verification, §6b; orders still require a Google account, so email sign ups can't order or see anything).
4. Create the admin account(s): **Authentication → Users → Add user** (email + password, auto-confirm), then in the SQL editor:
   ```sql
   insert into admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   Anyone who signs in without a row in `admin_users` is signed out immediately.

## 2. Run the site

```bash
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

| Env var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key |
| `VITE_ADMIN_PATH` | Hidden admin login route (default `/mgl-hub-admin-portal`). **Change it** to something only your team knows. |

Admin login: `https://your-domain/<VITE_ADMIN_PATH>`. After sign-in you land on `/admin`. It isn't linked anywhere, it's `noindex`, and `/admin/*` shows a normal 404 to anyone who isn't an admin.

## 3. Add the images

| File | Used for |
| --- | --- |
| `public/logo.png` | Navbar, footer, admin login, Apple touch icon. A vector stand-in is shown until this file exists. |
| `public/menus/<slug>.jpg` | Each store's cover and "View original menu" photo |
| `public/products/*.jpg` | Product photos (16:10), linked with `; !/products/<file>.jpg` in `scripts/menu-data.mjs`. Re-running the setup fills a product's photo only if the admin hasn't uploaded one. |

Store slugs: `hazels-special-puto`, `aling-melys-carinderia`, `okoy-ni-jay-r`, `aurings-special-pancit-malabon`, `normas-special-pancit-bilao`, `balsa-sa-niugan`, `original-benjie-puto-pao`, `raves-diner`, `mary-jay`, `rody-days`, `anny-dading-peachy-peachy`, `judy-anns-crispy-pata`, `sisig-ni-mutik`, `wet-foods` (no menu photo yet: its store page hides "View original menu" until `public/menus/wet-foods.jpg` exists and the seed is regenerated).

Admins can also replace any store cover, menu photo or product photo from **Admin → Products & Stores** (uploads go to Supabase Storage).

## 4. Admin settings to fill in first

**Admin → Settings**: account name, number and QR image for GCash, MariBank and GoTyme (each works the same way: the customer pays, then sends the reference number and a screenshot); cutoff time (default 8:00 PM); max days ahead (default 30); blocked dates; email toggle.

## 5. Prices (fixed)

- All prices live in **`scripts/menu-data.mjs`**, transcribed from the menus. `npm run seed:generate` rebuilds the seed migration from it.
- Prices **cannot** be changed from the admin UI (column-level grants) or even from the SQL editor (a `BEFORE UPDATE` trigger on `product_variants.price/addon_price` and `option_choices.price_delta`).
- `place_order` ignores any price sent by the browser and recomputes everything from the database.

> **Needs your input:** Balsa sa Niugan → *Balsa Chicken → Buttered Half* was marked `₱[CONFIRM]` on the menu, so it is **not seeded**. When you have the price, run the `insert` shown at the bottom of `scripts/menu-data.mjs`.

## 6. Optional: email confirmations (Resend)

```bash
supabase functions deploy send-order-email --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="MGL Food Hub <orders@yourdomain.com>" SITE_URL=https://yourdomain.com
```
Then turn on **Email confirmations** in Admin → Settings. The function only emails the address on the order, only once, and only within 15 minutes of the order being placed.

## 6b. Optional: Google (Gmail) verification at checkout (anti-scam)

When **Admin → Settings → Require Google account at checkout** is on, customers must sign in with Google before they can check out (the cart and checkout show **Continue with Google**), and `place_order` rejects anyone not signed in with Google (checked from the token's `app_metadata`, which only Supabase Auth can write). Each order saves the Google name, Gmail address and photo, the admin order page shows how many orders and cancellations that Google account has, and the daily order limit also applies per Google account.

1. **Google Cloud Console** (console.cloud.google.com): create a project. In **Google Auth Platform**, set **Audience** to External, fill in **Branding** (app name, support email; links to `/privacy` and `/terms`), and check **Data Access** has `openid`, `userinfo.email` and `userinfo.profile`. Skip the logo unless you want to wait for Google's brand verification.
2. **Clients → Create client → Web application**: Authorized JavaScript origins `https://<your-domain>` (and `http://localhost:5173` while testing); Authorized redirect URIs `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the Client ID and Client Secret.
3. **Supabase → Authentication → Sign In / Providers → Google**: enable, paste the Client ID and Client Secret. Make sure **Allow new users to sign up** is on.
4. **Supabase → Authentication → URL Configuration**: Site URL = your live URL; Redirect URLs include `https://<your-domain>/**` (and `http://localhost:5173/**` for local testing).
5. **Google Auth Platform → Audience → Publish app** so any Gmail can sign in (in Testing, only listed test users can).
6. Test a Google sign in from the cart, then turn the switch on in Admin → Settings.

**Facebook sign in was removed** (2026-11-02). The site only offers Google. `place_order` still accepts a Facebook token and `orders.verified_with` still marks the few orders placed with Facebook, so switch Facebook **off** in Supabase → Authentication → Sign In / Providers. Google sign in doesn't work inside Facebook's and Messenger's built-in browser, so there the cart shows a **Copy link** button to open the page in Chrome or Safari.

## 7. Deploy

Any static host works. `npm run build` outputs `dist/`. SPA rewrites are included for Vercel (`vercel.json`) and Netlify (`public/_redirects`).

**Install as an app.** The site is installable on Android, iPhone and desktop (`public/manifest.webmanifest`, `public/sw.js`). The service worker only serves `public/offline.html` when a page can't load; it caches nothing else, so every deploy is live immediately. Android shows Chrome's install popup from the **Install** button; iPhone and Facebook's in-app browser get step-by-step instructions.

---

## How it works

- **Carts are per device.** A random `device_id` and the cart live only in `localStorage` (`mgl_cart_v1`). Nothing is shared server-side, so two phones can never merge carts. The cart clears only after an order succeeds. Sold-out or unavailable items are flagged and block checkout.
- **Scheduling.** The earliest date is tomorrow (Asia/Manila), or the day after once the cutoff passes. Blocked dates and max days are enforced in the date picker and again on the server. Every store currently delivers 12:00 PM to 8:00 PM (set per store in `scripts/menu-data.mjs`). Slots are 1-hour windows inside the overlap of every cart store's hours. If the stores don't overlap, checkout is blocked with a message naming the stores.
- **Orders.** `place_order` re-validates everything: prices, sold-out, store availability, date, slot, phone and email format, the honeypot, and 5 orders per phone per day. It then returns `MGL-YYMMDD-XXXX` plus a 32-character random tracking token.
- **Tracking.** `/track/<token>` reads one order via `get_order_by_token` (customer-safe fields only). Anon users have no table access to orders at all. Every change pings a Realtime broadcast channel named after the token, and the page re-fetches, so status updates appear live.
- **Admin.** Every status change goes through `admin_order_action`, which validates the transition, writes `order_status_history` with the admin's email, and pushes the update to the customer.
- **Edit Order.** `/admin/orders/<id>/edit` saves through `admin_edit_order`: it checks the customer details, schedule (store hours), items (menu prices, sold out, options), the COD limit and what the order's status allows, recalculates subtotal and total (food subtotal + delivery fee), keeps the order id, number, tracking link, status and payment records, and records who changed what in `order_edits` (admin only, never on the tracking page). Cancelled orders can't be edited; once out for delivery or delivered, only the customer details and delivery fee can change.

## Tests

```bash
npm run test:db     # runs every migration in an in-process Postgres (PGlite) and checks prices, RLS, RPCs, scheduling, anti-spam, the admin flow
npm run typecheck
```
