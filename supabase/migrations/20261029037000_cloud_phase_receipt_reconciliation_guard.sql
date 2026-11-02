-- Narrow guards for phase/recovery entry points. They do not cover creation
-- of new batches/reruns, direct table writes or reconciliation itself.
-- They deliberately hold only transaction-scoped locks and never call network.
create function public.assert_provider_receipt_record_scope(p_record uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 perform 1 from public.source_records s where s.id=p_record for update nowait;
 if not found then raise exception 'PROVIDER_SCOPE_RECORD_MISSING';end if;
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
   (select pj_guard.id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record) order by pc.id for update nowait;
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
    or t.run_id in (select pj_guard.run_id from public.pipeline_jobs pj_guard where pj_guard.source_record_id=p_record)))
  then raise exception 'PROVIDER_RECONCILIATION_REQUIRED';end if;
end $$;
revoke all on function public.assert_provider_receipt_record_scope(uuid) from public,anon,authenticated;
grant execute on function public.assert_provider_receipt_record_scope(uuid) to service_role;

create function public.assert_provider_receipt_run_scope(p_run uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare record_id uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 -- The run lock fences FK-checked job/task insertion in the target run.
 perform 1 from public.pipeline_runs r where r.id=p_run for update nowait;
 if not found then raise exception 'PROVIDER_SCOPE_RUN_MISSING';end if;
 perform 1 from public.pipeline_jobs j where j.run_id=p_run order by j.id for update nowait;
 perform 1 from public.worker_tasks t where t.run_id=p_run order by t.id for update nowait;
 perform 1 from public.cloud_checkpoints c where c.task_id in (select t.id from public.worker_tasks t where t.run_id=p_run)
  order by c.task_id,c.item_key for update nowait;
 perform 1 from public.provider_calls pc where pc.pipeline_job_id in (select j.id from public.pipeline_jobs j where j.run_id=p_run)
  order by pc.id for update nowait;
 if exists(select 1 from public.worker_tasks t where t.run_id=p_run and t.failure_kind='provider_unknown')
  or exists(select 1 from public.cloud_checkpoints c join public.worker_tasks t on t.id=c.task_id
   where t.run_id=p_run and c.item_key like 'ai:%' and c.value->>'state' in ('sending','unknown'))
  or exists(select 1 from public.provider_calls pc join public.pipeline_jobs j on j.id=pc.pipeline_job_id
   where j.run_id=p_run and pc.state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if exists(select 1 from public.worker_tasks t where t.run_id=p_run and t.failure_kind='provider_reconciliation')
  then raise exception 'PROVIDER_RECONCILIATION_REQUIRED';end if;
 -- Also inspect separate individual tasks and other runs tied to each member.
 for record_id in select distinct j.source_record_id from public.pipeline_jobs j where j.run_id=p_run order by j.source_record_id loop
  perform public.assert_provider_receipt_record_scope(record_id);
 end loop;
end $$;
revoke all on function public.assert_provider_receipt_run_scope(uuid) from public,anon,authenticated;
grant execute on function public.assert_provider_receipt_run_scope(uuid) to service_role;

-- Preserve every existing branch of each routine and fail migration closed if
-- a previous migration changed the exact insertion point.
do $migration$
declare original text; patched text; anchor text;
begin
 original:=pg_get_functiondef('public.cloud_start_phase(uuid,text)'::regprocedure);
 anchor:=' select * into strict r from pipeline_runs where id=p_run for update;';
 if length(original)-length(replace(original,anchor,''))<>length(anchor) then raise exception 'START_PHASE_GUARD_ANCHOR_INVALID';end if;
 patched:=replace(original,anchor,anchor||E'\n perform public.assert_provider_receipt_run_scope(p_run);');
 execute patched;
 original:=pg_get_functiondef('public.cloud_record_phase(uuid,text)'::regprocedure);
 anchor:=' select * into strict r from source_records where id=p_record for update;';
 if length(original)-length(replace(original,anchor,''))<>length(anchor) then raise exception 'RECORD_PHASE_GUARD_ANCHOR_INVALID';end if;
 patched:=replace(original,anchor,anchor||E'\n perform public.assert_provider_receipt_record_scope(p_record);');
 execute patched;
 original:=pg_get_functiondef('public.cloud_retry_validation(uuid,text)'::regprocedure);
 anchor:=' select * into strict t from worker_tasks where run_id=p_run and executor=''vercel_workflow'' order by created_at desc,id desc limit 1 for update;';
 -- A differing installed definition must be explicitly reconciled.
 if length(original)-length(replace(original,anchor,''))<>length(anchor) then raise exception 'RETRY_VALIDATION_GUARD_ANCHOR_INVALID';end if;
 patched:=replace(original,anchor,anchor||E'\n perform public.assert_provider_receipt_run_scope(p_run);');
 execute patched;
 original:=pg_get_functiondef('public.cloud_resume(uuid)'::regprocedure);
 anchor:=' select * into strict t from worker_tasks where run_id=p_run and executor=''vercel_workflow'' order by created_at desc,id desc limit 1 for update;';
 if length(original)-length(replace(original,anchor,''))<>length(anchor) then raise exception 'RESUME_RUN_SCOPE_GUARD_ANCHOR_INVALID';end if;
 patched:=replace(original,anchor,anchor||E'\n perform public.assert_provider_receipt_run_scope(p_run);');
 execute patched;
end $migration$;
