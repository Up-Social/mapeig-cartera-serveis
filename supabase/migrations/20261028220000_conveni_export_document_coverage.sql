-- A later annex, changed source type or degraded extraction invalidates the
-- current export without rewriting prior human decisions or provisions.
create or replace view public.conveni_reviewed_provisions with (security_invoker=true) as
 select p.* from service_provisions p
 where (not exists(select 1 from conveni_analyses where source_record_id=p.source_record_id)
  and (p.mechanism<>'Conveni' or exists(select 1 from source_records r where r.id=p.source_record_id and r.processing_status='completat' and (select decision from review_decisions where source_record_id=r.id order by created_at desc,id desc limit 1) in ('approved','corrected'))))
 or exists(select 1 from conveni_current_units c where c.unit_id=p.unit_id and c.reviewed_job=c.job_id and c.outcome='select'
  and c.source_hash=conveni_source_hash(c.source_record_id)
  and jsonb_typeof(c.document_revisions)='object'
  and not exists(select 1 from source_documents d where d.source_record_id=c.source_record_id and d.document_type in ('agreement','annex')
   and (d.status<>'fetched' or d.extraction_partial is not false or d.storage_sha256 is null or d.storage_path is null
    or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or c.document_revisions->>d.id::text is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')))
  and not exists(select 1 from jsonb_each_text(case when jsonb_typeof(c.document_revisions)='object' then c.document_revisions else '{}'::jsonb end) rev
   left join source_documents d on d.id::text=rev.key
   where d.id is null or d.source_record_id<>c.source_record_id or d.document_type not in ('agreement','annex')
    or d.status<>'fetched' or d.extraction_partial is not false or d.storage_sha256 is null or d.storage_path is null
    or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')));
