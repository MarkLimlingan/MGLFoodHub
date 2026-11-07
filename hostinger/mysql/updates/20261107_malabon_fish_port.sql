-- Wet Foods is now called Malabon Fish Port (the store and its category).
-- Only the names change: the slug stays wet-foods, so /store/wet-foods,
-- Request a Fish, the home page section and past orders keep working.
-- Run in phpMyAdmin → u406950319_MGLFOODHUB → SQL. Safe to run more than once.
UPDATE stores SET name = 'Malabon Fish Port' WHERE slug = 'wet-foods';
UPDATE hub_categories SET name = 'Malabon Fish Port' WHERE slug = 'wet-foods';
