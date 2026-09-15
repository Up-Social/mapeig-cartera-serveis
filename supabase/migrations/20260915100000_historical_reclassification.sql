-- Additive campaign: old jobs, proposals and human decisions remain untouched.
create unique index pipeline_runs_history_campaign on public.pipeline_runs ((parameters->>'history_campaign')) where parameters ? 'history_campaign';
create or replace function public.cloud_reclassify_history() returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid; ids uuid[]; n integer;
begin
 perform pg_advisory_xact_lock(hashtext('create_automated_batch'));
 select id into rid from pipeline_runs where parameters->>'history_campaign'='normative-history-v1';
 if rid is not null then return rid; end if;
 if not exists(select 1 from catalog_versions where active and validated) then raise exception 'Catàleg no validat'; end if;
 -- Lock source records before jobs, matching the human-review lock order.
 perform 1 from source_records s where exists(select 1 from pipeline_jobs j join matching_candidates c on c.pipeline_job_id=j.id where j.source_record_id=s.id) order by s.id for update;
 select array_agg(s.id order by s.id) into ids from source_records s
 where exists(select 1 from pipeline_jobs j join matching_candidates c on c.pipeline_job_id=j.id where j.source_record_id=s.id)
 and not exists(select 1 from analysis_results a where a.source_record_id=s.id)
 and not exists(select 1 from review_decisions d where d.source_record_id=s.id)
 and not exists(select 1 from service_provisions p where p.source_record_id=s.id)
 and not exists(select 1 from pipeline_jobs j where j.source_record_id=s.id and j.status in ('selected','preparing','ready','matching','queued'))
 and not exists(select 1 from worker_tasks t where t.source_record_id=s.id and t.status in ('queued','running'));
 n:=coalesce(cardinality(ids),0);
 if n=0 then return null; end if;
 if n>500 then raise exception 'Cal preparar una campanya més petita'; end if;
 insert into pipeline_runs(status,stage,selected_count,parameters,started_at)
 values('queued','preparation',n,jsonb_build_object('auto_process',true,'ocr_recovery',false,'purpose','historical_normative','history_campaign','normative-history-v1','provider_budget_usd',4),now()) returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) select rid,unnest(ids),'selected','pending';
 update source_records set processing_status='preparant',updated_at=now() where id=any(ids);
 insert into worker_tasks(task_type,run_id,executor) values('process_run',rid,'vercel_workflow');
 return rid;
end $$;
revoke all on function public.cloud_reclassify_history() from public,anon,authenticated;
grant execute on function public.cloud_reclassify_history() to service_role;

-- Fence every domain write against a human review made after campaign selection.
alter function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) rename to cloud_commit_before_history;
create function public.cloud_commit(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_operation text,p_data jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare sid uuid; historical boolean; decision text;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select j.source_record_id,r.parameters ? 'history_campaign' into strict sid,historical from pipeline_jobs j join pipeline_runs r on r.id=j.run_id where j.id=p_job;
 if historical then
  if not exists(select 1 from worker_tasks t join pipeline_jobs j on j.run_id=t.run_id where t.id=p_task and j.id=p_job) then raise exception 'CLOUD_SCOPE'; end if;
  perform 1 from source_records where id=sid for update;
  select d.decision into decision from review_decisions d where d.source_record_id=sid order by d.created_at desc,d.id desc limit 1;
  if decision is not null or exists(select 1 from service_provisions where source_record_id=sid) then
   update pipeline_jobs set status=coalesce(decision,'approved'),completed_at=now() where id=p_job;
   return;
  end if;
 end if;
 perform cloud_commit_before_history(p_task,p_owner,p_generation,p_job,p_operation,p_data);
end $$;
revoke all on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_commit(uuid,uuid,bigint,uuid,text,jsonb) to service_role;

-- Reserve the maximum text-model request cost, settle from usage, and retain the
-- reservation when a provider outcome is unknown. No billing data leaves Supabase.
create table public.cloud_budget_reservations (
 task_id uuid not null references worker_tasks(id), item_key text not null,
 reserved_usd numeric not null check(reserved_usd>=0), actual_usd numeric check(actual_usd>=0),
 primary key(task_id,item_key)
);
alter table public.cloud_budget_reservations enable row level security;
grant select,insert,update on public.cloud_budget_reservations to service_role;
create function public.cloud_budget_reserve(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_model text,p_output integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare rid uuid; budget numeric; spent numeric; ceiling numeric;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select run_id into rid from worker_tasks where id=p_task;
 select (parameters->>'provider_budget_usd')::numeric into budget from pipeline_runs where id=rid for update;
 if budget is null then return true; end if;
 if p_model is null or p_model not in ('gpt-4o-mini','gpt-4o-mini-2024-07-18') or p_output is null or p_output<1 or p_output>16384 then return false; end if;
 if exists(select 1 from cloud_budget_reservations where task_id=p_task and item_key=p_key) then return true; end if;
 -- Standard text pricing, no cache discount: $0.15/$0.60 per million tokens.
 -- Full 128K input context plus output is a deliberately conservative ceiling.
 ceiling:=(128000*0.15+p_output*0.60)/1000000;
 select coalesce(sum(coalesce(b.actual_usd,b.reserved_usd)),0) into spent from cloud_budget_reservations b join worker_tasks t on t.id=b.task_id where t.run_id=rid;
 if spent+ceiling>budget then return false; end if;
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(p_task,p_key,ceiling);
 return true;
end $$;
create function public.cloud_budget_settle(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 -- Missing usage keeps the conservative reservation, never silently frees it.
 if jsonb_typeof(p_usage->'input_tokens')='number' and jsonb_typeof(p_usage->'output_tokens')='number' then
  update cloud_budget_reservations set actual_usd=((p_usage->>'input_tokens')::numeric*0.15+(p_usage->>'output_tokens')::numeric*0.60)/1000000
  where task_id=p_task and item_key=p_key and actual_usd is null;
 end if;
end $$;
revoke all on function public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer),public.cloud_budget_settle(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer),public.cloud_budget_settle(uuid,uuid,bigint,text,jsonb) to service_role;
