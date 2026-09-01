create table public.service_provisions (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null unique references public.source_records(id) on delete restrict,
  source_id text not null,
  call_url text,
  regulatory_basis_url text,
  provider_name text,
  provider_nif text,
  mechanism text not null,
  award_date date,
  amount numeric(16,2),
  contracting_body text,
  target_population text,
  source_reference text not null,
  service_code text not null references public.master_services(service_code) on update cascade on delete restrict,
  matching_candidate_id uuid references public.matching_candidates(id) on delete set null,
  review_decision_id uuid references public.review_decisions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index service_provisions_service_code_idx on public.service_provisions (service_code);
create index service_provisions_mechanism_idx on public.service_provisions (mechanism);

alter table public.service_provisions enable row level security;
grant select, insert, update on public.service_provisions to service_role;

comment on table public.service_provisions is
  'Resultat normalitzat equivalent a Detalle_Provisiones. És la font de la consulta i de la futura exportació a Excel.';
comment on column public.service_provisions.service_code is
  'Codi final de Cartera vinculat a la provisió; no s''ha d''omplir des d''un candidat automàtic sense revisió.';
