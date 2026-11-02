-- Serialize new Conveni sends across distinct cloud tasks and the local journal.
-- Existing checkpoints and reservations are preserved; ambiguous history requires
-- reconciliation. Does not protect simultaneous invocations within one task.
-- Deploy only after inventorying/draining active old writers and preserving leases.
create function public.conveni_provider_journal_fence() returns trigger
language plpgsql security invoker set search_path=public as $$
declare jid uuid; k text; tid uuid; prior jsonb;
begin
 if tg_table_name='cloud_checkpoints' then
  if new.value->>'state' is distinct from 'sending' or new.item_key !~ '^ai:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:conveni$' then return new;end if;
  jid:=split_part(new.item_key,':',2)::uuid;tid:=new.task_id;k:=new.item_key;
 elsif tg_table_name='provider_calls' then
  if new.state<>'sending' or new.phase<>'conveni' then return new;end if;
  jid:=new.pipeline_job_id;k:='ai:'||jid::text||':conveni';
  -- The local journal stores a 5xx response while retaining `sending` because
  -- provider work may have completed. This updates one existing attempt; it
  -- must not be mistaken for permission to initiate another request.
  if tg_op='UPDATE' then
   if old.state='sending' and old.id=new.id and old.pipeline_job_id=new.pipeline_job_id
      and old.phase=new.phase and old.request_hash=new.request_hash and old.attempts=new.attempts
      and old.error_kind is not distinct from new.error_kind and old.created_at=new.created_at then
    if (old.response is null or old.response is not distinct from new.response)
       and (old.received_at is null or old.received_at is not distinct from new.received_at) then return new;end if;
    raise exception 'CONVENI_JOURNAL_RESPONSE_CONFLICT';
   end if;
  end if;
 else raise exception 'CONVENI_JOURNAL_TRIGGER_INVALID';end if;
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'CONVENI_JOURNAL_ISOLATION_UNSUPPORTED';
 end if;
 -- Preserve the already-sending response when a provider 5xx makes it
 -- uncertain; this records an outcome and does not start another request.
 if tg_table_name='cloud_checkpoints' then
  if new.value->'unknown'='true'::jsonb then
   select value into prior from public.cloud_checkpoints where task_id=tid and item_key=k and value->>'state'='sending';
   if found then
    if prior->'attempt' is not distinct from new.value->'attempt'
       and (prior->'response' is null or prior->'response'='null'::jsonb or prior->'response' is not distinct from new.value->'response') then return new;end if;
    raise exception 'CONVENI_JOURNAL_RESPONSE_CONFLICT';
   end if;
  end if;
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended('mapeig:conveni-journal:'||jid::text,0)) then
  raise exception 'CONVENI_JOURNAL_BUSY' using errcode='55P03';
 end if;
 if tg_table_name='cloud_checkpoints' then
  if exists(select 1 from public.cloud_checkpoints where item_key=k and task_id<>tid)
    or exists(select 1 from public.provider_calls where pipeline_job_id=jid and phase='conveni')
    or exists(select 1 from public.cloud_budget_reservations where item_key=k and task_id<>tid) then
   raise exception 'CONVENI_JOURNAL_OTHER_RECEIPT';end if;
 else
  if exists(select 1 from public.cloud_checkpoints where item_key=k)
    or exists(select 1 from public.provider_calls where pipeline_job_id=jid and phase='conveni' and id<>new.id)
    or exists(select 1 from public.cloud_budget_reservations where item_key=k) then
   raise exception 'CONVENI_JOURNAL_OTHER_RECEIPT';end if;
 end if;
 return new;
end $$;
revoke all on function public.conveni_provider_journal_fence() from public,anon,authenticated;
grant execute on function public.conveni_provider_journal_fence() to service_role;
create trigger conveni_cloud_journal_fence before insert or update on public.cloud_checkpoints
for each row execute function public.conveni_provider_journal_fence();
create trigger conveni_local_journal_fence before insert or update on public.provider_calls
for each row execute function public.conveni_provider_journal_fence();
-- Reserve through the application's RPC; do not change raw reservation inserts,
-- which are also used by historical recovery to preserve accounting.
create function public.conveni_before_provider_reserve(p_task uuid,p_key text) returns void
language plpgsql security invoker set search_path=public as $$
declare jid uuid;
begin
 if p_key !~ '^ai:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:conveni$' then return;end if;
 if current_setting('transaction_isolation') <> 'read committed' then raise exception 'CONVENI_JOURNAL_ISOLATION_UNSUPPORTED';end if;
 jid:=split_part(p_key,':',2)::uuid;
 if not pg_try_advisory_xact_lock(hashtextextended('mapeig:conveni-journal:'||jid::text,0)) then
  raise exception 'CONVENI_JOURNAL_BUSY' using errcode='55P03';end if;
 if exists(select 1 from public.cloud_checkpoints where item_key=p_key and task_id<>p_task)
  or exists(select 1 from public.provider_calls where pipeline_job_id=jid and phase='conveni')
  or exists(select 1 from public.cloud_budget_reservations where item_key=p_key and task_id<>p_task) then
  raise exception 'CONVENI_JOURNAL_OTHER_RECEIPT';end if;
end $$;
revoke all on function public.conveni_before_provider_reserve(uuid,text) from public,anon,authenticated;
grant execute on function public.conveni_before_provider_reserve(uuid,text) to service_role;
do $$ declare before text;after text;anchor constant text:='perform cloud_assert_lease(p_task,p_owner,p_generation);';begin
 before:=pg_get_functiondef('public.cloud_budget_reserve(uuid,uuid,bigint,text,text,integer,integer)'::regprocedure);
 if (length(before)-length(replace(before,anchor,'')))/length(anchor)<>1 then raise exception 'CONVENI_RESERVE_ANCHOR_COUNT';end if;
 after:=replace(before,anchor,
  'perform cloud_assert_lease(p_task,p_owner,p_generation); perform public.conveni_before_provider_reserve(p_task,p_key);');
 if before=after then raise exception 'CONVENI_RESERVE_ANCHOR_MISSING';end if;
 execute after;
end $$;
