-- An explicitly requested new Concerts analysis may repeat previously confirmed
-- OCR from another task. Recovery within the same task and all uncertain or
-- unattributed legacy work retain the existing blocking behavior.
-- Requires 20261028234000 and the Concerts entrypoint 20261102120000.
do $migration$
declare definition text;patched text;anchor text;replacement text;
begin
 perform 'public.begin_concert_reprocess(uuid,uuid,text)'::regprocedure;
 select prosrc into strict definition from pg_proc
 where oid='public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb)'::regprocedure;
 patched:=regexp_replace(definition,'^([[:space:]]*declare)([[:space:]])',
  E'\\1\n allow_confirmed_repeat boolean:=false;\n\\2','i');
 if patched=definition then raise exception 'CONCERT_REFRESH_OCR_DECLARATION_ANCHOR';end if;

 anchor:='if p_action=''document_status'' then';
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_REFRESH_OCR_SCOPE_ANCHOR';end if;
 replacement:=$scope$
 -- This is not an operator-controlled bypass parameter. The new entrypoint
 -- records these values atomically; bind them to this exact job and task.
 select coalesce(
   t.pipeline_job_id=j.id and t.run_id=j.run_id
   and r.parameters->>'purpose'='concert_reprocess'
   and r.parameters->'concert_refresh_sources'='true'::jsonb
   and exists(select 1 from public.source_records s where s.id=j.source_record_id and s.financing_type='concert'),false)
 into allow_confirmed_repeat from public.pipeline_runs r where r.id=j.run_id;
 allow_confirmed_repeat:=coalesce(allow_confirmed_repeat,false);
$scope$||anchor;
 patched:=replace(patched,anchor,replacement);

 anchor:=$old$
  if exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed')
   or exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
    where c.item_key like 'ocr-v2:'||d.id::text||':'||p_source_sha256||':%:dpi'||p_dpi::text||':'||p_extraction_version
     and (wt.source_record_id=j.source_record_id or wt.run_id in (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id)))
  then return 'existing';end if;
$old$;
 replacement:=$new$
  if exists(select 1 from public.cloud_ocr_page_journal old_page where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed'
   and not (allow_confirmed_repeat and old_page.task_id<>p_task
     and old_page.source_path=p_source_path and old_page.source_url=p_source_url
     and coalesce(old_page.text_hash,'') ~ '^[a-f0-9]{64}$'))
   or exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
    where c.item_key like 'ocr-v2:'||d.id::text||':'||p_source_sha256||':%:dpi'||p_dpi::text||':'||p_extraction_version
     and (wt.source_record_id=j.source_record_id or wt.run_id in (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id))
     and not (allow_confirmed_repeat and c.task_id<>p_task and exists(
      select 1 from public.cloud_ocr_page_journal confirmed
      where confirmed.task_id=c.task_id and confirmed.document_id=d.id and confirmed.source_sha256=p_source_sha256
       and confirmed.source_path=p_source_path and confirmed.source_url=p_source_url
       and confirmed.snapshot_hash=p_snapshot_hash and confirmed.dpi=p_dpi
       and confirmed.extraction_version=p_extraction_version and confirmed.state='confirmed'
       and c.item_key='ocr-v2:'||d.id::text||':'||p_source_sha256||':'||confirmed.page::text||':dpi'||p_dpi::text||':'||p_extraction_version
       and jsonb_typeof(c.value)='object' and octet_length(c.value::text)<=16100000
       and c.value->>'version'='ocr-page-v2' and c.value->>'documentId'=d.id::text
       and c.value->>'sourceSha256'=p_source_sha256 and c.value->>'sourcePath'=p_source_path and c.value->>'sourceUrl'=p_source_url
       and c.value->'page'=to_jsonb(confirmed.page) and c.value->'dpi'=to_jsonb(p_dpi)
       and jsonb_typeof(c.value->'text')='string' and octet_length(c.value->>'text')<=8000000
       and c.value->>'textHash'=confirmed.text_hash
       and confirmed.text_hash=encode(extensions.digest(c.value->>'text','sha256'),'hex')
     )))
  then return 'existing';end if;
$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_REFRESH_OCR_DOCUMENT_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);

 anchor:=$old$
 if exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
  where c.item_key=page_key and (wt.source_record_id=j.source_record_id or wt.run_id in
   (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id)))
  or exists(select 1 from public.cloud_ocr_page_journal where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and page=p_page and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed')
 then return 'existing';end if;
$old$;
 replacement:=$new$
 if exists(select 1 from public.cloud_checkpoints c join public.worker_tasks wt on wt.id=c.task_id
  where c.item_key=page_key and (wt.source_record_id=j.source_record_id or wt.run_id in
   (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=j.source_record_id))
   and not (allow_confirmed_repeat and c.task_id<>p_task and exists(
    select 1 from public.cloud_ocr_page_journal confirmed
    where confirmed.task_id=c.task_id and confirmed.document_id=d.id and confirmed.source_sha256=p_source_sha256
     and confirmed.source_path=p_source_path and confirmed.source_url=p_source_url
     and confirmed.snapshot_hash=p_snapshot_hash and confirmed.page=p_page and confirmed.dpi=p_dpi
     and confirmed.extraction_version=p_extraction_version and confirmed.state='confirmed'
     and jsonb_typeof(c.value)='object' and octet_length(c.value::text)<=16100000
     and c.value->>'version'='ocr-page-v2' and c.value->>'documentId'=d.id::text
     and c.value->>'sourceSha256'=p_source_sha256 and c.value->>'sourcePath'=p_source_path and c.value->>'sourceUrl'=p_source_url
     and c.value->'page'=to_jsonb(p_page) and c.value->'dpi'=to_jsonb(p_dpi)
     and jsonb_typeof(c.value->'text')='string' and octet_length(c.value->>'text')<=8000000
     and c.value->>'textHash'=confirmed.text_hash
     and confirmed.text_hash=encode(extensions.digest(c.value->>'text','sha256'),'hex')
   )))
  or exists(select 1 from public.cloud_ocr_page_journal old_page where document_id=d.id and source_sha256=p_source_sha256
   and snapshot_hash=p_snapshot_hash and page=p_page and dpi=p_dpi and extraction_version=p_extraction_version and state='confirmed'
   and not (allow_confirmed_repeat and old_page.task_id<>p_task
     and old_page.source_path=p_source_path and old_page.source_url=p_source_url
     and coalesce(old_page.text_hash,'') ~ '^[a-f0-9]{64}$'))
 then return 'existing';end if;
$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_REFRESH_OCR_PAGE_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);
 -- Replacing only the body retains the original security, ACL and signature.
 definition:=pg_get_functiondef('public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb)'::regprocedure);
 anchor:=(select prosrc from pg_proc where oid='public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_REFRESH_OCR_BODY_ANCHOR';end if;
 execute replace(definition,anchor,patched);
end $migration$;
