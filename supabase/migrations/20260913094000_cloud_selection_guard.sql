create or replace function public.cloud_create_run(p_records uuid[],p_ocr boolean default false) returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid;n integer;
begin
 if cardinality(p_records)<1 or cardinality(p_records)>500 then raise exception 'Invalid selection';end if;
 perform pg_advisory_xact_lock(hashtext('create_automated_batch'));
 perform 1 from source_records where id=any(p_records) order by id for update;
 select count(*) into n from source_records where id=any(p_records);
 if n<>cardinality(p_records) then raise exception 'Invalid selection';end if;
 if exists(select 1 from service_provisions where source_record_id=any(p_records)) then raise exception 'Registre ja aprovat';end if;
 if exists(select 1 from pipeline_jobs j left join analysis_results a on a.pipeline_job_id=j.id where j.source_record_id=any(p_records) and (a.id is not null or exists(select 1 from matching_candidates c where c.pipeline_job_id=j.id) or j.status in ('selected','preparing','ready','matching','queued'))) then raise exception 'Registre ja seleccionat o analitzat';end if;
 insert into pipeline_runs(status,stage,selected_count,parameters,started_at) values('queued','preparation',n,jsonb_build_object('auto_process',true,'ocr_recovery',p_ocr,'purpose','automated_cloud'),now()) returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) select rid,id,'selected','pending' from source_records where id=any(p_records);
 update source_records set processing_status='preparant',updated_at=now() where id=any(p_records);
 insert into worker_tasks(task_type,run_id,executor) values('process_run',rid,'vercel_workflow');
 return rid;
end $$;


revoke all on function public.cloud_create_run(uuid[],boolean) from public,anon,authenticated;
grant execute on function public.cloud_create_run(uuid[],boolean) to service_role;
