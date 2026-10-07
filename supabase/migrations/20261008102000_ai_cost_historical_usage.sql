-- Older executions recorded provider usage before the budget ledger existed.
-- Price only received, attributable gpt-4o-mini calls with valid token counts.
create function public.ai_usage_cost_usd(p_usage jsonb,p_model text) returns numeric
language plpgsql immutable set search_path=public as $$
declare input_count numeric;output_count numeric;cached_count numeric:=0;
begin
 if p_model not in ('gpt-4o-mini','gpt-4o-mini-2024-07-18')
  or jsonb_typeof(p_usage->'input_tokens')<>'number'
  or jsonb_typeof(p_usage->'output_tokens')<>'number' then return null;end if;
 input_count:=(p_usage->>'input_tokens')::numeric;
 output_count:=(p_usage->>'output_tokens')::numeric;
 if jsonb_typeof(p_usage->'input_tokens_details'->'cached_tokens')='number' then
  cached_count:=(p_usage->'input_tokens_details'->>'cached_tokens')::numeric;
 end if;
 if input_count<0 or output_count<0 or cached_count<0 or cached_count>input_count then return null;end if;
 -- USD per million tokens; cached input is charged at the documented half rate.
 return ((input_count-cached_count)*0.15+cached_count*0.075+output_count*0.60)/1000000;
end $$;

create or replace view public.ai_cost_per_call as
with budget_calls as (
 select distinct on (b.item_key)
  b.item_key,j.source_record_id,j.run_id,b.reserved_usd,b.actual_usd
 from public.cloud_budget_reservations b
 join public.worker_tasks t on t.id=b.task_id
 join public.pipeline_jobs j on j.id=case
  when split_part(b.item_key,':',2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then split_part(b.item_key,':',2)::uuid else t.pipeline_job_id end
 where b.item_key like 'ai:%'
 order by b.item_key,(b.actual_usd is not null) desc,b.actual_usd desc,t.created_at,b.task_id
), old_checkpoints as (
 select distinct on (c.item_key)
  c.item_key,j.source_record_id,j.run_id,
  public.ai_usage_cost_usd(c.value->'response'->'usage',c.value->'response'->>'model') as actual_usd
 from public.cloud_checkpoints c
 join public.pipeline_jobs j on j.id=split_part(c.item_key,':',2)::uuid
 where c.item_key ~ '^ai:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
  and c.value->>'state'='received'
  and not exists(select 1 from public.cloud_budget_reservations b where b.item_key=c.item_key)
 order by c.item_key,c.updated_at,c.task_id
), old_provider_calls as (
 select ('legacy-provider:'||p.id)::text as item_key,j.source_record_id,j.run_id,
  public.ai_usage_cost_usd(p.response->'usage',p.response->>'model') as actual_usd
 from public.provider_calls p
 join public.pipeline_jobs j on j.id=p.pipeline_job_id
 where p.state='received' and p.response is not null
  and not exists(select 1 from public.cloud_checkpoints c
    where c.item_key like 'ai:%' and c.value->>'state'='received'
      and c.value->'response'->>'id'=p.response->>'id'
      and p.response->>'id' is not null)
)
select item_key,source_record_id,run_id,reserved_usd,actual_usd from budget_calls
union all
select item_key,source_record_id,run_id,0::numeric,actual_usd from old_checkpoints where actual_usd is not null
union all
select item_key,source_record_id,run_id,0::numeric,actual_usd from old_provider_calls where actual_usd is not null;

revoke all on function public.ai_usage_cost_usd(jsonb,text) from public,anon,authenticated;
grant execute on function public.ai_usage_cost_usd(jsonb,text) to service_role;
