alter table public.pipeline_runs
  add column if not exists stage text not null default 'selection',
  add column if not exists prepared_count integer not null default 0 check (prepared_count >= 0),
  add column if not exists ready_count integer not null default 0 check (ready_count >= 0),
  add column if not exists review_count integer not null default 0 check (review_count >= 0),
  add column if not exists approved_count integer not null default 0 check (approved_count >= 0),
  add column if not exists error_count integer not null default 0 check (error_count >= 0),
  add column if not exists estimated_input_tokens integer not null default 0 check (estimated_input_tokens >= 0),
  add column if not exists actual_input_tokens integer not null default 0 check (actual_input_tokens >= 0),
  add column if not exists actual_output_tokens integer not null default 0 check (actual_output_tokens >= 0);

alter table public.pipeline_jobs
  add column if not exists preparation_status text not null default 'pending',
  add column if not exists preparation_message text;

update public.pipeline_runs set stage = case
  when status = 'needs_review' then 'review'
  when status = 'queued' then 'matching'
  else stage end;

update public.pipeline_jobs set status = 'needs_review'
where status = 'completed' and exists (
  select 1 from public.matching_candidates candidate where candidate.pipeline_job_id = pipeline_jobs.id
);

create table public.excel_exports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  provision_count integer not null check (provision_count >= 0),
  content_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.excel_exports enable row level security;
grant select, insert on public.excel_exports to service_role;

create or replace function public.sample_balanced_source_records(per_source integer default 10, excluded_ids uuid[] default '{}')
returns table (
  id uuid, source_dataset text, source_record_id text, title text,
  provider_name text, amount numeric, mechanism text
)
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select record.*,
      row_number() over (partition by record.source_dataset order by random()) as sample_rank
    from source_records record
    where record.processing_status = 'pendent'
      and record.source_dataset in ('contractacions', 'convenis', 'raisc_ccaa', 'raisc_local')
      and not (record.id = any(excluded_ids))
      and not exists (
        select 1 from pipeline_jobs job
        where job.source_record_id = record.id
          and job.status not in ('rejected', 'insufficient_evidence', 'error')
      )
  )
  select eligible.id, eligible.source_dataset, eligible.source_record_id, eligible.title,
    eligible.provider_name, eligible.amount, eligible.mechanism
  from eligible
  where sample_rank <= per_source
  order by source_dataset, sample_rank;
$$;

revoke all on function public.sample_balanced_source_records(integer, uuid[]) from public;
grant execute on function public.sample_balanced_source_records(integer, uuid[]) to service_role;

comment on function public.sample_balanced_source_records is
  'Retorna una mostra aleatòria equilibrada de registres pendents, excloent files ja actives.';
