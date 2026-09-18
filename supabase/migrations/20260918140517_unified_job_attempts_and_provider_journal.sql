alter table public.pipeline_jobs add column previous_job_id uuid references public.pipeline_jobs(id) on delete set null;
alter table public.worker_tasks add column pipeline_job_id uuid references public.pipeline_jobs(id) on delete set null;
create table public.provider_calls(
 id uuid primary key default gen_random_uuid(),pipeline_job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
 phase text not null,request_hash text not null,state text not null check(state in ('sending','received','retry','rejected')),
 response jsonb,attempts integer not null default 1,error_kind text,created_at timestamptz not null default clock_timestamp(),received_at timestamptz,
 unique(pipeline_job_id,phase,request_hash)
);
alter table public.provider_calls enable row level security;
revoke all on public.provider_calls from public,anon,authenticated;
grant select,insert,update on public.provider_calls to service_role;
create function public.claim_provider_call(p_job uuid,p_phase text,p_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c provider_calls;
begin
 perform 1 from pipeline_jobs where id=p_job for update;if not found then raise exception 'JOB_MISSING';end if;
 select * into c from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash=p_hash for update;
 if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if c.state='rejected' or c.attempts>=3 then raise exception 'PROVIDER_REJECTED';end if;
 if c.id is null then insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(p_job,p_phase,p_hash,'sending') returning * into c;
 else update provider_calls set state='sending',attempts=attempts+1,error_kind=null where id=c.id returning * into c;end if;
 return jsonb_build_object('send',true,'id',c.id);
end $$;
revoke all on function public.claim_provider_call(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_provider_call(uuid,text,text) to service_role;

create function public.guard_unresolved_provider_delete() returns trigger language plpgsql set search_path=public as $$begin
 if exists(select 1 from provider_calls where pipeline_job_id=old.id and state='sending') then raise exception 'DELETE_PROVIDER_UNRESOLVED';end if;return old;
end $$;
create trigger guard_unresolved_provider_delete before delete on public.pipeline_jobs for each row execute function public.guard_unresolved_provider_delete();

create function public.begin_record_operation(p_record uuid,p_operation text,p_executor text default 'local') returns jsonb language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs; prior uuid;run uuid;attempt uuid; task uuid;old_task uuid;kind text; source source_records;new_job boolean:=false;
begin
 if p_operation not in ('prepare','enrich','match','process','ocr') or p_executor not in ('local','vercel_workflow') then raise exception 'INVALID_OPERATION';end if;
 select * into strict source from source_records where id=p_record for update;
 select * into j from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1 for update;
 if exists(select 1 from worker_tasks t where (t.source_record_id=p_record or t.run_id in(select run_id from pipeline_jobs where source_record_id=p_record)) and (t.status in ('queued','running') or t.lease_until>now())) then raise exception 'ACTIVE_TASK';end if;
 if exists(select 1 from provider_calls where pipeline_job_id in(select id from pipeline_jobs where source_record_id=p_record) and state='sending') or exists(select 1 from cloud_checkpoints c join worker_tasks t on t.id=c.task_id where c.value->>'state'='sending' and (t.source_record_id=p_record or exists(select 1 from pipeline_jobs x where x.source_record_id=p_record and position(x.id::text in c.item_key)>0))) then raise exception 'PROVIDER_UNKNOWN';end if;
 if p_operation='match' and (source.evidence_status<>'ready' or source.enrichment_status<>'completed') then raise exception 'PREPARE_AND_ENRICH_FIRST';end if;
 if p_operation='enrich' and source.evidence_status<>'ready' then raise exception 'PREPARE_FIRST';end if;
 prior:=j.id;
 if j.id is null or exists(select 1 from analysis_results where pipeline_job_id=j.id) or exists(select 1 from matching_candidates where pipeline_job_id=j.id) or exists(select 1 from review_decisions where pipeline_job_id=j.id) then
  insert into pipeline_runs(status,stage,selected_count,parameters) values('queued','preparation',1,jsonb_build_object('auto_process',p_operation in ('process','ocr'),'purpose','record_operation','operation',p_operation,'ocr_recovery',p_operation='ocr')) returning id into run;
  insert into pipeline_jobs(run_id,source_record_id,previous_job_id,status,preparation_status,enrichment_status)
  values(run,p_record,prior,case when p_operation in ('match','enrich') then 'ready' else 'selected' end,case when source.evidence_status='ready' then 'ready' else 'pending' end,case when p_operation='match' then 'completed' else 'pending' end) returning * into j;
  new_job:=true;
 else
  run:=j.run_id;
  perform capture_job_snapshot(j.id,'before_recovery');
  update job_attempts set status=case when status='running' then 'interrupted' else status end,completed_at=coalesce(completed_at,now()) where pipeline_job_id=j.id;
  insert into job_attempts(pipeline_job_id,ordinal,operation) select j.id,coalesce(max(ordinal),0)+1,p_operation from job_attempts where pipeline_job_id=j.id returning id into attempt;
  update pipeline_jobs set status=case when p_operation in ('match','enrich') then 'ready' else 'selected' end,error_message=null,completed_at=null,claimed_at=null,preparation_status=case when p_operation='ocr' then 'pending' else preparation_status end where id=j.id;
  update pipeline_runs set status='queued',stage=case when p_operation='match' then 'matching' when p_operation='enrich' then 'enrichment' else 'preparation' end,completed_at=null,processing_completed_at=null,parameters=parameters||jsonb_build_object('auto_process',p_operation in ('process','ocr'),'ocr_recovery',p_operation='ocr') where id=run;
 end if;
 if attempt is null then select id into attempt from job_attempts where pipeline_job_id=j.id order by ordinal desc limit 1;end if;
 kind:=case p_operation when 'prepare' then 'prepare_run' when 'enrich' then 'enrich_record' when 'match' then 'match_run' else 'process_run' end;
 select id into old_task from worker_tasks where executor=p_executor and (run_id=run or source_record_id=p_record) order by created_at desc,id desc limit 1;
 insert into worker_tasks(task_type,run_id,source_record_id,pipeline_job_id,executor) values(kind,case when kind='enrich_record' then null else run end,case when kind='enrich_record' then p_record else null end,j.id,p_executor) returning id into task;
 if not new_job and old_task is not null then
  insert into cloud_checkpoints(task_id,item_key,value) select task,item_key,value from cloud_checkpoints where task_id=old_task and (position(j.id::text in item_key)>0 or exists(select 1 from source_documents d where d.source_record_id=p_record and position(d.id::text in item_key)>0)) and item_key not like '%:complete' and item_key not like '%:discovered' and item_key not like 'document_failed:%' on conflict do nothing;
  insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd) select task,item_key,reserved_usd,actual_usd from cloud_budget_reservations where task_id=old_task and position(j.id::text in item_key)>0 on conflict do nothing;
 end if;
 update source_records set processing_status=case when p_operation='match' then 'processant'::processing_status else 'preparant'::processing_status end,enrichment_status=case when p_operation in ('enrich','process','ocr') then 'pending' else enrichment_status end,updated_at=now() where id=p_record;
 return jsonb_build_object('runId',run,'jobId',j.id,'taskId',task,'attemptId',attempt,'newJob',new_job);
end $$;
revoke all on function public.begin_record_operation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_record_operation(uuid,text,text) to service_role;

-- Include durable local-provider receipts in future immutable snapshots.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.capture_job_snapshot(uuid,text)'::regprocedure);
 definition:=replace(definition,'''provider_checkpoints'',','''provider_calls'',coalesce((select jsonb_agg(to_jsonb(pc)) from provider_calls pc where pc.pipeline_job_id=p_job),''[]''),''provider_checkpoints'',');
 execute definition;
end $$;
