-- Capture row identities before a call; status alone misses an ABA transition.
create function public.local_provider_scope(p_run uuid,p_job uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('job_status',j.status,'job_xmin',j.xmin::text,'run_status',r.status,'run_xmin',r.xmin::text)
 from pipeline_jobs j join pipeline_runs r on r.id=j.run_id
 where j.id=p_job and r.id=p_run and j.status in ('selected','queued','preparing','ready','matching')
  and r.status in ('queued','preparing','ready','enriching','matching')
$$;

-- A late unknown result must not overwrite a reviewed job or a completed run.
-- The receipt is locked but never changed; a false result requires review.
create function public.local_pause_provider_unknown(p_run uuid,p_job uuid,p_scope jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare j pipeline_jobs; r pipeline_runs; job_xmin text; run_xmin text;
begin
 if p_run is null or p_job is null or jsonb_typeof(p_scope) is distinct from 'object' then return false;end if;
 select t.xmin::text into job_xmin from pipeline_jobs t where t.id=p_job and t.run_id=p_run for update nowait;
 if not found then return false;end if;
 select * into j from pipeline_jobs where id=p_job;
 if j.status is distinct from p_scope->>'job_status' or job_xmin is distinct from p_scope->>'job_xmin'
  or j.status not in ('selected','queued','preparing','ready','matching') then return false;end if;
 select t.xmin::text into run_xmin from pipeline_runs t where t.id=p_run for update nowait;
 if not found then return false;end if;
 select * into r from pipeline_runs where id=p_run;
 if r.status is distinct from p_scope->>'run_status' or run_xmin is distinct from p_scope->>'run_xmin'
  or r.status not in ('queued','preparing','ready','enriching','matching') then return false;end if;
 perform 1 from provider_calls where pipeline_job_id=p_job for update nowait;
 if not exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then return false;end if;
 update pipeline_jobs set status='error',error_kind='provider_unknown',error_message='Resultat del proveïdor desconegut. Cal revisar-lo abans de repetir.' where id=p_job;
 update pipeline_runs set status='paused',pause_reason='Resultat del proveïdor desconegut. Cal revisar-lo abans de repetir.',pause_kind='provider_unknown' where id=p_run;
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_provider_scope(uuid,uuid),public.local_pause_provider_unknown(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.local_provider_scope(uuid,uuid),public.local_pause_provider_unknown(uuid,uuid,jsonb) to service_role;
