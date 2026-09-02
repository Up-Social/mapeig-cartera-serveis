alter table public.pipeline_runs
  add column if not exists processing_completed_at timestamptz;

comment on column public.pipeline_runs.processing_completed_at is
  'Moment en què finalitza el processament automàtic. completed_at queda reservat per al tancament global després de la revisió.';

update public.pipeline_runs
set processing_completed_at = coalesce(processing_completed_at, completed_at),
    completed_at = null
where status = 'needs_review'
  and stage = 'review';

update public.pipeline_runs
set processing_completed_at = coalesce(processing_completed_at, completed_at)
where status = 'completed';

update public.source_records record
set evidence_status = 'pending',
    updated_at = now()
where record.processing_status = 'pendent'
  and record.evidence_status = 'error'
  and record.evidence_error is null
  and not exists (
    select 1 from public.pipeline_jobs job
    where job.source_record_id = record.id
  )
  and not exists (
    select 1 from public.source_documents document
    where document.source_record_id = record.id
      and document.status <> 'discovered'
  );

update public.pipeline_jobs job
set preparation_status = 'ready'
where job.status = 'approved'
  and job.preparation_status = 'pending'
  and exists (
    select 1 from public.matching_candidates candidate
    join public.matching_candidate_evidence evidence on evidence.candidate_id = candidate.id
    where candidate.pipeline_job_id = job.id
  )
  and exists (
    select 1 from public.review_decisions review
    where review.source_record_id = job.source_record_id
      and review.decision in ('approved', 'corrected')
  );

alter table public.pipeline_jobs
  add constraint pipeline_jobs_status_check
    check (status in ('selected','queued','preparing','ready','matching','needs_review','approved','corrected','rejected','insufficient_evidence','error')),
  add constraint pipeline_jobs_preparation_status_check
    check (preparation_status in ('pending','discovering','fetching','chunking','ready','no_source','unsupported','error'));

alter table public.pipeline_runs
  add constraint pipeline_runs_status_check
    check (status in ('draft','queued','preparing','enriching','matching','needs_review','completed','processing_error')),
  add constraint pipeline_runs_stage_check
    check (stage in ('selection','preparation','enrichment','matching','review','completed'));

alter table public.source_records
  add constraint source_records_financing_type_check
    check (financing_type in ('contractacio','conveni','subvencio','concert'));

create or replace function public.refresh_pipeline_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs integer;
  v_prepared integer;
  v_ready integer;
  v_processed integer;
  v_review integer;
  v_approved integer;
  v_errors integer;
  v_terminal integer;
begin
  select
    count(*),
    count(*) filter (where preparation_status <> 'pending' or status in ('matching','needs_review','approved','corrected','rejected','insufficient_evidence')),
    count(*) filter (where preparation_status = 'ready' or status in ('matching','needs_review','approved','corrected','rejected','insufficient_evidence')),
    count(*) filter (where exists(select 1 from matching_candidates candidate where candidate.pipeline_job_id = job.id)),
    count(*) filter (where status = 'needs_review'),
    count(*) filter (where status in ('approved','corrected') and exists(select 1 from service_provisions provision where provision.source_record_id = job.source_record_id)),
    count(*) filter (where status = 'error'),
    count(*) filter (where status in ('approved','corrected','rejected','insufficient_evidence','error'))
  into v_jobs, v_prepared, v_ready, v_processed, v_review, v_approved, v_errors, v_terminal
  from pipeline_jobs job where run_id = p_run_id;

  update pipeline_runs set
    selected_count = v_jobs,
    prepared_count = v_prepared,
    ready_count = v_ready,
    processed_count = v_processed,
    review_count = v_review,
    approved_count = v_approved,
    error_count = v_errors,
    status = case when v_jobs > 0 and v_terminal = v_jobs and v_review = 0 then 'completed' else status end,
    stage = case when v_jobs > 0 and v_terminal = v_jobs and v_review = 0 then 'completed' else stage end,
    processing_completed_at = case
      when v_jobs > 0 and v_terminal + v_review = v_jobs then coalesce(processing_completed_at, now())
      else null
    end,
    completed_at = case
      when v_jobs > 0 and v_terminal = v_jobs and v_review = 0 then coalesce(completed_at, now())
      else null
    end
  where id = p_run_id;
end;
$$;

revoke all on function public.refresh_pipeline_run(uuid) from public;
grant execute on function public.refresh_pipeline_run(uuid) to service_role;

comment on function public.refresh_pipeline_run(uuid) is
  'Recalcula comptadors i separa la fi del processament automàtic del tancament posterior a la revisió.';
