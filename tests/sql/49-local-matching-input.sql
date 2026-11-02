create function pg_temp.matching_input(p_record uuid,p_version text,p_job uuid) returns jsonb language sql as $$
 select jsonb_build_object('version','local-matching-input-v1','job_id',p_job,'run_id',(select run_id from pipeline_jobs where id=p_job),'source',jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb) from source_documents d where d.source_record_id=r.id),
 'chunks',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb) from evidence_chunks e join source_documents d on d.id=e.source_document_id where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id),
 'enrichment',coalesce((select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts) from record_enrichments e where e.source_record_id=r.id),'null'::jsonb),
 'catalog_version',(select to_jsonb(v) from catalog_versions v where id=p_version),'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from official_services s where s.version_id=p_version)) from source_records r where r.id=p_record
$$;
do $$
declare sid uuid:=gen_random_uuid();r uuid;r2 uuid;j uuid;d uuid:=gen_random_uuid();c uuid:=gen_random_uuid();other uuid:=gen_random_uuid();newdoc uuid:=gen_random_uuid();v text:='fixture-'||gen_random_uuid()::text;input_ jsonb; enriched_ jsonb;h text;run_state text;
begin
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values(v,'https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values(v,'1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions',sid::text,'Contractació','Synthetic');
 insert into pipeline_runs(status) values('matching') returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status) values(r,sid,'matching') returning id into j;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(d,sid,'https://example.invalid/'||d,d::text,'publication','fetched');
 insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values(c,d,0,'synthetic content','hash',17);
 input_:=pg_temp.matching_input(sid,v,j);h:=local_verify_matching_input(j,input_);
 if h is null or h !~ '^local-matching-input-v1:[0-9a-f]{64}$' then raise exception 'Current capture rejected';end if;
 if local_verify_matching_input(j,input_) is distinct from h then raise exception 'Capture not stable';end if;
 if local_verify_matching_input(j,jsonb_set(input_,'{job_id}',to_jsonb(gen_random_uuid()::text))) is not null or local_verify_matching_input(j,jsonb_set(input_,'{run_id}',to_jsonb(gen_random_uuid()::text))) is not null then raise exception 'Foreign job or run accepted';end if;
 update evidence_chunks set content='mutated content' where id=c;
 if local_verify_matching_input(j,input_) is not null then raise exception 'Chunk change missed';end if;
 update evidence_chunks set content='synthetic content' where id=c;
 insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values(other,d,1,'new content','hash',11);
 if local_verify_matching_input(j,input_) is not null then raise exception 'New chunk missed';end if;
 delete from evidence_chunks where id=other;
 update source_documents set extraction_partial=true where id=d;
 if local_verify_matching_input(j,input_) is not null then raise exception 'Document change missed';end if;
 update source_documents set extraction_partial=false where id=d;
 update source_records set source_payload='{"changed":true}' where id=sid;
 if local_verify_matching_input(j,input_) is not null then raise exception 'Source change missed';end if;
 update source_records set source_payload='{}' where id=sid;
 insert into record_enrichments(source_record_id,summary,confidence,engine,engine_version) values(sid,'New',0.5,'fixture','fixture');
 if local_verify_matching_input(j,input_) is not null then raise exception 'Enrichment addition missed';end if;
 enriched_:=pg_temp.matching_input(sid,v,j);
 if local_verify_matching_input(j,enriched_) is null then raise exception 'Current enrichment capture rejected';end if;
 update record_enrichments set summary='Changed' where source_record_id=sid;
 if local_verify_matching_input(j,enriched_) is not null then raise exception 'Enrichment edit missed';end if;
 delete from record_enrichments where source_record_id=sid;
 update official_services set description='Changed' where version_id=v and service_code='1';
 if local_verify_matching_input(j,input_) is not null then raise exception 'Catalogue content change missed';end if;
 update official_services set description='Description' where version_id=v and service_code='1';
 if local_verify_matching_input(j,input_) is distinct from h then raise exception 'Restored input not verifiable';end if;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(newdoc,sid,'https://example.invalid/'||newdoc,newdoc::text,'annex','discovered');
 if local_verify_matching_input(j,input_) is not null then raise exception 'New document missed';end if;
 delete from source_documents where id=newdoc;
 update source_records set financing_type=null where id=sid;
 if local_verify_matching_input(j,pg_temp.matching_input(sid,v,j)) is not null then raise exception 'Unknown financing type accepted';end if;
 update source_records set financing_type='contractacio' where id=sid;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j,'matching','synthetic','sending');
 if local_verify_matching_input(j,input_) is not null then raise exception 'Uncertain provider receipt accepted';end if;
 delete from provider_calls where pipeline_job_id=j;
 foreach run_state in array array['queued','ready','matching'] loop
  update pipeline_runs set status=run_state where id=r;
  if local_verify_matching_input(j,input_) is distinct from h then raise exception 'Valid run state rejected: %',run_state;end if;
 end loop;
 foreach run_state in array array['draft','preparing','enriching','paused','needs_review','completed','preparation_error','matching_error','processing_error'] loop
  update pipeline_runs set status=run_state where id=r;
  if local_verify_matching_input(j,input_) is not null then raise exception 'Inactive run state accepted: %',run_state;end if;
 end loop;
 update pipeline_runs set status='matching' where id=r;
 update source_records set source_dataset='concerts' where id=sid;
 if local_verify_matching_input(j,pg_temp.matching_input(sid,v,j)) is not null then raise exception 'Concert accepted';end if;
 update source_records set source_dataset='contractacions' where id=sid;
 insert into pipeline_runs(status) values('matching') returning id into r2;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(r2,sid,'matching','2200-01-01');
 if local_verify_matching_input(j,input_) is not null then raise exception 'Superseded job accepted';end if;
 if has_function_privilege('anon','public.local_verify_matching_input(uuid,jsonb)','execute') then raise exception 'Public matching input verification';end if;
end $$;
