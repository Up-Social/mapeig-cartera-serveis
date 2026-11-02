-- Run inside a transaction and roll back. Every record and receipt is synthetic.
do $$
declare sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); sid3 uuid:=gen_random_uuid();
 run_ uuid:=gen_random_uuid(); job_ uuid:=gen_random_uuid(); job2 uuid:=gen_random_uuid();
 task_ uuid:=gen_random_uuid(); individual_ uuid:=gen_random_uuid(); result jsonb; before_tasks integer;
begin
 insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic fixture') on conflict(key) do update set enabled=true;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values
  (sid,'contractacions',sid::text,'Contractació','Synthetic source one','{}'),
  (sid2,'contractacions',sid2::text,'Contractació','Synthetic source two','{}'),
  (sid3,'raisc_ccaa',sid3::text,'Subvenció','Synthetic unrelated','{}');
 insert into pipeline_runs(id,status) values(run_,'paused');
 insert into pipeline_jobs(id,run_id,source_record_id,status) values(job_,run_,sid,'selected'),(job2,run_,sid2,'selected');
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind)
  values(task_,'process_run',run_,'vercel_workflow','failed','paused','provider_reconciliation');
 select count(*) into before_tasks from worker_tasks;
 -- A batch task covers all its jobs, independently of its checkpoint key.
 foreach result in array array['null'::jsonb,'true'::jsonb] loop
  begin
   if result='null'::jsonb then perform begin_record_operation(sid,'process','vercel_workflow');
   else perform begin_record_operation(sid2,'process','local');end if;
   raise exception 'TEST: batch reconciliation bypass';
  exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 end loop;
 begin perform retry_job_operation(sid,job_,'process','vercel_workflow');raise exception 'TEST: retry bypass';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 if (select count(*) from worker_tasks)<>before_tasks then raise exception 'TEST: blocked operation created a task';end if;
 -- In the same task, uncertainty wins over the reconciliation marker.
 insert into cloud_checkpoints(task_id,item_key,value) values(task_,'ai:other-job:matching','{"state":"unknown"}');
 begin perform begin_record_operation(sid2,'process','vercel_workflow');raise exception 'TEST: unknown bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update cloud_checkpoints set value='{"state":"sending"}' where task_id=task_ and item_key='ai:other-job:matching';
 begin perform begin_record_operation(sid,'process','vercel_workflow');raise exception 'TEST: sending bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 delete from cloud_checkpoints where task_id=task_ and item_key='ai:other-job:matching';
 update worker_tasks set failure_kind='provider_unknown' where id=task_;
 begin perform begin_record_operation(sid,'process','vercel_workflow');raise exception 'TEST: provider unknown marker bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update worker_tasks set failure_kind='internal' where id=task_;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(job_,'matching','synthetic','sending');
 begin perform begin_record_operation(sid,'process','vercel_workflow');raise exception 'TEST: local sending bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 -- An individual task may have no run_id. It remains in the same scope.
 insert into worker_tasks(id,task_type,source_record_id,executor,status,execution_state,failure_kind)
  values(individual_,'enrich_record',sid3,'vercel_workflow','failed','paused','provider_reconciliation');
 begin perform begin_record_operation(sid3,'process','vercel_workflow');raise exception 'TEST: individual bypass';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 update worker_tasks set failure_kind='internal' where id=individual_;
 insert into cloud_checkpoints(task_id,item_key,value) values(individual_,'ai:other-job:enrichment','{"state":"unknown"}');
 begin perform begin_record_operation(sid3,'process','vercel_workflow');raise exception 'TEST: individual uncertain receipt bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 delete from cloud_checkpoints where task_id=individual_;
 -- Existing generic internal pauses are not retrospectively reattributed.
 result:=begin_record_operation(sid3,'process','vercel_workflow');
 if nullif(result->>'taskId','') is null then raise exception 'TEST: unrelated internal pause changed';end if;
 if not has_function_privilege('service_role','public.begin_record_operation(uuid,text,text)','execute')
  or has_function_privilege('anon','public.begin_record_operation(uuid,text,text)','execute') then raise exception 'TEST: permissions changed';end if;
end $$;
