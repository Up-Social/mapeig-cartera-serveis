-- One row per imported source, including sources that have never entered a run.
-- Execution counts describe recorded attempts, not distinct invoices or AI calls.
create or replace view public.imported_record_processing_overview with (security_invoker=true) as
select
  r.id,r.title,r.source_dataset,r.source_record_id,r.provider_name,r.financing_type,r.updated_at,
  c.job_id,c.run_id,c.batch_number,c.execution_status,c.destination,c.human_reviewed,c.review_decision,
  coalesce(jobs.execution_count,0)::bigint as execution_count,
  coalesce(jobs.batch_execution_count,0)::bigint as batch_execution_count,
  coalesce(jobs.individual_execution_count,0)::bigint as individual_execution_count,
  coalesce(jobs.other_execution_count,0)::bigint as other_execution_count,
  run.parameters->>'purpose' as latest_run_purpose,
  case
    when c.job_id is null then 'pending'
    when c.execution_status='error' then 'error'
    when c.destination='processing' then 'in_progress'
    else 'processed'
  end as processing_state,
  case
    when c.human_reviewed then 'reviewed'
    when c.destination='review' then 'awaiting_review'
    else 'not_applicable'
  end as review_state
from public.source_records r
join public.current_record_results c on c.id=r.id
left join public.pipeline_runs run on run.id=c.run_id
left join (
  select j.source_record_id,
    count(*) as execution_count,
    count(*) filter (where b.parameters->>'purpose' in ('automated_batch','automated_cloud')) as batch_execution_count,
    count(*) filter (where b.parameters->>'purpose' in ('record_operation','automated_single')) as individual_execution_count,
    count(*) filter (where b.parameters->>'purpose' is null or b.parameters->>'purpose' not in ('automated_batch','automated_cloud','record_operation','automated_single')) as other_execution_count
  from public.pipeline_jobs j
  join public.pipeline_runs b on b.id=j.run_id
  group by j.source_record_id
) jobs on jobs.source_record_id=r.id;

revoke all on public.imported_record_processing_overview from public,anon,authenticated;
grant select on public.imported_record_processing_overview to service_role;

create or replace view public.imported_record_processing_summary with (security_invoker=true) as
select
  count(*)::bigint as total,
  count(*) filter (where processing_state='pending')::bigint as pending,
  count(*) filter (where processing_state='in_progress')::bigint as in_progress,
  count(*) filter (where processing_state='processed')::bigint as processed,
  count(*) filter (where processing_state='error')::bigint as failed,
  count(*) filter (where review_state='awaiting_review')::bigint as awaiting_review
from public.imported_record_processing_overview;

revoke all on public.imported_record_processing_summary from public,anon,authenticated;
grant select on public.imported_record_processing_summary to service_role;
