do $$ declare sid uuid:=gen_random_uuid();r uuid;t uuid;j uuid;r2 uuid;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title)
 values(sid,'contractacions','PAUSED-VIEW-'||sid,'test','Paused worker visibility fixture');
 r:=cloud_create_run(array[sid],false);
 select id into j from pipeline_jobs where run_id=r;
 select id into t from worker_tasks where run_id=r;
 update pipeline_jobs set status='matching' where id=j;
 update worker_tasks set pipeline_job_id=j,progress_job_id=j,status='failed',execution_state='paused',failure_kind='internal',current_step='matching' where id=t;
 if not exists(select 1 from current_record_results where id=sid and destination='issues' and execution_status='error' and worker_incident) then
   raise exception 'Paused worker missing from incidents';
 end if;
 if not exists(select 1 from current_issue_results where id=sid and issue_group='technical') then
   raise exception 'Paused worker missing from technical counters';
 end if;
 if (select status from pipeline_jobs where id=j)<>'matching' then raise exception 'View must not mutate persisted job';end if;
 update pipeline_jobs set status='needs_review' where id=j;
 if not exists(select 1 from current_record_results where id=sid and destination='review' and not worker_incident) then
   raise exception 'Completed job was hidden by an old paused worker';
 end if;
 insert into pipeline_runs default values returning id into r2;
 insert into pipeline_jobs(run_id,source_record_id,status) values(r2,sid,'selected');
 if not exists(select 1 from current_record_results where id=sid and run_id=r2 and destination='processing' and not worker_incident) then
   raise exception 'Old worker leaked into a newer execution';
 end if;
end $$;
