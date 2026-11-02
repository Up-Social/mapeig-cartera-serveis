-- Prospectively bind a Conveni request and receipt to one leased task/job.
-- Older journals are never backfilled; ambiguous receipts remain pending review.
-- This validates journal consistency, not provider or Storage authenticity.
create table public.conveni_receipt_bindings (
 task_id uuid not null references public.worker_tasks(id) on delete cascade, job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
 wire_hash text not null, response_hash text, primary key(task_id,job_id),unique(job_id),
 check(wire_hash~'^prepared-json-v1:[0-9a-f]{64}$'),check(response_hash is null or response_hash~'^[0-9a-f]{64}$')
);
alter table public.conveni_receipt_bindings enable row level security;
revoke all on public.conveni_receipt_bindings from public,anon,authenticated,service_role;
grant select on public.conveni_receipt_bindings to service_role;

create function public.conveni_bind_begin(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_wire text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.worker_tasks%rowtype; j public.pipeline_jobs%rowtype; existing public.conveni_receipt_bindings%rowtype;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from public.worker_tasks where id=p_task;
 select * into strict j from public.pipeline_jobs where id=p_job for update;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'BIND_ISOLATION';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('mapeig:conveni-journal:'||p_job::text,0)) then raise exception 'CONVENI_JOURNAL_BUSY' using errcode='55P03';end if;
 if t.progress_job_id is distinct from p_job or t.current_step is null or t.current_step not in ('enrichment','matching')
  or not coalesce((t.run_id is not null and t.run_id=j.run_id) or t.source_record_id=j.source_record_id,false)
  or (t.pipeline_job_id is not null and t.pipeline_job_id<>p_job)
  or not exists(select 1 from public.source_records where id=j.source_record_id and financing_type='conveni')
  or p_wire is null or p_wire!~'^prepared-json-v1:[0-9a-f]{64}$' then raise exception 'BIND_SCOPE'; end if;
 select * into existing from public.conveni_receipt_bindings where job_id=p_job;
 if found then
  if existing.task_id<>p_task then raise exception 'BIND_OTHER_TASK';end if;
  if existing.wire_hash<>p_wire then raise exception 'BIND_WIRE_CHANGED';end if;
  return 'existing';
 end if;
 -- Never backfill a link on a previous sending/received or hashed request.
 if exists(select 1 from public.cloud_checkpoints where item_key in
  ('ai:'||p_job::text||':conveni','conveni-input:'||p_job::text,'provider-wire:ai:'||p_job::text||':conveni'))
  or exists(select 1 from public.provider_calls where pipeline_job_id=p_job and phase='conveni')
  or exists(select 1 from public.cloud_budget_reservations where item_key='ai:'||p_job::text||':conveni') then return 'legacy';end if;
 insert into public.conveni_receipt_bindings(task_id,job_id,wire_hash) values(p_task,p_job,p_wire);
 return 'created';
end $$;

