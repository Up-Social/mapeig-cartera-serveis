-- Experimental, private reservation. It serializes only callers using this
-- protocol; existing cloud/import/claim writers do not consult it. No expiry
-- or release is provided: an uncertain call must never be retried by timeout.
create table public.local_matching_group_reservations (
  job_id uuid primary key references public.pipeline_jobs(id) on delete restrict,
  source_id uuid not null unique references public.source_records(id) on delete restrict,
  group_key text not null unique check (group_key ~ '^[0-9a-f]{32}$'),
  input_hash text not null check (input_hash ~ '^local-matching-input-v1:[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.local_matching_group_reservations enable row level security;
revoke all on public.local_matching_group_reservations from public, anon, authenticated, service_role;

create function public.local_reserve_matching_group(p_job uuid,p_expected jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare verified text; source_id_ uuid; key_ text; prior public.local_matching_group_reservations;
begin
  -- This acquires SHARE on source_records first; it has the operational
  -- limitations documented in 310 and must run in a short transaction.
  verified:=public.local_verify_unique_matching_group(p_job,p_expected,'matching');
  if verified is null then return false; end if;
  select r.id,r.deduplication_key into source_id_,key_
    from public.pipeline_jobs j join public.source_records r on r.id=j.source_record_id where j.id=p_job;
  if source_id_ is null or key_ is null then return false; end if;
  -- Never assign provenance retroactively to an earlier matching attempt.
  -- Existing reservations still need journal checks at every future phase;
  -- this component alone does not authorize a provider call.
  if not exists(select 1 from public.local_matching_group_reservations where job_id=p_job) and (
    exists(select 1 from public.local_matching_requests where job_id=p_job) or
    exists(select 1 from public.local_matching_commits where job_id=p_job) or
    exists(select 1 from public.analysis_results where pipeline_job_id=p_job) or
    exists(select 1 from public.matching_candidates where pipeline_job_id=p_job) or
    exists(select 1 from public.review_decisions where pipeline_job_id=p_job) or
    exists(select 1 from public.provider_calls where pipeline_job_id=p_job and phase is distinct from 'enrichment')
  ) then return false; end if;
  insert into public.local_matching_group_reservations(job_id,source_id,group_key,input_hash)
    values(p_job,source_id_,key_,verified) on conflict do nothing;
  select * into prior from public.local_matching_group_reservations where job_id=p_job for update nowait;
  return found and prior.source_id=source_id_ and prior.group_key=key_ and prior.input_hash=verified;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_reserve_matching_group(uuid,jsonb) from public, anon, authenticated, service_role;
