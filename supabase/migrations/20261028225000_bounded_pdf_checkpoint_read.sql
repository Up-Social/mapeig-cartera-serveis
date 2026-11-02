-- Bound OCR checkpoint payloads in PostgreSQL, before PostgREST serializes or
-- transfers them. The legacy lookup only tests existence and never reads JSON.
create function public.cloud_read_pdf_checkpoint(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,
 p_kind text,p_key text,p_max_text_bytes integer
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j public.pipeline_jobs;t public.worker_tasks;v jsonb;stored_size integer;text_field text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from public.worker_tasks where id=p_task;
 select * into strict j from public.pipeline_jobs where id=p_job;
 if (((t.run_id is not null and j.run_id=t.run_id) or t.source_record_id=j.source_record_id) is not true)
  or not exists(select 1 from public.source_documents where id=p_document and source_record_id=j.source_record_id)
 then raise exception 'CLOUD_SCOPE';end if;
 if p_kind is null or p_key is null or length(p_key)>300 or p_max_text_bytes is null or p_max_text_bytes<0 or p_max_text_bytes>8000000 then
  raise exception 'PDF_CHECKPOINT_INVALID';
 end if;
 if p_kind='legacy' then
  if p_key !~ '^ocr:[0-9a-f]{64}:[0-9]+:dpi(300|400):[a-zA-Z0-9._-]+$' then raise exception 'PDF_CHECKPOINT_INVALID';end if;
  return jsonb_build_object('found',exists(select 1 from public.cloud_checkpoints where task_id=p_task and item_key=p_key));
 elsif p_kind='preflight' then
  if left(p_key,length('pdf-preflight:'||p_document::text||':'))<>'pdf-preflight:'||p_document::text||':' then raise exception 'PDF_CHECKPOINT_INVALID';end if;
  text_field:='rawText';
 elsif p_kind='page' then
  if left(p_key,length('ocr-v2:'||p_document::text||':'))<>'ocr-v2:'||p_document::text||':' then raise exception 'PDF_CHECKPOINT_INVALID';end if;
  text_field:='text';
 else raise exception 'PDF_CHECKPOINT_INVALID';end if;
 -- A compressed oversized value still needs detoasting for the exact test, but
 -- no oversized JSON is returned to the caller.
 select pg_column_size(value) into stored_size from public.cloud_checkpoints where task_id=p_task and item_key=p_key;
 if not found then return jsonb_build_object('found',false);end if;
 if stored_size>16100000 then raise exception 'PDF_CHECKPOINT_TOO_LARGE';end if;
 select value into strict v from public.cloud_checkpoints where task_id=p_task and item_key=p_key;
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'PDF_CHECKPOINT_INVALID';end if;
 if octet_length(v::text)>16100000 or octet_length(v->>text_field)>p_max_text_bytes then raise exception 'PDF_CHECKPOINT_TOO_LARGE';end if;
 return jsonb_build_object('found',true,'value',v);
end $$;
revoke all on function public.cloud_read_pdf_checkpoint(uuid,uuid,bigint,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.cloud_read_pdf_checkpoint(uuid,uuid,bigint,uuid,uuid,text,text,integer) to service_role;
