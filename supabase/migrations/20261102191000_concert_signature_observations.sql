-- Signature observations are supplemental: extraction coverage and reviewed
-- units are deliberately untouched. Signed dates are claims, not awards.
create table public.concert_signature_observations (
 id uuid primary key default gen_random_uuid(),
 source_record_id uuid not null references public.source_records(id),
 document_id uuid not null references public.source_documents(id),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 claimed_utc timestamptz not null,
 local_date date not null,
 certificate_trust text not null check(certificate_trust in ('trusted','untrusted','unknown')),
 verification_method text not null default 'pdfsig-full-document-v1' check(verification_method='pdfsig-full-document-v1'),
 verification_origin text not null default 'worker' check(verification_origin in ('worker','operator')),
 observed_at timestamptz not null default clock_timestamp(),
 constraint concert_signature_date_zone check(local_date = (claimed_utc at time zone 'Europe/Madrid')::date),
 unique(document_id,document_sha256,claimed_utc,certificate_trust,verification_method)
);
comment on column public.concert_signature_observations.observed_at is 'Database registration time; does not prove the time when an operator checked the PDF.';
create index concert_signature_observations_doc_idx on public.concert_signature_observations(document_id, observed_at desc);
alter table public.concert_signature_observations enable row level security;
revoke all on public.concert_signature_observations from public,anon,authenticated,service_role;
grant select,insert on public.concert_signature_observations to service_role;

-- All writers (including an operator backfill) share the same archive guard.
-- The row lock holds until commit, so archive replacement cannot race an insert.
create function public.guard_concert_signature_observation()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.source_documents;
begin
 select * into strict d from public.source_documents where id=new.document_id for share;
 if d.source_record_id is distinct from new.source_record_id
  or d.storage_sha256 is distinct from new.document_sha256
  or d.storage_path is null
  or not exists(select 1 from public.source_records r where r.id=new.source_record_id and r.financing_type='concert') then
  raise exception 'CONCERT_SIGNATURE_SOURCE_CHANGED';
 end if;
 return new;
end $$;
revoke all on function public.guard_concert_signature_observation() from public,anon,authenticated;
create trigger guard_concert_signature_observation before insert on public.concert_signature_observations
 for each row execute function public.guard_concert_signature_observation();

create function public.cloud_store_concert_signature(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_sha text,
 p_claimed_utc timestamptz,p_local_date date,p_certificate_trust text
) returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.pipeline_jobs; d public.source_documents; result uuid;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task and (t.run_id=j.run_id or t.source_record_id=j.source_record_id))
  or not exists(select 1 from public.source_records r where r.id=j.source_record_id and r.financing_type='concert') then
  raise exception 'CONCERT_SIGNATURE_SCOPE';
 end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=j.source_record_id for share;
 if d.storage_path is null or d.storage_sha256 is distinct from p_sha or p_sha !~ '^[a-f0-9]{64}$'
  or p_claimed_utc is null or p_local_date is distinct from (p_claimed_utc at time zone 'Europe/Madrid')::date
  or p_certificate_trust not in ('trusted','untrusted','unknown') then
  raise exception 'CONCERT_SIGNATURE_SOURCE_CHANGED';
 end if;
 insert into public.concert_signature_observations(source_record_id,document_id,document_sha256,claimed_utc,local_date,certificate_trust)
 values(j.source_record_id,p_document,p_sha,p_claimed_utc,p_local_date,p_certificate_trust)
 on conflict(document_id,document_sha256,claimed_utc,certificate_trust,verification_method) do nothing returning id into result;
 if result is null then
  select id into strict result from public.concert_signature_observations
   where document_id=p_document and document_sha256=p_sha and claimed_utc=p_claimed_utc
    and certificate_trust=p_certificate_trust and verification_method='pdfsig-full-document-v1';
 end if;
 return result;
end $$;
revoke all on function public.cloud_store_concert_signature(uuid,uuid,bigint,uuid,uuid,text,timestamptz,date,text) from public,anon,authenticated;
grant execute on function public.cloud_store_concert_signature(uuid,uuid,bigint,uuid,uuid,text,timestamptz,date,text) to service_role;

create view public.current_concert_signature_observations with(security_invoker=true) as
-- Keep contradictory observations visible; consumers must not choose the latest.
select o.* from public.concert_signature_observations o
 join public.source_documents d on d.id=o.document_id and d.source_record_id=o.source_record_id and d.storage_sha256=o.document_sha256
 where d.storage_path is not null and d.status='fetched' and d.mime_type='application/pdf';
revoke all on public.current_concert_signature_observations from public,anon,authenticated;
grant select on public.current_concert_signature_observations to service_role;
