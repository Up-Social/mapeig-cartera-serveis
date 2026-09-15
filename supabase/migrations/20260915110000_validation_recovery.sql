-- Account for independently journaled positive validation without changing historical totals.
-- Count a received provider response even when its classification is rejected.
create or replace function public.cloud_provider_usage(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare rid uuid;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_key !~ '^usage:[0-9a-f-]{36}:(enrichment|analysis|positive-audit-v[12]|contract-repair-v1)$' then raise exception 'Invalid usage key';end if;
 if exists(select 1 from cloud_checkpoints where task_id=p_task and item_key=p_key) then return;end if;
 select run_id into rid from worker_tasks where id=p_task;
 update pipeline_runs set actual_input_tokens=coalesce(actual_input_tokens,0)+coalesce((p_usage->>'input_tokens')::integer,0),actual_output_tokens=coalesce(actual_output_tokens,0)+coalesce((p_usage->>'output_tokens')::integer,0) where id=rid;
 perform cloud_checkpoint(p_task,p_owner,p_generation,p_key,p_usage);
end $$;
revoke all on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) to service_role;

create function public.cloud_retry_validation(p_run uuid,p_revision text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks; j pipeline_jobs; n integer:=0; k text; v jsonb; rejected record;
begin
 if p_revision !~ '^validation-v[1-9][0-9]?$' then raise exception 'Invalid recovery revision';end if;
 select * into strict t from worker_tasks where run_id=p_run and executor='vercel_workflow' order by created_at desc,id desc limit 1 for update;
 if exists(select 1 from cloud_checkpoints where task_id=t.id and item_key='recovery:'||p_revision) then return t.id;end if;
 if t.execution_state<>'completed' then raise exception 'Cal esperar que finalitzi el lot';end if;
 perform 1 from source_records s join pipeline_jobs p on p.source_record_id=s.id where p.run_id=p_run and p.status='error' order by s.id for update of s;
 for j in select * from pipeline_jobs p where p.run_id=p_run and p.status='error' and p.error_kind='validation'
 and not exists(select 1 from analysis_results a where a.pipeline_job_id=p.id)
 and not exists(select 1 from review_decisions d where d.source_record_id=p.source_record_id)
 and not exists(select 1 from service_provisions v where v.source_record_id=p.source_record_id)
 and not exists(select 1 from pipeline_jobs newer where newer.source_record_id=p.source_record_id and (newer.created_at,newer.id)>(p.created_at,p.id)) for update of p loop
  insert into cloud_checkpoints(task_id,item_key,value) values(t.id,'recovery:'||p_revision||':'||j.id,jsonb_build_object('error_kind',j.error_kind,'error_message',j.error_message,'completed_at',j.completed_at));
  -- Before rejection journaling existed, only a confirmed provider rejection
  -- could leave this audit in sending while its job ended with validation.
  k:='ai:'||j.id||':positive-audit-v2';
  select value into v from cloud_checkpoints where task_id=t.id and item_key=k;
  if v->>'state'='sending' then
   if not exists(select 1 from cloud_checkpoints where task_id=t.id and item_key='ai:'||j.id||':matching' and value->>'state'='received')
    or not exists(select 1 from cloud_checkpoints where task_id=t.id and item_key=j.id||':audit-ready' and value='true'::jsonb) then raise exception 'Unknown provider outcome';end if;
   insert into cloud_checkpoints(task_id,item_key,value) values(t.id,'recovery:'||p_revision||':'||k,v);
   update cloud_checkpoints set value=v||'{"state":"retry","recovery_reason":"confirmed_validation_rejection"}',updated_at=now() where task_id=t.id and item_key=k;
  end if;
  for rejected in select item_key,value from cloud_checkpoints where task_id=t.id and item_key like 'ai:'||j.id||':%' and value->>'state'='rejected' loop
   insert into cloud_checkpoints(task_id,item_key,value) values(t.id,'recovery:'||p_revision||':'||rejected.item_key,rejected.value);
   update cloud_checkpoints set value=rejected.value||'{"state":"retry","recovery_reason":"explicit_recovery_after_fix"}',updated_at=now() where task_id=t.id and item_key=rejected.item_key;
  end loop;
  if exists(select 1 from cloud_checkpoints where task_id=t.id and item_key like 'ai:'||j.id||':%' and value->>'state'='sending') then raise exception 'Unknown provider outcome';end if;
  update pipeline_jobs set status=case when preparation_status='ready' then 'ready' else 'selected' end,error_kind=null,error_message=null,completed_at=null where id=j.id;
  update source_records set processing_status='preparant',updated_at=now() where id=j.source_record_id;
  n:=n+1;
 end loop;
 if n=0 then raise exception 'No hi ha incidències recuperables';end if;
 insert into cloud_checkpoints(task_id,item_key,value) values(t.id,'recovery:'||p_revision,jsonb_build_object('count',n));
 update worker_tasks set execution_state='pending',status='queued',failure_kind=null,lease_owner=null,lease_until=null,completed_at=null,dispatch_at=null where id=t.id;
 update pipeline_runs set status='queued',stage='matching',pause_kind=null,pause_reason=null,completed_at=null where id=p_run;
 return t.id;
end $$;
revoke all on function public.cloud_retry_validation(uuid,text) from public,anon,authenticated;
grant execute on function public.cloud_retry_validation(uuid,text) to service_role;
