create or replace function public.cloud_finish(p_task uuid,p_owner uuid,p_generation bigint,p_state text,p_kind text default null) returns void
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks; v_review_count integer;v_pending_count integer;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_state not in ('pending','paused','interrupted','completed') then raise exception 'Invalid state'; end if;
 update worker_tasks set execution_state=p_state,failure_kind=p_kind,
 status=case when p_state='completed' then 'completed' when p_state in ('paused','interrupted') then 'failed' else 'queued' end,
 lease_until=null,lease_owner=null,last_progress_at=now(),completed_at=case when p_state='completed' then now() else null end where id=p_task returning * into t;
 if t.run_id is null then return;end if;
 perform refresh_pipeline_run(t.run_id);
 select count(*) filter(where status='needs_review'),count(*) filter(where status not in ('needs_review','approved','corrected','rejected','insufficient_evidence','error')) into v_review_count,v_pending_count from pipeline_jobs where run_id=t.run_id;
 update pipeline_runs set processed_count=(select count(*) from analysis_results a join pipeline_jobs j on j.id=a.pipeline_job_id where j.run_id=t.run_id),
 status=case when p_state in ('paused','interrupted') then 'paused' when p_state='completed' and t.task_type in ('prepare_run','enrich_record') then 'ready' when p_state='completed' and v_pending_count=0 then case when v_review_count>0 then 'needs_review' else 'completed' end else 'preparing' end,
 stage=case when p_state='completed' and v_pending_count=0 then case when v_review_count>0 then 'review' else 'completed' end else stage end,
 pause_kind=p_kind,pause_reason=case when p_state in ('paused','interrupted') then 'Execució pausada: '||coalesce(p_kind,'internal') else null end where id=t.run_id;
end $$;
