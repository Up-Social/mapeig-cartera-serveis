-- Keep the targeted OCR completion marker in the same transaction as the
-- source revision and its chunks. A stale worker must never replace a newer extraction.
do $migration$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.cloud_commit_v1(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure);
 updated:=replace(definition,
  $old$  then raise exception 'DOCUMENT_SOURCE_CHANGED' using errcode='40001';end if;
  update source_documents set active_extraction_id$old$,
  $new$  then raise exception 'DOCUMENT_SOURCE_CHANGED' using errcode='40001';end if;
  if exists(select 1 from pipeline_runs where id=j.run_id and parameters->'targeted_ocr'->>'documentId'=doc_id::text) then
   if not (p_data ? 'target_previous_extraction_id') or p_data->'target_pages' is distinct from
     (select parameters->'targeted_ocr'->'pages' from pipeline_runs where id=j.run_id)
   then raise exception 'TARGETED_OCR_CONTRACT_REQUIRED' using errcode='40001';end if;
  elsif p_data ? 'target_previous_extraction_id' then
   raise exception 'TARGETED_OCR_CONTRACT_REQUIRED' using errcode='40001';
  end if;
  if p_data ? 'target_previous_extraction_id' then
   if jsonb_typeof(p_data->'target_pages') is distinct from 'array' or jsonb_array_length(p_data->'target_pages')=0
    or not exists(select 1 from source_documents where id=doc_id and active_extraction_id::text=p_data->>'target_previous_extraction_id'
      and encode(extensions.digest(coalesce(extracted_text,''),'sha256'),'hex')=p_data->>'previous_text_sha256')
    or encode(extensions.digest(coalesce(p_data->>'text',''),'sha256'),'hex') is distinct from p_data->>'text_hash'
   then raise exception 'TARGETED_OCR_SOURCE_CHANGED' using errcode='40001';end if;
  end if;
  update source_documents set active_extraction_id$new$);
 if definition=updated then raise exception 'Targeted OCR revision guard patch failed';end if;
 definition:=updated;
 updated:=replace(definition,
  $old$   values(doc_id,(d->>'ordinal')::integer,d->>'content',d->>'hash',length(d->>'content'));
  end loop;
 elsif p_operation='ready' then$old$,
  $new$   values(doc_id,(d->>'ordinal')::integer,d->>'content',d->>'hash',length(d->>'content'));
  end loop;
  if p_data ? 'target_previous_extraction_id' then
   perform cloud_checkpoint(p_task,p_owner,p_generation,'targeted-ocr:'||j.id::text||':'||doc_id::text,
    (select jsonb_build_object('version','targeted-ocr-v1','extraction_id',active_extraction_id,'source_sha256',storage_sha256,
     'source_path',storage_path,'source_url',url,'text_hash',extracted_text_hash,'extraction_version',p_data->>'extraction_version',
     'method',p_data->>'method','partial',coalesce((p_data->>'partial')::boolean,false),
     'coverage',coalesce(p_data->'coverage','null'::jsonb),'pages',p_data->'target_pages')
     from source_documents where id=doc_id));
  end if;
 elsif p_operation='ready' then$new$);
 if definition=updated then raise exception 'Targeted OCR atomic marker patch failed';end if;
 execute updated;
end $migration$;

-- Validate under the same lease and document lock used by the writer. A legacy
-- boolean marker or a later source/extraction change requires explicit review.
create function public.verify_targeted_ocr_checkpoint(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_pages jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs; t worker_tasks; d source_documents; marker jsonb;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from worker_tasks where id=p_task;
 select * into strict j from pipeline_jobs where id=p_job for update;
 if not ((t.run_id is not null and j.run_id=t.run_id) or t.source_record_id=j.source_record_id) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict d from source_documents where id=p_document and source_record_id=j.source_record_id for update;
 select value into marker from cloud_checkpoints where task_id=p_task and item_key='targeted-ocr:'||j.id::text||':'||d.id::text;
 if not found then return false;end if;
 if marker->>'version' is distinct from 'targeted-ocr-v1' or marker->>'extraction_id' is distinct from d.active_extraction_id::text
  or marker->>'source_sha256' is distinct from d.storage_sha256 or marker->>'source_path' is distinct from d.storage_path
  or marker->>'source_url' is distinct from d.url or marker->>'text_hash' is distinct from d.extracted_text_hash
  or marker->>'text_hash' is distinct from encode(extensions.digest(coalesce(d.extracted_text,''),'sha256'),'hex')
  or marker->>'extraction_version' is distinct from d.extraction_version or marker->'pages' is distinct from p_pages
  or marker->>'method' is distinct from d.extraction_method or marker->'partial' is distinct from to_jsonb(d.extraction_partial)
  or marker->'coverage' is distinct from coalesce(d.extraction_coverage,'null'::jsonb)
  or d.status is distinct from 'fetched'
 then raise exception 'TARGETED_OCR_SOURCE_CHANGED' using errcode='40001';end if;
 return true;
end $$;
revoke all on function public.verify_targeted_ocr_checkpoint(uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.verify_targeted_ocr_checkpoint(uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;
