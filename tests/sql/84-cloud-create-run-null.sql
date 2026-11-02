-- All inserts are synthetic; the caller must run in a rollback transaction.
do $$
declare sid uuid:=gen_random_uuid();run_ uuid;runs_before bigint;tasks_before bigint;
begin
 insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic fixture') on conflict(key) do update set enabled=true;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
  values(sid,'contractacions',sid::text,'Contractació','Synthetic NULL guard','{}');
 select count(*) into runs_before from pipeline_runs;
 select count(*) into tasks_before from worker_tasks;
 begin perform cloud_create_run(null,false);raise exception 'TEST: null selection accepted';
 exception when others then if sqlerrm<>'Invalid selection' then raise;end if;end;
 begin perform cloud_create_run(array[]::uuid[],false);raise exception 'TEST: empty selection accepted';
 exception when others then if sqlerrm<>'Invalid selection' then raise;end if;end;
 begin perform cloud_create_run(array[sid,null]::uuid[],false);raise exception 'TEST: null element accepted';
 exception when others then if sqlerrm<>'Invalid selection' then raise;end if;end;
 begin perform cloud_create_run(array[sid,sid]::uuid[],false);raise exception 'TEST: duplicate selection accepted';
 exception when others then if sqlerrm<>'Invalid selection' then raise;end if;end;
 if (select count(*) from pipeline_runs)<>runs_before or (select count(*) from worker_tasks)<>tasks_before then raise exception 'TEST: invalid selection left work';end if;
 run_:=cloud_create_run(array[sid],false);
 if (select selected_count from pipeline_runs where id=run_)<>1 or
  not exists(select 1 from pipeline_jobs where run_id=run_ and source_record_id=sid) or
  not exists(select 1 from worker_tasks where run_id=run_) then raise exception 'TEST: valid selection changed';end if;
end $$;
