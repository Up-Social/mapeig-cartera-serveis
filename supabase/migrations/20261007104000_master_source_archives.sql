alter table public.master_services
 add column storage_path text,
 add column storage_sha256 text;

alter table public.master_services add constraint master_source_archive_scope check (
 storage_path is null or (
  storage_sha256 ~ '^[0-9a-f]{64}$'
  and storage_path = 'references/master/items/'||id||'/source/'||storage_sha256||'.json'
 )
);
