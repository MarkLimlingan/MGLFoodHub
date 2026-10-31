-- =====================================================================
-- MGL Food Hub: QA fixes (2026-11-02).
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
--  * orders.paid_amount: what was paid when a paid order is edited (balance due / refund due)
--  * Tracking page: asks for the payment screenshot when an order was switched to online payment
--  * Edit Order: same day and blocked dates refused, customer told when the order changes,
--    "Mark balance collected / refund sent"
--  * Owner contact number: must contain at least 7 digits
-- Copied from supabase/migrations (the source of truth). Nothing else is changed.
-- =====================================================================

alter table public.orders add column if not exists paid_amount numeric(10,2);

create or replace function public.get_order_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'tracking_token', o.tracking_token,
    'customer_name', o.customer_name,
    'phone', o.phone,
    'address', o.address,
    'barangay', o.barangay,
    'city', o.city,
    'landmark', o.landmark,
    'delivery_date', o.delivery_date,
    'delivery_slot', o.delivery_slot,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'order_status', o.order_status,
    'gcash_reference', o.gcash_reference,
    'payment_rejection_reason', o.payment_rejection_reason,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'customer_notes', o.customer_notes,
    'cancel_reason', o.cancel_reason,
    'cancel_requested', o.cancel_requested,
    -- Online payment with no screenshot yet (rejected, or switched to online by the admin): the page asks for one.
    'needs_payment_proof', (o.payment_method <> 'cod' and o.order_status = 'processing'
      and (o.payment_status = 'rejected' or (o.payment_status = 'pending_verification' and o.gcash_proof_path is null))),
    'amount_paid', o.paid_amount,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_name', i.store_name_snapshot,
        'section_name', i.section_name_snapshot,
        'product_name', i.product_name_snapshot,
        'variant_label', i.variant_label_snapshot,
        'options', i.options_snapshot,
        'unit_price', i.unit_price_snapshot,
        'quantity', i.quantity,
        'line_total', i.line_total
      ) order by i.line_no)
      from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', h.status, 'note', h.note, 'created_at', h.created_at
      ) order by h.created_at, h.id)
      from public.order_status_history h where h.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and o.tracking_token = p_token;
$$;