create function public.conveni_bind_complete(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_wire text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.worker_tasks%rowtype; j public.pipeline_jobs%rowtype; b public.conveni_receipt_bindings%rowtype; receipt jsonb; ih jsonb; wh jsonb; rh text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict t from public.worker_tasks where id=p_task;
 select * into strict j from public.pipeline_jobs where id=p_job for update;
 if t.progress_job_id is distinct from p_job or not coalesce((t.run_id is not null and t.run_id=j.run_id) or t.source_record_id=j.source_record_id,false)
  or (t.pipeline_job_id is not null and t.pipeline_job_id<>p_job) then raise exception 'BIND_SCOPE';end if;
 select * into b from public.conveni_receipt_bindings where task_id=p_task and job_id=p_job for update;
 if not found or b.wire_hash is distinct from p_wire then raise exception 'BIND_MISSING';end if;
 select value into receipt from public.cloud_checkpoints where task_id=p_task and item_key='ai:'||p_job::text||':conveni' for update;
 select value into ih from public.cloud_checkpoints where task_id=p_task and item_key='conveni-input:'||p_job::text for update;
 select value into wh from public.cloud_checkpoints where task_id=p_task and item_key='provider-wire:ai:'||p_job::text||':conveni' for update;
 if receipt->>'state' is distinct from 'received' or jsonb_typeof(receipt->'response') is distinct from 'object'
  or ih#>>'{}' is distinct from p_wire or wh#>>'{}' is distinct from p_wire then raise exception 'BIND_RECEIPT_INVALID';end if;
 rh:=encode(extensions.digest((receipt->'response')::text,'sha256'),'hex');
 if b.response_hash is not null and b.response_hash<>rh then raise exception 'BIND_RESPONSE_CHANGED';end if;
 if b.response_hash is null then update public.conveni_receipt_bindings set response_hash=rh where task_id=p_task and job_id=p_job;end if;
 return rh;
end $$;
revoke all on function public.conveni_bind_begin(uuid,uuid,bigint,uuid,text),public.conveni_bind_complete(uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.conveni_bind_begin(uuid,uuid,bigint,uuid,text),public.conveni_bind_complete(uuid,uuid,bigint,uuid,text) to service_role;

-- Preview eligibility only; this does not authenticate the provider, evidence,
-- journal writer, Storage bytes, or user decisions.
create function public.conveni_bound_receipt_valid(p_task uuid,p_job uuid)
returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.conveni_receipt_bindings b
  join public.cloud_checkpoints r on r.task_id=b.task_id and r.item_key='ai:'||b.job_id::text||':conveni'
  join public.cloud_checkpoints i on i.task_id=b.task_id and i.item_key='conveni-input:'||b.job_id::text
  join public.cloud_checkpoints w on w.task_id=b.task_id and w.item_key='provider-wire:ai:'||b.job_id::text||':conveni'
  where b.task_id=p_task and b.job_id=p_job and b.response_hash is not null
   and r.value->>'state'='received' and jsonb_typeof(r.value->'response')='object'
   and b.response_hash=encode(extensions.digest((r.value->'response')::text,'sha256'),'hex')
   and i.value#>>'{}'=b.wire_hash and w.value#>>'{}'=b.wire_hash)
$$;
revoke all on function public.conveni_bound_receipt_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function public.conveni_bound_receipt_valid(uuid,uuid) to service_role;

-- Bindings act as an intent fence: older cloud and local writers must honor
-- the job's owner before they reserve or write `sending`.
do $$ declare original text;patched text;anchor text;begin
 original:=pg_get_functiondef('public.conveni_provider_journal_fence()'::regprocedure);
 anchor:=' raise exception ''CONVENI_JOURNAL_BUSY'' using errcode=''55P03'';'||chr(10)||' end if;'||chr(10)||' if tg_table_name=''cloud_checkpoints'' then';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'BIND_CLOUD_FENCE_ANCHOR_COUNT';end if;
 patched:=replace(original,
  anchor,
  ' raise exception ''CONVENI_JOURNAL_BUSY'' using errcode=''55P03'';'||chr(10)||' end if;'||chr(10)||
  ' if exists(select 1 from public.conveni_receipt_bindings b where b.job_id=jid and (tid is null or b.task_id<>tid)) then raise exception ''CONVENI_JOURNAL_OTHER_RECEIPT'';end if;'||chr(10)||' if tg_table_name=''cloud_checkpoints'' then');
 if patched=original then raise exception 'BIND_CLOUD_FENCE_ANCHOR_MISSING';end if;execute patched;
 original:=pg_get_functiondef('public.conveni_before_provider_reserve(uuid,text)'::regprocedure);
 anchor:=' if exists(select 1 from public.cloud_checkpoints where item_key=p_key and task_id<>p_task)';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'BIND_RESERVE_FENCE_ANCHOR_COUNT';end if;
 patched:=replace(original,
  anchor,
  ' if exists(select 1 from public.conveni_receipt_bindings b where b.job_id=jid and b.task_id<>p_task) then raise exception ''CONVENI_JOURNAL_OTHER_RECEIPT'';end if;'||chr(10)||' if exists(select 1 from public.cloud_checkpoints where item_key=p_key and task_id<>p_task)');
 if patched=original then raise exception 'BIND_RESERVE_FENCE_ANCHOR_MISSING';end if;execute patched;
end $$;

-- Read a single, bounded provider response for a Conveni job. This does not
-- resume processing, settle usage, create proposals or change any decision.
create or replace function public.read_conveni_retained_receipt(p_record uuid,p_job uuid)
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
  select 1 from public.cloud_checkpoints cp where cp.item_key='ai:'||p_job::text||':conveni'
 ) receipts;
 if n<>1 then return jsonb_build_object('status','unavailable'); end if;
 select * into c from (
  select state,response,request_hash as input_hash,null::uuid as task_id from public.provider_calls
   where pipeline_job_id=p_job and phase='conveni'
  union all
  select cp.value->>'state',cp.value->'response',null::text,t.id from public.cloud_checkpoints cp
   join public.worker_tasks t on t.id=cp.task_id
   where cp.item_key='ai:'||p_job::text||':conveni' and t.executor='vercel_workflow'
   and (t.pipeline_job_id=p_job or (t.pipeline_job_id is null and public.conveni_bound_receipt_valid(t.id,p_job)))
   and ((t.run_id is not null and t.run_id=j.run_id) or t.source_record_id=p_record)
 ) receipts;
 if not found then return jsonb_build_object('status','unavailable');end if;
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
