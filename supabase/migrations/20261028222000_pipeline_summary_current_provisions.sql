-- Count the same currently exportable sources as the batch export. Historical
-- decisions, provisions and export snapshots remain untouched.
create or replace view public.pipeline_run_summaries with (security_invoker = true) as
select
  r.*,
  coalesce(j.total, 0)::integer as jobs_total,
  coalesce(j.reviewed_count, 0)::integer as derived_reviewed_count,
  coalesce(j.rejected_count, 0)::integer as derived_rejected_count,
  coalesce(j.insufficient_count, 0)::integer as derived_insufficient_count,
  coalesce(p.provision_count, 0)::integer as provision_count
from public.pipeline_runs r
left join lateral (
  select
    count(*) as total,
    count(*) filter (where status = 'needs_review') as review_count,
    count(*) filter (where status in ('approved', 'corrected', 'rejected', 'insufficient_evidence')) as reviewed_count,
    count(*) filter (where status in ('approved', 'corrected')) as approved_count,
    count(*) filter (where status = 'rejected') as rejected_count,
    count(*) filter (where status = 'insufficient_evidence') as insufficient_count,
    count(*) filter (where status = 'error') as error_count
  from public.pipeline_jobs
  where run_id = r.id
) j on true
left join lateral (
  select count(distinct sp.id) as provision_count
  from public.pipeline_jobs pj
  join public.service_provisions sp on sp.source_record_id = pj.source_record_id
    and public.provision_is_current(sp)
  where pj.run_id = r.id
) p on true;

