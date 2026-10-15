-- Additive migration. Existing receipts and settled amounts are immutable here.
-- Standard text prices verified 2026-10-15:
-- https://developers.openai.com/api/docs/models/gpt-6-luna
alter table public.cloud_budget_reservations add column if not exists request_model text;
alter table public.cloud_budget_reservations add column if not exists pricing_version text;

create or replace function public.ai_usage_cost_usd(p_usage jsonb,p_model text) returns numeric
language plpgsql immutable set search_path=public as $$
declare i numeric; o numeric; c numeric:=0; w numeric:=0;
 input_rate numeric; cache_rate numeric; write_rate numeric; output_rate numeric;
begin
 if p_model is null or p_model not in ('gpt-4o-mini','gpt-4o-mini-2024-07-18','gpt-6-luna')
  or jsonb_typeof(p_usage->'input_tokens') is distinct from 'number'
  or jsonb_typeof(p_usage->'output_tokens') is distinct from 'number' then return null; end if;
 i:=(p_usage->>'input_tokens')::numeric; o:=(p_usage->>'output_tokens')::numeric;
 if p_usage->'input_tokens_details' ? 'cached_tokens' then
  if jsonb_typeof(p_usage->'input_tokens_details'->'cached_tokens') is distinct from 'number' then return null;end if;
  c:=(p_usage->'input_tokens_details'->>'cached_tokens')::numeric;
 end if;
 if p_model='gpt-6-luna' and p_usage->'input_tokens_details' ? 'cache_write_tokens' then
  if jsonb_typeof(p_usage->'input_tokens_details'->'cache_write_tokens') is distinct from 'number' then return null;end if;
  w:=(p_usage->'input_tokens_details'->>'cache_write_tokens')::numeric;
 end if;
 if i<0 or o<0 or c<0 or w<0 or c+w>i or i<>trunc(i) or o<>trunc(o) or c<>trunc(c) or w<>trunc(w) then return null;end if;
 if p_model='gpt-6-luna' then
  input_rate:=0.10; cache_rate:=0.01; write_rate:=0.125; output_rate:=0.50;
  if i>272000 then
   input_rate:=input_rate*2;cache_rate:=cache_rate*2;write_rate:=write_rate*2;output_rate:=output_rate*1.5;
  end if;
 else
  input_rate:=0.15;cache_rate:=0.075;write_rate:=0;output_rate:=0.60;
 end if;
 return ((i-c-w)*input_rate+c*cache_rate+w*write_rate+o*output_rate)/1000000;
end $$;

-- Keep the six-argument RPC compatible with deployed/paused workers.
-- The new overload receives a conservative UTF-8 upper bound for text input.
create or replace function public.cloud_budget_reserve(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_model text,p_output integer,p_input_tokens integer) returns boolean
language plpgsql security invoker set search_path=public as $$
declare rid uuid; budget numeric; spent numeric; ceiling numeric; existing_model text;
 input_bound integer; input_rate numeric; output_rate numeric;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select run_id into rid from worker_tasks where id=p_task;
 select (parameters->>'provider_budget_usd')::numeric into budget from pipeline_runs where id=rid for update;
 if p_model is null or p_model not in ('gpt-4o-mini','gpt-4o-mini-2024-07-18','gpt-6-luna')
  or p_output is null or p_output<1 then return false;end if;
 if p_model='gpt-6-luna' then
  input_bound:=coalesce(p_input_tokens,1050000);
  if input_bound<1 or input_bound>1050000 or p_output>128000 then return false;end if;
  -- Assume every input token incurs the cache-write premium. No discount is reserved.
  input_rate:=case when input_bound>272000 then 0.25 else 0.125 end;
  output_rate:=case when input_bound>272000 then 0.75 else 0.50 end;
 else
  if p_output>16384 then return false;end if;
  input_bound:=128000;input_rate:=0.15;output_rate:=0.60;
 end if;
 if budget is null then return true;end if;
 select coalesce(request_model,'gpt-4o-mini') into existing_model
 from cloud_budget_reservations where task_id=p_task and item_key=p_key;
 if found then
  return existing_model=p_model or (existing_model in ('gpt-4o-mini','gpt-4o-mini-2024-07-18') and p_model in ('gpt-4o-mini','gpt-4o-mini-2024-07-18'));
 end if;
 ceiling:=(input_bound*input_rate+p_output*output_rate)/1000000;
 select coalesce(sum(coalesce(b.actual_usd,b.reserved_usd)),0) into spent
 from cloud_budget_reservations b join worker_tasks t on t.id=b.task_id where t.run_id=rid;
 if spent+ceiling>budget then return false;end if;
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd,request_model,pricing_version)
 values(p_task,p_key,ceiling,p_model,'openai-standard-2026-10-15');
 return true;
end $$;

create or replace function public.cloud_budget_reserve(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_model text,p_output integer) returns boolean
language sql security invoker set search_path=public as $$
 select public.cloud_budget_reserve(p_task,p_owner,p_generation,p_key,p_model,p_output,null::integer);
$$;

create or replace function public.cloud_budget_settle(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare entry public.cloud_budget_reservations%rowtype; cost numeric;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select * into entry from cloud_budget_reservations where task_id=p_task and item_key=p_key for update;
 if not found or entry.actual_usd is not null then return;end if;
 if entry.pricing_version is null then
  -- Legacy reservations predate model capture; preserve their undiscounted tariff.
  if jsonb_typeof(p_usage->'input_tokens')='number' and jsonb_typeof(p_usage->'output_tokens')='number'
   and (p_usage->>'input_tokens')::numeric>=0 and (p_usage->>'output_tokens')::numeric>=0 then
   cost:=((p_usage->>'input_tokens')::numeric*0.15+(p_usage->>'output_tokens')::numeric*0.60)/1000000;
  end if;
 else
  cost:=ai_usage_cost_usd(p_usage,entry.request_model);
 end if;
 -- Invalid/missing usage retains the reservation; a repeated settlement is a no-op.
 if cost is not null then
  update cloud_budget_reservations set actual_usd=cost where task_id=p_task and item_key=p_key and actual_usd is null;
 end if;
end $$;

revoke all on function public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer,integer) to service_role;
revoke all on function public.ai_usage_cost_usd(jsonb,text),public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer),public.cloud_budget_settle(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.ai_usage_cost_usd(jsonb,text),public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer),public.cloud_budget_settle(uuid,uuid,bigint,text,jsonb) to service_role;
