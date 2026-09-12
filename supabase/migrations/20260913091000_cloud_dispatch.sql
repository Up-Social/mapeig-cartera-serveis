create function public.cloud_create_automated(p_size integer) returns uuid language plpgsql security invoker set search_path=public as $$
declare rid uuid;begin
 rid:=create_automated_batch(p_size);
 insert into worker_tasks(task_type,run_id,executor) values('process_run',rid,'vercel_workflow');return rid;
end $$;
create function public.cloud_resume(p_run uuid) returns uuid language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;begin
 select * into strict t from worker_tasks where run_id=p_run and executor='vercel_workflow' order by created_at desc limit 1 for update;
 if t.execution_state not in ('pending','paused','interrupted') and not(t.execution_state='running' and t.lease_until<now()) then raise exception 'No es pot reprendre';end if;
 if t.failure_kind='provider_unknown' then raise exception 'Cal resoldre la petició de resultat desconegut abans de repetir-la';end if;
 update cloud_resources set blocked_kind=null where blocked_kind=t.failure_kind;
 update worker_tasks set execution_state='pending',status='queued',failure_kind=null,lease_until=null,lease_owner=null where id=t.id;
 return t.id;
end $$;
revoke all on function public.cloud_create_automated(integer),public.cloud_resume(uuid) from public,anon,authenticated;
grant execute on function public.cloud_create_automated(integer),public.cloud_resume(uuid) to service_role;
