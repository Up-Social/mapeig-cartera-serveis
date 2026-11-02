create or replace function pg_temp.matching_input(p_record uuid,p_version text,p_job uuid) returns jsonb language sql as $$
 select jsonb_build_object('version','local-matching-input-v1','job_id',p_job,'run_id',(select run_id from pipeline_jobs where id=p_job),'source',jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb) from source_documents d where d.source_record_id=r.id),
 'chunks',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb) from evidence_chunks e join source_documents d on d.id=e.source_document_id where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id),
 'enrichment',coalesce((select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts) from record_enrichments e where e.source_record_id=r.id),'null'::jsonb),
 'catalog_version',(select to_jsonb(v) from catalog_versions v where id=p_version),'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from official_services s where s.version_id=p_version)) from source_records r where r.id=p_record
$$;
do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;doc uuid:=gen_random_uuid();chunk uuid:=gen_random_uuid();v text:='fixture-'||gen_random_uuid()::text;input_ jsonb;payload jsonb;bad jsonb;receipts jsonb;result_ jsonb;ev jsonb;enrich jsonb;receipt_id uuid; h text; ok boolean;
begin
 update app_settings set enabled=true where key='processing_enabled';
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values(v,'https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values(v,'1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions',sid::text,'Contract','Synthetic');
 insert into pipeline_runs(status) values('matching') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(doc,sid,'https://example.invalid/'||doc,doc::text,'publication','fetched');
 insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values(chunk,doc,0,'synthetic content','hash',17);
 input_:=pg_temp.matching_input(sid,v,j);
 result_:='{"classification":"insufficient_evidence","reasons":[],"explanation":"Synthetic review","service_description":"","target_population":""}';
 ev:=jsonb_build_object('id',chunk,'source_document_id',doc,'ordinal',0,'content','synthetic content');
 enrich:='{"title":"Title","summary":"Synthetic","confidence":0.8,"engine_version":"mock"}';
 payload:=jsonb_build_object('version','local-matching-commit-v1','mode','provider','transform_hash',repeat('b',64),'result',result_,'candidates','[]'::jsonb,'evidence',jsonb_build_array(ev),'enrichment',enrich,'enrichment_evidence',jsonb_build_array(chunk));
 receipts:=jsonb_build_array(jsonb_build_object('phase','matching','wire_hash','prepared-json-v1:'||repeat('a',64),'response',jsonb_build_object('synthetic',true)));
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'enrichment','historical','received','{"old":true}') returning id into receipt_id;
 if local_commit_matching(j,input_,jsonb_build_object('version','local-matching-commit-v1','mode','deterministic','result',result_,'candidates','[]'::jsonb,'evidence',jsonb_build_array(ev),'enrichment',null),'[]'::jsonb) is not false then raise exception 'Deterministic result ignored an enrichment receipt';end if;
 delete from provider_calls where id=receipt_id;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Missing receipt accepted';end if;
 if local_register_matching_request(j,jsonb_set(input_,'{source,title}','"changed"'),'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Stale input registered';end if;
 if local_register_matching_request(j,input_,'matching','old',repeat('b',64),null) is not false then raise exception 'Malformed wire registered';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),'old',null) is not false then raise exception 'Malformed transformer registered';end if;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'matching','prepared-json-v1:'||repeat('a',64),'received','{"synthetic":true}') returning id into receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Historical receipt registered';end if;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Unanchored receipt accepted';end if;
 delete from provider_calls where id=receipt_id;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
 values(j,sid,v,'legacy','insufficient_evidence','[]','old','old','old','[]');
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Previous analysis allowed new request';end if;
 delete from analysis_results where pipeline_job_id=j;
 insert into matching_candidates(pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,rank,score,rationale,engine,engine_version)
 values(j,'official',v,'1','Synthetic',1,0.5,'old','old','old');
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Previous candidate allowed new request';end if;
 delete from matching_candidates where pipeline_job_id=j;
 insert into review_decisions(source_record_id,pipeline_job_id,decision) values(sid,j,'rejected');
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Previous review allowed new request';end if;
 delete from review_decisions where pipeline_job_id=j;
 -- The old RPC is still granted directly: the experimental wrapper cannot
 -- fence it until this shared route is changed and integrated deliberately.
 if not has_function_privilege('service_role','public.claim_provider_call(uuid,text,text)','execute') then raise exception 'Unexpected shared journal privilege';end if;
 if (claim_provider_call(j,'matching','prepared-json-v1:'||repeat('a',64))->>'send')::boolean is not true then raise exception 'Shared journal behavior changed';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Direct uncertain call accepted';end if;
 delete from provider_calls where pipeline_job_id=j;
 if local_claim_matching_request(j,jsonb_set(input_,'{source,title}','"changed"'),'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not null then raise exception 'Stale atomic claim succeeded';end if;
 if exists(select 1 from provider_calls where pipeline_job_id=j) or exists(select 1 from local_matching_requests where job_id=j) then raise exception 'Stale claim wrote state';end if;
 if (local_claim_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null)->>'send')::boolean is not true then raise exception 'Atomic claim rejected';end if;
 select id into receipt_id from provider_calls where pipeline_job_id=j and phase='matching';
 if receipt_id is null or (select state from provider_calls where id=receipt_id)<>'sending' then raise exception 'Atomic claim did not journal sending';end if;
 if local_claim_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not null then raise exception 'Uncertain atomic claim repeated';end if;
 update provider_calls set state='retry' where id=receipt_id;
 if (local_claim_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null)->>'send')::boolean is not true then raise exception 'Atomic retry rejected';end if;
 if (select attempts from provider_calls where id=receipt_id)<>2 then raise exception 'Atomic retry skipped journal';end if;
 delete from provider_calls where id=receipt_id;
 delete from local_matching_requests where job_id=j;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not true then raise exception 'Valid request was not registered';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not true then raise exception 'Identical request retry rejected';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('c',64),repeat('b',64),null) is not false then raise exception 'Changed wire registered';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('c',64),null) is not false then raise exception 'Changed transformer registered';end if;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'matching','prepared-json-v1:'||repeat('a',64),'received','{"synthetic":true}') returning id into receipt_id;
 update provider_calls set state='retry',attempts=1 where id=receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not true then raise exception 'Retry attempt 1 rejected';end if;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Unreceived retry accepted for commit';end if;
 if local_register_matching_request(j,jsonb_set(input_,'{source,title}','"changed"'),'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Retry with changed input accepted';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('c',64),repeat('b',64),null) is not false then raise exception 'Retry with changed wire accepted';end if;
 if (claim_provider_call(j,'matching','prepared-json-v1:'||repeat('a',64))->>'send')::boolean is not true then raise exception 'Journal did not claim verified retry';end if;
 if (select attempts from provider_calls where id=receipt_id)<>2 then raise exception 'Journal attempt count was not preserved';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'In-flight retry treated as safe';end if;
 update provider_calls set state='retry' where id=receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not true then raise exception 'Retry attempt 2 rejected';end if;
 if (claim_provider_call(j,'matching','prepared-json-v1:'||repeat('a',64))->>'send')::boolean is not true then raise exception 'Journal did not claim second retry';end if;
 if (select attempts from provider_calls where id=receipt_id)<>3 then raise exception 'Journal attempt ceiling not reached';end if;
 update provider_calls set state='retry' where id=receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Exhausted retry accepted';end if;
 update provider_calls set state='rejected',attempts=1 where id=receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Rejected call accepted';end if;
 update provider_calls set state='sending' where id=receipt_id;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Uncertain request retried';end if;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Uncertain receipt accepted';end if;
 update provider_calls set state='received' where id=receipt_id;
 insert into matching_candidates(pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,rank,score,rationale,engine,engine_version)
 values(j,'official',v,'1','Synthetic',1,0.5,'old','old','old');
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Commit overwrote concurrent candidates';end if;
 if local_register_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not false then raise exception 'Existing intent retried despite new candidate';end if;
 delete from matching_candidates where pipeline_job_id=j;
 update app_settings set enabled=false where key='processing_enabled';
 if local_claim_matching_request(j,input_,'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null) is not null then raise exception 'Paused system returned saved receipt';end if;
 update app_settings set enabled=true where key='processing_enabled';
 if local_commit_matching(j,input_,payload,jsonb_set(receipts,'{0,response,synthetic}','false')) is not false then raise exception 'Changed receipt accepted';end if;
 if local_commit_matching(j,input_,jsonb_set(payload,'{transform_hash}',to_jsonb(repeat('c',64))),receipts) is not false then raise exception 'Changed transformer accepted';end if;
 if local_register_matching_request(j,input_,'positive-audit-v4','prepared-json-v1:'||repeat('d',64),repeat('b',64),'{"synthetic":false}') is not false then raise exception 'Changed audit parent registered';end if;
 if local_register_matching_request(j,input_,'positive-audit-v4','prepared-json-v1:'||repeat('d',64),repeat('b',64),'{"synthetic":true}') is not true then raise exception 'Audit parent not registered';end if;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Open audit intent ignored';end if;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'positive-audit-v4','prepared-json-v1:'||repeat('d',64),'received','{"audit":true}');
 bad:=receipts || jsonb_build_array(jsonb_build_object('phase','positive-audit-v4','wire_hash','prepared-json-v1:'||repeat('d',64),'response',jsonb_build_object('audit',true)));
 update local_matching_requests set parent_response_hash=repeat('e',64) where job_id=j and phase='positive-audit-v4';
 if local_commit_matching(j,input_,jsonb_set(payload,'{result,classification}','"in_portfolio"'),bad) is not false then raise exception 'Changed audit lineage accepted';end if;
 update local_matching_requests set parent_response_hash=encode(extensions.digest('{"synthetic":true}'::jsonb::text,'sha256'),'hex') where job_id=j and phase='positive-audit-v4';
 update provider_calls set state='retry',attempts=1 where pipeline_job_id=j and phase='positive-audit-v4';
 if local_register_matching_request(j,input_,'positive-audit-v4','prepared-json-v1:'||repeat('d',64),repeat('b',64),'{"synthetic":true}') is not true then raise exception 'Audit retry rejected';end if;
 if local_register_matching_request(j,input_,'positive-audit-v4','prepared-json-v1:'||repeat('d',64),repeat('b',64),'{"synthetic":false}') is not false then raise exception 'Audit retry accepted changed parent';end if;
 if local_commit_matching(j,input_,payload,bad) is not false then raise exception 'Unreceived audit accepted';end if;
 update provider_calls set state='received' where pipeline_job_id=j and phase='positive-audit-v4';
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Omitted audit receipt accepted';end if;
 delete from provider_calls where pipeline_job_id=j and phase='positive-audit-v4';
 delete from local_matching_requests where job_id=j and phase='positive-audit-v4';
 if local_commit_matching(j,input_,jsonb_set(payload,'{evidence,0,content}','"wrong"'),receipts) is not false then raise exception 'Altered evidence accepted';end if;
 if local_commit_matching(j,input_,jsonb_set(payload,'{result,classification}','"in_portfolio"'),receipts) is not false then raise exception 'Positive result without audit accepted';end if;
 bad:=jsonb_set(payload,'{result}',result_-'explanation');
 begin perform local_commit_matching(j,input_,bad,receipts);raise exception 'TEST: invalid analysis persisted';exception when not_null_violation then null;end;
 if exists(select 1 from record_enrichments where source_record_id=sid) or exists(select 1 from analysis_results where pipeline_job_id=j) or exists(select 1 from local_matching_commits where job_id=j) then raise exception 'Failed analysis left partial data';end if;
 ok:=local_commit_matching(j,input_,payload,receipts);
 if ok is not true or not exists(select 1 from analysis_results where pipeline_job_id=j) or not exists(select 1 from record_enrichments where source_record_id=sid) then raise exception 'Atomic commit failed';end if;
 if local_commit_matching(j,input_,payload,receipts) is not true then raise exception 'Exact retry rejected';end if;
 if (select count(*) from analysis_results where pipeline_job_id=j)<>1 or (select count(*) from local_matching_commits where job_id=j)<>1 then raise exception 'Retry duplicated records';end if;
 update provider_calls set response='{"synthetic":false}' where id=receipt_id;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Retry accepted changed receipt';end if;
 update provider_calls set response='{"synthetic":true}' where id=receipt_id;
 if local_commit_matching(j,input_,jsonb_set(payload,'{result,explanation}','"other"'),receipts) is not false then raise exception 'Divergent retry accepted';end if;
 update record_enrichments set summary='tampered' where source_record_id=sid;
 if local_commit_matching(j,input_,payload,receipts) is not false then raise exception 'Changed persisted result accepted';end if;
 if has_table_privilege('service_role','public.local_matching_requests','select') or has_table_privilege('service_role','public.local_matching_requests','insert') then raise exception 'Experimental request table accessible';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='local_matching_requests' and column_name in ('response','request','content','api_key','text')) then raise exception 'Request table contains raw content';end if;
 if has_function_privilege('service_role','public.local_claim_matching_request(uuid,jsonb,text,text,text,jsonb)','execute') then raise exception 'Experimental claim callable';end if;
 if has_function_privilege('service_role','public.local_register_matching_request(uuid,jsonb,text,text,text,jsonb)','execute') then raise exception 'Experimental registration callable';end if;
 if has_function_privilege('service_role','public.local_commit_matching(uuid,jsonb,jsonb,jsonb)','execute') then raise exception 'Experimental commit callable';end if;
end $$;
