-- History of the «Mapeig de la Cartera» workbooks generated from Exportacions.
-- Every generated file is archived as served, and its row keeps the filters,
-- the counts and the byte identity so a historical download can be verified.
-- Rows are append-only from the application; an operator correction of a row
-- (for example, registering an export generated before this table existed)
-- is done by SQL and must say so in `note`.
create table public.mapeig_exports (
 id uuid primary key default gen_random_uuid(),
 created_at timestamptz not null default now(),
 file_name text not null,
 financing_types text[] not null check (cardinality(financing_types) > 0),
 provinces text[] null,
 year_from integer null check (year_from between 1900 and 2200),
 year_to integer null check (year_to between 1900 and 2200),
 row_count integer not null check (row_count >= 0),
 total_cents bigint not null,
 byte_size integer not null check (byte_size > 0),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,
 summary jsonb not null default '{}'::jsonb,
 notes text[] not null default '{}',
 generated_by text not null default 'web' check (generated_by in ('web','operator')),
 note text null,
 constraint mapeig_exports_year_range check (year_from is null or year_to is null or year_from <= year_to)
);
comment on table public.mapeig_exports is 'One row per Mapeig de la Cartera workbook generated from Exportacions; the file is archived in the mapeig-exports bucket at storage_path.';
comment on column public.mapeig_exports.provinces is 'Province filter applied; null means every province.';
comment on column public.mapeig_exports.note is 'Operator explanation when the row was registered or corrected by hand.';
create index mapeig_exports_created_idx on public.mapeig_exports (created_at desc);
alter table public.mapeig_exports enable row level security;
revoke all on public.mapeig_exports from public, anon, authenticated, service_role;
grant select, insert on public.mapeig_exports to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
 values ('mapeig-exports', 'mapeig-exports', false, 52428800)
 on conflict (id) do nothing;
-- No anonymous/authenticated storage policies. Only the server service role can access objects.
