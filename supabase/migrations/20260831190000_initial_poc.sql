create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create type public.processing_status as enum (
  'pendent',
  'preparant',
  'processant',
  'completat',
  'revisio',
  'error'
);

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft',
  selected_count integer not null default 0 check (selected_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  parameters jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  source_dataset text not null,
  source_record_id text not null,
  mechanism text not null,
  title text not null,
  provider_name text,
  amount numeric(16,2),
  processing_status public.processing_status not null default 'pendent',
  cartera_code text,
  cartera_name text,
  confidence numeric(4,3) check (confidence between 0 and 1),
  evidence text,
  suggested_code text not null,
  suggested_name text not null,
  suggested_confidence numeric(4,3) not null check (suggested_confidence between 0 and 1),
  suggested_evidence text not null,
  source_payload jsonb not null default '{}'::jsonb,
  source_payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_dataset, source_record_id)
);

create table public.pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  status text not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, source_record_id)
);

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  previous_code text,
  final_code text,
  decision text not null check (decision in ('approved', 'corrected', 'rejected', 'insufficient_evidence')),
  reason text,
  reviewer text,
  created_at timestamptz not null default now()
);

alter table public.pipeline_runs enable row level security;
alter table public.source_records enable row level security;
alter table public.pipeline_jobs enable row level security;
alter table public.review_decisions enable row level security;

comment on table public.source_records is
  'Registres de demostració del flux. No procedeixen del Master manual.';

insert into public.source_records (
  id, source_dataset, source_record_id, mechanism, title, provider_name, amount,
  suggested_code, suggested_name, suggested_confidence, suggested_evidence
) values
  (
    '11111111-1111-4111-8111-111111111111', 'RAISC', 'CC002-23-006-1', 'Subvenció',
    'Transport adaptat individual i col·lectiu a la comarca',
    'Entitat beneficiària de prova', 48500,
    '1.2.2.1.3', 'Servei de transport adaptat', 0.960,
    'El títol de la concessió identifica explícitament el transport adaptat.'
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'Convenis', '2024/11/0014', 'Conveni',
    'Cofinançament de l''Equip d''Atenció a la Infància i l''Adolescència',
    null, 126000,
    '1.2.1.2', 'Servei especialitzat d''atenció a la infància i a l''adolescència (SEAIA)', 0.910,
    'L''objecte identifica l''EAIA, però cal validar el rol de les parts signants.'
  ),
  (
    '33333333-3333-4333-8333-333333333333', 'PSCP', '2026/68', 'Contractació pública',
    'Servei de formació i monitoratge en criança positiva per a famílies',
    'Adjudicatari de prova', 73200,
    '1.2.11.1', 'Servei d''atenció a les famílies', 0.780,
    'El programa s''adreça a famílies, però la documentació no cita un servei oficial concret.'
  ),
  (
    '44444444-4444-4444-8444-444444444444', 'e-Tauler', 'EDICTE-2025-0142', 'Concert social',
    'Provisió de places de centre residencial per a persones amb discapacitat intel·lectual',
    'Entitat acreditada de prova', 310000,
    '1.2.6.2.3.3', 'Serveis de centre residencial per a persones amb discapacitat intel·lectual', 0.940,
    'La resolució descriu la tipologia residencial i la població destinatària.'
  )
on conflict (source_dataset, source_record_id) do nothing;

grant usage on schema public to anon, authenticated;
grant select on public.source_records to anon, authenticated;
