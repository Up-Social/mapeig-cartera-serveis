-- Local enrichment and matching cannot reconcile Concert lines. Keep the entire
-- selected scope untouched when its types cannot be verified before a claim.
create or replace function public.assert_local_task_types(p_task public.worker_tasks)
returns uuid language plpgsql security definer set search_path=public as $$
declare n integer; invalid integer; target_run uuid; target_job uuid; latest_job uuid; run_status text;
begin
 if p_task.executor <> 'local' then
  raise exception 'LOCAL_TYPE_BLOCKED: Tasca no local';
 end if;
 if p_task.task_type = 'prepare_run' then return null; end if;
 if p_task.task_type = 'enrich_record' then
  -- Match the exact selection in run-enrichment, including legacy tasks
  -- without pipeline_job_id; never infer a run from another record.
  select j.id,j.run_id into target_job,target_run from pipeline_jobs j
   where j.source_record_id=p_task.source_record_id and (p_task.pipeline_job_id is null or j.id=p_task.pipeline_job_id)
   order by j.created_at desc,j.id desc limit 1 for share nowait;
  if target_job is null or target_run is null then raise exception 'LOCAL_TYPE_BLOCKED: No es pot verificar el lot del registre.'; end if;
  select id into latest_job from pipeline_jobs where source_record_id=p_task.source_record_id order by created_at desc,id desc limit 1;
  if latest_job is distinct from target_job then raise exception 'LOCAL_TYPE_BLOCKED: El treball d’enriquiment ja no es vigent.'; end if;
 elsif p_task.task_type in ('process_run','match_run') and p_task.run_id is not null then
  target_run:=p_task.run_id;
 else
  raise exception 'LOCAL_TYPE_BLOCKED: No es pot verificar el lot de la tasca.';
 end if;
 select status into run_status from pipeline_runs where id=target_run for share nowait;
 if run_status is null then raise exception 'LOCAL_TYPE_BLOCKED: No es pot verificar l’estat del lot.'; end if;
 if run_status='paused' then raise exception 'LOCAL_TYPE_BLOCKED: El lot esta pausat. Cal reprendre’l explicitament.'; end if;
  -- These runners update the global run even when the task selects one job.
  -- Other writers lock sources and jobs in both orders. Never wait with one
  -- of these locks held; contention must leave the task untouched.
  perform 1 from source_records where id in (select source_record_id from pipeline_jobs where run_id=target_run) for share nowait;
  perform 1 from pipeline_jobs where run_id=target_run for share nowait;
  if p_task.task_type='enrich_record' then
   perform 1 from source_records where id=p_task.source_record_id for update nowait;
   perform 1 from pipeline_jobs where source_record_id=p_task.source_record_id for share nowait;
   select id into latest_job from pipeline_jobs where source_record_id=p_task.source_record_id order by created_at desc,id desc limit 1;
   if latest_job is distinct from target_job then raise exception 'LOCAL_TYPE_BLOCKED: El treball d’enriquiment ja no es vigent.';end if;
  end if;
  select count(*),count(*) filter (where r.id is null or r.financing_type is null or r.financing_type not in ('conveni','contractacio','subvencio'))
  into n,invalid from pipeline_jobs j left join source_records r on r.id=j.source_record_id
  where j.run_id=target_run;
 if n=0 or invalid>0 then
  raise exception 'LOCAL_TYPE_BLOCKED: El lot conte concerts o tipologies no verificables. Reprograma el processament amb el flux cloud compatible.';
 end if;
 return target_job;
exception when lock_not_available then
 raise exception 'LOCAL_TYPE_BLOCKED: El lot esta en proces de modificacio. Torna-ho a provar quan finalitzi.';
end $$;

create or replace function public.claim_worker_task(p_worker_id text) returns setof public.worker_tasks
language plpgsql security definer set search_path=public as $$
declare t worker_tasks; blocked boolean:=false; target_job uuid;
begin
 if not processing_is_enabled() then return; end if;
 for t in select * from worker_tasks where executor='local'
 and (status='queued' or(status='running' and claimed_at<now()-interval '30 minutes')) and attempts<3
 order by created_at,id for update skip locked loop
  begin
   target_job:=assert_local_task_types(t);
  exception when raise_exception then
   if sqlerrm not like 'LOCAL_TYPE_BLOCKED:%' then raise; end if;
   blocked:=true;
   continue;
  end;
  return query update worker_tasks set status='running',attempts=attempts+1,claimed_by=left(p_worker_id,200),
   pipeline_job_id=case when t.task_type='enrich_record' then target_job else t.pipeline_job_id end,
   claimed_at=now(),completed_at=null,error_message=null where id=t.id returning *;
  return;
 end loop;
 if blocked then raise exception 'LOCAL_TYPE_BLOCKED: Hi ha tasques locals amb lots pausats, concerts, tipologies no verificables o modificacions concurrents. Revisa el lot abans de reprendre o reprogramar.'; end if;
end $$;

create or replace function public.claim_local_operation_task(p_task uuid) returns setof public.worker_tasks
language plpgsql security definer set search_path=public as $$
declare t worker_tasks; target_job uuid;
begin
 if not processing_is_enabled() then return; end if;
 select * into t from worker_tasks where id=p_task and status='queued' and executor='local' for update;
 if t.id is null then return; end if;
 target_job:=assert_local_task_types(t);
 return query update worker_tasks set status='running',claimed_at=now(),
  pipeline_job_id=case when t.task_type='enrich_record' then target_job else t.pipeline_job_id end where id=t.id returning *;
end $$;
revoke all on function public.assert_local_task_types(public.worker_tasks), public.claim_local_operation_task(uuid) from public,anon,authenticated;
grant execute on function public.assert_local_task_types(public.worker_tasks), public.claim_local_operation_task(uuid) to service_role;
