alter table public.pipeline_jobs add column enrichment_status text not null default 'pending',add column enrichment_error text;
update public.pipeline_jobs j set enrichment_status='completed' where exists(select 1 from analysis_results where pipeline_job_id=j.id);
create function public.project_job_enrichment() returns trigger language plpgsql security invoker set search_path=public as $$
declare job uuid;
begin
 select id into job from pipeline_jobs where source_record_id=new.id order by created_at desc,id desc limit 1;
 update pipeline_jobs set enrichment_status=new.enrichment_status,enrichment_error=new.enrichment_error where id=job and status in ('selected','queued','preparing','ready','matching','error');
 return new;
end $$;
create trigger project_job_enrichment after update of enrichment_status,enrichment_error on public.source_records for each row execute function public.project_job_enrichment();
drop trigger job_snapshot_transition on public.pipeline_jobs;
create trigger job_snapshot_transition after insert or update of status,error_message,enrichment_status,enrichment_error on public.pipeline_jobs for each row execute function public.snapshot_job_transition();

create view public.job_phase_states with(security_invoker=true) as
with facts as (
 select j.*,exists(select 1 from analysis_results a where a.pipeline_job_id=j.id) as analyzed,
 exists(select 1 from matching_candidates c where c.pipeline_job_id=j.id) as legacy_matched
 from public.pipeline_jobs j
), prepared as (
 select f.*,case
  when analyzed or legacy_matched or preparation_status='ready' then 'completed'
  when preparation_status in ('no_source','unsupported','error') or (status='error' and preparation_status in ('pending','discovering','fetching','chunking')) then 'error'
  when status='preparing' or preparation_status in ('discovering','fetching','chunking') then 'running'
  else 'pending' end as preparation
 from facts f
), enriched as (
 select p.*,case
  when analyzed or legacy_matched or enrichment_status='completed' then 'completed'
  when preparation='error' then 'blocked'
  when enrichment_status='error' or (status='error' and preparation='completed' and enrichment_status<>'completed') then 'error'
  when enrichment_status='processing' then 'running'
  else 'pending' end as enrichment
 from prepared p
)
select id,run_id,source_record_id,preparation,enrichment,
 case when analyzed or legacy_matched then 'completed'
 when preparation='error' or enrichment in ('error','blocked') then 'blocked'
 when status='error' then 'error'
 when status='matching' and enrichment='completed' then 'running'
 else 'pending' end as matching,
 analyzed or legacy_matched as analyzed,
 status in ('needs_review','approved','corrected','rejected','insufficient_evidence','error') or analyzed as automatic_terminal
from enriched;
grant select on public.job_phase_states to service_role;

create or replace function public.refresh_pipeline_run(p_run_id uuid) returns void language plpgsql security invoker set search_path=public as $$
declare totals record;
begin
 select count(*) as total,count(*) filter(where p.preparation in ('completed','error')) as prepared,
 count(*) filter(where p.preparation='completed') as ready,count(*) filter(where p.analyzed) as analyzed,
 count(*) filter(where j.status='needs_review') as review,count(*) filter(where j.status in ('approved','corrected')) as approved,
 count(*) filter(where j.status='error') as errors,count(*) filter(where p.automatic_terminal) as terminal
 into totals from pipeline_jobs j join job_phase_states p on p.id=j.id where j.run_id=p_run_id;
 update pipeline_runs set selected_count=totals.total,prepared_count=totals.prepared,ready_count=totals.ready,processed_count=totals.analyzed,
 review_count=totals.review,approved_count=totals.approved,error_count=totals.errors,
 status=case when totals.total=totals.terminal then case when totals.review>0 then 'needs_review' else 'completed' end else status end,
 stage=case when totals.total=totals.terminal then case when totals.review>0 then 'review' else 'completed' end else stage end,
 processing_completed_at=case when totals.total=totals.terminal then coalesce(processing_completed_at,now()) else null end,
 completed_at=case when totals.total=totals.terminal and totals.review=0 then coalesce(completed_at,now()) else null end
 where id=p_run_id;
end $$;
revoke all on function public.refresh_pipeline_run(uuid) from public,anon,authenticated;
grant execute on function public.refresh_pipeline_run(uuid) to service_role;

create or replace function public.cloud_finish(p_task uuid,p_owner uuid,p_generation bigint,p_state text,p_kind text default null) returns void
language plpgsql security invoker set search_path=public as $$
declare t worker_tasks;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_state not in ('pending','paused','interrupted','completed') then raise exception 'Invalid state';end if;
 update worker_tasks set execution_state=p_state,failure_kind=p_kind,status=case when p_state='completed' then 'completed' when p_state in ('paused','interrupted') then 'failed' else 'queued' end,
 lease_until=null,lease_owner=null,last_progress_at=now(),completed_at=case when p_state='completed' then now() else null end where id=p_task returning * into t;
 if t.run_id is null then return;end if;
 perform refresh_pipeline_run(t.run_id);
 update pipeline_runs set status=case when p_state in ('paused','interrupted') then 'paused' else status end,pause_kind=p_kind,
 pause_reason=case when p_state in ('paused','interrupted') then 'Execució pausada: '||coalesce(p_kind,'internal') else null end where id=t.run_id;
end $$;
do $$declare r record;begin for r in select id from pipeline_runs loop perform refresh_pipeline_run(r.id);end loop;end $$;
