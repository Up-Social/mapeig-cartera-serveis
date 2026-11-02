create function pg_temp.matching_input(p_record uuid,p_version text,p_job uuid) returns jsonb language sql as $$
 select jsonb_build_object('version','local-matching-input-v1','job_id',p_job,'run_id',(select run_id from pipeline_jobs where id=p_job),'source',jsonb_build_object('id',r.id,'financing_type',r.financing_type,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_payload',r.source_payload,'deduplication_key',r.deduplication_key),
 'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'url',d.url,'document_type',d.document_type,'status',d.status,'mime_type',d.mime_type,'text_length',d.text_length,'extraction_method',d.extraction_method,'extraction_coverage',d.extraction_coverage,'quality_flags',d.quality_flags,'extraction_partial',d.extraction_partial,'active_extraction_id',d.active_extraction_id,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'extracted_text_hash',d.extracted_text_hash) order by d.id),'[]'::jsonb) from source_documents d where d.source_record_id=r.id),
 'chunks',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'source_document_id',e.source_document_id,'ordinal',e.ordinal,'content_sha256',encode(extensions.digest(e.content,'sha256'),'hex')) order by d.id,e.ordinal,e.id),'[]'::jsonb) from evidence_chunks e join source_documents d on d.id=e.source_document_id where d.source_record_id=r.id and d.status='fetched' and e.extraction_id=d.active_extraction_id),
 'enrichment',coalesce((select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts) from record_enrichments e where e.source_record_id=r.id),'null'::jsonb),
 'catalog_version',(select to_jsonb(v) from catalog_versions v where id=p_version),'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from official_services s where s.version_id=p_version)) from source_records r where r.id=p_record
$$;
do $$
declare sid uuid:=gen_random_uuid(); rid uuid; jid uuid; newer uuid; jid2 uuid; other uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid(); ver text:='reservation-fixture-'||gen_random_uuid()::text; input_ jsonb;
begin
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values(ver,'https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values(ver,'1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload) values(sid,'contractacions',sid::text,'Synthetic',sid::text,'Entitat prova',123.45,'{"Data concessió":"2025-01-10"}');
 insert into pipeline_runs(status) values('matching') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into jid;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(doc,sid,'https://example.invalid/'||doc,doc::text,'publication','fetched');
 input_:=pg_temp.matching_input(sid,ver,jid);
 if local_reserve_matching_group(jid,input_) is not true or local_reserve_matching_group(jid,input_) is not true then raise exception 'initial reservation/replay rejected';end if;
 if (select count(*) from local_matching_group_reservations where job_id=jid)<>1 then raise exception 'reservation duplicated';end if;
 if local_reserve_matching_group(jid,jsonb_set(input_,'{source,title}','"different"')) is not false then raise exception 'changed manifest accepted';end if;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload) values(other,'contractacions',other::text,'Synthetic',sid::text,'Entitat prova',123.45,'{"Data concessió":"2025-01-10"}');
 if local_reserve_matching_group(jid,input_) is not false then raise exception 'new equivalent ignored';end if;
 delete from source_records where id=other;
 update source_records set title=title||' revised' where id=sid;
 if local_reserve_matching_group(jid,pg_temp.matching_input(sid,ver,jid)) is not false then raise exception 'changed identity re-reserved';end if;
 insert into pipeline_runs(status) values('matching') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(rid,sid,'matching',now()+interval '1 second') returning id into newer;
 if local_reserve_matching_group(newer,pg_temp.matching_input(sid,ver,newer)) is not false then raise exception 'new job bypassed source reservation';end if;
 if (select count(*) from local_matching_group_reservations)<>1 then raise exception 'reservation changed';end if;
 -- A pre-existing matching intent cannot be retroactively attributed.
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(other,'contractacions',other::text,'Synthetic',other::text);
 insert into pipeline_runs(status) values('matching') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,other,'matching') returning id into jid2;
 insert into source_documents(source_record_id,url,url_hash,document_type,status) values(other,'https://example.invalid/'||other,other::text,'publication','fetched');
 insert into local_matching_requests(job_id,phase,input_hash,wire_hash,transform_hash) values(jid2,'matching','local-matching-input-v1:'||repeat('a',64),'prepared-json-v1:'||repeat('b',64),repeat('c',64));
 if local_reserve_matching_group(jid2,pg_temp.matching_input(other,ver,jid2)) is not false then raise exception 'historical intent adopted';end if;
 delete from local_matching_requests where job_id=jid2;
 if has_function_privilege('service_role','public.local_reserve_matching_group(uuid,jsonb)','execute') or has_function_privilege('authenticated','public.local_reserve_matching_group(uuid,jsonb)','execute') or has_function_privilege('anon','public.local_reserve_matching_group(uuid,jsonb)','execute') then raise exception 'reservation function exposed';end if;
 if exists(select 1 from unnest(array['service_role','authenticated','anon']) role_, unnest(array['select','insert','update','delete']) perm_ where has_table_privilege(role_,'public.local_matching_group_reservations',perm_)) then raise exception 'reservation table exposed';end if;
 if not (select relrowsecurity from pg_class where oid='public.local_matching_group_reservations'::regclass) then raise exception 'RLS disabled';end if;
 if exists(select 1 from provider_calls where pipeline_job_id in(jid,newer)) or exists(select 1 from local_matching_requests where job_id in(jid,newer)) then raise exception 'unexpected journal write';end if;
end $$;
