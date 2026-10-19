-- The dedicated conveni request is a real phase and needs the same idempotent usage journal.
create or replace function public.cloud_provider_usage(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare rid uuid;job uuid;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_key !~ '^usage:[0-9a-f-]{36}:(enrichment|analysis|positive-audit-v[1234]|contract-repair-v1|concert-role-review-v[12]|conveni)$' then raise exception 'Invalid usage key';end if;
 if split_part(p_key,':',3)='conveni' then
  job:=split_part(p_key,':',2)::uuid;
  if not exists(select 1 from pipeline_jobs j join source_records r on r.id=j.source_record_id join worker_tasks t on t.id=p_task
   where j.id=job and r.financing_type='conveni' and (t.run_id=j.run_id or t.pipeline_job_id=j.id or t.source_record_id=j.source_record_id)) then raise exception 'Conveni usage outside task scope';end if;
 end if;
 if exists(select 1 from cloud_checkpoints where task_id=p_task and item_key=p_key) then return;end if;
 select run_id into rid from worker_tasks where id=p_task;
 update pipeline_runs set actual_input_tokens=coalesce(actual_input_tokens,0)+coalesce((p_usage->>'input_tokens')::integer,0),actual_output_tokens=coalesce(actual_output_tokens,0)+coalesce((p_usage->>'output_tokens')::integer,0) where id=rid;
 perform cloud_checkpoint(p_task,p_owner,p_generation,p_key,p_usage);
end $$;
