-- Recover only the temporary Concert review fence, after its runtime fix is
-- deployed. Never sends a request, settles an amount, or resumes a worker.
-- p_apply=false inspects under the same locks without changing any row.
create function public.reconcile_concert_review_receipts(p_task uuid,p_expected_failure jsonb,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare t public.worker_tasks; j public.pipeline_jobs; c record; b public.cloud_budget_reservations;
 failure_ jsonb; usage_ jsonb; usage_key text; cost_ numeric; count_ integer:=0;
 blockers text[]:='{}'; audit_key constant text:='recovery:concert-review-receipts:v1';
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 select * into strict t from public.worker_tasks where id=p_task for update nowait;
 -- Holding the task row prevents concurrent lease acquisition and FK inserts;
 -- lock existing children too, because they may otherwise be updated in place.
 perform 1 from public.cloud_checkpoints where task_id=p_task order by item_key for update nowait;
 perform 1 from public.cloud_budget_reservations where task_id=p_task order by item_key for update nowait;
 select value into failure_ from public.cloud_checkpoints where task_id=p_task and item_key='last_failure';
 if p_expected_failure is null or failure_ is distinct from p_expected_failure then
  blockers:=array_append(blockers,'FAILURE_CHANGED');
 end if;
 if t.executor is distinct from 'vercel_workflow' or t.execution_state is distinct from 'paused'
  or t.failure_kind is distinct from 'provider_reconciliation' or t.lease_owner is not null or t.lease_until is not null then
  blockers:=array_append(blockers,'TASK_NOT_RECONCILIATION_PAUSED');
 end if;
 if failure_->>'kind' is distinct from 'provider_reconciliation'
  or failure_->>'stage' is distinct from 'matching'
  or failure_#>>'{diagnostic,operation}' is distinct from 'concert_discard_review'
  or failure_#>>'{diagnostic,code}' is distinct from 'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED' then
  blockers:=array_append(blockers,'OTHER_FAILURE_REQUIRES_REVIEW');
 end if;
 -- This recovery intentionally accepts only a single Concert job run. Broader
 -- or legacy scopes remain pending for a separate explicit investigation.
 perform 1 from public.pipeline_runs where id=t.run_id for update nowait;
 perform 1 from public.pipeline_jobs where run_id=t.run_id order by id for update nowait;
 if (select count(*) from public.pipeline_jobs where run_id=t.run_id)<>1 then
  blockers:=array_append(blockers,'SINGLE_CONCERT_RUN_REQUIRED');
 else
  select * into j from public.pipeline_jobs where run_id=t.run_id;
  perform 1 from public.source_records where id=j.source_record_id for update nowait;
  if not exists(select 1 from public.source_records where id=j.source_record_id and financing_type='concert')
   or failure_->>'job' is distinct from j.id::text
   or (t.pipeline_job_id is not null and t.pipeline_job_id is distinct from j.id)
   or (t.source_record_id is not null and t.source_record_id is distinct from j.source_record_id) then
   blockers:=array_append(blockers,'CONCERT_JOB_SCOPE_MISMATCH');
  end if;
  perform 1 from public.provider_calls where pipeline_job_id=j.id order by id for update nowait;
  if exists(select 1 from public.provider_calls where pipeline_job_id=j.id and state='sending') then
   blockers:=array_append(blockers,'PROVIDER_UNKNOWN');
  end if;
 end if;
 for c in select item_key,value from public.cloud_checkpoints where task_id=p_task and item_key like 'ai:%' order by item_key loop
  count_:=count_+1;
  if c.item_key !~ '^ai:[0-9a-f-]{36}:(enrichment|matching|positive-audit-v[1234]|contract-repair-v1|concert-role-review-v[12]|conveni)$'
   or split_part(c.item_key,':',2) is distinct from j.id::text then
   blockers:=array_append(blockers,'RECEIPT_SCOPE_INVALID');continue;
  end if;
  if c.value->>'state' is distinct from 'received' then
   blockers:=array_append(blockers,case when c.value->>'state' in ('sending','unknown') then 'PROVIDER_UNKNOWN' else 'RECEIPT_NOT_RECEIVED' end);continue;
  end if;
  usage_:=c.value#>'{response,usage}';
  usage_key:='usage:'||split_part(c.item_key,':',2)||':'||case when split_part(c.item_key,':',3)='matching' then 'analysis' else split_part(c.item_key,':',3) end;
  if jsonb_typeof(usage_) is distinct from 'object'
   or not exists(select 1 from public.cloud_checkpoints where task_id=p_task and item_key=usage_key and value=usage_) then
   blockers:=array_append(blockers,'USAGE_NOT_RECONCILED');continue;
  end if;
  if jsonb_typeof(usage_->'input_tokens') is distinct from 'number'
   or jsonb_typeof(usage_->'output_tokens') is distinct from 'number' then
   blockers:=array_append(blockers,'INVALID_RECEIPT_USAGE');continue;
  end if;
  if (usage_->>'input_tokens')::numeric>9007199254740991 or (usage_->>'output_tokens')::numeric>9007199254740991 then
   blockers:=array_append(blockers,'INVALID_RECEIPT_USAGE');continue;
  end if;
  select * into b from public.cloud_budget_reservations where task_id=p_task and item_key=c.item_key;
  if not found or b.pricing_version is distinct from 'openai-standard-2026-10-15'
   or b.actual_usd is null or b.actual_usd<0 then
   blockers:=array_append(blockers,'BUDGET_NOT_RECONCILED');continue;
  end if;
  cost_:=public.ai_usage_cost_usd(usage_,b.request_model);
  if cost_ is null or cost_ is distinct from b.actual_usd then
   blockers:=array_append(blockers,'BUDGET_COST_MISMATCH');
  end if;
 end loop;
 if count_=0 then blockers:=array_append(blockers,'NO_RECEIPTS');end if;
 if exists(select 1 from public.cloud_budget_reservations r where r.task_id=p_task
  and not exists(select 1 from public.cloud_checkpoints x where x.task_id=p_task and x.item_key=r.item_key and x.item_key like 'ai:%')) then
  blockers:=array_append(blockers,'ORPHAN_BUDGET');
 end if;
 if exists(select 1 from public.cloud_checkpoints u where u.task_id=p_task and u.item_key like 'usage:%'
  and (u.item_key !~ '^usage:[0-9a-f-]{36}:(enrichment|analysis|positive-audit-v[1234]|contract-repair-v1|concert-role-review-v[12]|conveni)$'
   or not exists(select 1 from public.cloud_checkpoints x where x.task_id=p_task and x.item_key=
   'ai:'||split_part(u.item_key,':',2)||':'||case when split_part(u.item_key,':',3)='analysis' then 'matching' else split_part(u.item_key,':',3) end))) then
  blockers:=array_append(blockers,'ORPHAN_USAGE');
 end if;
 if exists(select 1 from public.cloud_checkpoints where task_id=p_task and item_key=audit_key) then
  blockers:=array_append(blockers,'ALREADY_RECONCILED');
 end if;
 if cardinality(blockers)>0 then
  return jsonb_build_object('eligible',false,'applied',false,'blockers',to_jsonb(blockers));
 end if;
 if coalesce(p_apply,false) then
  insert into public.cloud_checkpoints(task_id,item_key,value) values(p_task,audit_key,
   jsonb_build_object('version',1,'prior_failure',failure_,'receipt_count',count_,'at',clock_timestamp(),'action','clear_verified_concert_review_fence'));
  update public.worker_tasks set failure_kind=null where id=p_task;
 end if;
 return jsonb_build_object('eligible',true,'applied',coalesce(p_apply,false),'receipt_count',count_,'state','paused','next','cloud_resume');
end $$;
revoke all on function public.reconcile_concert_review_receipts(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_concert_review_receipts(uuid,jsonb,boolean) to service_role;
