-- Narrow guard for this task's durable reconciliation pause. It does not
-- protect individual operations, batch reruns or direct privileged writes.
-- Existing generic 'internal' pauses cannot be reclassified retrospectively.
create or replace function public.cloud_resume(p_run uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;j pipeline_jobs;
begin
 -- A snapshot taken before the row locks could miss a committed checkpoint.
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 perform assert_processing_enabled();
 if exists(select 1 from cloud_resources where blocked_kind is not null) then
  raise exception 'CLOUD_RESOURCE_BLOCKED:recovery_required' using errcode='55000';
 end if;
 select * into strict t from worker_tasks where run_id=p_run and executor='vercel_workflow' order by created_at desc,id desc limit 1 for update;
 if t.execution_state not in ('pending','paused','interrupted') and not(t.execution_state='running' and t.lease_until<now()) then raise exception 'No es pot reprendre';end if;
 -- The task lock prevents FK-checked inserts referencing it; row locks also
 -- prevent changing an existing checkpoint after the following read. No
 -- network call occurs while these locks are held.
 perform 1 from cloud_checkpoints where task_id=t.id order by item_key for update nowait;
 if t.failure_kind='provider_unknown' or exists(select 1 from cloud_checkpoints where task_id=t.id and value->>'state' in ('sending','unknown')) then raise exception 'PROVIDER_UNKNOWN';end if;
 if t.failure_kind='provider_reconciliation' then raise exception 'PROVIDER_RECONCILIATION_REQUIRED';end if;
 for j in select * from pipeline_jobs x where run_id=p_run and not exists(select 1 from analysis_results where pipeline_job_id=x.id)
 and x.status not in ('approved','corrected','rejected','insufficient_evidence','needs_review') order by id for update loop
  perform capture_job_snapshot(j.id,'before_cloud_resume');
  update job_attempts set status=case when status='running' then 'interrupted' else status end,completed_at=coalesce(completed_at,now()) where pipeline_job_id=j.id;
  insert into job_attempts(pipeline_job_id,ordinal,operation) select j.id,coalesce(max(ordinal),0)+1,'cloud_resume' from job_attempts where pipeline_job_id=j.id;
 end loop;
 update worker_tasks set execution_state='pending',status='queued',failure_kind=null,lease_until=null,lease_owner=null where id=t.id;
 return t.id;
end $$;
revoke all on function public.cloud_resume(uuid) from public,anon,authenticated;
grant execute on function public.cloud_resume(uuid) to service_role;
