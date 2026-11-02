-- Protect only begin_record_operation and callers delegating to it. Other
-- batch/phase entry points and direct privileged writes remain out of scope.
-- No previously generic 'internal' pause is reclassified retrospectively.
do $migration$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure);
 patched:=replace(definition,
 $old$select * into strict source from source_records where id=p_record for update;$old$,
 $new$select * into strict source from source_records where id=p_record for update;

  -- A transaction snapshot predating the locks could hide a prior pause.
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
  -- The source lock fences job inserts; job and run locks fence task inserts;
  -- task/job locks fence FK-checked receipt inserts. Existing rows are locked
  -- explicitly against update or delete. All locks last only this DB call.
  perform 1 from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record order by pj_guard.id for update nowait;
  perform 1 from public.pipeline_runs r where r.id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record) order by r.id for update nowait;
  perform 1 from public.worker_tasks t where t.source_record_id=p_record
    or t.pipeline_job_id in (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
    or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
    order by t.id for update nowait;
  perform 1 from public.cloud_checkpoints c where c.task_id in (
    select t.id from public.worker_tasks t where t.source_record_id=p_record
      or t.pipeline_job_id in (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
      or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
    ) order by c.task_id,c.item_key for update nowait;
  perform 1 from public.provider_calls pc where pc.pipeline_job_id in
    (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
    order by pc.id for update nowait;
  if exists(select 1 from public.worker_tasks t where t.failure_kind='provider_unknown' and
    (t.source_record_id=p_record
      or t.pipeline_job_id in (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
      or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)))
    or exists(select 1 from public.cloud_checkpoints c join public.worker_tasks t on t.id=c.task_id
    where (t.source_record_id=p_record
      or t.pipeline_job_id in (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
      or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record))
      and c.item_key like 'ai:%' and c.value->>'state' in ('sending','unknown'))
    or exists(select 1 from public.provider_calls pc join public.pipeline_jobs pj_guard on pj_guard.id=pc.pipeline_job_id
      where pj_guard.source_record_id=p_record and pc.state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
  if exists(select 1 from public.worker_tasks t where t.failure_kind='provider_reconciliation' and
    (t.source_record_id=p_record
      or t.pipeline_job_id in (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)
      or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record))) then
    raise exception 'PROVIDER_RECONCILIATION_REQUIRED';
  end if;
$new$);
 if patched=definition then raise exception 'BEGIN_RECORD_RECEIPT_GUARD_NOT_APPLIED';end if;
 execute patched;
end $migration$;
