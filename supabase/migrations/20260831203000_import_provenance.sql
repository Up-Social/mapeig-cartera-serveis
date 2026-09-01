create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  source_directory text,
  files jsonb not null default '[]'::jsonb,
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_written integer not null default 0 check (rows_written >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.source_records
  add column source_file text,
  add column source_sheet text,
  add column source_row integer check (source_row is null or source_row >= 2),
  alter column suggested_code drop not null,
  alter column suggested_name drop not null,
  alter column suggested_confidence drop not null,
  alter column suggested_evidence drop not null;

create index source_records_status_idx on public.source_records (processing_status);
create index source_records_dataset_idx on public.source_records (source_dataset);
create index source_records_source_location_idx on public.source_records (source_file, source_sheet, source_row);

alter table public.import_runs enable row level security;

comment on table public.import_runs is 'Execucions auditables de la ingesta dels fitxers de fonts.';
comment on column public.source_records.source_payload is 'Fila original serialitzada sense aplicar matching.';

delete from public.source_records
where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);
