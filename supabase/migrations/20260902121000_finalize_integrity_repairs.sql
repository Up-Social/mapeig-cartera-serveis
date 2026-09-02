alter table public.pipeline_runs
  drop constraint if exists pipeline_runs_status_check,
  drop constraint if exists pipeline_runs_stage_check;

alter table public.pipeline_runs
  add constraint pipeline_runs_status_check
    check (status in ('draft','queued','preparing','ready','enriching','matching','needs_review','completed','preparation_error','matching_error','processing_error')),
  add constraint pipeline_runs_stage_check
    check (stage in ('selection','preparation','confirmation','enrichment','matching','review','completed'));

update public.pipeline_runs run
set processing_completed_at = coalesce(
  run.processing_completed_at,
  (
    select max(job.completed_at)
    from public.pipeline_jobs job
    where job.run_id = run.id
  ),
  run.created_at
)
where run.status = 'needs_review'
  and run.stage = 'review'
  and run.processing_completed_at is null;

update public.source_records record
set evidence_status = 'pending',
    evidence_error = null,
    updated_at = now()
where record.processing_status = 'pendent'
  and record.evidence_status = 'error'
  and record.evidence_error is null
  and not exists (
    select 1 from public.pipeline_jobs job
    where job.source_record_id = record.id
  )
  and exists (
    select 1 from public.source_documents document
    where document.source_record_id = record.id
      and document.status = 'discovered'
  );

update public.source_records record
set processing_status = 'sense_evidencia',
    evidence_status = 'unsupported',
    evidence_error = 'La font disponible necessita OCR o un extractor compatible.',
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
      and document.status = 'discovered'
  )
  and exists (
    select 1 from public.source_documents document
    where document.source_record_id = record.id
      and document.status = 'unsupported'
  );

update public.source_records record
set processing_status = 'error',
    evidence_error = coalesce(
      (
        select string_agg(distinct document.error_message, ' · ')
        from public.source_documents document
        where document.source_record_id = record.id
          and document.status = 'error'
          and document.error_message is not null
      ),
      'No s''ha pogut preparar cap font documental.'
    ),
    updated_at = now()
where record.processing_status = 'pendent'
  and record.evidence_status = 'error'
  and record.evidence_error is null
  and not exists (
    select 1 from public.pipeline_jobs job
    where job.source_record_id = record.id
  );
