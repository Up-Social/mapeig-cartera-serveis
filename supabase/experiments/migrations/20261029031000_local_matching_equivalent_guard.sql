-- Experimental, unconnected guard. No runtime path may call this until group
-- semantics, request/receipt parity and the operational cost of the lock are
-- established. SHARE blocks *all* source_records writers until transaction end,
-- including when this function returns NULL. Acquire it first in a short TX;
-- never hold it across a provider or other network call.
create function public.local_verify_unique_matching_group(p_job uuid, p_expected jsonb, p_status text)
returns text language plpgsql security definer set search_path = public as $$
declare
  fingerprint text;
  source_id uuid;
  source_key text;
begin
  -- A repeatable-read/serializable snapshot may predate the table lock.
  -- This check does not reserve the group after the transaction ends.
  if current_setting('transaction_isolation') <> 'read committed' then return null; end if;
  -- Fail fast on an active writer; callers already holding other locks can
  -- still create lock-order hazards, so this is not an integration contract.
  lock table public.source_records in share mode nowait;
  fingerprint := public.local_verify_matching_input_state(p_job, p_expected, p_status);
  if fingerprint is null then return null; end if;
  select r.id, r.deduplication_key into source_id, source_key
    from public.pipeline_jobs j join public.source_records r on r.id=j.source_record_id
    where j.id=p_job;
  if not found or source_key is null then return null; end if;

  -- Conservatively reject every other potential equivalent, including an
  -- old stored key or a stale key whose current values recompute to ours.
  -- This does not decide which record is authoritative or resolve its jobs.
  if exists (
    select 1 from public.source_records r where r.id<>source_id and (
      r.deduplication_key=source_key or
      md5(concat_ws('|',case
        when r.source_dataset='contractacions' then 'contractacio'
        when r.source_dataset='convenis' then 'conveni'
        when r.source_dataset in ('raisc_ccaa','raisc_local') then 'subvencio'
        when r.source_dataset='concerts' then 'concert' else 'altres' end,
        public.normalize_matching_identity(r.title),public.normalize_matching_identity(r.provider_name),
        coalesce(round(r.amount,2)::text,''),public.normalize_matching_identity(coalesce(
          r.source_payload->>'Data concessió',r.source_payload->>'Data signatura',
          r.source_payload->>'Fecha de la última publicación',
          r.source_payload->>'Fecha de publicación del anuncio de licitación',''))))=source_key
    )
  ) then return null; end if;
  return fingerprint;
exception when lock_not_available then
  return null;
end $$;

revoke all on function public.local_verify_unique_matching_group(uuid,jsonb,text) from public, anon, authenticated, service_role;
