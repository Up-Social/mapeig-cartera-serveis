update public.pipeline_runs run set
  prepared_count = (select count(*) from public.pipeline_jobs job where job.run_id = run.id and job.preparation_status <> 'pending'),
  ready_count = (select count(*) from public.pipeline_jobs job where job.run_id = run.id and job.preparation_status = 'ready'),
  review_count = (select count(*) from public.pipeline_jobs job where job.run_id = run.id and job.status = 'needs_review'),
  approved_count = (select count(*) from public.pipeline_jobs job where job.run_id = run.id and job.status in ('approved', 'corrected')),
  error_count = (select count(*) from public.pipeline_jobs job where job.run_id = run.id and job.status = 'error');
