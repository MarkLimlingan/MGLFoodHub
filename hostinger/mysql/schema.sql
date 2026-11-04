-- =====================================================================
-- MGL Food Hub — MySQL / MariaDB schema (Hostinger)
-- Same tables and ids as the Supabase version, so the menu copies across
-- as is. Import in phpMyAdmin (select the database → Import), then import
-- data.local.sql made by npm run export:supabase. Safe to import again.
--
-- Security that Postgres did with RLS, grants and triggers (prices can't
-- change, COD limit, admins only) is done by the PHP API in
-- hostinger/public_html/api. Times are stored in UTC.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hub_categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  slug VARCHAR(191) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  UNIQUE KEY hub_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stores (
  id CHAR(36) NOT NULL PRIMARY KEY,
  slug VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  tagline TEXT NULL,
  hub_category_id CHAR(36) NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  address TEXT NULL,
  contact_note TEXT NULL,
  cover_image_url TEXT NULL,
  menu_image_url TEXT NULL,
  is_accepting_orders TINYINT(1) NOT NULL DEFAULT 1,
  sort INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY stores_slug (slug),
  CONSTRAINT stores_hours_check CHECK (close_time > open_time),
  CONSTRAINT stores_category_fk FOREIGN KEY (hub_category_id) REFERENCES hub_categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menu_sections (
  id CHAR(36) NOT NULL PRIMARY KEY,
  store_id CHAR(36) NOT NULL,
  name VARCHAR(191) NOT NULL,
  note TEXT NULL,
  sort INT NOT NULL DEFAULT 0,
  KEY menu_sections_store_idx (store_id),
  CONSTRAINT menu_sections_store_fk FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) NOT NULL PRIMARY KEY,
  store_id CHAR(36) NOT NULL,
  section_id CHAR(36) NOT NULL,
  name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  badge ENUM('best_seller', 'new', 'all_time_favorite') NULL,
  image_url TEXT NULL,
  is_sold_out TINYINT(1) NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY products_store_idx (store_id),
  KEY products_section_idx (section_id),
  CONSTRAINT products_store_fk FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
  CONSTRAINT products_section_fk FOREIGN KEY (section_id) REFERENCES menu_sections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_variants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  label VARCHAR(191) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  addon_price DECIMAL(10,2) NULL,
  is_sold_out TINYINT(1) NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY product_variants_product_idx (product_id),
  CONSTRAINT product_variants_price_check CHECK (price >= 0 AND (addon_price IS NULL OR addon_price >= 0)),
  CONSTRAINT product_variants_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS option_groups (
  id CHAR(36) NOT NULL PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  name VARCHAR(191) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  KEY option_groups_product_idx (product_id),
  CONSTRAINT option_groups_product_fk FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS option_choices (
  id CHAR(36) NOT NULL PRIMARY KEY,
  group_id CHAR(36) NOT NULL,
  label VARCHAR(191) NOT NULL,
  price_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort INT NOT NULL DEFAULT 0,
  KEY option_choices_group_idx (group_id),
  CONSTRAINT option_choices_group_fk FOREIGN KEY (group_id) REFERENCES option_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Admins (replaces Supabase Auth for the admin pages)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  UNIQUE KEY admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only a SHA-256 of each token is kept, so a copy of the database can't be used to sign in.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  admin_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  KEY admin_sessions_admin_idx (admin_id),
  CONSTRAINT admin_sessions_admin_fk FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Customers signed in with Google (checked against Google by the API)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  google_sub VARCHAR(191) NOT NULL,
  google_name VARCHAR(191) NULL,
  google_email VARCHAR(191) NULL,
  google_picture TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  KEY customer_sessions_sub_idx (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_number VARCHAR(32) NOT NULL,
  tracking_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_id VARCHAR(64) NULL,
  customer_name VARCHAR(191) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(191) NOT NULL,
  social_media VARCHAR(255) NULL,
  address TEXT NOT NULL,
  barangay VARCHAR(191) NOT NULL,
  city VARCHAR(191) NOT NULL,
  landmark TEXT NULL,
  delivery_date DATE NOT NULL,
  delivery_slot VARCHAR(32) NOT NULL,
  payment_method ENUM('cod', 'gcash', 'maribank', 'gotyme') NOT NULL,
  payment_status ENUM('cod_unpaid', 'pending_verification', 'paid', 'rejected') NOT NULL,
  order_status ENUM('processing', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'processing',
  gcash_reference VARCHAR(64) NULL,
  gcash_proof_path VARCHAR(255) NULL,
  payment_rejection_reason TEXT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  paid_amount DECIMAL(10,2) NULL,
  customer_notes TEXT NULL,
  admin_notes TEXT NULL,
  cancel_reason TEXT NULL,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  cancel_request_reason TEXT NULL,
  google_sub VARCHAR(191) NULL,
  google_name VARCHAR(191) NULL,
  google_email VARCHAR(191) NULL,
  google_picture TEXT NULL,
  verified_with ENUM('google', 'facebook') NULL,
  email_sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY orders_order_number (order_number),
  UNIQUE KEY orders_tracking_token (tracking_token),
  KEY orders_delivery_date_idx (delivery_date),
  KEY orders_created_at_idx (created_at),
  KEY orders_updated_at_idx (updated_at),
  KEY orders_phone_idx (phone),
  KEY orders_google_sub_idx (google_sub),
  KEY orders_device_idx (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  variant_id CHAR(36) NOT NULL,
  store_name_snapshot VARCHAR(191) NOT NULL,
  section_name_snapshot VARCHAR(191) NULL,
  product_name_snapshot VARCHAR(191) NOT NULL,
  variant_label_snapshot VARCHAR(191) NOT NULL,
  options_snapshot JSON NOT NULL,
  unit_price_snapshot DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  line_no INT NOT NULL DEFAULT 0,
  KEY order_items_order_idx (order_id),
  KEY order_items_store_idx (store_id),
  CONSTRAINT order_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_items_store_fk FOREIGN KEY (store_id) REFERENCES stores (id),
  CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT order_items_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: an order status, or an event such as payment_confirmed,
-- payment_rejected, proof_resubmitted, cancel_requested, delivery_fee_updated.
-- note: shown to the customer (reasons). Internal notes live in orders.admin_notes.
CREATE TABLE IF NOT EXISTS order_status_history (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  status VARCHAR(64) NOT NULL,
  note TEXT NULL,
  changed_by CHAR(36) NULL,
  changed_by_email VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY order_status_history_order_idx (order_id, created_at),
  CONSTRAINT order_status_history_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_status_history_admin_fk FOREIGN KEY (changed_by) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS call_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  result ENUM('answered', 'no_answer', 'wrong_number') NOT NULL,
  note TEXT NULL,
  created_by CHAR(36) NULL,
  created_by_email VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY call_logs_order_idx (order_id),
  CONSTRAINT call_logs_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT call_logs_admin_fk FOREIGN KEY (created_by) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin → Edit Order history (admins only; never on the tracking page).
-- changes: [{ "field": "delivery_date", "from": "2026-11-06", "to": "2026-11-07" }, …]
CREATE TABLE IF NOT EXISTS order_edits (
  id CHAR(36) NOT NULL PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  changes JSON NOT NULL,
  edited_by CHAR(36) NULL,
  edited_by_email VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY order_edits_order_idx (order_id, created_at),
  CONSTRAINT order_edits_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_edits_admin_fk FOREIGN KEY (edited_by) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Settings and limits
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sign in attempts and uploads, so nobody can guess passwords or fill the disk.
CREATE TABLE IF NOT EXISTS rate_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(32) NOT NULL,
  subject VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY rate_events_lookup (kind, subject, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (`key`, value) VALUES
  ('gcash_account_name', '""'),
  ('gcash_number', '""'),
  ('gcash_qr_url', '""'),
  ('maribank_account_name', '""'),
  ('maribank_number', '""'),
  ('maribank_qr_url', '""'),
  ('gotyme_account_name', '""'),
  ('gotyme_number', '""'),
  ('gotyme_qr_url', '""'),
  ('cutoff_time', '"20:00"'),
  ('max_days_ahead', '30'),
  ('blocked_dates', '[]'),
  ('delivery_fee_note', '"Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries)."'),
  ('email_notifications_enabled', 'false'),
  ('max_orders_per_phone_per_day', '5'),
  ('require_google_login', 'false'),
  ('owner_phone', '""'),
  ('ordering_guidelines', '["We deliver via Grab within Metro Manila from 12:00 PM to 8:00 PM.", "Pay by Cash on Delivery (COD) for orders up to ₱2,000, or online via GCash, MariBank or GoTyme.", "Orders are for booking (scheduled delivery) only. Same day delivery is not available.", "We will confirm your order by text or call.", "Menu prices are VAT inclusive and may vary or be subject to change by the merchant. Higher delivery fees may also apply for long distance deliveries.", "You can order from all merchants in the app and pay only one delivery fee."]');
