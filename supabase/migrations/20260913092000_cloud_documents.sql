insert into storage.buckets(id,name,public,file_size_limit) values('cloud-documents','cloud-documents',false,10485760) on conflict(id) do nothing;
-- No anonymous/authenticated storage policies. Only the server service role can access objects.
alter table public.source_documents add column if not exists extraction_partial boolean not null default false;
