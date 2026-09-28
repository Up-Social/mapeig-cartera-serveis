do $$
declare r uuid;j uuid;t uuid;o uuid:=gen_random_uuid();g bigint;p record;
begin
 insert into pipeline_runs(status,stage) values('queued','preparation') returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status,enrichment_status)
 values(r,'aaaaaaaa-0000-4000-8000-000000000001','selected','pending','pending') returning id into j;
 update job_attempts set operation='process',status='running',completed_at=null,diagnostic=null where pipeline_job_id=j;
 insert into worker_tasks(task_type,run_id,executor,status,execution_state,lease_owner,lease_until,lease_generation)
 values('process_run',r,'vercel_workflow','running','running',o,now()+interval '5 minutes',1) returning id into t;
 perform cloud_finish(t,o,1,'paused','vercel_quota');
 if not exists(select 1 from job_attempts where pipeline_job_id=j and status='interrupted' and completed_at is not null and diagnostic='vercel_quota') then raise exception 'Paused attempt remained active';end if;
 select * into p from job_phase_states where id=j;
 if p.preparation<>'blocked' or p.enrichment<>'blocked' or p.matching<>'blocked' then raise exception 'Paused phases were not blocked';end if;
 if exists(select 1 from job_phase_states where id=j and preparation='running') then raise exception 'Paused job remained running';end if;
end $$;