create or replace function public.resubmit_gcash_proof(p_token text, p_ref text, p_path text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_ref text := nullif(upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g')), '');
begin
  select * into o from public.orders where tracking_token = p_token for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if o.payment_method = 'cod' or o.order_status <> 'processing'
     or not (o.payment_status = 'rejected' or (o.payment_status = 'pending_verification' and o.gcash_proof_path is null)) then
    raise exception 'This order is not waiting for a new payment proof.';
  end if;
  if v_ref is null or v_ref !~ '^[A-Z0-9-]{4,40}$' then
    raise exception 'Please enter your % reference number.', public.payment_label(o.payment_method::text);
  end if;
  if p_path is null or p_path !~ '^proofs/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$' or not public.proof_exists(p_path) then
    raise exception 'Please upload a screenshot of your % payment.', public.payment_label(o.payment_method::text);
  end if;

  update public.orders
     set payment_status = 'pending_verification',
         gcash_reference = v_ref,
         gcash_proof_path = p_path,
         payment_rejection_reason = null
   where id = o.id;
  insert into public.order_status_history (order_id, status, note)
  values (o.id, 'proof_resubmitted', 'New ' || public.payment_label(o.payment_method::text) || ' payment proof submitted (Ref: ' || v_ref || ').');
end $$;

-- ===================== migrations/20261031000100_edit_order.sql =====================
-- =====================================================================
-- MGL Food Hub — Edit Order (admin)
-- One function saves every change to an existing order (customer,
-- delivery, items, delivery fee, payment method) after checking it,
-- recalculates the totals from the menu prices, and records who changed
-- what in order_edits. The order keeps its id, number, tracking link,
-- status and payment records. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Edit history (admin only; never part of the customer tracking page)
-- changes: [{ "field": "delivery_date", "from": "2026-11-06", "to": "2026-11-07" }, …]
-- Item changes use field "item" with readable text ("2× Special Okoy").
-- ---------------------------------------------------------------------
create table if not exists public.order_edits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  changes jsonb not null,
  edited_by uuid references auth.users(id) on delete set null,
  edited_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists order_edits_order_idx on public.order_edits(order_id, created_at desc);

revoke all on public.order_edits from anon, authenticated;
grant select on public.order_edits to authenticated;
alter table public.order_edits enable row level security;
drop policy if exists "admin read" on public.order_edits;
create policy "admin read" on public.order_edits for select to authenticated using (public.is_admin());

-- Readable line for the edit history: "2× Bangus (4 pcs) · Spicy".
create or replace function public.order_line_text(p_qty int, p_product text, p_variant text, p_options jsonb)
returns text
language sql
immutable
as $$
  select p_qty || '× ' || p_product
      || case when p_variant <> 'Regular' then ' (' || p_variant || ')' else '' end
      || coalesce((
           select ' · ' || string_agg(case when o->>'group' = 'Extra Toppings' then 'Extra toppings' else o->>'choice' end, ', ')
           from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) as o
         ), '');
$$;

-- ---------------------------------------------------------------------
-- Admin: edit an order
-- p_changes holds the full edited order; keys left out stay as they are:
--   customer_name, phone, email, address, barangay, city, landmark,
--   delivery_date, delivery_slot, delivery_fee, payment_method,
--   items: [{ id?: existing order_items.id, variant_id, quantity, choice_ids?, extra_toppings? }]
-- p_expected_updated_at: the order's updated_at when the editor opened, so
-- a change made meanwhile (status, payment, another admin) is never overwritten.
-- ---------------------------------------------------------------------
create or replace function public.admin_edit_order(
  p_order_id uuid,
  p_changes jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
  c jsonb := coalesce(p_changes, '{}'::jsonb);
  v_uid uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_changes jsonb := '[]'::jsonb;
  -- edited values (default: unchanged)
  v_name text;
  v_phone text;
  v_cust_email text;
  v_address text;
  v_barangay text;
  v_city text;
  v_landmark text;
  v_date date;
  v_slot text;
  v_fee numeric(10,2);
  v_method text;
  v_payment_status public.payment_status;
  v_paid numeric(10,2);
  -- items
  v_items_given boolean := jsonb_typeof(c->'items') = 'array';
  v_item jsonb;
  v_pos int;
  v_qty int;
  v_item_id uuid;
  v_variant_id uuid;
  v_old public.order_items;
  v_v record;
  v_g record;
  v_cc record;
  v_n int;
  v_choice_ids uuid[];
  v_raw_choice text;
  v_unit numeric(10,2);
  v_options jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_kept uuid[] := '{}';
  v_subtotal numeric(10,2);
  v_store_ids uuid[] := '{}';
  v_items_changed boolean := false;
  v_line jsonb;
  v_text_old text;
  v_text_new text;
  -- schedule check
  v_slot_start time;
  v_slot_end time;
  v_max_open time;
  v_min_close time;
  v_hours text;
  v_schedule_locked boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if p_expected_updated_at is not null and o.updated_at <> p_expected_updated_at then
    raise exception 'This order was updated while you were editing it (for example a status or payment change). Reload to see the latest, then make your changes again.';
  end if;
  if o.order_status = 'cancelled' then
    raise exception 'Cancelled orders cannot be edited.';
  end if;
  v_schedule_locked := o.order_status not in ('processing', 'confirmed', 'preparing');

  -- Customer details: same rules as checkout.
  v_name := case when c ? 'customer_name' then left(btrim(coalesce(c->>'customer_name', '')), 120) else o.customer_name end;
  v_phone := case when c ? 'phone' then public.normalize_ph_phone(c->>'phone') else o.phone end;
  v_cust_email := case when c ? 'email' then left(lower(btrim(coalesce(c->>'email', ''))), 200) else o.email end;
  v_address := case when c ? 'address' then left(btrim(coalesce(c->>'address', '')), 300) else o.address end;
  v_barangay := case when c ? 'barangay' then left(btrim(coalesce(c->>'barangay', '')), 120) else o.barangay end;
  v_city := case when c ? 'city' then left(btrim(coalesce(c->>'city', '')), 120) else o.city end;
  v_landmark := case when c ? 'landmark' then nullif(left(btrim(coalesce(c->>'landmark', '')), 200), '') else o.landmark end;

  if length(v_name) < 2 then
    raise exception 'Please enter the customer''s full name.';
  end if;
  if v_phone is null then
    raise exception 'Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).';
  end if;
  if v_cust_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if length(v_address) < 4 or length(v_barangay) < 2 or length(v_city) < 2 then
    raise exception 'Please complete the delivery address (house/unit and street, barangay, city).';
  end if;

  -- Delivery date and slot
  if c ? 'delivery_date' then
    if coalesce(c->>'delivery_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Please choose a delivery date.';
    end if;
    v_date := (c->>'delivery_date')::date;
  else
    v_date := o.delivery_date;
  end if;
  v_slot := case when c ? 'delivery_slot' then btrim(coalesce(c->>'delivery_slot', '')) else o.delivery_slot end;

  if (v_date <> o.delivery_date or v_slot <> o.delivery_slot) and v_schedule_locked then
    raise exception 'This order is already %, so the delivery schedule can no longer be changed.',
      case o.order_status when 'out_for_delivery' then 'out for delivery' else o.order_status::text end;
  end if;
  -- A new date follows the checkout rules: no same day delivery, no blocked dates.
  if v_date <> o.delivery_date then
    if v_date < v_today then
      raise exception 'The delivery date cannot be in the past.';
    end if;
    if v_date = v_today then
      raise exception 'Same day delivery is not available. Please choose tomorrow or a later date.';
    end if;
    if v_date > v_today + 365 then
      raise exception 'Please choose a delivery date within the next year.';
    end if;
    if coalesce(public.setting('blocked_dates'), '[]'::jsonb) ? to_char(v_date, 'YYYY-MM-DD') then
      raise exception 'We are not accepting deliveries on % (blocked in Settings). Please choose another date.', to_char(v_date, 'Mon DD, YYYY');
    end if;
  end if;

  -- Delivery fee: total is always food subtotal + delivery fee.
  if c ? 'delivery_fee' then
    begin
      v_fee := round((c->>'delivery_fee')::numeric, 2);
    exception when others then
      v_fee := null;
    end;
    if v_fee is null or v_fee < 0 or v_fee > 100000 then
      raise exception 'Please enter a valid delivery fee.';
    end if;
  else
    v_fee := o.delivery_fee;
  end if;

  -- Payment method: only before the order is confirmed and paid.
  v_method := coalesce(nullif(c->>'payment_method', ''), o.payment_method::text);
  if v_method not in ('cod', 'gcash', 'maribank', 'gotyme') then
    raise exception 'Please choose a payment method.';
  end if;
  v_payment_status := o.payment_status;
  if v_method <> o.payment_method::text then
    if o.order_status <> 'processing' or o.payment_status = 'paid' then
      raise exception 'The payment method can only be changed before the order is confirmed and paid.';
    end if;
    if v_method = 'cod' then
      v_payment_status := 'cod_unpaid';
    elsif o.payment_method = 'cod' then
      v_payment_status := 'pending_verification';
    end if;
  end if;

  -- Items: the full new list. Kept lines keep their snapshots; every new
  -- price is re-read from the menu (prices are fixed, see prevent_price_change).
  if v_items_given then
    if jsonb_array_length(c->'items') = 0 then
      raise exception 'An order needs at least one item. To drop everything, cancel the order instead.';
    end if;
    if jsonb_array_length(c->'items') > 60 then
      raise exception 'Too many items in one order.';
    end if;

    for v_item, v_pos in select value, ordinality from jsonb_array_elements(c->'items') with ordinality loop
      begin
        v_qty := (v_item->>'quantity')::int;
      exception when others then
        v_qty := null;
      end;
      if v_qty is null or v_qty < 1 or v_qty > 99 then
        raise exception 'Each item needs a quantity from 1 to 99.';
      end if;
      v_item_id := public.try_uuid(v_item->>'id');
      v_variant_id := public.try_uuid(v_item->>'variant_id');

      if v_item_id is not null then
        -- An item already in this order: quantity and size can change.
        select * into v_old from public.order_items where id = v_item_id and order_id = o.id;
        if not found then
          raise exception 'One of the items is no longer part of this order. Reload and try again.';
        end if;
        if v_item_id = any(v_kept) then
          raise exception 'The same order item was listed twice.';
        end if;
        v_kept := array_append(v_kept, v_item_id);
        v_variant_id := coalesce(v_variant_id, v_old.variant_id);

        if v_variant_id = v_old.variant_id then
          v_line := jsonb_build_object(
            'id', v_old.id, 'store_id', v_old.store_id, 'product_id', v_old.product_id, 'variant_id', v_old.variant_id,
            'store_name', v_old.store_name_snapshot, 'section_name', v_old.section_name_snapshot,
            'product_name', v_old.product_name_snapshot, 'variant_label', v_old.variant_label_snapshot,
            'options', v_old.options_snapshot, 'unit_price', v_old.unit_price_snapshot, 'quantity', v_qty);
        else
          select pv.id as variant_id, pv.label, pv.price, pv.addon_price, pv.is_sold_out as variant_sold_out,
                 p.id as product_id, p.name as product_name, p.is_sold_out as product_sold_out,
                 s.id as store_id, s.name as store_name, s.is_accepting_orders, ms.name as section_name
            into v_v
          from public.product_variants pv
          join public.products p on p.id = pv.product_id
          join public.stores s on s.id = p.store_id
          join public.menu_sections ms on ms.id = p.section_id
          where pv.id = v_variant_id;
          if not found then
            raise exception 'Please choose a size of % for that item.', v_old.product_name_snapshot;
          end if;
          if v_v.product_id <> v_old.product_id then
            raise exception 'Please choose a size of % for that item.', v_old.product_name_snapshot;
          end if;
          if v_v.product_sold_out or v_v.variant_sold_out then
            raise exception '% (%) is SOLD OUT.', v_v.product_name, v_v.label;
          end if;
          if not v_v.is_accepting_orders then
            raise exception '% is temporarily not accepting orders.', v_v.store_name;
          end if;
          -- Same choices as before; Extra Toppings follow the new size's add-on price.
          v_unit := v_v.price;
          v_options := '[]'::jsonb;
          for v_g in select value as opt from jsonb_array_elements(v_old.options_snapshot) loop
            if v_g.opt->>'group' = 'Extra Toppings' then
              if v_v.addon_price is null then
                raise exception 'Extra toppings are not available for % (%).', v_v.product_name, v_v.label;
              end if;
              v_unit := v_unit + v_v.addon_price;
              v_options := v_options || jsonb_build_array(jsonb_set(v_g.opt, '{price_delta}', to_jsonb(v_v.addon_price)));
            else
              v_unit := v_unit + coalesce((v_g.opt->>'price_delta')::numeric, 0);
              v_options := v_options || jsonb_build_array(v_g.opt);
            end if;
          end loop;
          v_line := jsonb_build_object(
            'id', v_old.id, 'store_id', v_v.store_id, 'product_id', v_v.product_id, 'variant_id', v_v.variant_id,
            'store_name', v_v.store_name, 'section_name', v_v.section_name, 'product_name', v_v.product_name,
            'variant_label', v_v.label, 'options', v_options, 'unit_price', v_unit, 'quantity', v_qty);
        end if;
      else
        -- A new item: checked and priced exactly like checkout.
        if v_variant_id is null then
          raise exception 'One of the new items is invalid. Please choose it again.';
        end if;
        select pv.id as variant_id, pv.label, pv.price, pv.addon_price, pv.is_sold_out as variant_sold_out,
               p.id as product_id, p.name as product_name, p.is_sold_out as product_sold_out,
               s.id as store_id, s.name as store_name, s.is_accepting_orders, ms.name as section_name
          into v_v
        from public.product_variants pv
        join public.products p on p.id = pv.product_id
        join public.stores s on s.id = p.store_id
        join public.menu_sections ms on ms.id = p.section_id
        where pv.id = v_variant_id;
        if not found then
          raise exception 'One of the new items is no longer on the menu.';
        end if;
        if v_v.product_sold_out or v_v.variant_sold_out then
          raise exception '% (%) from % is SOLD OUT.', v_v.product_name, v_v.label, v_v.store_name;
        end if;
        if not v_v.is_accepting_orders then
          raise exception '% is temporarily not accepting orders.', v_v.store_name;
        end if;

        v_unit := v_v.price;
        v_options := '[]'::jsonb;
        v_choice_ids := '{}';
        if jsonb_typeof(v_item->'choice_ids') = 'array' then
          for v_raw_choice in select value from jsonb_array_elements_text(v_item->'choice_ids') loop
            if public.try_uuid(v_raw_choice) is null then
              raise exception 'Invalid option selected for %.', v_v.product_name;
            end if;
            v_choice_ids := array_append(v_choice_ids, public.try_uuid(v_raw_choice));
          end loop;
        end if;
        if exists (
          select 1 from unnest(v_choice_ids) as x(id)
          where not exists (
            select 1 from public.option_choices oc
            join public.option_groups og on og.id = oc.group_id
            where oc.id = x.id and og.product_id = v_v.product_id
          )
        ) then
          raise exception 'Invalid option selected for %.', v_v.product_name;
        end if;
        for v_g in
          select og.id, og.name, og.is_required from public.option_groups og
          where og.product_id = v_v.product_id order by og.name
        loop
          select count(*) into v_n from public.option_choices oc where oc.group_id = v_g.id and oc.id = any(v_choice_ids);
          if v_n > 1 then
            raise exception 'Please choose only one % for %.', lower(v_g.name), v_v.product_name;
          elsif v_n = 0 and v_g.is_required then
            raise exception 'Please choose a % for %.', lower(v_g.name), v_v.product_name;
          elsif v_n = 1 then
            select oc.label, oc.price_delta into v_cc from public.option_choices oc
            where oc.group_id = v_g.id and oc.id = any(v_choice_ids);
            v_unit := v_unit + v_cc.price_delta;
            v_options := v_options || jsonb_build_array(jsonb_build_object(
              'group', v_g.name, 'choice', v_cc.label, 'price_delta', v_cc.price_delta));
          end if;
        end loop;
        if coalesce((v_item->>'extra_toppings')::boolean, false) then
          if v_v.addon_price is null then
            raise exception 'Extra toppings are not available for %.', v_v.product_name;
          end if;
          v_unit := v_unit + v_v.addon_price;
          v_options := v_options || jsonb_build_array(jsonb_build_object(
            'group', 'Extra Toppings', 'choice', 'Yes', 'price_delta', v_v.addon_price));
        end if;
        v_line := jsonb_build_object(
          'id', null, 'store_id', v_v.store_id, 'product_id', v_v.product_id, 'variant_id', v_v.variant_id,
          'store_name', v_v.store_name, 'section_name', v_v.section_name, 'product_name', v_v.product_name,
          'variant_label', v_v.label, 'options', v_options, 'unit_price', v_unit, 'quantity', v_qty);
      end if;

      v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('line_no', v_pos));
    end loop;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'store_id', i.store_id, 'product_id', i.product_id, 'variant_id', i.variant_id,
             'store_name', i.store_name_snapshot, 'section_name', i.section_name_snapshot,
             'product_name', i.product_name_snapshot, 'variant_label', i.variant_label_snapshot,
             'options', i.options_snapshot, 'unit_price', i.unit_price_snapshot, 'quantity', i.quantity,
             'line_no', i.line_no) order by i.line_no), '[]'::jsonb)
      into v_lines
    from public.order_items i where i.order_id = o.id;
  end if;

  -- Item changes, for the edit history.
  for v_old in select * from public.order_items where order_id = o.id order by line_no loop
    v_text_old := public.order_line_text(v_old.quantity, v_old.product_name_snapshot, v_old.variant_label_snapshot, v_old.options_snapshot);
    select l into v_line from jsonb_array_elements(v_lines) as l where l->>'id' = v_old.id::text;
    if v_line is null then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'item', 'from', v_text_old, 'to', null));
    else
      v_text_new := public.order_line_text((v_line->>'quantity')::int, v_line->>'product_name', v_line->>'variant_label', v_line->'options');
      if v_text_new <> v_text_old then
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'item', 'from', v_text_old, 'to', v_text_new));
      end if;
    end if;
  end loop;
  for v_line in select l from jsonb_array_elements(v_lines) as l where l->>'id' is null loop
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'item', 'from', null,
      'to', public.order_line_text((v_line->>'quantity')::int, v_line->>'product_name', v_line->>'variant_label', v_line->'options')));
  end loop;
  v_items_changed := jsonb_array_length(v_changes) > 0
    or exists (
      select 1 from jsonb_array_elements(v_lines) as l
      join public.order_items i on i.id::text = l->>'id'
      where i.line_no <> (l->>'line_no')::int
    );
  if v_items_changed and v_schedule_locked then
    raise exception 'This order is already %, so its items can no longer be changed.',
      case o.order_status when 'out_for_delivery' then 'out for delivery' else o.order_status::text end;
  end if;

  select coalesce(sum((l->>'unit_price')::numeric * (l->>'quantity')::int), 0),
         coalesce(array_agg(distinct (l->>'store_id')::uuid), '{}')
    into v_subtotal, v_store_ids
  from jsonb_array_elements(v_lines) as l;

  -- Time slot: a 1-hour slot inside the hours of EVERY store in the order (same as checkout).
  if v_items_changed or v_slot <> o.delivery_slot then
    if v_slot !~ '^\d{2}:\d{2}-\d{2}:\d{2}$' then
      raise exception 'Please choose a delivery time slot.';
    end if;
    v_slot_start := split_part(v_slot, '-', 1)::time;
    v_slot_end := split_part(v_slot, '-', 2)::time;
    select max(open_time), min(close_time),
           string_agg(name || ' (' || to_char(open_time, 'FMHH12:MI AM') || ' to ' || to_char(close_time, 'FMHH12:MI AM') || ')', ', ' order by name)
      into v_max_open, v_min_close, v_hours
    from public.stores where id = any(v_store_ids);
    if v_min_close - v_max_open < interval '1 hour' then
      raise exception 'The stores in this order have no common delivery hours: %.', v_hours;
    end if;
    if v_slot_end - v_slot_start <> interval '1 hour'
       or v_slot_start < v_max_open
       or v_slot_end > v_min_close
       or mod(extract(epoch from (v_slot_start - v_max_open))::int, 3600) <> 0 then
      raise exception 'The time slot is outside the store hours of this order (%). Please choose another slot.', v_hours;
    end if;
  end if;

  -- Cash on Delivery is only for orders up to ₱2,000.
  if v_method = 'cod' and v_subtotal > 2000 and (v_subtotal <> o.subtotal or v_method <> o.payment_method::text) then
    raise exception 'Cash on Delivery is only for orders up to ₱2,000, and this change makes the food subtotal ₱%. Switch the payment to GCash, MariBank or GoTyme, or remove some items.',
      to_char(v_subtotal, 'FM999,999,990.00');
  end if;

  -- Field changes, for the edit history.
  select v_changes || coalesce(jsonb_agg(jsonb_build_object('field', f, 'from', a, 'to', b) order by n), '[]'::jsonb)
    into v_changes
  from (values
    (1, 'customer_name', o.customer_name, v_name),
    (2, 'phone', o.phone, v_phone),
    (3, 'email', o.email, v_cust_email),
    (4, 'address', o.address, v_address),
    (5, 'barangay', o.barangay, v_barangay),
    (6, 'city', o.city, v_city),
    (7, 'landmark', o.landmark, v_landmark),
    (8, 'delivery_date', o.delivery_date::text, v_date::text),
    (9, 'delivery_slot', o.delivery_slot, v_slot),
    (10, 'payment_method', o.payment_method::text, v_method),
    (11, 'subtotal', o.subtotal::text, v_subtotal::text),
    (12, 'delivery_fee', o.delivery_fee::text, v_fee::text),
    (13, 'total', o.total::text, (v_subtotal + v_fee)::text)
  ) as x(n, f, a, b)
  where a is distinct from b;

  if jsonb_array_length(v_changes) = 0 and not v_items_changed then
    raise exception 'There are no changes to save.';
  end if;

  -- Paid online and the food subtotal changes: remember what was actually paid, so the
  -- balance due or refund due shows until the admin marks it settled.
  v_paid := o.paid_amount;
  if v_paid is null and o.payment_method <> 'cod' and o.payment_status = 'paid' and v_subtotal <> o.subtotal then
    v_paid := o.subtotal;
  end if;

  -- Save. Order id, number, tracking token, status and created_at never change.
  if v_items_changed then
    delete from public.order_items where order_id = o.id and not (id = any(v_kept));
    update public.order_items i
       set line_no = (l->>'line_no')::int,
           store_id = (l->>'store_id')::uuid,
           product_id = (l->>'product_id')::uuid,
           variant_id = (l->>'variant_id')::uuid,
           store_name_snapshot = l->>'store_name',
           section_name_snapshot = l->>'section_name',
           product_name_snapshot = l->>'product_name',
           variant_label_snapshot = l->>'variant_label',
           options_snapshot = l->'options',
           unit_price_snapshot = (l->>'unit_price')::numeric,
           quantity = (l->>'quantity')::int,
           line_total = (l->>'unit_price')::numeric * (l->>'quantity')::int
      from jsonb_array_elements(v_lines) as l
     where i.order_id = o.id and i.id::text = l->>'id';
    insert into public.order_items (
      order_id, line_no, store_id, product_id, variant_id, store_name_snapshot, section_name_snapshot,
      product_name_snapshot, variant_label_snapshot, options_snapshot, unit_price_snapshot, quantity, line_total
    )
    select o.id, (l->>'line_no')::int, (l->>'store_id')::uuid, (l->>'product_id')::uuid, (l->>'variant_id')::uuid,
           l->>'store_name', l->>'section_name', l->>'product_name', l->>'variant_label', l->'options',
           (l->>'unit_price')::numeric, (l->>'quantity')::int, (l->>'unit_price')::numeric * (l->>'quantity')::int
    from jsonb_array_elements(v_lines) as l
    where l->>'id' is null;
  end if;

  update public.orders
     set customer_name = v_name, phone = v_phone, email = v_cust_email,
         address = v_address, barangay = v_barangay, city = v_city, landmark = v_landmark,
         delivery_date = v_date, delivery_slot = v_slot,
         payment_method = v_method::public.payment_method, payment_status = v_payment_status,
         payment_rejection_reason = case when v_method = 'cod' then null else payment_rejection_reason end,
         subtotal = v_subtotal, delivery_fee = v_fee, total = v_subtotal + v_fee, paid_amount = v_paid
   where id = o.id;

  -- The delivery fee is shown to the customer, same as Admin → Save fee.
  if v_fee <> o.delivery_fee then
    insert into public.order_status_history (order_id, status, note, changed_by, changed_by_email)
    values (o.id, 'delivery_fee_updated', 'Delivery fee set to ₱' || to_char(v_fee, 'FM999,999,990.00') || '.', v_uid, v_email);
  end if;
  -- Anything else the customer can see on the tracking page: tell them it changed (the details stay private).
  if exists (select 1 from jsonb_array_elements(v_changes) as x where x->>'field' not in ('email', 'delivery_fee', 'total')) then
    insert into public.order_status_history (order_id, status, note, changed_by, changed_by_email)
    values (o.id, 'order_updated', 'Our team updated your order details. Please check them below.', v_uid, v_email);
  end if;

  insert into public.order_edits (order_id, changes, edited_by, edited_by_email)
  values (o.id, v_changes, v_uid, v_email);

  return jsonb_build_object('subtotal', v_subtotal, 'delivery_fee', v_fee, 'total', v_subtotal + v_fee, 'changes', jsonb_array_length(v_changes));
