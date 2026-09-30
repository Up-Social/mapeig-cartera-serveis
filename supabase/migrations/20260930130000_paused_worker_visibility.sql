-- Paused workers remain incidents even before the job status is reconciled.
-- Projection only: no job, provider receipt or human decision is rewritten.
create index if not exists worker_tasks_job_recent_idx on public.worker_tasks(pipeline_job_id,created_at desc,id desc) where pipeline_job_id is not null;
create index if not exists worker_tasks_progress_job_recent_idx on public.worker_tasks(progress_job_id,created_at desc,id desc) where progress_job_id is not null;

create or replace view public.current_record_results with (security_invoker=true) as
select r.id,r.source_record_id,r.title,r.provider_name,r.financing_type,r.source_dataset,
 j.id as job_id,j.run_id,b.batch_number,case when worker.incident then 'error' else j.status end as execution_status,j.created_at as job_created_at,case when worker.incident then 'Operació interrompuda. Cal revisar el diagnòstic abans de reprendre.' else j.error_message end as error_message,
 a.id as analysis_id,a.catalog_version_id,a.target_population,a.service_description,a.evidence,
 case when j.status in ('selected','queued','preparing','ready','matching') or a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then null else coalesce(d.classification,a.reviewed_classification,a.classification) end as classification,
 case when d.id is not null then to_jsonb(d.reasons) when a.reviewed_classification is not null then to_jsonb(a.reviewed_reasons) else a.reasons end as reasons,
 case when a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'Resultat no fiable pendent de reanàlisi' else coalesce(d.reason,a.review_notes,a.explanation) end as explanation,
 d.decision as review_decision,coalesce(d.created_at,a.reviewed_at) as reviewed_at,
 (d.id is not null or a.reviewed_classification is not null) as human_reviewed,
 case
  when worker.incident or j.status='error' or a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'issues'
  when j.status in ('selected','queued','preparing','ready','matching') then 'processing'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='discarded' then 'discarded'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='insufficient_evidence' then 'issues'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='out_of_portfolio' then 'outside'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='in_portfolio' and (d.id is not null or a.reviewed_classification is not null) then 'approved'
  when j.status='needs_review' then 'review'
  when j.id is null and (r.evidence_status in ('error','no_source','unsupported') or r.enrichment_status='error') then 'issues'
  else 'unprocessed' end as destination,
 md5(jsonb_build_array(j.id,a.id,coalesce(d.classification,a.reviewed_classification,a.classification),d.id,d.reasons,a.reviewed_reasons,a.explanation,a.review_notes,a.reliability_status,a.reliability_reasons,candidate_state.non_positive,worker.incident,worker.id,worker.failure_kind)::text) as result_token,
 case when a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'invalidated' else 'valid' end as reliability_status,
 case when coalesce(candidate_state.non_positive,false) then array['non_positive_confidence']::text[] else coalesce(a.reliability_reasons,'{}'::text[]) end as reliability_reasons,a.invalidated_at,
 coalesce(worker.incident,false) as worker_incident,worker.failure_kind as worker_failure_kind,worker.current_step as worker_step,worker.last_progress_at as worker_last_activity_at
from public.source_records r
left join lateral(select * from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) j on true
left join lateral (
 select t.id,t.failure_kind,t.current_step,coalesce(t.last_progress_at,t.claimed_at,t.dispatch_at,t.created_at) as last_progress_at,
   j.status in ('selected','queued','preparing','ready','matching')
   and t.status<>'completed' and coalesce(t.execution_state,'')<>'completed'
   and (t.status='failed' or t.execution_state in ('paused','interrupted')) as incident
 from public.worker_tasks t
 where t.pipeline_job_id=j.id or t.progress_job_id=j.id
 order by t.created_at desc,t.id desc limit 1
) worker on true
left join public.pipeline_runs b on b.id=j.run_id
left join public.analysis_results a on a.pipeline_job_id=j.id
left join lateral(select bool_or(candidate.score<=0) as non_positive from public.matching_candidates candidate where candidate.pipeline_job_id=j.id) candidate_state on true
left join lateral(select * from public.review_decisions where pipeline_job_id=j.id order by created_at desc,id desc limit 1) d on true;
revoke all on public.current_record_results from public,anon,authenticated;
grant select on public.current_record_results to service_role;
