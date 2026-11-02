-- Read-only validation of the data actually loaded for the future generic local
-- matching flow. This does not authorize a provider call or a result commit.
create function public.local_verify_matching_input_state(p_job uuid,p_expected jsonb,p_status text) returns text
language plpgsql security definer set search_path=public as $$
declare j pipeline_jobs; r source_records; v catalog_versions; current_source jsonb; current_docs jsonb; current_chunks jsonb; current_enrichment jsonb; current_services jsonb; latest uuid;
begin
 if p_job is null or p_status not in ('matching','needs_review') or jsonb_typeof(p_expected) is distinct from 'object' or p_expected->>'version' is distinct from 'local-matching-input-v1' then return null;end if;
 select * into j from pipeline_jobs where id=p_job;
 if not found then return null;end if;
 select * into r from source_records where id=j.source_record_id for update nowait;
 if not found or coalesce(r.financing_type,'') not in ('contractacio','subvencio') then return null;end if;
 perform 1 from pipeline_jobs where source_record_id=r.id for update nowait;
 select * into j from pipeline_jobs where id=p_job and source_record_id=r.id;
 select id into latest from pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1;
 if j.id is null or j.status is distinct from p_status or latest is distinct from p_job
  or p_expected->>'job_id' is distinct from j.id::text or p_expected->>'run_id' is distinct from j.run_id::text then return null;end if;
 -- process-run sets matching; a queued record operation and a manually
 -- prepared ready run are the other local entry states. A terminal/error,
 -- paused, draft or still-preparing/enriching run is not an active match.
 perform 1 from pipeline_runs where id=j.run_id and (status in ('queued','ready','matching') or (p_status='needs_review' and status in ('needs_review','completed'))) for share nowait;
 if not found then return null;end if;
 perform 1 from provider_calls where pipeline_job_id=p_job for share nowait;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then return null;end if;
 select * into v from catalog_versions where active and validated for update nowait;
 if not found or v.entry_count>1000 then return null;end if;
 perform 1 from official_services where version_id=v.id order by service_code for share nowait;
 perform 1 from source_documents where source_record_id=r.id order by id for update nowait;
 perform e.id from evidence_chunks e join source_documents d on d.id=e.source_document_id
  where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id order by d.id,e.ordinal,e.id for share of e nowait;
 perform 1 from record_enrichments where source_record_id=r.id for update nowait;
 current_source:=jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,
  'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key);
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,
  'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,
  'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb)
 into current_docs from source_documents d where d.source_record_id=r.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,
  'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb)
 into current_chunks from evidence_chunks e join source_documents d on d.id=e.source_document_id
 where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id;
 select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,
  'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts)
 into current_enrichment from record_enrichments e where e.source_record_id=r.id;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) into current_services from official_services s where s.version_id=v.id;
 if jsonb_array_length(current_docs)=0 or jsonb_array_length(current_services)<>v.entry_count
  or p_expected->'source' is distinct from current_source or p_expected->'documents' is distinct from current_docs
  or p_expected->'chunks' is distinct from current_chunks or p_expected->'enrichment' is distinct from coalesce(current_enrichment,'null'::jsonb)
  or p_expected->'catalog_version' is distinct from to_jsonb(v) or p_expected->'services' is distinct from current_services
 then return null;end if;
 return 'local-matching-input-v1:'||encode(extensions.digest(p_expected::text,'sha256'),'hex');
exception when lock_not_available then return null;
end $$;
revoke all on function public.local_verify_matching_input_state(uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.local_verify_matching_input(p_job uuid,p_expected jsonb) returns text
language sql security definer set search_path=public as $$
 select public.local_verify_matching_input_state(p_job,p_expected,'matching')
$$;
revoke all on function public.local_verify_matching_input(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.local_verify_matching_input(uuid,jsonb) to service_role;
