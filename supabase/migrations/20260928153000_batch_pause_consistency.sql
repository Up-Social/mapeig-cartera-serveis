create or replace function public.cloud_finish(p_task uuid,p_owner uuid,p_generation bigint,p_state text,p_kind text default null) returns void
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_state not in ('pending','paused','interrupted','completed') then raise exception 'Invalid state';end if;
 update worker_tasks set execution_state=p_state,failure_kind=p_kind,status=case when p_state='completed' then 'completed' when p_state in ('paused','interrupted') then 'failed' else 'queued' end,
 lease_until=null,lease_owner=null,last_progress_at=now(),completed_at=case when p_state='completed' then now() else null end where id=p_task returning * into t;
 if t.run_id is null then return;end if;
 if p_state in ('paused','interrupted') then
  update job_attempts a set status='interrupted',completed_at=coalesce(a.completed_at,now()),diagnostic=coalesce(a.diagnostic,p_kind)
  from pipeline_jobs j where a.pipeline_job_id=j.id and j.run_id=t.run_id and a.status='running';
 end if;
 perform refresh_pipeline_run(t.run_id);
 update pipeline_runs set status=case when p_state in ('paused','interrupted') then 'paused' else status end,pause_kind=p_kind,
 pause_reason=case when p_state in ('paused','interrupted') then 'Execució pausada: '||coalesce(p_kind,'internal') else null end where id=t.run_id;
end $$;

create or replace view public.job_phase_states with(security_invoker=true) as
with facts as (
 select j.*,r.status='paused' as run_paused,
 exists(select 1 from analysis_results a where a.pipeline_job_id=j.id) as analyzed,
 exists(select 1 from matching_candidates c where c.pipeline_job_id=j.id) as legacy_matched
 from public.pipeline_jobs j join public.pipeline_runs r on r.id=j.run_id
), prepared as (
 select f.*,case
  when analyzed or legacy_matched or preparation_status='ready' then 'completed'
  when preparation_status in ('no_source','unsupported','error') or (status='error' and preparation_status in ('pending','discovering','fetching','chunking')) then 'error'
  when run_paused then 'blocked'
  when status='preparing' or preparation_status in ('discovering','fetching','chunking') then 'running'
  else 'pending' end as preparation
 from facts f
), enriched as (
 select p.*,case
  when analyzed or legacy_matched then 'completed'
  when preparation='error' then 'blocked'
  when enrichment_status='completed' then 'completed'
  when enrichment_status='error' or (status='error' and preparation='completed') then 'error'
  when run_paused then 'blocked'
  when enrichment_status='processing' then 'running'
  else 'pending' end as enrichment
 from prepared p
)
select id,run_id,source_record_id,preparation,enrichment,
 case when analyzed or legacy_matched then 'completed'
 when preparation='error' or enrichment in ('error','blocked') then 'blocked'
 when status='error' then 'error'
 when run_paused then 'blocked'
 when status='matching' and enrichment='completed' then 'running'
 else 'pending' end as matching,
 analyzed or legacy_matched as analyzed,
 status in ('needs_review','approved','corrected','rejected','insufficient_evidence','error') or analyzed as automatic_terminal
from enriched;
grant select on public.job_phase_states to service_role;

-- Reconcile already paused executions without changing completed analyses.
update public.job_attempts a set status='interrupted',completed_at=coalesce(a.completed_at,now()),diagnostic=coalesce(a.diagnostic,r.pause_kind)
from public.pipeline_jobs j join public.pipeline_runs r on r.id=j.run_id
where a.pipeline_job_id=j.id and a.status='running' and r.status='paused';
