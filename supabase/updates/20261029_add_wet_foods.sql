-- =====================================================================
-- MGL Food Hub: add the Wet Foods merchant (2026-10-29).
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
-- Adds only the Wet Foods category, store, sections, products and prices,
-- and the new display order. Nothing else in the menu is touched.
-- GENERATED from scripts/menu-data.mjs (same ids as the full seed).
-- =====================================================================
begin;

insert into public.hub_categories (id, name, slug, sort) values
  ('fb5b211c-c4e1-5839-b1e0-b68faac47bea', 'Puto & Kakanin', 'puto-kakanin', 1),
  ('5766fd4d-eed3-5778-a5d9-bb78a2db89aa', 'Pancit & Bilao', 'pancit-bilao', 2),
  ('89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', 'Restaurants', 'restaurants', 3),
  ('c9c23d50-ba50-5457-8395-6aa3eb5991d8', 'Wet Foods', 'wet-foods', 4),
  ('506ed5af-9b3b-5c30-b057-8b241bcaebec', 'Carinderia', 'carinderia', 5),
  ('dcbee9ff-c279-51b4-a25e-d4a9d966b4f1', 'Merienda & Street Food', 'merienda-street-food', 6),
  ('95cfcde3-e9a6-5cc2-a0c5-2f2e6ca365ff', 'Diner', 'diner', 7),
  ('ad7877f7-2ab6-5c6f-a55d-06d24303a2e3', 'Sisig & Crispy Favorites', 'sisig-crispy-favorites', 8)
on conflict (id) do update set sort = excluded.sort;

insert into public.stores (id, slug, name, tagline, hub_category_id, open_time, close_time, address, contact_note, cover_image_url, menu_image_url, is_accepting_orders, sort) values
  ('28680e60-df65-58e8-9bdc-5d2200031ab7', 'wet-foods', 'Wet Foods', null, 'c9c23d50-ba50-5457-8395-6aa3eb5991d8', '12:00', '20:00', null, null, null, null, true, 11)
on conflict (id) do update set sort = excluded.sort, tagline = excluded.tagline, open_time = excluded.open_time, close_time = excluded.close_time;

insert into public.menu_sections (id, store_id, name, note, sort) values
  ('e95f003c-b2a0-5fea-8070-0c701a5a9991', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'Fresh Shrimp', null, 1),
  ('1fdd8959-2ad4-55c1-ad47-a11f638b2db6', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'Salmon', null, 2),
  ('d6a8c9cf-434c-5a11-9ac7-3204fbc45501', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'Tilapia', null, 3),
  ('8b57c666-d8bd-519e-8567-03051b316b25', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'Other Fresh Fish', null, 4),
  ('5be9d08a-f68c-57dd-b7c8-969b52f7de17', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'Dagupan Bangus', null, 5)
on conflict (id) do nothing;

insert into public.products (id, store_id, section_id, name, description, badge, image_url, sort) values
  ('4508e588-f58f-56ef-940d-29257d1b9dae', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'e95f003c-b2a0-5fea-8070-0c701a5a9991', 'Fresh Shrimp (Suahe)', 'Price per kilo.', null, '/products/wet-foods-fresh-shrimp.jpg', 1),
  ('44d64f67-0b41-59d9-ad97-4b9d3e45c701', '28680e60-df65-58e8-9bdc-5d2200031ab7', '1fdd8959-2ad4-55c1-ad47-a11f638b2db6', 'Salmon Belly', null, null, '/products/wet-foods-salmon-belly.jpg', 1),
  ('cf6738ce-6c5b-5bb6-948d-1d6211768903', '28680e60-df65-58e8-9bdc-5d2200031ab7', '1fdd8959-2ad4-55c1-ad47-a11f638b2db6', 'Salmon Head', null, null, '/products/wet-foods-salmon-head.jpg', 2),
  ('ca1e52bf-c7dd-531b-acbd-3b02787b68be', '28680e60-df65-58e8-9bdc-5d2200031ab7', 'd6a8c9cf-434c-5a11-9ac7-3204fbc45501', 'Tilapia', null, null, '/products/wet-foods-tilapia.jpg', 1),
  ('b4f79c3f-be21-57d2-bcea-8bb5c518ef1c', '28680e60-df65-58e8-9bdc-5d2200031ab7', '8b57c666-d8bd-519e-8567-03051b316b25', 'Tulingan', null, null, '/products/wet-foods-tulingan.jpg', 1),
  ('3afeabe1-1e67-5d96-a32e-d60798d959a2', '28680e60-df65-58e8-9bdc-5d2200031ab7', '8b57c666-d8bd-519e-8567-03051b316b25', 'Alumahan', null, null, '/products/wet-foods-alumahan.jpg', 2),
  ('5c413ead-1c37-5cc4-ae8c-6b7b70379715', '28680e60-df65-58e8-9bdc-5d2200031ab7', '8b57c666-d8bd-519e-8567-03051b316b25', 'Hasa', null, null, '/products/wet-foods-hasa.jpg', 3),
  ('5788c405-cc66-5337-9d96-cf5cc4cbeddb', '28680e60-df65-58e8-9bdc-5d2200031ab7', '8b57c666-d8bd-519e-8567-03051b316b25', 'Bisugong Dilat', null, null, '/products/wet-foods-bisugong-dilat.jpg', 4),
  ('a671c602-6c8f-536b-b793-22ae6b038cd0', '28680e60-df65-58e8-9bdc-5d2200031ab7', '5be9d08a-f68c-57dd-b7c8-969b52f7de17', 'Dagupan Bangus', null, null, '/products/wet-foods-dagupan-bangus.jpg', 1)
