alter table public.source_documents
  add column resolved_url text,
  add column byte_size integer check (byte_size is null or byte_size >= 0),
  add column text_length integer check (text_length is null or text_length >= 0),
  add column extraction_method text;
