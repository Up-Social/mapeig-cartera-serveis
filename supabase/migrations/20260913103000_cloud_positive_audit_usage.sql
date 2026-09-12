-- Account for independently journaled positive validation without changing historical totals.
-- Count a received provider response even when its classification is rejected.
create or replace function public.cloud_provider_usage(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare rid uuid;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_key !~ '^usage:[0-9a-f-]{36}:(enrichment|analysis|positive-audit-v[12])$' then raise exception 'Invalid usage key';end if;
 if exists(select 1 from cloud_checkpoints where task_id=p_task and item_key=p_key) then return;end if;
 select run_id into rid from worker_tasks where id=p_task;
 update pipeline_runs set actual_input_tokens=coalesce(actual_input_tokens,0)+coalesce((p_usage->>'input_tokens')::integer,0),actual_output_tokens=coalesce(actual_output_tokens,0)+coalesce((p_usage->>'output_tokens')::integer,0) where id=rid;
 perform cloud_checkpoint(p_task,p_owner,p_generation,p_key,p_usage);
end $$;
revoke all on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) to service_role;
