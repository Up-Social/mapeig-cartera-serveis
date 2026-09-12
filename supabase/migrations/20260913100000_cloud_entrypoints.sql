grant delete on public.worker_tasks to service_role;
alter table public.worker_tasks drop constraint worker_tasks_target_check;
alter table public.worker_tasks add constraint worker_tasks_target_check check (
 (task_type in ('prepare_run','match_run','process_run') and run_id is not null and source_record_id is null)
 or (task_type='enrich_record' and source_record_id is not null and (run_id is null or executor='vercel_workflow'))
);
-- Atomic guided creation and phase transitions; no changes to historical rows.
create function public.cloud_create_draft(p_records uuid[],p_parameters jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid;
begin
 rid:=cloud_create_run(p_records,false);
 delete from worker_tasks where run_id=rid and executor='vercel_workflow';
 update pipeline_runs set status='draft',parameters=p_parameters where id=rid;
 return rid;
end $$;
create function public.cloud_start_phase(p_run uuid,p_type text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare tid uuid;r pipeline_runs;
begin
 if p_type not in ('prepare_run','match_run','enrich_record') then raise exception 'Invalid phase';end if;
 select * into strict r from pipeline_runs where id=p_run for update;
 select id into tid from worker_tasks where run_id=p_run and task_type=p_type and executor='vercel_workflow' and execution_state in ('pending','running','paused','interrupted') order by created_at desc limit 1;
 if tid is not null then return tid;end if;
 if exists(select 1 from worker_tasks where run_id=p_run and status in ('queued','running')) then raise exception 'Execució ja activa';end if;
 if p_type='prepare_run' and not exists(select 1 from pipeline_jobs where run_id=p_run and preparation_status<>'ready' and status<>'error') then raise exception 'No hi ha preparació pendent';end if;
 if p_type in ('match_run','enrich_record') and not exists(select 1 from pipeline_jobs where run_id=p_run and status='ready') then raise exception 'No hi ha registres preparats';end if;
 insert into worker_tasks(task_type,run_id,source_record_id,executor)
 values(p_type,p_run,case when p_type='enrich_record' then (select source_record_id from pipeline_jobs where run_id=p_run limit 1) else null end,'vercel_workflow') returning id into tid;
 update pipeline_runs set status='queued',stage=case when p_type='prepare_run' then 'preparation' when p_type='enrich_record' then 'enrichment' else 'matching' end,started_at=coalesce(started_at,now()) where id=p_run;
 return tid;
end $$;
create function public.cloud_record_phase(p_record uuid,p_type text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid;tid uuid;r source_records;
begin
 if p_type not in ('prepare_run','enrich_record','match_run') then raise exception 'Invalid phase';end if;
 perform pg_advisory_xact_lock(hashtext('create_automated_batch'));
 select * into strict r from source_records where id=p_record for update;
 select t.id into tid from worker_tasks t join pipeline_jobs j on j.run_id=t.run_id where j.source_record_id=p_record and t.executor='vercel_workflow' and t.task_type=p_type and t.execution_state in ('pending','running','paused','interrupted') order by t.created_at desc limit 1;
 if tid is not null then return tid;end if;
 if exists(select 1 from analysis_results where source_record_id=p_record) or exists(select 1 from service_provisions where source_record_id=p_record) or exists(select 1 from matching_candidates c join pipeline_jobs j on j.id=c.pipeline_job_id where j.source_record_id=p_record) then raise exception 'Registre ja analitzat';end if;
 if exists(select 1 from worker_tasks t join pipeline_jobs j on j.run_id=t.run_id where j.source_record_id=p_record and t.status in ('queued','running')) then raise exception 'Execució ja activa';end if;
 if p_type<>'prepare_run' and r.evidence_status<>'ready' then raise exception 'Falta preparar documents';end if;
 select j.run_id into rid from pipeline_jobs j where j.source_record_id=p_record and j.status='ready' and (select count(*) from pipeline_jobs x where x.run_id=j.run_id)=1 order by j.created_at desc limit 1;
 if rid is null then
  if exists(select 1 from pipeline_jobs where source_record_id=p_record and status in ('selected','preparing','ready','matching','queued')) then raise exception 'Registre seleccionat en un altre lot';end if;
  insert into pipeline_runs(status,stage,selected_count,parameters) values('draft','preparation',1,jsonb_build_object('purpose','inspection')) returning id into rid;
  insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) values(rid,p_record,case when p_type='prepare_run' then 'selected' else 'ready' end,case when p_type='prepare_run' then 'pending' else 'ready' end);
 end if;
 tid:=cloud_start_phase(rid,p_type);
 return tid;
end $$;
revoke all on function public.cloud_create_draft(uuid[],jsonb),public.cloud_start_phase(uuid,text),public.cloud_record_phase(uuid,text) from public,anon,authenticated;
grant execute on function public.cloud_create_draft(uuid[],jsonb),public.cloud_start_phase(uuid,text),public.cloud_record_phase(uuid,text) to service_role;
