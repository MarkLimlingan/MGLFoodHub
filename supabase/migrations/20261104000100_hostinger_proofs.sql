-- =====================================================================
-- Payment screenshots on Hostinger
-- New screenshots can be saved by hostinger/api/proof.php instead of
-- Supabase Storage (which is only 1 GB on the free plan). That script signs
-- every file it saves: proofs/<device>/<time>-<random>.h<signature>.<ext>.
-- proof_exists() accepts either a file in Supabase Storage (older orders)
-- or a name with a valid signature, so nobody can make one up.
-- On an existing database, run just this file, then save the secret
-- (the same one as in proof-config.php):
--   insert into private.secrets (name, value) values ('proof_hmac', '<secret>')
--   on conflict (name) do update set value = excluded.value;
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.secrets (
  name text primary key,
  value text not null
);
revoke all on private.secrets from public, anon, authenticated;

create or replace function public.proof_exists(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  m text[];
  v_secret text;
begin
  if exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_path) then
    return true;
  end if;
  m := regexp_match(p_path, '^(proofs/[A-Za-z0-9_-]{1,64}/[0-9]{10,16}-[0-9a-f]{8})\.h([0-9a-f]{32})\.(jpg|png|webp)$');
  if m is null then
    return false;
  end if;
  select value into v_secret from private.secrets where name = 'proof_hmac';
  if v_secret is null or length(v_secret) < 32 then
    return false;
  end if;
  return left(encode(extensions.hmac(m[1], v_secret, 'sha256'), 'hex'), 32) = m[2];
end;
$$;
revoke execute on function public.proof_exists(text) from public, anon, authenticated;
