do $$
declare
  pending_id uuid:=gen_random_uuid();
  mixed_id uuid:=gen_random_uuid();
  failed_id uuid:=gen_random_uuid();
  batch_run uuid;
  individual_run uuid;
  failed_run uuid;
  next_number bigint;
begin
  insert into public.source_records(id,source_dataset,source_record_id,mechanism,title)
  values
    (pending_id,'convenis','OVERVIEW-PENDING-'||pending_id,'Conveni','Fixture pendent'),
    (mixed_id,'concerts','OVERVIEW-MIXED-'||mixed_id,'Concert','Fixture amb lot i reanàlisi individual'),
    (failed_id,'contractacions','OVERVIEW-ERROR-'||failed_id,'Contractació','Fixture amb error');
  select coalesce(max(batch_number),0)+1000 into next_number from public.pipeline_runs;
  insert into public.pipeline_runs(parameters,batch_number) values ('{"purpose":"automated_batch"}',next_number) returning id into batch_run;
  insert into public.pipeline_runs(parameters,batch_number) values ('{"purpose":"record_operation"}',next_number+1) returning id into individual_run;
  insert into public.pipeline_runs(parameters,batch_number) values ('{"purpose":"automated_single"}',next_number+2) returning id into failed_run;
  insert into public.pipeline_jobs(run_id,source_record_id,status,created_at)
  values(batch_run,mixed_id,'needs_review',now()-interval '1 minute');
  insert into public.pipeline_jobs(run_id,source_record_id,status,created_at)
  values(individual_run,mixed_id,'needs_review',now());
  insert into public.pipeline_jobs(run_id,source_record_id,status)
  values(failed_run,failed_id,'error');

  if (select count(*) from public.imported_record_processing_overview where id in (pending_id,mixed_id,failed_id))<>3 then
    raise exception 'Overview duplicated or omitted imported records';
  end if;
  if not exists(select 1 from public.imported_record_processing_overview where id=pending_id and processing_state='pending' and execution_count=0 and review_state='not_applicable') then
    raise exception 'Never processed record misclassified';
  end if;
  if not exists(select 1 from public.imported_record_processing_overview where id=mixed_id and processing_state='processed' and review_state='awaiting_review' and execution_count=2 and batch_execution_count=1 and individual_execution_count=1 and latest_run_purpose='record_operation') then
    raise exception 'Mixed batch and individual history misclassified';
  end if;
  if not exists(select 1 from public.imported_record_processing_overview where id=failed_id and processing_state='error' and execution_count=1 and individual_execution_count=1) then
    raise exception 'Failed execution misclassified';
  end if;
  if (select total from public.imported_record_processing_summary)<>(select count(*) from public.source_records) then
    raise exception 'Summary total differs from imported sources';
  end if;
end $$;
