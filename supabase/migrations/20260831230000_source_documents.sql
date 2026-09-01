create type public.source_document_status as enum (
  'discovered',
  'fetching',
  'fetched',
  'unsupported',
  'error'
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references public.source_records(id) on delete cascade,
  url text not null,
  url_hash text not null,
  document_type text not null,
  source_fields text[] not null default '{}',
  status public.source_document_status not null default 'discovered',
  http_status integer,
  mime_type text,
  content_hash text,
  extracted_text text,
  error_message text,
  discovered_at timestamptz not null default now(),
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (source_record_id, url_hash)
);

create index source_documents_record_idx on public.source_documents (source_record_id);
create index source_documents_status_idx on public.source_documents (status);
create index source_documents_type_idx on public.source_documents (document_type);

alter table public.source_documents enable row level security;
grant select, insert, update on public.source_documents to service_role;

comment on table public.source_documents is
  'URLs de documents i pàgines oficials descobertes als payloads originals. El contingut s''extreu en una fase posterior.';
