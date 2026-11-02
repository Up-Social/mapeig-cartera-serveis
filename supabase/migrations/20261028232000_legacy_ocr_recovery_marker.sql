-- Legacy OCR keys identify bytes but not the document or sandbox image. Keep a
-- small, per-document uncertainty marker in each recovery without copying text.
-- Unattributed historical OCR in a related batch is conservatively treated as
-- relevant to every document of this record; final verified extractions remain usable.
do $migration$
declare definition text;patched text;anchor text;anchor_count integer;anchor_pos integer;
begin
 definition:=pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure);
 -- pg_get_functiondef preserves the original body formatting: production can
 -- contain long runs of whitespace here. Match tokens with whitespace only,
 -- but abort if the target is absent or appears more than once.
 select count(*),min(m[1]) into anchor_count,anchor
 from regexp_matches(definition,
  $re$(update[[:space:]]+source_records[[:space:]]+set[[:space:]]+processing_status[[:space:]]*=[[:space:]]*case[[:space:]]+when[[:space:]]+p_operation[[:space:]]*=[[:space:]]*'match')$re$,'gi') m;
 if anchor_count<>1 then raise exception 'Legacy OCR recovery marker patch failed: expected one update anchor';end if;
 anchor_pos:=strpos(definition,anchor);
 patched:=substring(definition from 1 for anchor_pos-1)||
  $new$if p_executor='vercel_workflow' and exists(
    select 1 from public.cloud_checkpoints c join public.worker_tasks prior_task on prior_task.id=c.task_id
    where c.item_key like 'ocr:%' and (prior_task.source_record_id=p_record or prior_task.run_id in
      (select pj.run_id from public.pipeline_jobs pj where pj.source_record_id=p_record))
  ) then
    insert into public.cloud_checkpoints(task_id,item_key,value)
    select task,'legacy-ocr-pending:'||d.id::text,jsonb_build_object('version','legacy-ocr-pending-v1')
    from public.source_documents d where d.source_record_id=p_record
    on conflict(task_id,item_key) do nothing;
  end if;
  $new$||substring(definition from anchor_pos);
 if patched=definition then raise exception 'Legacy OCR recovery marker patch failed';end if;
 execute patched;
end $migration$;
