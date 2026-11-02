-- Publish a verified historical Master row only against its exact observed
-- source and pointer. Storage bytes are verified by the caller; this function
-- does not certify physical contents or grant new table permissions.
create function public.publish_historical_master_source(
 p_master uuid,p_expected jsonb,p_previous jsonb,p_archive jsonb,p_path text,p_sha256 text
) returns boolean language plpgsql security invoker set search_path=public as $$
declare r public.master_services; expected_ jsonb; previous_ jsonb; archive_sha text;
begin
 if p_master is null or jsonb_typeof(p_expected) is distinct from 'object'
  or jsonb_typeof(p_previous) is distinct from 'object' or jsonb_typeof(p_archive) is distinct from 'object'
  or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then return false;end if;
 archive_sha:=p_archive->>'sha256';
 if archive_sha is null or archive_sha !~ '^[0-9a-f]{64}$'
  or p_archive->>'path' is distinct from 'imports/legacy/'||archive_sha||'.xlsx'
  or p_path is distinct from 'references/master/items/'||p_master::text||'/source/'||p_sha256||'.json' then return false;end if;
 select * into r from public.master_services where id=p_master for update nowait;
 if not found then return false;end if;
 expected_:=jsonb_build_object('source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,
  'source_payload',r.source_payload,'source_payload_hash',r.source_payload_hash);
 if expected_ is distinct from p_expected then return false;end if;
 if r.storage_path is not distinct from p_path and r.storage_sha256 is not distinct from p_sha256 then return true;end if;
 previous_:=jsonb_build_object('storage_path',r.storage_path,'storage_sha256',r.storage_sha256);
 if previous_ is distinct from p_previous or r.storage_path is not null or r.storage_sha256 is not null then return false;end if;
 update public.master_services set storage_path=p_path,storage_sha256=p_sha256 where id=p_master;
 return true;
exception when lock_not_available then raise exception 'MASTER_SOURCE_BUSY' using errcode='55P03';
end $$;
revoke all on function public.publish_historical_master_source(uuid,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.publish_historical_master_source(uuid,jsonb,jsonb,jsonb,text,text) to service_role;
