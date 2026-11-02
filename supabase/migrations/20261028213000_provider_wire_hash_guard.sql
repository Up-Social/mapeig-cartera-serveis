-- Every provider phase must retain its original versioned wire fingerprint.
-- A legacy or changed hash requires a new explicit job; uncertain sends retain
-- priority and remain blocked by the existing guard.
do $$
declare original text; patched text;
begin
 original:=pg_get_functiondef('public.claim_provider_call(uuid,text,text)'::regprocedure);
 patched:=replace(original,
  $old$if p_phase in ('conveni','matching','enrichment','positive-audit-v4') and exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;$old$,
  $new$if exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;$new$);
 if patched=original then raise exception 'Expected provider request guard not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;$old$,
  $new$if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if p_hash is null or p_hash !~ '^prepared-json-v1:[0-9a-f]{64}$' then raise exception 'PROVIDER_REQUEST_INVALID';end if;
 if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;$new$);
 if patched=original then raise exception 'Expected provider hash validation position not found';end if;
 execute patched;
end $$;
