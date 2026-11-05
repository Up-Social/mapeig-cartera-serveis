-- Audited recovery for a Conveni task paused by conveni_bind_begin='legacy':
-- a provider receipt exists for the job from before receipt bindings, so it
-- cannot be linked to the current request (the request version guard rejects
-- reusing a response obtained with an earlier prompt). When every receipt is
-- received (no sending/unknown request) and settled exactly once, this records
-- an audit checkpoint, retires the old job and creates a fresh job for the
-- record. A new job id has no receipts, so the next reprocess binds normally.
-- Receipts, usage and budget rows are preserved; nothing is sent, settled,
-- deleted or resumed, and no worker task is created.
-- p_apply=false inspects under the same locks without changing any row.
create function public.retire_legacy_conveni_receipt(p_task uuid,p_expected_failure jsonb,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare t public.worker_tasks; j public.pipeline_jobs; r public.source_records; c record;
 failure_ jsonb; original_ jsonb; usage_ jsonb; key_ text; usage_key text; settled_ integer:=0; count_ integer:=0;
 receipts_ jsonb:='[]'::jsonb; blockers text[]:='{}'; run_ uuid; new_job uuid;
 audit_key constant text:='recovery:conveni-legacy-receipt:v1';
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 select * into strict t from public.worker_tasks where id=p_task for update nowait;
 select value into failure_ from public.cloud_checkpoints where task_id=p_task and item_key='last_failure';
 if p_expected_failure is null or failure_ is distinct from p_expected_failure then
  blockers:=array_append(blockers,'FAILURE_CHANGED');
 end if;
 if t.executor is distinct from 'vercel_workflow' or t.execution_state is distinct from 'paused'
  or t.failure_kind is distinct from 'provider_reconciliation' or t.lease_owner is not null
  or (t.lease_until is not null and t.lease_until>now()) or t.status in ('queued','running') then
  blockers:=array_append(blockers,'TASK_NOT_RECONCILIATION_PAUSED');
 end if;
 if failure_->>'kind' is distinct from 'provider_reconciliation'
  or failure_#>>'{diagnostic,operation}' is distinct from 'conveni_bind_begin'
  or failure_#>>'{diagnostic,code}' is distinct from 'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED' then
  blockers:=array_append(blockers,'OTHER_FAILURE_REQUIRES_REVIEW');
 end if;
 select * into j from public.pipeline_jobs where id=coalesce(t.progress_job_id,t.pipeline_job_id) for update nowait;
 if not found or failure_->>'job' is distinct from j.id::text
  or (t.pipeline_job_id is not null and t.pipeline_job_id is distinct from j.id) then
  return jsonb_build_object('eligible',false,'applied',false,'blockers',to_jsonb(array_append(blockers,'JOB_SCOPE_MISMATCH')));
 end if;
 select * into strict r from public.source_records where id=j.source_record_id for update nowait;
 key_:='ai:'||j.id::text||':conveni';usage_key:='usage:'||j.id::text||':conveni';
 -- Lock every task, checkpoint, budget and journal row that can refer to the job.
 perform 1 from public.pipeline_jobs where source_record_id=r.id order by id for update nowait;
 perform 1 from public.worker_tasks x where x.pipeline_job_id=j.id or x.progress_job_id=j.id or x.run_id=j.run_id or x.source_record_id=r.id order by x.id for update nowait;
 perform 1 from public.cloud_checkpoints where position(j.id::text in item_key)>0 order by task_id,item_key for update nowait;
 perform 1 from public.cloud_budget_reservations where position(j.id::text in item_key)>0 order by task_id,item_key for update nowait;
 perform 1 from public.provider_calls where pipeline_job_id=j.id order by id for update nowait;
 if r.financing_type is distinct from 'conveni' or j.verification_only
  or j.id is distinct from (select id from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) then
  blockers:=array_append(blockers,'NOT_LATEST_CONVENI_JOB');
 end if;
 if exists(select 1 from public.analysis_results where pipeline_job_id=j.id)
  or exists(select 1 from public.conveni_analyses where job_id=j.id)
  or exists(select 1 from public.matching_candidates where pipeline_job_id=j.id)
  or exists(select 1 from public.review_decisions where pipeline_job_id=j.id) then
  blockers:=array_append(blockers,'JOB_HAS_RESULTS');
 end if;
 if exists(select 1 from public.conveni_receipt_bindings where job_id=j.id) then
  blockers:=array_append(blockers,'BINDING_EXISTS');
 end if;
 if exists(select 1 from public.worker_tasks x where x.id<>p_task and (x.pipeline_job_id=j.id or x.progress_job_id=j.id or x.run_id=j.run_id or x.source_record_id=r.id)
  and (x.status in ('queued','running') or x.execution_state in ('pending','running') or x.failure_kind is not null or (x.lease_until is not null and x.lease_until>now()))) then
  blockers:=array_append(blockers,'OTHER_TASK_ACTIVE_OR_PAUSED');
 end if;
 if exists(select 1 from public.provider_calls where pipeline_job_id=j.id and state is distinct from 'received')
  or exists(select 1 from public.cloud_checkpoints where position(j.id::text in item_key)>0 and item_key like 'ai:%' and value->>'state' in ('sending','unknown')) then
  blockers:=array_append(blockers,'PROVIDER_UNKNOWN');
 end if;
 if exists(select 1 from public.cloud_checkpoints where position(j.id::text in item_key)>0 and item_key like 'ai:%' and item_key<>key_) then
  blockers:=array_append(blockers,'OTHER_RECEIPT_SCOPE');
 end if;
 -- Every copy of the receipt must be the same received response with its
 -- reconciled usage; exactly one budget row settles it at its exact cost and
 -- any other row is a zero carry-over created by begin_record_operation.
 for c in select task_id,value from public.cloud_checkpoints where item_key=key_ order by task_id loop
  count_:=count_+1;
  if c.value->>'state' is distinct from 'received' then blockers:=array_append(blockers,'RECEIPT_NOT_RECEIVED');continue;end if;
  if original_ is null then original_:=c.value;
  elsif c.value is distinct from original_ then blockers:=array_append(blockers,'RECEIPT_COPIES_DIFFER');continue;end if;
  usage_:=c.value#>'{response,usage}';
  if jsonb_typeof(usage_) is distinct from 'object'
   or not exists(select 1 from public.cloud_checkpoints where task_id=c.task_id and item_key=usage_key and value=usage_) then
   blockers:=array_append(blockers,'USAGE_NOT_RECONCILED');
  end if;
  receipts_:=receipts_||jsonb_build_array(jsonb_build_object('task',c.task_id,'state',c.value->>'state'));
 end loop;
 if count_=0 then blockers:=array_append(blockers,'NO_RECEIPTS');end if;
 for c in select * from public.cloud_budget_reservations where item_key=key_ order by task_id loop
  if c.pricing_version is not null then
   settled_:=settled_+1;
   if c.pricing_version is distinct from 'openai-standard-2026-10-15' or c.actual_usd is null or c.actual_usd<0
    or public.ai_usage_cost_usd(original_#>'{response,usage}',c.request_model) is distinct from c.actual_usd then
    blockers:=array_append(blockers,'BUDGET_COST_MISMATCH');
   end if;
  elsif c.reserved_usd is distinct from 0 or c.actual_usd is distinct from 0 then
   blockers:=array_append(blockers,'BUDGET_NOT_RECONCILED');
  end if;
 end loop;
 if settled_<>1 then blockers:=array_append(blockers,'BUDGET_NOT_SETTLED_ONCE');end if;
 if exists(select 1 from public.cloud_budget_reservations b where position(j.id::text in b.item_key)>0 and b.item_key<>key_) then
  blockers:=array_append(blockers,'OTHER_BUDGET_SCOPE');
 end if;
 if exists(select 1 from public.cloud_checkpoints where task_id=p_task and item_key=audit_key) then
  blockers:=array_append(blockers,'ALREADY_RECOVERED');
 end if;
 if cardinality(blockers)>0 then
  return jsonb_build_object('eligible',false,'applied',false,'blockers',to_jsonb(blockers));
 end if;
 if coalesce(p_apply,false) then
  insert into public.pipeline_runs(status,stage,selected_count,parameters)
  values('queued','preparation',1,jsonb_build_object('purpose','record_operation','operation','process','auto_process',false,'ocr_recovery',false,'recovery','conveni-legacy-receipt-v1','retired_job',j.id))
  returning id into run_;
  insert into public.pipeline_jobs(run_id,source_record_id,previous_job_id,status,preparation_status,enrichment_status)
  values(run_,r.id,j.id,'selected','pending','pending') returning id into new_job;
  update public.pipeline_jobs set status='error',completed_at=coalesce(completed_at,now()),
   error_message='Anàlisi retirada: la resposta conservada del model es va obtenir amb una versió anterior i no es pot vincular. Es reprocessa amb una anàlisi nova.'
  where id=j.id;
  insert into public.cloud_checkpoints(task_id,item_key,value) values(p_task,audit_key,
   jsonb_build_object('version',1,'action','retire_legacy_conveni_receipt','prior_failure',failure_,'retired_job',j.id,'new_job',new_job,
    'receipts',receipts_,'settled_usd',(select actual_usd from public.cloud_budget_reservations where item_key=key_ and pricing_version is not null),
    'actor',current_user,'at',clock_timestamp()));
  update public.worker_tasks set failure_kind=null,execution_state='completed',completed_at=coalesce(completed_at,now()) where id=p_task;
  perform public.refresh_pipeline_run(j.run_id);
  perform public.refresh_pipeline_run(run_);
 end if;
 return jsonb_build_object('eligible',true,'applied',coalesce(p_apply,false),'receipt_count',count_,'retired_job',j.id,'new_job',new_job,'next','record_reprocess');
end $$;
revoke all on function public.retire_legacy_conveni_receipt(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.retire_legacy_conveni_receipt(uuid,jsonb,boolean) to service_role;
