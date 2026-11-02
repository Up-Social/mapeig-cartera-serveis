-- Read a single, bounded provider response for a Conveni job. This does not
-- resume processing, settle usage, create proposals or change any decision.
create function public.read_conveni_retained_receipt(p_record uuid,p_job uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare j public.pipeline_jobs%rowtype; c record; n integer; expected text; wire text;
begin
 select * into j from public.pipeline_jobs where id=p_job and source_record_id=p_record;
 if not found or j.status is distinct from 'error' or j.error_kind is distinct from 'validation'
    or not exists(select 1 from public.source_records where id=p_record and financing_type='conveni') then
  return jsonb_build_object('status','unavailable');
 end if;
 -- Never show a retained response as though it were a proposal when an
 -- analysis already exists. The caller must read the persisted analysis.
 if exists(select 1 from public.conveni_analyses where job_id=p_job and source_record_id=p_record) then
  return jsonb_build_object('status','persisted');
 end if;
 select count(*) into n from (
  select 1 from public.provider_calls where pipeline_job_id=p_job and phase='conveni'
  union all
  select 1 from public.cloud_checkpoints cp join public.worker_tasks t on t.id=cp.task_id
   where cp.item_key='ai:'||p_job::text||':conveni' and t.executor='vercel_workflow'
   and t.pipeline_job_id=p_job
   and ((t.run_id is not null and t.run_id=j.run_id) or t.source_record_id=p_record)
 ) receipts;
 if n<>1 then return jsonb_build_object('status','unavailable'); end if;
 select * into c from (
  select state,response,request_hash as input_hash,null::uuid as task_id from public.provider_calls
   where pipeline_job_id=p_job and phase='conveni'
  union all
  select cp.value->>'state',cp.value->'response',null::text,t.id from public.cloud_checkpoints cp
   join public.worker_tasks t on t.id=cp.task_id
   where cp.item_key='ai:'||p_job::text||':conveni' and t.executor='vercel_workflow'
   and t.pipeline_job_id=p_job
   and ((t.run_id is not null and t.run_id=j.run_id) or t.source_record_id=p_record)
 ) receipts;
 if c.state is distinct from 'received' or jsonb_typeof(c.response) is distinct from 'object'
    or octet_length(c.response::text)>262144 then return jsonb_build_object('status','unavailable'); end if;
 if c.task_id is not null then
  -- The failure marker is task-scoped and can be overwritten by another job.
  -- Only the exact structured diagnostic permits this view. If it no longer
  -- exists, withhold the response rather than infer from error text.
  if not exists(select 1 from public.cloud_checkpoints f where f.task_id=c.task_id and f.item_key='last_failure'
   and f.value->>'kind'='validation' and f.value->>'job'=p_job::text
   and f.value->'diagnostic'->>'operation'='conveni_analysis'
   and f.value->'diagnostic'->>'code' in ('CONVENI_MODEL_DISCARD_REVIEW_REQUIRED',
    'CONVENI_DISCARD_MISSING_NIF','CONVENI_DISCARD_MISSING_IDENTITY','CONVENI_DISCARD_MISSING_RECIPIENT',
    'CONVENI_DISCARD_MISSING_AMOUNT','CONVENI_DISCARD_MISSING_PERIOD','CONVENI_DISCARD_MISSING_POPULATION',
    'CONVENI_DISCARD_MISSING_SERVICE','CONVENI_DISCARD_MISSING_FIELD','CONVENI_RECIPIENT_MISSING',
    'CONVENI_PERIOD_MISSING','CONVENI_POPULATION_MISSING','CONVENI_DESCRIPTION_MISSING')) then
   return jsonb_build_object('status','unavailable');
  end if;
  select value#>>'{}' into expected from public.cloud_checkpoints where task_id=c.task_id and item_key='conveni-input:'||p_job::text;
  select value#>>'{}' into wire from public.cloud_checkpoints where task_id=c.task_id and item_key='provider-wire:ai:'||p_job::text||':conveni';
  if expected is null or expected!~'^prepared-json-v1:[0-9a-f]{64}$' or wire is distinct from expected then return jsonb_build_object('status','unavailable'); end if;
 else
  -- The local journal does not persist a structured failure code for this
  -- path. A free-text error is not a reliable substitute.
  return jsonb_build_object('status','unavailable');
 end if;
 return jsonb_build_object('status','received','response',c.response);
end $$;
revoke all on function public.read_conveni_retained_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_conveni_retained_receipt(uuid,uuid) to service_role;
