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
