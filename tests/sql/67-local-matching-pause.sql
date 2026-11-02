create or replace function pg_temp.pause_matching_input(p_record uuid,p_version text,p_job uuid) returns jsonb language sql as $$
 select jsonb_build_object('version','local-matching-input-v1','job_id',p_job,'run_id',(select run_id from pipeline_jobs where id=p_job),
 'source',jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb) from source_documents d where d.source_record_id=r.id),
 'chunks',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb) from evidence_chunks e join source_documents d on d.id=e.source_document_id where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id),
 'enrichment','null'::jsonb,'catalog_version',(select to_jsonb(v) from catalog_versions v where id=p_version),'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from official_services s where s.version_id=p_version)) from source_records r where r.id=p_record
$$;
do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;doc uuid:=gen_random_uuid();chunk uuid:=gen_random_uuid();v text:='pause-'||gen_random_uuid()::text;input_ jsonb;payload jsonb;ev jsonb;
begin
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
 values(v,'https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
 values(v,'1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions',sid::text,'Contract','Synthetic');
 insert into pipeline_runs(status) values('matching') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(doc,sid,'https://example.invalid/'||doc,doc::text,'publication','fetched');
 insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values(chunk,doc,0,'synthetic content','hash',17);
 input_:=pg_temp.pause_matching_input(sid,v,j);
 ev:=jsonb_build_object('id',chunk,'source_document_id',doc,'ordinal',0,'content','synthetic content');
 payload:=jsonb_build_object('version','local-matching-commit-v1','mode','deterministic','result',jsonb_build_object('classification','insufficient_evidence','reasons','[]'::jsonb,'explanation','Synthetic review','service_description','','target_population',''),'candidates','[]'::jsonb,'evidence',jsonb_build_array(ev),'enrichment',null);
 update app_settings set enabled=false where key='processing_enabled';
 if local_commit_matching(j,input_,payload,'[]'::jsonb) is not false then raise exception 'TEST: paused system committed';end if;
 if exists(select 1 from analysis_results where pipeline_job_id=j) or exists(select 1 from local_matching_commits where job_id=j) then raise exception 'TEST: paused commit wrote state';end if;
 update app_settings set enabled=true where key='processing_enabled';
 if local_commit_matching(j,input_,payload,'[]'::jsonb) is not true then raise exception 'TEST: verified unpaused commit rejected';end if;
 update app_settings set enabled=false where key='processing_enabled';
 if local_commit_matching(j,input_,payload,'[]'::jsonb) is not false then raise exception 'TEST: paused replay accepted';end if;
 update app_settings set enabled=true where key='processing_enabled';
 if local_commit_matching(j,input_,payload,'[]'::jsonb) is not true then raise exception 'TEST: exact replay rejected after restart';end if;
 if (select count(*) from analysis_results where pipeline_job_id=j)<>1 or has_function_privilege('service_role','public.local_commit_matching(uuid,jsonb,jsonb,jsonb)','execute') then raise exception 'TEST: duplicate result or unexpected permission';end if;
end $$;
