-- A preparation may be submitted by the application only after the selected
-- archived sources have been streamed and checked against their SHA-256.
create table public.conveni_group_archive_verifications (
 preparation_id uuid primary key references public.conveni_group_preparation_events(id),
 receipts jsonb not null, verified_at timestamptz not null default clock_timestamp()
);
alter table public.conveni_group_archive_verifications enable row level security;
revoke all on public.conveni_group_archive_verifications from public,anon,authenticated,service_role;
grant select on public.conveni_group_archive_verifications to service_role;

-- A version UUID is required: a path or metadata existence alone cannot
-- identify the exact object the server streamed. Missing/ambiguous returns NULL.
create function public.conveni_archive_snapshot(p_record uuid,p_documents uuid[]) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,storage as $$
declare out_ jsonb; found_ integer; expected_ integer;
begin
 expected_:=cardinality(p_documents);
 if coalesce(expected_,0)<1 or expected_>502 or (select count(distinct x) from unnest(p_documents) x)<>expected_ then return null;end if;
 select count(*),jsonb_object_agg(d.id::text,jsonb_build_object('path',d.storage_path,'sha256',d.storage_sha256,'object_id',o.id::text,'version',o.version))
 into found_,out_ from public.source_documents d join storage.objects o on o.bucket_id='cloud-documents' and o.name=d.storage_path
 where d.id=any(p_documents) and d.source_record_id=p_record and d.document_type in ('agreement','annex')
  and d.status='fetched' and d.extraction_partial is false and not (coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'])
  and d.storage_sha256 ~ '^[0-9a-f]{64}$'
  and d.storage_path ~ ('^cases/'||p_record::text||'/documents/'||d.id::text||'/'||d.storage_sha256||'[.][a-z0-9]+$')
  and o.version ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 if found_<>expected_ then return null;end if;
 return out_;
end $$;
revoke all on function public.conveni_archive_snapshot(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.conveni_archive_snapshot(uuid,uuid[]) to service_role;

create function public.conveni_preparation_source_ids(p_record uuid,p_job uuid,p_unit uuid,p_heads jsonb,p_total jsonb,p_identity jsonb) returns uuid[]
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(array_agg(distinct d.id order by d.id),'{}'::uuid[]) from public.source_documents d
 where d.source_record_id=p_record and d.id::text in (
  select p_total->>'document_id' union select p_identity->>'document_id'
  union select e.selected_citation->>'document_id' from jsonb_each_text(case when jsonb_typeof(p_heads)='object' then p_heads else '{}'::jsonb end) h
   join public.conveni_concept_review_events e on e.id::text=h.value and e.source_record_id=p_record and e.job_id=p_job and e.unit_id=p_unit
 )
$$;
revoke all on function public.conveni_preparation_source_ids(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.conveni_preparation_source_ids(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;

create function public.prepare_conveni_group_verified(
 p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_parent_review uuid,
 p_group_hash text,p_analysis_hash text,p_source_hash text,p_revisions jsonb,p_heads jsonb,p_code text,
 p_amount_cents bigint,p_amount_literal text,p_total_citation jsonb,p_identity_citation jsonb,
 p_confirmations jsonb,p_note text,p_archive_snapshot jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,public,storage,extensions as $$
declare docs uuid[];current_snapshot jsonb;existing jsonb;
begin
 -- The inner RPC locks the record, analysis, proposal, documents and Storage
 -- rows. Any subsequent error rolls back the newly inserted event as well.
 perform public.prepare_conveni_group(p_record,p_job,p_unit,p_event,p_previous,p_parent_review,p_group_hash,p_analysis_hash,p_source_hash,p_revisions,p_heads,p_code,p_amount_cents,p_amount_literal,p_total_citation,p_identity_citation,p_confirmations,p_note);
 docs:=public.conveni_preparation_source_ids(p_record,p_job,p_unit,p_heads,p_total_citation,p_identity_citation);
 current_snapshot:=public.conveni_archive_snapshot(p_record,docs);
 if jsonb_typeof(p_archive_snapshot) is distinct from 'object' or current_snapshot is null or current_snapshot is distinct from p_archive_snapshot
 then raise exception 'Còpies arxivades canviades o sense versió verificable' using errcode='PT409';end if;
 select receipts into existing from public.conveni_group_archive_verifications where preparation_id=p_event;
 if found then
  if existing is distinct from p_archive_snapshot then raise exception 'La verificació de còpies ha canviat' using errcode='PT409';end if;
 else
  insert into public.conveni_group_archive_verifications(preparation_id,receipts) values(p_event,p_archive_snapshot);
 end if;
end $$;
-- Keep the action disabled until a controlled Storage validation and a
-- separate explicit migration grant EXECUTE to service_role.
revoke all on function public.prepare_conveni_group_verified(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,bigint,text,jsonb,jsonb,jsonb,text,jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.prepare_conveni_group(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,bigint,text,jsonb,jsonb,jsonb,text) from service_role;

create or replace view public.conveni_group_preparations with (security_invoker=true) as
 select c.source_record_id,c.job_id,c.unit_id,c.source_hash,c.document_revisions,c.review_id as parent_review_id,
  encode(extensions.digest(c.data::text,'sha256'),'hex') as group_hash,
  encode(extensions.digest(a.payload::text,'sha256'),'hex') as analysis_hash,
  head.id as preparation_id,head.sequence,head.service_code,head.amount_cents,head.proposed_amount_state,
  head.amount_literal,head.total_citation,head.identity_citation,head.confirmations,head.reason,
  coalesce(head.id is not null and head.group_hash=encode(extensions.digest(c.data::text,'sha256'),'hex')
   and exists(select 1 from public.conveni_group_archive_verifications verified where verified.preparation_id=head.id
     and verified.receipts=public.conveni_archive_snapshot(head.source_record_id,public.conveni_preparation_source_ids(head.source_record_id,head.job_id,head.unit_id,head.concept_heads,head.total_citation,head.identity_citation)))
   and head.parent_review_id is not distinct from c.review_id
   and head.source_hash=c.source_hash and head.analysis_hash=encode(extensions.digest(a.payload::text,'sha256'),'hex') and c.source_hash=public.conveni_source_hash(c.source_record_id)
   and head.document_revisions=c.document_revisions and c.payload->'coverage_complete'='true'::jsonb
   and not exists(select 1 from public.source_documents sd where sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and (sd.storage_sha256 is null or sd.storage_sha256 !~ '^[0-9a-f]{64}$' or sd.storage_path is null
     or sd.storage_path !~ ('^cases/'||c.source_record_id::text||'/documents/'||sd.id::text||'/'||sd.storage_sha256||'\.[a-z0-9]+$')
     or not exists(select 1 from storage.objects o where o.bucket_id='cloud-documents' and o.name=sd.storage_path)))
   and a.catalog_version_id=head.catalog_version_id
   and exists(select 1 from public.eligible_official_services os where os.version_id=head.catalog_version_id and os.service_code=head.service_code)
   and jsonb_typeof(head.concept_heads)='object' and jsonb_typeof(c.data->'concepts')='array'
   and (select count(*) from jsonb_object_keys(case when jsonb_typeof(head.concept_heads)='object' then head.concept_heads else '{}'::jsonb end))=jsonb_array_length(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end) with ordinality x(value,ordinality)
    where not exists(select 1 from public.conveni_concept_proposals cp where cp.job_id=c.job_id and cp.unit_id=c.unit_id and cp.concept_index=(x.ordinality-1)::integer
     and cp.review_is_current and cp.outcome='select' and cp.social_confirmed and cp.reviewed_code=head.service_code
     and cp.review_id::text=head.concept_heads->>(x.ordinality-1)::text))
   and public.conveni_group_literal_cents(head.amount_literal)=head.amount_cents
   and public.conveni_quote_has_amount_literal(head.total_citation->>'quote',head.amount_literal)
   and public.conveni_identity_quote_matches(c.data->>'recipient',c.data->>'recipient_nif',head.identity_citation->>'quote')
   and exists(select 1 from public.source_documents sd where sd.id::text=head.total_citation->>'document_id' and sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and public.conveni_citation_on_page(sd.extracted_text,case when coalesce(head.total_citation->>'page','') ~ '^[1-9][0-9]{0,5}$' then (head.total_citation->>'page')::integer else null end,head.total_citation->>'quote'))
   and exists(select 1 from public.source_documents sd where sd.id::text=head.identity_citation->>'document_id' and sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and public.conveni_citation_on_page(sd.extracted_text,case when coalesce(head.identity_citation->>'page','') ~ '^[1-9][0-9]{0,5}$' then (head.identity_citation->>'page')::integer else null end,head.identity_citation->>'quote')),
   false) as preparation_is_current
 from public.conveni_current_units c join public.conveni_analyses a on a.job_id=c.job_id
 left join lateral (select e.* from public.conveni_group_preparation_events e where e.job_id=c.job_id and e.unit_id=c.unit_id order by e.sequence desc limit 1) head on true
 where jsonb_typeof(c.data->'concepts')='array' and jsonb_array_length(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)>=2;
revoke all on public.conveni_group_preparations from public,anon,authenticated;
grant select on public.conveni_group_preparations to service_role;
