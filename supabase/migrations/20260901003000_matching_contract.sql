create table public.matching_candidates (
  id uuid primary key default gen_random_uuid(),
  pipeline_job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
  target_catalog text not null,
  target_code text not null,
  target_name text not null,
  rank integer not null check (rank between 1 and 10),
  score numeric(5,4) not null check (score between 0 and 1),
  rationale text not null,
  engine text not null,
  engine_version text not null,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (pipeline_job_id, rank)
);

create table public.matching_candidate_evidence (
  candidate_id uuid not null references public.matching_candidates(id) on delete cascade,
  evidence_chunk_id uuid not null references public.evidence_chunks(id) on delete restrict,
  relevance numeric(5,4) check (relevance is null or relevance between 0 and 1),
  explanation text,
  primary key (candidate_id, evidence_chunk_id)
);

create table public.matching_evaluations (
  id uuid primary key default gen_random_uuid(),
  pipeline_job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
  candidate_id uuid references public.matching_candidates(id) on delete set null,
  verdict text not null check (verdict in ('correct', 'incorrect', 'partial', 'insufficient_evidence')),
  expected_code text,
  notes text,
  evaluator text,
  created_at timestamptz not null default now()
);

create index matching_candidates_job_idx on public.matching_candidates (pipeline_job_id);
create index matching_candidate_evidence_chunk_idx on public.matching_candidate_evidence (evidence_chunk_id);
create index matching_evaluations_job_idx on public.matching_evaluations (pipeline_job_id);

alter table public.matching_candidates enable row level security;
alter table public.matching_candidate_evidence enable row level security;
alter table public.matching_evaluations enable row level security;

grant select, insert, update on public.matching_candidates to service_role;
grant select, insert, update on public.matching_candidate_evidence to service_role;
grant select, insert, update on public.matching_evaluations to service_role;

comment on table public.matching_candidates is
  'Candidats proposats pel motor. Cap fila implica aprovació humana.';
comment on table public.matching_candidate_evidence is
  'Fragments exactes que sustenten cada candidat de matching.';
