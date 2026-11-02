-- Synthetic rollback-only fixture. Not executed against production.
-- Caller supplies BEGIN/ROLLBACK and applies the candidate migration first.
do $$
declare sid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();jid uuid:=gen_random_uuid();tid uuid:=gen_random_uuid();
 receipt_key text;usage_key text;failure_ jsonb;usage_ jsonb:='{"input_tokens":1000,"output_tokens":100}';result_ jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
 values(sid,'concerts',sid::text,'Concert','Synthetic receipt recovery','{}');
 insert into pipeline_runs(id,status) values(rid,'paused');
 insert into pipeline_jobs(id,run_id,source_record_id,status,preparation_status) values(jid,rid,sid,'ready','ready');
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind)
 values(tid,'process_run',rid,'vercel_workflow','failed','paused','provider_reconciliation');
 failure_:=jsonb_build_object('kind','provider_reconciliation','job',jid,'stage','matching','at','2026-11-02T10:29:18.393Z',
  'diagnostic',jsonb_build_object('operation','concert_discard_review','code','EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED'));
 receipt_key:='ai:'||jid::text||':enrichment';usage_key:='usage:'||jid::text||':enrichment';
 insert into cloud_checkpoints(task_id,item_key,value) values(tid,'last_failure',failure_),
  (tid,receipt_key,jsonb_build_object('state','received','response',jsonb_build_object('usage',usage_))),
  (tid,usage_key,usage_);
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd,request_model,pricing_version)
 values(tid,receipt_key,0.1,ai_usage_cost_usd(usage_,'gpt-6-luna'),'gpt-6-luna','openai-standard-2026-10-15');
 result_:=reconcile_concert_review_receipts(tid,failure_,false);
 if result_->>'eligible' is distinct from 'true' or result_->>'applied' is distinct from 'false' then raise exception 'TEST: valid dry run %',result_;end if;
 if (select failure_kind from worker_tasks where id=tid) is distinct from 'provider_reconciliation'
  or exists(select 1 from cloud_checkpoints where task_id=tid and item_key like 'recovery:%') then raise exception 'TEST: dry run wrote state';end if;
 result_:=reconcile_concert_review_receipts(tid,failure_||'{"stage":"other"}',true);
 if result_->>'applied' is distinct from 'false' then raise exception 'TEST: stale failure applied';end if;
 update cloud_checkpoints set value=jsonb_set(failure_,'{diagnostic,operation}','"provider_release"') where task_id=tid and item_key='last_failure';
 result_:=reconcile_concert_review_receipts(tid,jsonb_set(failure_,'{diagnostic,operation}','"provider_release"'),true);
 if not(result_->'blockers' ? 'OTHER_FAILURE_REQUIRES_REVIEW') then raise exception 'TEST: unrelated reconciliation cleared';end if;
 update cloud_checkpoints set value=failure_ where task_id=tid and item_key='last_failure';
 update worker_tasks set execution_state='running',lease_owner=gen_random_uuid(),lease_until=now()+interval '1 minute' where id=tid;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'TASK_NOT_RECONCILIATION_PAUSED') then raise exception 'TEST: active worker accepted';end if;
 update worker_tasks set execution_state='paused',lease_owner=null,lease_until=null where id=tid;
 update cloud_checkpoints set value=jsonb_set(value,'{state}','"unknown"') where task_id=tid and item_key=receipt_key;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'PROVIDER_UNKNOWN') or result_->>'applied' is distinct from 'false' then raise exception 'TEST: unknown receipt accepted';end if;
 update cloud_checkpoints set value=jsonb_set(value,'{state}','"received"') where task_id=tid and item_key=receipt_key;
 update cloud_budget_reservations set actual_usd=null where task_id=tid;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'BUDGET_NOT_RECONCILED') then raise exception 'TEST: unsettled budget accepted';end if;
 update cloud_budget_reservations set actual_usd=1 where task_id=tid;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'BUDGET_COST_MISMATCH') then raise exception 'TEST: cost mismatch accepted';end if;
 update cloud_budget_reservations set actual_usd=ai_usage_cost_usd(usage_,'gpt-6-luna') where task_id=tid;
 update cloud_checkpoints set value='{"input_tokens":1,"output_tokens":1}' where task_id=tid and item_key=usage_key;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'USAGE_NOT_RECONCILED') then raise exception 'TEST: usage mismatch accepted';end if;
 update cloud_checkpoints set value=usage_ where task_id=tid and item_key=usage_key;
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(tid,'ai:orphan',0.1);
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'ORPHAN_BUDGET') then raise exception 'TEST: orphan budget accepted';end if;
 delete from cloud_budget_reservations where task_id=tid and item_key='ai:orphan';
 insert into cloud_checkpoints(task_id,item_key,value) values(tid,'usage:'||jid::text||':analysis',usage_);
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if not(result_->'blockers' ? 'ORPHAN_USAGE') then raise exception 'TEST: orphan usage accepted';end if;
 delete from cloud_checkpoints where task_id=tid and item_key='usage:'||jid::text||':analysis';
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if result_->>'applied' is distinct from 'true' then raise exception 'TEST: recovery failed %',result_;end if;
 if (select failure_kind from worker_tasks where id=tid) is not null
  or (select execution_state from worker_tasks where id=tid) is distinct from 'paused'
  or (select value from cloud_checkpoints where task_id=tid and item_key='last_failure') is distinct from failure_
  or (select value->'prior_failure' from cloud_checkpoints where task_id=tid and item_key='recovery:concert-review-receipts:v1') is distinct from failure_ then
  raise exception 'TEST: recovery did not preserve history/pause';end if;
 result_:=reconcile_concert_review_receipts(tid,failure_,true);
 if result_->>'applied' is distinct from 'false' then raise exception 'TEST: duplicate application';end if;
 if has_function_privilege('anon','public.reconcile_concert_review_receipts(uuid,jsonb,boolean)','execute')
  or has_function_privilege('authenticated','public.reconcile_concert_review_receipts(uuid,jsonb,boolean)','execute')
  or not has_function_privilege('service_role','public.reconcile_concert_review_receipts(uuid,jsonb,boolean)','execute') then raise exception 'TEST: privileges';end if;
end $$;
