create index pipeline_jobs_current_idx on public.pipeline_jobs(source_record_id,created_at desc,id desc);
alter table public.review_decisions alter column created_at set default clock_timestamp();
alter table public.job_snapshots alter column captured_at set default clock_timestamp();
create view public.current_record_results with (security_invoker=true) as
select r.id,r.source_record_id,r.title,r.provider_name,r.financing_type,r.source_dataset,
 j.id as job_id,j.run_id,b.batch_number,j.status as execution_status,j.created_at as job_created_at,j.error_message,
 a.id as analysis_id,a.catalog_version_id,a.target_population,a.service_description,a.evidence,
 case when j.status in ('selected','queued','preparing','ready','matching') then null else coalesce(d.classification,a.reviewed_classification,a.classification) end as classification,
 case when d.id is not null then to_jsonb(d.reasons) when a.reviewed_classification is not null then to_jsonb(a.reviewed_reasons) else a.reasons end as reasons,
 coalesce(d.reason,a.review_notes,a.explanation) as explanation,
 d.decision as review_decision,coalesce(d.created_at,a.reviewed_at) as reviewed_at,
 (d.id is not null or a.reviewed_classification is not null) as human_reviewed,
 case
  when j.status='error' then 'issues'
  when j.status in ('selected','queued','preparing','ready','matching') then 'processing'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='discarded' then 'discarded'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='insufficient_evidence' then 'issues'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='out_of_portfolio' then 'outside'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='in_portfolio' and (d.id is not null or a.reviewed_classification is not null) then 'approved'
  when j.status='needs_review' then 'review'
  when j.id is null and (r.evidence_status in ('error','no_source','unsupported') or r.enrichment_status='error') then 'issues'
  else 'unprocessed' end as destination
from public.source_records r
left join lateral(select * from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) j on true
left join public.pipeline_runs b on b.id=j.run_id
left join public.analysis_results a on a.pipeline_job_id=j.id
left join lateral(select * from public.review_decisions where pipeline_job_id=j.id order by created_at desc,id desc limit 1) d on true;
revoke all on public.current_record_results from public,anon,authenticated;
grant select on public.current_record_results to service_role;
