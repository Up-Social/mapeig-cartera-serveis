-- Closed candidate: no public RPC, no grants and no app integration.
-- A version binds the title, publication count and actual extracted text as well
-- as existing metadata. It is not proof of archived bytes or extraction origin.
create function concert_provisional_complete_candidate.snapshot(p_record uuid,p_document uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object(
   'recordId',r.id,'documentId',d.id,
   'version',encode(extensions.digest(convert_to(jsonb_build_array(
      r.id,r.financing_type,r.title,d.id,public.concert_population_document_hash(d),
      d.extracted_text_hash,encode(extensions.digest(convert_to(coalesce(d.extracted_text,''),'UTF8'),'sha256'),'hex'),
      (select count(*) from public.source_documents p where p.source_record_id=r.id and p.document_type='publication')
   )::text,'UTF8'),'sha256'),'hex'),
   'current',concert_provisional_complete_candidate.read_current(r.id),
   'physicalSourceVerified',false,'textProvenanceVerified',false,'sumable',false)
 from public.source_records r join public.source_documents d on d.source_record_id=r.id
 where r.id=p_record and d.id=p_document
$$;

create function concert_provisional_complete_candidate.capture_checked(
 p_set uuid,p_record uuid,p_document uuid,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare snapshot_ jsonb; fingerprint_ text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'PROVISIONAL_ISOLATION';end if;
 if p_set is null or p_record is null or p_document is null or p_expected_version is null then raise exception 'PROVISIONAL_INPUT';end if;
 perform 1 from public.source_records where id=p_record for update;
 if not found then raise exception 'PROVISIONAL_RECORD_MISSING';end if;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share;
 snapshot_:=concert_provisional_complete_candidate.snapshot(p_record,p_document);
 if snapshot_ is null then raise exception 'PROVISIONAL_DOCUMENT_MISSING';end if;
 if snapshot_->>'version' is distinct from p_expected_version then raise exception 'PROVISIONAL_SOURCE_CHANGED';end if;
 select public.concert_population_document_hash(d) into fingerprint_ from public.source_documents d where d.id=p_document and d.source_record_id=p_record;
 return concert_provisional_complete_candidate.capture(p_set,p_record,p_document,fingerprint_);
end $$;
revoke all on function concert_provisional_complete_candidate.snapshot(uuid,uuid),
 concert_provisional_complete_candidate.capture_checked(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
