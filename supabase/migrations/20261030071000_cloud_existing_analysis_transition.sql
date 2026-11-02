-- A stale cloud worker must not move a job back to review after losing its lease.
create function public.cloud_mark_existing_analysis_review(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.pipeline_jobs%rowtype;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select pj.* into j from public.pipeline_jobs pj join public.worker_tasks t on t.id=p_task
 where pj.id=p_job and ((t.run_id is not null and pj.run_id=t.run_id)
   or (t.source_record_id is not null and pj.source_record_id=t.source_record_id))
  and (t.pipeline_job_id is null or t.pipeline_job_id=pj.id)
 for update of pj;
 if not found then raise exception 'CLOUD_SCOPE';end if;
 if j.status in ('needs_review','approved','corrected','rejected','insufficient_evidence','error') then return false;end if;
 perform 1 from public.analysis_results a where a.pipeline_job_id=j.id and a.source_record_id=j.source_record_id for share;
 if not found then raise exception 'CLOUD_ANALYSIS_MISSING';end if;
 update public.pipeline_jobs set status='needs_review' where id=j.id;
 return true;
end $$;
revoke all on function public.cloud_mark_existing_analysis_review(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.cloud_mark_existing_analysis_review(uuid,uuid,bigint,uuid) to service_role;
