create function pg_temp.matching_input(p_record uuid,p_version text,p_job uuid) returns jsonb language sql as $$
 select jsonb_build_object('version','local-matching-input-v1','job_id',p_job,'run_id',(select run_id from pipeline_jobs where id=p_job),'source',jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb) from source_documents d where d.source_record_id=r.id),
 'chunks',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb) from evidence_chunks e join source_documents d on d.id=e.source_document_id where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id),
 'enrichment',coalesce((select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts) from record_enrichments e where e.source_record_id=r.id),'null'::jsonb),
 'catalog_version',(select to_jsonb(v) from catalog_versions v where id=p_version),'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from official_services s where s.version_id=p_version)) from source_records r where r.id=p_record
$$;
do $$
declare ds text; sid uuid; rid uuid; jid uuid; doc uuid; ver text:='identity-fixture-'||gen_random_uuid()::text; input_ jsonb; original_key text;
begin
 update app_settings set enabled=true where key='processing_enabled';
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values(ver,'https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values(ver,'1','Service',null,'service','Description','People','Conditions','Law','{}');
 foreach ds in array array['contractacions','raisc_ccaa','raisc_local'] loop
  sid:=gen_random_uuid();doc:=gen_random_uuid();
  insert into source_records(id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload)
   values(sid,ds,sid::text,'Synthetic','Prova','Entitat prova',123.45,'{"Data concessió":"2025-01-10"}');
  insert into pipeline_runs(status) values('matching') returning id into rid;
  insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into jid;
  insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(doc,sid,'https://example.invalid/'||doc,doc::text,'publication','fetched');
  input_:=pg_temp.matching_input(sid,ver,jid);
  if local_verify_matching_input(jid,input_) is null then raise exception 'valid identity rejected: %',ds;end if;
  -- A lower-priority date does not change the classification trigger's key.
  update source_records set source_payload='{"Data concessió":"2025-01-10","Data signatura":"2024-12-01"}' where id=sid;
  if local_verify_matching_input(jid,pg_temp.matching_input(sid,ver,jid)) is null then raise exception 'lower-priority date rejected: %',ds;end if;
  select deduplication_key into original_key from source_records where id=sid;
  -- Only payload changes; the existing trigger leaves the persisted key stale.
  update source_records set source_payload='{"Data concessió":"2025-01-11"}' where id=sid;
  if (select deduplication_key from source_records where id=sid) is distinct from original_key then raise exception 'fixture did not preserve stale key';end if;
  input_:=pg_temp.matching_input(sid,ver,jid);
  if local_verify_matching_input(jid,input_) is not null then raise exception 'stale administrative date accepted: %',ds;end if;
  if local_claim_matching_request(jid,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not null then raise exception 'stale identity allowed provider claim: %',ds;end if;
  if exists(select 1 from provider_calls where pipeline_job_id=jid) or exists(select 1 from local_matching_requests where job_id=jid) then raise exception 'stale identity wrote journal state: %',ds;end if;
  -- Recompute only on this transaction-local synthetic record, then retry.
  update source_records set title=title where id=sid;
  input_:=pg_temp.matching_input(sid,ver,jid);
  if local_verify_matching_input(jid,input_) is null then raise exception 'corrected identity rejected: %',ds;end if;
  update source_records set deduplication_key='historical-unknown' where id=sid;
  if local_verify_matching_input(jid,pg_temp.matching_input(sid,ver,jid)) is not null then raise exception 'unknown key accepted: %',ds;end if;
  update source_records set deduplication_key=null where id=sid;
  if local_verify_matching_input(jid,pg_temp.matching_input(sid,ver,jid)) is not null then raise exception 'null key accepted: %',ds;end if;
 end loop;
 if has_function_privilege('service_role','public.local_verify_matching_input_state(uuid,jsonb,text)','execute') then raise exception 'internal state checker exposed';end if;
end $$;
