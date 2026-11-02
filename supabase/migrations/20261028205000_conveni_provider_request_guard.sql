-- A changed conveni or matching input requires a new explicit job. Never
-- create another paid provider call under an already-used job/phase.
do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.claim_provider_call(uuid,text,text)'::regprocedure);
 patched:=replace(original,
  $old$if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;$old$,
  $new$if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if p_phase in ('conveni','matching','enrichment','positive-audit-v4') and exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;$new$);
 patched:=replace(patched,
  $old$if p_phase in ('conveni','matching','enrichment','positive-audit-v4') and exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;$old$,
  $new$if p_phase in ('conveni','matching','enrichment','positive-audit-v4') and exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase and request_hash<>p_hash) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;
 if p_phase='positive-audit-v4' and c.id is null and exists(select 1 from provider_calls where pipeline_job_id=p_job and phase in ('positive-audit-v1','positive-audit-v2','positive-audit-v3')) then raise exception 'PROVIDER_REQUEST_CHANGED';end if;$new$);
 if patched=original then raise exception 'Expected provider journal guard not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;$old$,
  $new$if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then raise exception 'PROVIDER_UNKNOWN';end if;
 if c.state='received' then return jsonb_build_object('send',false,'id',c.id,'response',c.response);end if;$new$);
 if patched=original then raise exception 'Expected provider receipt ordering not found';end if;
 execute patched;
end $$;
