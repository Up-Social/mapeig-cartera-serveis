-- A concept may be recorded as insufficient while coverage is incomplete,
-- but positive classifications must wait for complete documented coverage.
do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.review_conveni_concept(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,boolean)'::regprocedure);
 patched:=replace(original,
  $old$ -- The lock also covers rows that could change type into an annex.$old$,
  $new$ if p_outcome in ('select','outside') and (
  a.payload->'coverage_complete' is distinct from 'true'::jsonb
  or coalesce((data_->'blockers') ? 'incomplete',false)
  or coalesce((concept_->'blockers') ? 'incomplete',false)
 ) then raise exception 'Cal completar la cobertura documental abans de classificar el concepte';end if;
 -- The lock also covers rows that could change type into an annex.$new$);
 if patched=original then raise exception 'Expected concept coverage guard insertion point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=r.id;$old$,
  $new$select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=r.id for share;$new$);
 if patched=original then raise exception 'Expected analysis lock insertion point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$select data into strict data_ from public.conveni_unit_proposals where job_id=p_job and unit_id=u.id;$old$,
  $new$select data into strict data_ from public.conveni_unit_proposals where job_id=p_job and unit_id=u.id for share;$new$);
 if patched=original then raise exception 'Expected proposal lock insertion point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$  then return;end if;
  raise exception 'Identificador de revisió reutilitzat amb altres dades'$old$,
  $new$  then
   -- A retry must not report a positive decision as usable when coverage is now incomplete.
   if p_outcome in ('select','outside') then
    select data into strict data_ from public.conveni_unit_proposals where job_id=p_job and unit_id=u.id for share;
    concept_:=data_->'concepts'->p_index;
    if a.payload->'coverage_complete' is distinct from 'true'::jsonb
     or coalesce((data_->'blockers') ? 'incomplete',false)
     or coalesce((concept_->'blockers') ? 'incomplete',false)
    then raise exception 'Cal completar la cobertura documental abans de classificar el concepte';end if;
   end if;
   return;
  end if;
  raise exception 'Identificador de revisió reutilitzat amb altres dades'$new$);
 if patched=original then raise exception 'Expected concept idempotency guard insertion point not found';end if;
 execute patched;
end $$;

-- Keep the last event as the optimistic-concurrency token, while exposing
-- separately whether its parent decision and documentary evidence remain valid.
create or replace view public.conveni_concept_proposals with (security_invoker=true) as
 select c.source_record_id,c.job_id,c.unit_id,c.source_hash,c.document_revisions,c.review_id as parent_review_id,
  (concept.ordinality-1)::integer as concept_index,concept.value as concept,
  encode(extensions.digest(concept.value::text,'sha256'),'hex') as concept_hash,
  head.id as review_id,head.sequence as review_sequence,head.outcome,head.service_code as reviewed_code,
  head.reason as review_note,head.selected_citation,head.social_confirmed,
  coalesce(head.id is not null
   and head.concept_hash=encode(extensions.digest(concept.value::text,'sha256'),'hex')
   and (head.outcome not in ('select','outside') or (
    c.payload->'coverage_complete'='true'::jsonb
    and not coalesce((c.data->'blockers') ? 'incomplete',false)
    and not coalesce((concept.value->'blockers') ? 'incomplete',false)))
   and head.parent_review_id is not distinct from c.review_id
   and head.source_hash=c.source_hash and c.source_hash=public.conveni_source_hash(c.source_record_id)
   and jsonb_typeof(c.document_revisions)='object' and head.document_revisions=c.document_revisions
   and not exists(select 1 from public.source_documents sd where sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and (sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or c.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
   and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(c.document_revisions)='object' then c.document_revisions else '{}'::jsonb end) rev
    left join public.source_documents sd on sd.id::text=rev.key
    where sd.id is null or sd.source_record_id<>c.source_record_id or coalesce(sd.document_type,'') not in ('agreement','annex')
      or sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
   and exists(select 1 from public.source_documents sd where sd.id::text=head.selected_citation->>'document_id'
    and sd.source_record_id=c.source_record_id and sd.document_type in ('agreement','annex')
    and public.conveni_citation_on_page(sd.extracted_text,
      case when coalesce(head.selected_citation->>'page','') ~ '^[1-9][0-9]{0,5}$' then (head.selected_citation->>'page')::integer else null end,
      head.selected_citation->>'quote')),
   false) as review_is_current
 from public.conveni_current_units c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data->'concepts')='array' then c.data->'concepts' else '[]'::jsonb end)
  with ordinality as concept(value,ordinality)
 left join lateral (select e.* from public.conveni_concept_review_events e
  where e.job_id=c.job_id and e.unit_id=c.unit_id and e.concept_index=(concept.ordinality-1)::integer
  order by e.sequence desc limit 1) head on true;
