-- Existing workbook manifest entries are immutable. This also prevents a
-- concurrent read/modify/write from silently dropping another verified entry.
create function public.guard_import_workbook_manifest() returns trigger
language plpgsql set search_path=public as $$
declare key_ text;
begin
 if jsonb_typeof(old.storage_manifest) is distinct from 'object' or jsonb_typeof(new.storage_manifest) is distinct from 'object' then
  raise exception 'IMPORT_MANIFEST_INVALID' using errcode='23514';end if;
 for key_ in select jsonb_object_keys(old.storage_manifest) loop
  if old.storage_manifest->key_ is distinct from new.storage_manifest->key_ then
   raise exception 'IMPORT_MANIFEST_IMMUTABLE' using errcode='23514';end if;
 end loop;
 return new;
end $$;
create trigger guard_import_workbook_manifest before update of storage_manifest on public.import_runs
for each row execute function public.guard_import_workbook_manifest();

-- Append one independently verified workbook; an identical response can be
-- reconciled after a lost acknowledgement. Never rewrites an existing entry.
create function public.publish_import_workbook(p_run uuid,p_file text,p_path text,p_sha256 text,p_size bigint) returns boolean
language plpgsql security definer set search_path=public as $$
declare manifest_ jsonb; entry_ jsonb;
begin
 if p_run is null or nullif(p_file,'') is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size<0
  or p_path is distinct from 'imports/'||p_run::text||'/'||p_sha256||'.xlsx' then return false;end if;
 select storage_manifest into manifest_ from import_runs where id=p_run for update nowait;
 if not found or jsonb_typeof(manifest_) is distinct from 'object' then return false;end if;
 entry_:=jsonb_build_object('bucket','cloud-documents','path',p_path,'sha256',p_sha256,'byte_size',p_size);
 if manifest_ ? p_file then return manifest_->p_file is not distinct from entry_;end if;
 update import_runs set storage_manifest=storage_manifest||jsonb_build_object(p_file,entry_) where id=p_run;
 return true;
exception when lock_not_available then raise exception 'IMPORT_WORKBOOK_BUSY' using errcode='55P03';
end $$;
revoke all on function public.publish_import_workbook(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.publish_import_workbook(uuid,text,text,text,bigint) to service_role;

-- Publish an already verified immutable import object only against the exact
-- source revision and pointer observed before Storage work. Does not read,
-- create, overwrite or delete Storage objects.
create function public.publish_import_source(p_record uuid,p_expected jsonb,p_previous jsonb,p_archive jsonb,p_path text,p_sha256 text) returns boolean
language plpgsql security definer set search_path=public as $$
declare r source_records; current_ jsonb; previous_ jsonb; expected_path text; manifest_ jsonb;old_run text;archive_sha text;
begin
 if p_record is null or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_previous) is distinct from 'object'
  or jsonb_typeof(p_archive) is distinct from 'object' or p_path is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false;end if;
 select * into r from source_records where id=p_record for update nowait;
 if not found then return false;end if;
 current_:=jsonb_build_object('source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,'source_payload',r.source_payload,'source_payload_hash',r.source_payload_hash,'import_run_id',r.import_run_id);
 if current_ is distinct from p_expected then return false;end if;
 archive_sha:=p_archive->>'sha256';
 if archive_sha is null or archive_sha !~ '^[0-9a-f]{64}$' then return false;end if;
 if r.import_run_id is not null then
  select storage_manifest->r.source_file into manifest_ from import_runs where id=r.import_run_id for share nowait;
  if manifest_->>'bucket' is distinct from 'cloud-documents' or manifest_->>'path' is distinct from p_archive->>'path'
   or manifest_->>'sha256' is distinct from archive_sha or p_archive->>'path' is distinct from 'imports/'||r.import_run_id::text||'/'||archive_sha||'.xlsx' then return false;end if;
 elsif p_archive->>'path' is distinct from 'imports/legacy/'||archive_sha||'.xlsx'
  and p_archive->>'path' is distinct from 'imports/legacy/'||archive_sha||'.json' then return false;end if;
 expected_path:='cases/'||p_record::text||'/imports/'||coalesce(r.import_run_id::text,'legacy')||'/'||p_sha256||'.json';
 if p_path is distinct from expected_path then return false;end if;
 -- A response lost after commit can only be reconciled to the exact same path,
 -- digest and source, after the caller verifies the archived bytes again.
 if r.storage_path is not distinct from p_path and r.storage_sha256 is not distinct from p_sha256 then return true;end if;
 previous_:=jsonb_build_object('storage_path',r.storage_path,'storage_sha256',r.storage_sha256);
 if previous_ is distinct from p_previous then return false;end if;
 if r.storage_path is not null or r.storage_sha256 is not null then
  -- Historical copies and a different copy already published in this same run
  -- require review; only a clearly identified older run may be superseded.
  if r.import_run_id is null or r.storage_path is null or r.storage_sha256 is null
   or r.storage_sha256 !~ '^[0-9a-f]{64}$' then return false;end if;
  old_run:=split_part(r.storage_path,'/',4);
  if old_run=r.import_run_id::text or (old_run<>'legacy' and old_run !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   or r.storage_path is distinct from 'cases/'||p_record::text||'/imports/'||old_run||'/'||r.storage_sha256||'.json' then return false;end if;
 end if;
 update source_records set storage_path=p_path,storage_sha256=p_sha256 where id=p_record;
 return true;
exception when lock_not_available then raise exception 'IMPORT_SOURCE_BUSY' using errcode='55P03';
end $$;
revoke all on function public.publish_import_source(uuid,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.publish_import_source(uuid,jsonb,jsonb,jsonb,text,text) to service_role;
