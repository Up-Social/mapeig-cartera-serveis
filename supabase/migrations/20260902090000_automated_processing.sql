alter table public.worker_tasks drop constraint if exists worker_tasks_task_type_check;
alter table public.worker_tasks drop constraint if exists worker_tasks_check;

alter table public.worker_tasks
  add constraint worker_tasks_task_type_check
    check (task_type in ('prepare_run', 'enrich_record', 'match_run', 'process_run')),
  add constraint worker_tasks_target_check
    check (
      (task_type in ('prepare_run', 'match_run', 'process_run') and run_id is not null and source_record_id is null)
      or (task_type = 'enrich_record' and source_record_id is not null and run_id is null)
    );

create or replace function public.create_automated_batch(p_batch_size integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_record_ids uuid[];
  v_types text[];
begin
  if p_batch_size < 1 or p_batch_size > 50 then
    raise exception 'La mida del lot ha de ser entre 1 i 50.';
  end if;

  perform pg_advisory_xact_lock(hashtext('create_automated_batch'));

  with eligible as (
    select record.*,
      row_number() over (partition by record.deduplication_key order by random()) as duplicate_rank
    from public.source_records record
    where record.processing_status in ('pendent', 'preparat')
      and record.financing_type in ('contractacio', 'conveni', 'subvencio', 'concert')
      and not exists (
        select 1
        from public.pipeline_jobs job
        join public.pipeline_runs run on run.id = job.run_id
        join public.source_records attempted on attempted.id = job.source_record_id
        where attempted.deduplication_key = record.deduplication_key
          and coalesce(run.parameters->>'purpose', '') <> 'inspection'
          and job.status <> 'error'
      )
  ), ranked as (
    select eligible.*,
      row_number() over (partition by eligible.financing_type order by random()) as type_rank
    from eligible
    where duplicate_rank = 1
  ), selected as (
    select id, financing_type
    from ranked
    order by type_rank, financing_type, random()
    limit p_batch_size
  )
  select array_agg(id), array_agg(financing_type)
  into v_record_ids, v_types
  from selected;

  if coalesce(array_length(v_record_ids, 1), 0) <> p_batch_size then
    raise exception 'No hi ha % registres únics disponibles per crear el lot.', p_batch_size;
  end if;

  insert into public.pipeline_runs (
    status, stage, selected_count, started_at, parameters
  ) values (
    'queued', 'preparation', p_batch_size, now(),
    jsonb_build_object(
      'purpose', 'automated_batch',
      'auto_process', true,
      'mode', 'balanced_by_financing_type',
      'batch_size', p_batch_size,
      'types', to_jsonb(v_types)
    )
  ) returning id into v_run_id;

  insert into public.pipeline_jobs (
    run_id, source_record_id, status, preparation_status
  )
  select v_run_id, record_id, 'selected', 'pending'
  from unnest(v_record_ids) as record_id;

  update public.source_records
  set processing_status = 'preparant', updated_at = now()
  where id = any(v_record_ids);

  return v_run_id;
end;
$$;

revoke all on function public.create_automated_batch(integer) from public;
grant execute on function public.create_automated_batch(integer) to service_role;

comment on function public.create_automated_batch(integer) is
  'Selecciona de manera atòmica una mostra equilibrada i crea un lot automàtic de fins a 50 registres.';