on conflict (id) do update set name = excluded.name, image_url = coalesce(products.image_url, excluded.image_url);

insert into public.product_variants (id, product_id, label, price, addon_price, sort) values
  ('e48b031c-d232-52cd-84ef-72e8fa30abc3', '4508e588-f58f-56ef-940d-29257d1b9dae', 'Small (24 pcs/kg)', 750.00, null, 1),
  ('42d31e83-791f-57cb-b5dc-c9b1db7264bc', '4508e588-f58f-56ef-940d-29257d1b9dae', 'Medium (31 pcs/kg)', 800.00, null, 2),
  ('247e9d0d-5b68-50f5-82fe-2b7f427a2ae6', '4508e588-f58f-56ef-940d-29257d1b9dae', 'Large (45 pcs/kg)', 850.00, null, 3),
  ('f3c19565-7583-53ce-b56d-e3554dea86af', '44d64f67-0b41-59d9-ad97-4b9d3e45c701', '500g', 320.00, null, 1),
  ('6ae5a16e-ef7d-5a1a-9040-e32bedb669b3', 'cf6738ce-6c5b-5bb6-948d-1d6211768903', 'Per kilo', 250.00, null, 1),
  ('b1d92a17-fcb5-5f12-b156-bc93c52c3941', 'ca1e52bf-c7dd-531b-acbd-3b02787b68be', 'Large', 250.00, null, 1),
  ('a0bb6a2d-d747-558a-b889-df18ab19439b', 'ca1e52bf-c7dd-531b-acbd-3b02787b68be', 'Medium', 230.00, null, 2),
  ('4f358c80-9d2c-5965-84b7-483fdbfa052f', 'b4f79c3f-be21-57d2-bcea-8bb5c518ef1c', 'Regular', 310.00, null, 1),
  ('8a7a2ff2-6554-588d-9492-797568b33c48', '3afeabe1-1e67-5d96-a32e-d60798d959a2', 'Regular', 550.00, null, 1),
  ('837776b7-5626-5ec1-b1ba-7142e7205514', '5c413ead-1c37-5cc4-ae8c-6b7b70379715', 'Small', 600.00, null, 1),
  ('e99ae63e-3c7c-5c80-be02-11aa1e651321', '5c413ead-1c37-5cc4-ae8c-6b7b70379715', 'Big', 650.00, null, 2),
  ('8114eea4-cf81-5f61-badb-18268430cda1', '5788c405-cc66-5337-9d96-cf5cc4cbeddb', 'Regular', 700.00, null, 1),
  ('839f3d66-eda7-5aa2-adda-71e3ab5d6d39', 'a671c602-6c8f-536b-b793-22ae6b038cd0', '1 to 1.2 kg', 400.00, null, 1),
  ('e7d5637c-34ef-5bf1-a12a-b17419cc5018', 'a671c602-6c8f-536b-b793-22ae6b038cd0', '400g, 3 pcs', 440.00, null, 2),
  ('81ae53e0-f73d-5db2-8351-e3ac80ef1d39', 'a671c602-6c8f-536b-b793-22ae6b038cd0', '300g, 4 pcs', 450.00, null, 3)
on conflict (id) do nothing;

-- Display order: Wet Foods sits right after Rody Day's (the last restaurant).
update public.stores set sort = 3 where slug = 'hazels-special-puto';
update public.stores set sort = 13 where slug = 'aling-melys-carinderia';
update public.stores set sort = 4 where slug = 'okoy-ni-jay-r';
update public.stores set sort = 5 where slug = 'aurings-special-pancit-malabon';
update public.stores set sort = 6 where slug = 'normas-special-pancit-bilao';
update public.stores set sort = 7 where slug = 'balsa-sa-niugan';
update public.stores set sort = 8 where slug = 'original-benjie-puto-pao';
update public.stores set sort = 14 where slug = 'raves-diner';
update public.stores set sort = 9 where slug = 'mary-jay';
update public.stores set sort = 10 where slug = 'rody-days';
update public.stores set sort = 12 where slug = 'anny-dading-peachy-peachy';
update public.stores set sort = 2 where slug = 'judy-anns-crispy-pata';
update public.stores set sort = 1 where slug = 'sisig-ni-mutik';
update public.stores set sort = 11 where slug = 'wet-foods';

commit;
