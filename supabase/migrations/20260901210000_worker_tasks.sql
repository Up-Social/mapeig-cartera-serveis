create table public.worker_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('prepare_run', 'enrich_record', 'match_run')),
  run_id uuid references public.pipeline_runs(id) on delete cascade,
  source_record_id uuid references public.source_records(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  check (
    (task_type in ('prepare_run', 'match_run') and run_id is not null and source_record_id is null)
    or (task_type = 'enrich_record' and source_record_id is not null and run_id is null)
  )
);

create unique index worker_tasks_active_target_idx
on public.worker_tasks (
  task_type,
  coalesce(run_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(source_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where status in ('queued', 'running');

create index worker_tasks_queue_idx
on public.worker_tasks (status, created_at)
where status in ('queued', 'running');

alter table public.worker_tasks enable row level security;
grant select, insert, update on public.worker_tasks to service_role;

create or replace function public.claim_worker_task(p_worker_id text)
returns setof public.worker_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
begin
  select task.id
  into v_task_id
  from public.worker_tasks task
  where (
    task.status = 'queued'
    or (
      task.status = 'running'
      and task.claimed_at < now() - interval '30 minutes'
    )
  )
    and task.attempts < 3
  order by task.created_at, task.id
  for update skip locked
  limit 1;

  if v_task_id is null then
    return;
  end if;

  return query
  update public.worker_tasks
  set status = 'running',
      attempts = attempts + 1,
      claimed_by = left(p_worker_id, 200),
      claimed_at = now(),
      completed_at = null,
      error_message = null
  where id = v_task_id
  returning *;
end;
$$;

revoke all on function public.claim_worker_task(text) from public;
grant execute on function public.claim_worker_task(text) to service_role;

comment on table public.worker_tasks is
  'Cua persistent per desacoblar les accions web de Vercel dels processos TypeScript de llarga durada.';
