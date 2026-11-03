-- Supplemental operator claims only. No award dates or worker semantics change.
alter table public.concert_signature_observations
 add column signature_coverage text not null default 'full';
alter table public.concert_signature_observations
 drop constraint concert_signature_observations_verification_method_check;
alter table public.concert_signature_observations
 add constraint concert_signature_observation_method_coverage check (
  (verification_method='pdfsig-full-document-v1' and signature_coverage='full')
  or (verification_method='pdfsig-partial-document-operator-v1'
   and signature_coverage='partial' and verification_origin='operator')
 );
comment on column public.concert_signature_observations.signature_coverage is
 'Coverage of the archived bytes. Partial does not establish full-document integrity, certificate trust, a trusted timestamp, or award date.';

-- Append explicitly: CREATE OR REPLACE cannot reorder the existing view columns.
create or replace view public.current_concert_signature_observations with(security_invoker=true) as
select o.id,o.source_record_id,o.document_id,o.document_sha256,o.claimed_utc,
 o.local_date,o.certificate_trust,o.verification_method,o.verification_origin,
 o.observed_at,o.signature_coverage
from public.concert_signature_observations o
join public.source_documents d on d.id=o.document_id
 and d.source_record_id=o.source_record_id and d.storage_sha256=o.document_sha256
where d.storage_path is not null and d.status='fetched' and d.mime_type='application/pdf';
