create or replace function public.reconcile_paused_workloads() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare attempt_count integer;record_count integer;run_count integer;r record;
begin
 update job_attempts a set status='interrupted',completed_at=coalesce(a.completed_at,now()),diagnostic=coalesce(a.diagnostic,runs.pause_kind,'interrupted')
 from pipeline_jobs j join pipeline_runs runs on runs.id=j.run_id
 where a.pipeline_job_id=j.id and a.status='running' and runs.status='paused';
 get diagnostics attempt_count=row_count;

 update source_records s set
  processing_status=case when s.evidence_status='ready' and s.enrichment_status='completed' then 'preparat'::processing_status else 'pendent'::processing_status end,
  updated_at=now()
 from pipeline_jobs j join pipeline_runs runs on runs.id=j.run_id
 where s.id=j.source_record_id and runs.status='paused' and s.processing_status in ('preparant','processant')
 and j.id=(select latest.id from pipeline_jobs latest where latest.source_record_id=s.id order by latest.created_at desc,latest.id desc limit 1)
 and not exists(select 1 from analysis_results a where a.pipeline_job_id=j.id);
 get diagnostics record_count=row_count;

 select count(*) into run_count from pipeline_runs where status='paused';
 for r in select id from pipeline_runs where status='paused' order by id loop perform refresh_pipeline_run(r.id);end loop;
 return jsonb_build_object('runs',run_count,'attempts',attempt_count,'records',record_count);
end $$;

revoke all on function public.reconcile_paused_workloads() from public,anon,authenticated;
grant execute on function public.reconcile_paused_workloads() to service_role;

select public.reconcile_paused_workloads();