end $$;

-- ---------------------------------------------------------------------
-- Admin: the balance due or refund due of an edited paid order was settled
-- with the customer. Recorded in the edit history.
-- ---------------------------------------------------------------------
create or replace function public.admin_settle_balance(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if o.paid_amount is null or o.paid_amount = o.subtotal then
    raise exception 'This order has no balance to settle.';
  end if;
  update public.orders set paid_amount = subtotal where id = o.id;
  insert into public.order_edits (order_id, changes, edited_by, edited_by_email)
  values (o.id, jsonb_build_array(jsonb_build_object('field', 'paid_amount', 'from', o.paid_amount::text, 'to', o.subtotal::text)),
          auth.uid(), auth.jwt() ->> 'email');
end $$;

revoke execute on function public.admin_settle_balance(uuid) from public, anon;
grant execute on function public.admin_settle_balance(uuid) to authenticated;

revoke execute on function public.admin_edit_order(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.admin_edit_order(uuid, jsonb, timestamptz) to authenticated;
revoke execute on function public.order_line_text(int, text, text, jsonb) from public, anon;

-- ===================== migrations/20261101000100_owner_contact.sql =====================
-- =====================================================================
-- MGL Food Hub — Owner contact number (Admin → Settings)
-- Shown in the Wet Foods "Request a Fish" pop-up so customers can call
-- the owner. Empty by default: the site then offers Facebook only.
-- Safe to run more than once.
-- =====================================================================

insert into public.settings (key, value) values ('owner_phone', '""'::jsonb)
on conflict (key) do nothing;

-- Public: only the owner's contact number (the settings table itself stays admin only).
create or replace function public.get_owner_contact()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('phone', case
    when btrim(coalesce(public.setting('owner_phone') #>> '{}', '')) ~ '^\+?[0-9() -]{7,20}$'
      and length(regexp_replace(public.setting('owner_phone') #>> '{}', '\D', '', 'g')) >= 7
      then btrim(public.setting('owner_phone') #>> '{}')
    else ''
  end);
$$;

revoke execute on function public.get_owner_contact() from public;
grant execute on function public.get_owner_contact() to anon, authenticated;
