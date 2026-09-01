alter table public.source_documents
  add column text_preview text,
  add column extracted_text_hash text,
  add column quality_score numeric(4,3) check (quality_score is null or quality_score between 0 and 1),
  add column quality_flags text[] not null default '{}',
  add column chunk_count integer not null default 0 check (chunk_count >= 0);

update public.source_documents
set text_preview = left(extracted_text, 600)
where extracted_text is not null;

create table public.evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  content text not null,
  content_hash text not null,
  character_count integer not null check (character_count > 0),
  created_at timestamptz not null default now(),
  unique (source_document_id, ordinal)
);

create index evidence_chunks_document_idx on public.evidence_chunks (source_document_id);
alter table public.evidence_chunks enable row level security;
grant select, insert, update on public.evidence_chunks to service_role;

comment on table public.evidence_chunks is
  'Fragments auditables del text extret. Encara no contenen embeddings ni resultats de matching.';
