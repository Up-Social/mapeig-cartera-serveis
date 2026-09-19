create or replace function public.backfill_provable_legacy_reviews()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare affected integer;
begin
  update public.review_decisions decision
  set pipeline_job_id=candidate.pipeline_job_id,
      classification='in_portfolio'
  from public.service_provisions provision
  join public.matching_candidates candidate
    on candidate.id=provision.matching_candidate_id
  join public.pipeline_jobs job
    on job.id=candidate.pipeline_job_id
   and job.source_record_id=provision.source_record_id
  where provision.review_decision_id=decision.id
    and decision.source_record_id=provision.source_record_id
    and decision.decision in ('approved','corrected')
    and decision.final_code=provision.service_code
    and decision.pipeline_job_id is null
    and decision.classification is null;

  get diagnostics affected=row_count;
  return affected;
end $$;

revoke all on function public.backfill_provable_legacy_reviews() from public,anon,authenticated;
grant execute on function public.backfill_provable_legacy_reviews() to service_role;

select public.backfill_provable_legacy_reviews();

comment on function public.backfill_provable_legacy_reviews() is
  'Recupera només revisions positives històriques demostrables per la cadena provisió-decissió-candidat-treball.';
