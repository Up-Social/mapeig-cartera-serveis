-- Synthetic fixtures. The caller must run in a transaction and roll it back.
do $$
declare sid uuid:=gen_random_uuid();sid2 uuid:=gen_random_uuid();run_ uuid:=gen_random_uuid();job_ uuid:=gen_random_uuid();job2 uuid:=gen_random_uuid();task_ uuid:=gen_random_uuid();individual_ uuid:=gen_random_uuid();empty_run uuid:=gen_random_uuid();empty_task uuid:=gen_random_uuid();historic_ uuid:=gen_random_uuid();other_run uuid:=gen_random_uuid();other_job uuid:=gen_random_uuid();other_task uuid:=gen_random_uuid();returned uuid;
begin
 insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic fixture') on conflict(key) do update set enabled=true;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values
  (sid,'contractacions',sid::text,'Contractació','Synthetic phase one','{}'),
  (sid2,'raisc_ccaa',sid2::text,'Subvenció','Synthetic phase two','{}');
 insert into pipeline_runs(id,status) values(run_,'paused'),(empty_run,'paused');
 insert into pipeline_jobs(id,run_id,source_record_id,status,preparation_status) values(job_,run_,sid,'ready','ready'),(job2,run_,sid2,'ready','ready');
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind) values
  (task_,'match_run',run_,'vercel_workflow','failed','paused','provider_reconciliation'),
  (empty_task,'match_run',empty_run,'vercel_workflow','failed','paused','provider_reconciliation');
 insert into cloud_checkpoints(task_id,item_key,value) values(task_,'ai:other-job:matching','{"state":"received","response":{"synthetic":true}}');
 begin perform cloud_start_phase(run_,'match_run');raise exception 'TEST: phase returned paused task';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 begin perform cloud_record_phase(sid2,'match_run');raise exception 'TEST: record returned paused batch task';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 begin perform cloud_retry_validation(run_,'validation-v2');raise exception 'TEST: recovery bypass';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 begin perform cloud_start_phase(empty_run,'match_run');raise exception 'TEST: empty run bypass';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 if (select value->>'state' from cloud_checkpoints where task_id=task_ and item_key='ai:other-job:matching')<>'received' then raise exception 'TEST: receipt altered';end if;
 if exists(select 1 from cloud_checkpoints where task_id=task_ and item_key like 'recovery:%') then raise exception 'TEST: recovery checkpoint created';end if;
 update worker_tasks set failure_kind='internal' where id=task_;
 update cloud_checkpoints set value='{"state":"unknown"}' where task_id=task_ and item_key='ai:other-job:matching';
 begin perform cloud_start_phase(run_,'match_run');raise exception 'TEST: unknown run bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 begin perform cloud_record_phase(sid,'match_run');raise exception 'TEST: unknown record bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 begin perform cloud_retry_validation(run_,'validation-v2');raise exception 'TEST: unknown retry bypass';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 delete from cloud_checkpoints where task_id=task_;
 -- An individual task without run_id is still related to its source.
 insert into worker_tasks(id,task_type,source_record_id,executor,status,execution_state,failure_kind) values(individual_,'enrich_record',sid,'vercel_workflow','failed','paused','provider_reconciliation');
 begin perform cloud_start_phase(run_,'match_run');raise exception 'TEST: individual pause ignored by run';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 update worker_tasks set execution_state='completed',status='completed' where id=task_;
 insert into cloud_checkpoints(task_id,item_key,value) values(task_,'ai:synthetic:positive-audit-v2','{"state":"rejected"}');
 begin perform cloud_retry_validation(run_,'validation-v2');raise exception 'TEST: completed validation retry bypassed individual pause';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 if (select value->>'state' from cloud_checkpoints where task_id=task_ and item_key='ai:synthetic:positive-audit-v2')<>'rejected' then raise exception 'TEST: rejected receipt rewritten';end if;
 delete from cloud_checkpoints where task_id=task_;
 update worker_tasks set execution_state='paused',status='failed' where id=task_;
 update worker_tasks set failure_kind='internal' where id=individual_;
 -- An uncertain provider_calls row for another member also blocks the run.
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(job2,'matching','synthetic','sending');
 begin perform cloud_start_phase(run_,'match_run');raise exception 'TEST: other member local journal ignored';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 delete from provider_calls where pipeline_job_id=job2;
 -- A previous task in the same run must not be bypassed by the latest task.
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind,created_at)
  values(historic_,'match_run',run_,'vercel_workflow','failed','paused','provider_reconciliation',clock_timestamp()-interval '1 day');
 begin perform cloud_resume(run_);raise exception 'TEST: old reconciliation bypassed by latest task';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;
 update worker_tasks set failure_kind='provider_unknown' where id=historic_;
 begin perform cloud_resume(run_);raise exception 'TEST: old unknown marker bypassed';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update worker_tasks set failure_kind='internal' where id=historic_;
 insert into cloud_checkpoints(task_id,item_key,value) values(historic_,'ai:historic:matching','{"state":"unknown"}');
 begin perform cloud_resume(run_);raise exception 'TEST: old unknown checkpoint bypassed';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 delete from cloud_checkpoints where task_id=historic_;
 -- Another run with the same record and an uncertain task is also in scope.
 insert into pipeline_runs(id,status) values(other_run,'paused');
 insert into pipeline_jobs(id,run_id,source_record_id,status) values(other_job,other_run,sid,'selected');
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind)
  values(other_task,'match_run',other_run,'vercel_workflow','failed','paused','provider_unknown');
 begin perform cloud_start_phase(run_,'match_run');raise exception 'TEST: other-run unknown bypassed';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 begin perform cloud_record_phase(sid,'match_run');raise exception 'TEST: record phase bypassed other-run unknown';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update worker_tasks set failure_kind='internal' where id=other_task;
 -- No synthetic unresolved marker: retain the legacy idempotent phase result.
 returned:=cloud_start_phase(run_,'match_run');
 if returned<>task_ then raise exception 'TEST: normal phase semantics changed';end if;
 if has_function_privilege('anon','public.assert_provider_receipt_run_scope(uuid)','execute')
  or has_function_privilege('authenticated','public.assert_provider_receipt_record_scope(uuid)','execute')
  or not has_function_privilege('service_role','public.assert_provider_receipt_run_scope(uuid)','execute') then raise exception 'TEST: scope helper privileges';end if;
end $$;
