do $$
declare t uuid;rid uuid;owner_id uuid:=gen_random_uuid();other uuid:=gen_random_uuid();prior_until timestamptz;
begin
 update app_settings set enabled=true where key='processing_enabled';
 update cloud_resources set owner=null,lease_until=null,blocked_kind=null where name='sandbox';
 insert into pipeline_runs default values returning id into rid;
 insert into worker_tasks(run_id,task_type,executor,execution_state,status,lease_owner,lease_generation,lease_until)
 values(rid,'prepare_run','vercel_workflow','running','running',owner_id,7,clock_timestamp()-interval '1 second') returning id into t;
 begin perform cloud_acquire_sandbox(t,owner_id,7);raise exception 'TEST: expired lease acquired';
 exception when raise_exception then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 if (select owner from cloud_resources where name='sandbox') is not null then raise exception 'Expired task reserved Sandbox';end if;
 update worker_tasks set lease_until=clock_timestamp()+interval '10 seconds' where id=t;
 begin perform cloud_acquire_sandbox(t,owner_id,6);raise exception 'TEST: stale generation acquired';
 exception when raise_exception then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 if not cloud_acquire_sandbox(t,owner_id,7) then raise exception 'Valid lease did not reserve';end if;
 if (select lease_until from worker_tasks where id=t)<clock_timestamp()+interval '3 minutes' then raise exception 'Task lease was not refreshed';end if;
 select lease_until into prior_until from cloud_resources where name='sandbox';
 if prior_until<clock_timestamp()+interval '11 minutes' then raise exception 'Sandbox lease too short';end if;
 update worker_tasks set lease_owner=other,lease_generation=8 where id=t;
 if cloud_acquire_sandbox(t,other,8) then raise exception 'A different owner bypassed the resource lock';end if;
 if (select owner from cloud_resources where name='sandbox') is distinct from owner_id then raise exception 'Another owner changed Sandbox lease';end if;
 perform cloud_resource('sandbox',owner_id,true);
 update cloud_resources set blocked_kind='internal' where name='sandbox';
 if cloud_acquire_sandbox(t,other,8) then raise exception 'Blocked resource acquired';end if;
 update app_settings set enabled=false where key='processing_enabled';
 begin perform cloud_acquire_sandbox(t,other,8);raise exception 'TEST: disabled processing acquired';
 exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;
 if has_function_privilege('anon','public.cloud_acquire_sandbox(uuid,uuid,bigint)','EXECUTE') or has_function_privilege('authenticated','public.cloud_acquire_sandbox(uuid,uuid,bigint)','EXECUTE') then raise exception 'Public Sandbox acquisition exposed';end if;
end $$;
