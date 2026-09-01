create table public.master_services (
  id uuid primary key default gen_random_uuid(),
  service_code text not null unique,
  service_name text not null,
  sector_scope text,
  portfolio_status text,
  general_confidence text,
  source_file text not null,
  source_sheet text not null,
  source_row integer not null check (source_row >= 4),
  source_payload jsonb not null default '{}'::jsonb,
  source_payload_hash text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.master_services enable row level security;
grant select, insert, update on public.master_services to service_role;
create index master_services_portfolio_status_idx on public.master_services (portfolio_status);

comment on table public.master_services is
  'Referència importada del Master, aïllada dels registres font i no autoritzada automàticament per ajustar el matching.';
