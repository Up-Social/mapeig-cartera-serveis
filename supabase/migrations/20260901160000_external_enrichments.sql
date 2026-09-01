create table public.record_enrichments (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null unique references public.source_records(id) on delete cascade,
  extracted_title text,
  provider_name text,
  provider_nif text,
  mechanism text,
  award_date date,
  amount numeric(16,2),
  contracting_body text,
  target_population text,
  summary text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  engine text not null,
  engine_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.record_enrichment_evidence (
  enrichment_id uuid not null references public.record_enrichments(id) on delete cascade,
  evidence_chunk_id uuid not null references public.evidence_chunks(id) on delete restrict,
  primary key (enrichment_id, evidence_chunk_id)
);

create index record_enrichments_source_idx on public.record_enrichments (source_record_id);
alter table public.record_enrichments enable row level security;
alter table public.record_enrichment_evidence enable row level security;
grant select, insert, update on public.record_enrichments to service_role;
grant select, insert, delete on public.record_enrichment_evidence to service_role;

comment on table public.record_enrichments is
  'Camps estructurats extrets de documents oficials; mai substitueixen silenciosament la fila Excel original.';
