-- Run only in an isolated local test database with the catalog installed.
begin;
do $$ begin if current_database() not like 'cartera_leaf_test_%' then raise exception 'Isolated test database required'; end if; end $$;
insert into pipeline_runs(id,status,stage,parameters) values('10000000-0000-4000-8000-000000000001','matching','matching','{"auto_process":true}');
insert into source_records(id,source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount) values
('20000000-0000-4000-8000-000000000001','contractacions','TEST-SOCIAL-001','contracte','Mostra fictícia: atenció social bàsica','','',0,'',1000),
('20000000-0000-4000-8000-000000000002','contractacions','TEST-ANIMALS-002','contracte','Mostra fictícia: acollida de gossos','','',0,'',2000),
('20000000-0000-4000-8000-000000000003','contractacions','TEST-OUTSIDE-003','contracte','Mostra fictícia: servei social fora de cartera','','',0,'',3000);
insert into pipeline_jobs(id,run_id,source_record_id,status,preparation_status) select ('30000000-0000-4000-8000-'||right(id::text,12))::uuid,'10000000-0000-4000-8000-000000000001',id,'matching','ready' from source_records where source_record_id like 'TEST-%';
insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','https://example.org/fictional','fixture','publication','fetched');
insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'Mostra fictícia d’atenció social per a persones.','fixture',50);
select persist_analysis('30000000-0000-4000-8000-000000000001','pjc-557820-2164168','{"classification":"in_portfolio","reasons":[],"explanation":"El document fictici acredita el servei social.","service_description":"Atenció social bàsica","target_population":"Persones amb necessitat social"}',
 '[{"code":"1.1.1","score":0.9,"rationale":"Encaix: atenció social. Diferenciació: servei bàsic. Limitació: mostra fictícia.","model":"mock","metadata":{},"evidence_explanation":"Text fictici","evidence":[{"id":"50000000-0000-4000-8000-000000000001"}]}]', '[{"content":"Mostra fictícia d’atenció social per a persones."}]');
select persist_analysis('30000000-0000-4000-8000-000000000002','pjc-557820-2164168','{"classification":"discarded","reasons":["not_social_service"],"explanation":"El registre fictici és un servei per a animals.","service_description":"Acollida de gossos","target_population":"Animals"}','[]','[{"content":"Mostra fictícia: acollida de gossos."}]');
select persist_analysis('30000000-0000-4000-8000-000000000003','pjc-557820-2164168','{"classification":"out_of_portfolio","reasons":[],"explanation":"Mostra fictícia de servei social sense encaix en la cartera.","service_description":"Servei social de prova","target_population":"Persones vulnerables"}','[]','[{"content":"Mostra fictícia per a revisió."}]');
do $$ declare failed boolean:=false; before_count int; cid uuid; begin
 select count(*) into before_count from review_decisions;
 begin perform review_analysis('20000000-0000-4000-8000-000000000001','select',null,'1.1.2','Intent de seleccionar pare'); exception when others then failed:=true; end;
 if not failed or (select count(*) from review_decisions)<>before_count then raise exception 'Parent accepted or partial review persisted'; end if;
 select id into cid from matching_candidates where pipeline_job_id='30000000-0000-4000-8000-000000000001';
 perform review_analysis('20000000-0000-4000-8000-000000000001','select',cid,null,null);
 if not exists(select 1 from service_provisions where source_record_id='20000000-0000-4000-8000-000000000001' and service_code='1.1.1') then raise exception 'Missing approved provision'; end if;
 perform review_analysis('20000000-0000-4000-8000-000000000002','reject',null,null,'No és un servei destinat a persones');
 perform review_analysis('20000000-0000-4000-8000-000000000003','outside',null,null,'Servei i destinataris acreditats; sense encaix en aquesta versió');
 if (select count(*) from service_provisions where source_record_id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'))<>0 then raise exception 'Fictitious provision created'; end if;
 perform review_analysis('20000000-0000-4000-8000-000000000001','insufficient',null,null,'Rectificació: cal informació addicional');
 if exists(select 1 from service_provisions where source_record_id='20000000-0000-4000-8000-000000000001') then raise exception 'Old provision retained'; end if;
 if (select count(*) from review_decisions where source_record_id='20000000-0000-4000-8000-000000000001')<>2 then raise exception 'History lost'; end if;
end $$;
insert into source_records(id,source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence) values
('20000000-0000-4000-8000-000000000004','contractacions','TEST-QUOTA-004','contracte','Mostra quota','','',0,''),
('20000000-0000-4000-8000-000000000005','contractacions','TEST-INVALID-005','contracte','Mostra validació','','',0,'');
insert into pipeline_jobs(id,run_id,source_record_id,status,preparation_status,error_kind) values
('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','error','ready','quota'),
('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','error','ready','validation');
update pipeline_runs set status='paused',pause_kind='quota',pause_reason='Test' where id='10000000-0000-4000-8000-000000000001';
select resume_analysis_run('10000000-0000-4000-8000-000000000001');
do $$ begin
 if (select count(*) from analysis_results where source_record_id::text like '20000000-%')<>3 then raise exception 'Results lost on resume'; end if;
 if exists(select 1 from pipeline_jobs where run_id='10000000-0000-4000-8000-000000000001' and status='ready' and id<>'30000000-0000-4000-8000-000000000004') then raise exception 'Completed or invalid jobs reset'; end if;
 if not exists(select 1 from pipeline_jobs where id='30000000-0000-4000-8000-000000000004' and status='ready') then raise exception 'Quota job not resumed'; end if;
end $$;
rollback;
