create table public.excel_export_items (
  export_id uuid not null references public.excel_exports(id) on delete cascade,
  provision_id uuid not null references public.service_provisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(export_id, provision_id)
);

alter table public.excel_export_items enable row level security;
grant select, insert on public.excel_export_items to service_role;

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
    completed_at = case when v_jobs > 0 and v_terminal = v_jobs and v_review = 0 then coalesce(completed_at, now()) else null end
  where id = p_run_id;
end;
$$;

revoke all on function public.refresh_pipeline_run(uuid) from public;
grant execute on function public.refresh_pipeline_run(uuid) to service_role;

do $$ declare run record; begin
  for run in select id from public.pipeline_runs loop
    perform public.refresh_pipeline_run(run.id);
  end loop;
end $$;

comment on function public.refresh_pipeline_run(uuid) is
  'Recalcula comptadors i finalització des dels treballs, candidats i provisions vigents.';
