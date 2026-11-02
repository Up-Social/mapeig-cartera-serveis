do $$
declare sid uuid:=gen_random_uuid();run uuid;old_run uuid;job uuid;new_job uuid;entity uuid:=gen_random_uuid();generic_sid uuid:=gen_random_uuid();generic_provision uuid;reses_relation uuid;orphan_relation uuid;v text;code text;doc uuid:=gen_random_uuid();annex uuid:=gen_random_uuid();uid uuid;event1 uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();unit jsonb;bundle jsonb;sha text:=repeat('a',64);path text;hash text;revision text;annex_revision text;
 evidence text:='La Fundació de prova amb NIF G12345678 rep mil euros per prestar un servei social a persones grans al municipi de Vic durant 2025.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni de prova','{"Total aportacions previstes Generalitat":1000,"Total aportacions previstes ens locals":0}');
 insert into entities(id,legal_name,normalized_name,nif) values(entity,'Fundació de prova','fundacio de prova','G12345678');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into run;
 old_run:=run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into job;
 select id into strict v from catalog_versions where active and validated;
 select service_code into strict code from eligible_official_services where version_id=v limit 1;
 path:='cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(doc,sid,'https://example.invalid/'||doc,doc::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||evidence,path,sha,1000,false);
 insert into storage.objects(bucket_id,name) values('cloud-documents',path);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=doc;
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',100000,'amount_state','conditional','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','in_portfolio','service_code',code,'population','Gent gran','description','Servei social','explanation','Servei social acreditat','reason',null,'blockers','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('document_id',doc,'page',1,'quote',evidence)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',true,'coverage_complete',true,'unallocated_cents',0,'summary','Anàlisi de prova');
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),hash);
 select unit_id into strict uid from conveni_unit_proposals where job_id=job;
 insert into storage.objects(bucket_id,name) values('cloud-documents','cases/'||sid||'/items/'||uid||'/documents/'||doc||'/'||sha||'.pdf');
 perform review_conveni_unit(sid,job,uid,event1,null,'select',code,'Primera revisió documentada',true);
 if not exists(select 1 from service_provisions p where p.unit_id=uid and public.provision_is_current(p)) then raise exception 'TEST: approved provision visibility';end if;
 if (select provision_count from pipeline_run_summaries where id=old_run)<>1 then raise exception 'TEST: reviewed Conveni missing from batch count';end if;
 if not exists(select 1 from entity_catalog_relations rel where rel.entity_id=entity and rel.source_type='provision' and public.entity_relation_is_current(rel)) then raise exception 'TEST: approved provision relation visibility';end if;
 insert into entity_catalog_relations(entity_id,service_code,catalog_version_id,relation_type,source_type,source_reference) values(entity,code,v,'auxiliary','reses','RESES-SINTETIC') returning id into reses_relation;
 insert into entity_catalog_relations(entity_id,service_code,catalog_version_id,relation_type,source_type,source_reference) values(entity,code,v,'confirmed','provision','not-a-uuid') returning id into orphan_relation;
 if exists(select 1 from entity_catalog_relations rel where rel.id=orphan_relation and public.entity_relation_is_current(rel)) then raise exception 'TEST: orphan relation visible';end if;
 if not exists(select 1 from entity_catalog_relations rel where rel.id=reses_relation and public.entity_relation_is_current(rel)) then raise exception 'TEST: independent RESES hidden';end if;

 if not exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: initial approval missing';end if;
 path:='cases/'||sid||'/documents/'||annex||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(annex,sid,'https://example.invalid/'||annex,annex::text,'annex','fetched','application/pdf','Annex addicional del conveni',path,sha,500,false);
 if exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: new annex did not invalidate export';end if;
 if (select provision_count from pipeline_run_summaries where id=old_run)<>0 then raise exception 'TEST: stale Conveni counted after annex';end if;
 if not exists(select 1 from conveni_review_events where id=event1) then raise exception 'TEST: prior decision lost';end if;
 if exists(select 1 from service_provisions p where p.unit_id=uid and public.provision_is_current(p)) then raise exception 'TEST: stale provision visible';end if;
 if exists(select 1 from entity_catalog_relations rel where rel.entity_id=entity and rel.source_type='provision' and public.entity_relation_is_current(rel)) then raise exception 'TEST: stale relation visible';end if;
 if not exists(select 1 from entity_catalog_relations rel where rel.id=reses_relation and public.entity_relation_is_current(rel)) then raise exception 'TEST: stale conveni hid RESES';end if;

 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into annex_revision from source_documents where id=annex;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '1 second') returning id into new_job;
 perform persist_conveni(new_job,v,bundle,jsonb_build_object(doc::text,revision,annex::text,annex_revision),hash);
 if exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: reanalysis alone restored export';end if;
 perform review_conveni_unit(sid,new_job,uid,event2,event1,'select',code,'Revisió amb annex comprovat',true);
 if not exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: current reanalysis and review did not restore export';end if;
 if (select count(*) from conveni_review_events where id in (event1,event2))<>2 then raise exception 'TEST: review history not preserved';end if;
 if not exists(select 1 from service_provisions p where p.unit_id=uid and public.provision_is_current(p)) then raise exception 'TEST: renewed provision hidden';end if;
 if (select provision_count from pipeline_run_summaries where id=run)<>1 or (select provision_count from pipeline_run_summaries where id=old_run)<>1 then raise exception 'TEST: current reviewed provision differs from batch export';end if;
 if not exists(select 1 from entity_catalog_relations rel where rel.entity_id=entity and rel.source_type='provision' and public.entity_relation_is_current(rel)) then raise exception 'TEST: renewed relation hidden';end if;
 update entity_catalog_relations set retired_at=now() where id=reses_relation;
 if exists(select 1 from entity_catalog_relations rel where rel.id=reses_relation and public.entity_relation_is_current(rel)) then raise exception 'TEST: retired RESES visible';end if;
 update entity_catalog_relations set retired_at=null where id=reses_relation;

 update source_documents set document_type='other' where id=annex;
 if exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: changed document type did not invalidate export';end if;
 update source_documents set document_type='annex',extraction_partial=true where id=annex;
 if exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: partial annex did not invalidate export';end if;

 -- A non-Conveni legacy provision retains normal visibility and respects
 -- supersession, without needing any Conveni analysis.
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(generic_sid,'convenis',generic_sid::text,'Contracte','Provisió independent','{}');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,generic_sid,'ready');
 insert into service_provisions(source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id)
 values(generic_sid,generic_sid::text,'Contracte','Prova',code,v) returning id into generic_provision;
 if not exists(select 1 from service_provisions p where p.id=generic_provision and public.provision_is_current(p)) then raise exception 'TEST: non-conveni provision hidden';end if;
 if (select provision_count from pipeline_run_summaries where id=run)<>1 then raise exception 'TEST: non-Conveni provision missing from count';end if;
 update service_provisions set superseded_at=now() where id=generic_provision;
 if exists(select 1 from service_provisions p where p.id=generic_provision and public.provision_is_current(p)) then raise exception 'TEST: superseded non-conveni provision visible';end if;
 if (select provision_count from pipeline_run_summaries where id=run)<>0 then raise exception 'TEST: superseded provision counted';end if;
 if not exists(select 1 from service_provisions where id=generic_provision and superseded_at is not null) then raise exception 'TEST: superseded provision lost from history';end if;
 if has_function_privilege('anon','public.provision_is_current(public.service_provisions)','execute') or has_function_privilege('authenticated','public.entity_relation_is_current(public.entity_catalog_relations)','execute') then raise exception 'TEST: public execution';end if;
 if not has_function_privilege('service_role','public.provision_is_current(public.service_provisions)','execute') or not has_function_privilege('service_role','public.entity_relation_is_current(public.entity_catalog_relations)','execute') then raise exception 'TEST: service execution missing';end if;
end $$;
