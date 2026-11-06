-- Audited recovery for a Conveni batch task paused by provider_unknown: one AI
-- request was marked 'sending' and the worker stopped before any response was
-- recorded, so nobody can tell whether the provider received or charged it.
-- The whole run stays paused (cloud_resume refuses any sending receipt), so
-- every other record of the batch is blocked by one uncertain request.
--
-- When the uncertainty is confined to exactly one job of the run (one receipt in
-- sending/unknown, no recorded response, no other uncertain receipt in the run
-- or for the record), this:
--  * keeps the receipt row but marks it 'abandoned', storing the original value;
--  * leaves its budget reservation untouched, so the unknown cost stays counted
--    at its reserved upper bound;
--  * retires the job (error, Catalan message) and creates a fresh job for the
--    record in its own run, so the record is reprocessed with a new request and
--    the uncertain one is never replayed or bound again;
--  * records an audit checkpoint and clears the task's provider_unknown pause,
--    so the batch can be resumed for its other records.
-- Nothing is sent, settled or deleted, and no worker task is started.
-- p_apply=false inspects under the same locks without changing any row.
create function public.retire_unknown_conveni_receipt(p_task uuid,p_expected_failure jsonb,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare t public.worker_tasks; j public.pipeline_jobs; r public.source_records;
 failure_ jsonb; original_ jsonb; key_ text; blockers text[]:='{}'; run_ uuid; new_job uuid; reserved_ numeric;
 audit_key constant text:='recovery:conveni-unknown-receipt:v1';
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 select * into strict t from public.worker_tasks where id=p_task for update nowait;
 select value into failure_ from public.cloud_checkpoints where task_id=p_task and item_key='last_failure';
 if p_expected_failure is null or failure_ is distinct from p_expected_failure then
  blockers:=array_append(blockers,'FAILURE_CHANGED');
 end if;
 if t.executor is distinct from 'vercel_workflow' or t.execution_state is distinct from 'paused'
  or t.failure_kind is distinct from 'provider_unknown' or t.lease_owner is not null
  or (t.lease_until is not null and t.lease_until>now()) or t.status in ('queued','running') or t.run_id is null then
  blockers:=array_append(blockers,'TASK_NOT_PROVIDER_UNKNOWN_PAUSED');
 end if;
 if failure_->>'kind' is distinct from 'provider_unknown' or failure_->>'stage' is distinct from 'enrichment' then
  blockers:=array_append(blockers,'OTHER_FAILURE_REQUIRES_REVIEW');
 end if;
 select * into j from public.pipeline_jobs where id=t.progress_job_id for update nowait;
 if not found or failure_->>'job' is distinct from j.id::text or j.run_id is distinct from t.run_id then
  return jsonb_build_object('eligible',false,'applied',false,'blockers',to_jsonb(array_append(blockers,'JOB_SCOPE_MISMATCH')));
 end if;
 select * into strict r from public.source_records where id=j.source_record_id for update nowait;
 key_:='ai:'||j.id::text||':conveni';
 -- Lock every row that can refer to the job, the run or the record.
 perform 1 from public.pipeline_runs where id=t.run_id for update nowait;
 perform 1 from public.pipeline_jobs where source_record_id=r.id or run_id=t.run_id order by id for update nowait;
 perform 1 from public.worker_tasks x where x.run_id=t.run_id or x.pipeline_job_id=j.id or x.progress_job_id=j.id or x.source_record_id=r.id order by x.id for update nowait;
 perform 1 from public.cloud_checkpoints where task_id in (select x.id from public.worker_tasks x where x.run_id=t.run_id or x.source_record_id=r.id)
  or position(j.id::text in item_key)>0 order by task_id,item_key for update nowait;
 perform 1 from public.cloud_budget_reservations where position(j.id::text in item_key)>0 order by task_id,item_key for update nowait;
 perform 1 from public.provider_calls where pipeline_job_id=j.id order by id for update nowait;
 if r.financing_type is distinct from 'conveni' or j.verification_only
  or j.status in ('approved','corrected','rejected','insufficient_evidence','needs_review','error')
  or j.id is distinct from (select id from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) then
  blockers:=array_append(blockers,'NOT_LATEST_OPEN_CONVENI_JOB');
 end if;
 if exists(select 1 from public.analysis_results where pipeline_job_id=j.id)
  or exists(select 1 from public.conveni_analyses where job_id=j.id)
  or exists(select 1 from public.matching_candidates where pipeline_job_id=j.id)
  or exists(select 1 from public.review_decisions where pipeline_job_id=j.id) then
  blockers:=array_append(blockers,'JOB_HAS_RESULTS');
 end if;
 if exists(select 1 from public.provider_calls where pipeline_job_id=j.id) then
  blockers:=array_append(blockers,'PROVIDER_CALL_RECORDED');
 end if;
 if exists(select 1 from public.conveni_receipt_bindings where job_id=j.id and response_hash is not null) then
  blockers:=array_append(blockers,'RESPONSE_BOUND');
 end if;
 -- The uncertain receipt must be the only one for the job, live in this task,
 -- and be the only uncertain receipt anywhere in the run or for the record.
 if (select count(*) from public.cloud_checkpoints where position(j.id::text in item_key)>0 and item_key like 'ai:%')<>1
  or (select count(*) from public.cloud_checkpoints where task_id=p_task and item_key=key_ and value->>'state' in ('sending','unknown'))<>1 then
  blockers:=array_append(blockers,'RECEIPT_SCOPE_MISMATCH');
 end if;
 select value into original_ from public.cloud_checkpoints where task_id=p_task and item_key=key_;
 if original_ ? 'response' then blockers:=array_append(blockers,'RESPONSE_PRESENT');end if;
 if exists(select 1 from public.cloud_checkpoints c join public.worker_tasks x on x.id=c.task_id
  where (x.run_id=t.run_id or x.source_record_id=r.id) and c.item_key like 'ai:%' and c.item_key<>key_ and c.value->>'state' in ('sending','unknown'))
  or exists(select 1 from public.provider_calls pc join public.pipeline_jobs pj on pj.id=pc.pipeline_job_id
  where (pj.run_id=t.run_id or pj.source_record_id=r.id) and pc.state='sending') then
  blockers:=array_append(blockers,'OTHER_UNCERTAIN_RECEIPT');
 end if;
 if exists(select 1 from public.worker_tasks x where x.id<>p_task and (x.run_id=t.run_id or x.pipeline_job_id=j.id or x.source_record_id=r.id)
  and (x.status in ('queued','running') or x.execution_state in ('pending','running') or x.failure_kind is not null or (x.lease_until is not null and x.lease_until>now()))) then
  blockers:=array_append(blockers,'OTHER_TASK_ACTIVE_OR_PAUSED');
 end if;
 if exists(select 1 from public.cloud_budget_reservations where position(j.id::text in item_key)>0 and (item_key<>key_ or task_id<>p_task))
  or (select count(*) from public.cloud_budget_reservations where task_id=p_task and item_key=key_ and actual_usd is null)<>1 then
  blockers:=array_append(blockers,'BUDGET_SCOPE_MISMATCH');
 end if;
 if exists(select 1 from public.cloud_checkpoints where task_id=p_task and item_key=audit_key) then
  blockers:=array_append(blockers,'ALREADY_RECOVERED');
 end if;
 if cardinality(blockers)>0 then
  return jsonb_build_object('eligible',false,'applied',false,'blockers',to_jsonb(blockers));
 end if;
 select reserved_usd into reserved_ from public.cloud_budget_reservations where task_id=p_task and item_key=key_;
 if coalesce(p_apply,false) then
  update public.cloud_checkpoints set value=jsonb_build_object('state','abandoned','prior',original_,'recovery',audit_key,'at',clock_timestamp())
  where task_id=p_task and item_key=key_;
  insert into public.pipeline_runs(status,stage,selected_count,parameters)
  values('queued','preparation',1,jsonb_build_object('purpose','record_operation','operation','process','auto_process',false,'ocr_recovery',false,'recovery','conveni-unknown-receipt-v1','retired_job',j.id))
  returning id into run_;
  insert into public.pipeline_jobs(run_id,source_record_id,previous_job_id,status,preparation_status,enrichment_status)
  values(run_,r.id,j.id,'selected','pending','pending') returning id into new_job;
  update public.pipeline_jobs set status='error',completed_at=coalesce(completed_at,now()),
   error_message='Anàlisi retirada: la petició a la IA es va interrompre sense resposta confirmada. Es reprocessa amb una petició nova; el cost possible queda comptat.'
  where id=j.id;
  insert into public.cloud_checkpoints(task_id,item_key,value) values(p_task,audit_key,
   jsonb_build_object('version',1,'action','retire_unknown_conveni_receipt','prior_failure',failure_,'retired_job',j.id,'new_job',new_job,'new_run',run_,
    'receipt_key',key_,'prior_receipt',original_,'reserved_usd_kept',reserved_,'actor',current_user,'at',clock_timestamp()));
  update public.worker_tasks set failure_kind=null where id=p_task;
  perform public.refresh_pipeline_run(t.run_id);
  perform public.refresh_pipeline_run(run_);
 end if;
 return jsonb_build_object('eligible',true,'applied',coalesce(p_apply,false),'record',r.source_record_id,'retired_job',j.id,'new_job',new_job,'new_run',run_,'reserved_usd_kept',reserved_,'next','cloud_resume_then_record_reprocess');
end $$;
revoke all on function public.retire_unknown_conveni_receipt(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.retire_unknown_conveni_receipt(uuid,jsonb,boolean) to service_role;
