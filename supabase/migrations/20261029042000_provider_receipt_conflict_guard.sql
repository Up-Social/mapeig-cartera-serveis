-- Fence contradictory historical receipts before reusing an exact response.
-- No journal rows, reservations, states, privileges or provider calls change.
do $migration$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.claim_provider_call(uuid,text,text)'::regprocedure);
 patched:=replace(original,
 $old$perform 1 from pipeline_jobs where id=p_job for update;if not found then raise exception 'JOB_MISSING';end if;$old$,
 $new$if current_setting('transaction_isolation') <> 'read committed' then raise exception 'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED';end if;
 perform 1 from pipeline_jobs where id=p_job for update;if not found then raise exception 'JOB_MISSING';end if;
 -- The job lock fences FK inserts. Lock all existing states so a concurrent
 -- receipt save/update cannot change the conflict or sending check.
 perform 1 from provider_calls where pipeline_job_id=p_job order by id for update;$new$);
 if patched=original then raise exception 'PROVIDER_RECEIPT_JOB_LOCK_ANCHOR_MISSING';end if;
 original:=patched;
 patched:=replace(original,
 $old$if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;$old$,
 $new$if c.state='received' then
  if exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;
  return jsonb_build_object('send',false,'id',c.id,'response',c.response);
 end if;$new$);
 if patched=original then raise exception 'PROVIDER_RECEIPT_REPLAY_ANCHOR_MISSING';end if;
 execute patched;
end $migration$;
