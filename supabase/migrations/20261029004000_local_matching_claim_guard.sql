-- Local matching changes the shared source status; fence it against supersession.
create function public.local_claim_matching_job(p_job uuid,p_record uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare j pipeline_jobs; latest uuid; run_status text; source_type text;
begin
 if p_job is null or p_record is null then raise exception 'LOCAL_TYPE_BLOCKED: Objectiu de matching no verificable.';end if;
 select financing_type into source_type from source_records where id=p_record for update nowait;
 if not found or source_type is distinct from 'conveni' then raise exception 'LOCAL_TYPE_BLOCKED: El matching generic local requereix el flux cloud compatible.';end if;
 perform 1 from pipeline_jobs where source_record_id=p_record for update nowait;
 select * into j from pipeline_jobs where id=p_job and source_record_id=p_record;
 select id into latest from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1;
 if j.id is null or latest is distinct from p_job then raise exception 'LOCAL_TYPE_BLOCKED: El treball de matching ja no es vigent.';end if;
 select status into run_status from pipeline_runs where id=j.run_id for share nowait;
 if run_status is null or run_status='paused' then raise exception 'LOCAL_TYPE_BLOCKED: Lot pausat o no verificable.';end if;
 perform 1 from source_records where id in(select source_record_id from pipeline_jobs where run_id=j.run_id) for share nowait;
 perform 1 from pipeline_jobs where run_id=j.run_id for share nowait;
 if not exists(select 1 from pipeline_jobs where run_id=j.run_id) or exists(select 1 from pipeline_jobs x left join source_records r on r.id=x.source_record_id where x.run_id=j.run_id and (r.id is null or r.financing_type is null or r.financing_type not in ('conveni','contractacio','subvencio'))) then
  raise exception 'LOCAL_TYPE_BLOCKED: Lot mixt o tipologia no verificable.';
 end if;
 if j.status not in ('queued','ready') then return false;end if;
 update pipeline_jobs set status='matching',claimed_at=now(),attempts=1,error_message=null where id=p_job;
 return true;
exception when lock_not_available then raise exception 'LOCAL_TYPE_BLOCKED: El lot esta en modificacio; torna-ho a provar.';
end $$;

create function public.local_report_matching_failure(p_job uuid,p_record uuid,p_kind text,p_message text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_job is null or p_record is null then return false;end if;
 perform 1 from pipeline_jobs where id=p_job and source_record_id=p_record for update nowait;
 if not found then return false;end if;
 -- A failed local attempt records only its own job. Its source may already
 -- represent a later job or revision and must not be rewritten here.
 update pipeline_jobs set status='error',error_kind=p_kind,error_message=p_message,completed_at=now()
  where id=p_job and source_record_id=p_record and status='matching';
 if not found then return false;end if;
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_claim_matching_job(uuid,uuid),public.local_report_matching_failure(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.local_claim_matching_job(uuid,uuid),public.local_report_matching_failure(uuid,uuid,text,text) to service_role;
