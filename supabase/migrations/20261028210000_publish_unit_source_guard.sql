-- Publish an already verified unit copy only while its source revision and
-- previous unit pointer still match. The document lock makes the comparison
-- and update atomic against concurrent source changes. NO KEY UPDATE is
-- compatible with foreign-key checks when another transaction holds a unit.
create function public.publish_unit_source(
 p_record uuid,p_unit uuid,p_document uuid,p_source_url text,p_source_path text,p_source_sha256 text,p_content_hash text,
 p_previous_path text,p_previous_sha256 text,p_new_path text,p_new_sha256 text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare d public.source_documents;u public.record_units;expected_path text;
begin
 select * into strict d from public.source_documents where id=p_document and source_record_id=p_record for no key update;
 if d.url is distinct from p_source_url or d.storage_path is distinct from p_source_path
  or d.storage_sha256 is distinct from p_source_sha256 or d.content_hash is distinct from p_content_hash
 then raise exception 'SOURCE_REVISION_CHANGED' using errcode='40001';end if;
 if p_source_url is null or p_source_path is null or p_source_sha256 is null or p_new_path is null or p_new_sha256 is null
  or p_source_sha256 !~ '^[0-9a-f]{64}$' or p_new_sha256 is distinct from p_source_sha256
  or p_source_path !~ ('^cases/'||p_record::text||'/documents/'||p_document::text||'/'||p_source_sha256||'\.[a-z0-9]+$')
 then raise exception 'SOURCE_ARCHIVE_INVALID';end if;
 expected_path:='cases/'||p_record::text||'/items/'||p_unit::text||'/documents/'||p_document::text||'/'||split_part(p_source_path,'/',5);
 if p_new_path is distinct from expected_path then raise exception 'UNIT_ARCHIVE_INVALID';end if;
 select * into strict u from public.record_units where id=p_unit and source_record_id=p_record for update;
 if u.document_id is distinct from p_document or u.storage_path is distinct from p_previous_path or u.storage_sha256 is distinct from p_previous_sha256 then
  raise exception 'UNIT_REVISION_CHANGED' using errcode='40001';
 end if;
 if (u.storage_path is not null and u.storage_path<>p_new_path) or (u.storage_sha256 is not null and u.storage_sha256<>p_new_sha256) then
  raise exception 'UNIT_ARCHIVE_CHANGED';
 end if;
 update public.record_units set storage_path=p_new_path,storage_sha256=p_new_sha256 where id=u.id;
 return u.id;
end $$;
revoke all on function public.publish_unit_source(uuid,uuid,uuid,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.publish_unit_source(uuid,uuid,uuid,text,text,text,text,text,text,text,text) to service_role;
