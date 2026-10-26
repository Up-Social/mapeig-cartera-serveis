do $$
declare t uuid;l uuid;r uuid;g bigint;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();n bigint;
begin
 update app_settings set enabled=true where key='processing_enabled';
 update cloud_resources set owner=null,lease_until=null,blocked_kind=null;
 insert into pipeline_runs(status,stage) values('queued','preparation') returning id into r;
 insert into worker_tasks(task_type,run_id,executor) values('process_run',r,'vercel_workflow') returning id into t;
 insert into pipeline_runs(status,stage) values('queued','preparation') returning id into r;
 insert into worker_tasks(task_type,run_id,executor) values('prepare_run',r,'local') returning id into l;
 update app_settings set enabled=false where key='processing_enabled';

 if cloud_claim(t,a,'test-v1') is not null then raise exception 'Disabled cloud claim accepted';end if;
 if exists(select 1 from claim_worker_task('test-disabled')) then raise exception 'Disabled legacy claim accepted';end if;
 select count(*) into n from worker_tasks;
 begin
  insert into worker_tasks(task_type,run_id,executor) values('match_run',r,'local');
  raise exception 'Disabled enqueue accepted';
 exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;
 if (select count(*) from worker_tasks)<>n then raise exception 'Disabled enqueue left a task';end if;
 begin
  update worker_tasks set status='running',claimed_at=now() where id=l;
  raise exception 'Disabled direct legacy claim accepted';
 exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;
 begin
  perform cloud_resource('sandbox',a);
  raise exception 'Disabled paid reservation accepted';
 exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;
 begin
  perform cloud_resume(r);
  raise exception 'Disabled resume accepted';
 exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;

 update app_settings set enabled=true where key='processing_enabled';
 g:=cloud_claim(t,a,'test-v1');
 if g is null or cloud_claim(t,b,'test-v1') is not null then raise exception 'Cloud claim fencing failed';end if;
 if not cloud_resource('sandbox',a) then raise exception 'Sandbox reservation failed';end if;
 if (select lease_until from cloud_resources where name='sandbox')<now()+interval '11 minutes' then raise exception 'Sandbox lease too short';end if;
 if cloud_resource('sandbox',b) then raise exception 'Concurrent sandbox reservation accepted';end if;
 if not cloud_resource('ai',b) then raise exception 'AI reservation failed';end if;
 if (select lease_until from cloud_resources where name='ai')>now()+interval '5 minutes' then raise exception 'AI lease changed';end if;
 update app_settings set enabled=false where key='processing_enabled';
 perform cloud_checkpoint(t,a,g,'paused-during-flight','{"safe":true}');
 perform cloud_finish(t,a,g,'pending');
 perform cloud_resource('sandbox',a,true,'cleanup_failed');
 if (select value from cloud_checkpoints where task_id=t and item_key='paused-during-flight')<>'{"safe":true}'::jsonb then raise exception 'Checkpoint lost during pause';end if;
 update app_settings set enabled=true where key='processing_enabled';
 select run_id into r from worker_tasks where id=t;
 begin
  perform cloud_resume(r);
  raise exception 'Resume cleared a global safety block';
 exception when sqlstate '55000' then if sqlerrm<>'CLOUD_RESOURCE_BLOCKED:recovery_required' then raise;end if;end;
 if (select blocked_kind from cloud_resources where name='sandbox')<>'cleanup_failed' then raise exception 'Global block lost';end if;

 -- Missing setting has the same effect as an explicit pause.
 delete from app_settings where key='processing_enabled';
 if processing_is_enabled() or cloud_claim(t,a,'test-v1') is not null then raise exception 'Missing setting accepted';end if;
end $$;
