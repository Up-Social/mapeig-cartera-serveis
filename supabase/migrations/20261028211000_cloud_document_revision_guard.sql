-- Patch the innermost writer: every existing cloud_commit wrapper and direct
-- service-role invocation must validate the source before persisting text.
-- This retains the established job -> document lock order.
do $migration$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.cloud_commit_v1(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure);
 updated:=replace(definition,
  $old$  if not found then raise exception 'CLOUD_SCOPE';end if;
  update source_documents set active_extraction_id$old$,
  $new$  if not found then raise exception 'CLOUD_SCOPE';end if;
  if coalesce(p_data->>'source_sha256','') !~ '^[0-9a-f]{64}$'
   or coalesce(p_data->>'source_path','') = '' or coalesce(p_data->>'source_url','') = ''
   or not exists(select 1 from source_documents where id=doc_id and source_record_id=j.source_record_id
      and storage_sha256=p_data->>'source_sha256' and storage_path=p_data->>'source_path' and url=p_data->>'source_url')
  then raise exception 'DOCUMENT_SOURCE_CHANGED' using errcode='40001';end if;
  update source_documents set active_extraction_id$new$);
 if definition=updated then raise exception 'Document source guard patch failed';end if;
 execute updated;
end $migration$;
