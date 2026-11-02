do $$
declare sid uuid:=gen_random_uuid();run uuid;job uuid;v text;code text;doc uuid:=gen_random_uuid();uid uuid;sibling uuid:=gen_random_uuid();field_ text;
 event_id uuid;unit jsonb;bundle jsonb;bad jsonb;other_unit jsonb;sha text:=repeat('a',64);path text;revision text;
 evidence text:='La Fundació de prova amb NIF G12345678 rep mil euros per prestar un servei social a persones grans al municipi de Vic durant 2025.';
begin
 if public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":100000},{"amount_cents":null}],"coverage_complete":true,"unallocated_cents":0}',100000) then raise exception 'TEST: null sibling silently ignored';end if;
 if public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":100000},{"amount_cents":0,"concepts":[{}]}],"coverage_complete":true,"unallocated_cents":0}',100000) then raise exception 'TEST: grouped sibling accepted';end if;
 if public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":100000}],"coverage_complete":true,"unallocated_cents":null}',100000) then raise exception 'TEST: unknown remainder accepted';end if;
 if public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":100000},{"amount_cents":-1}],"coverage_complete":true,"unallocated_cents":1}',100000) then raise exception 'TEST: negative accepted';end if;
 if public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":9007199254740991},{"amount_cents":1}],"coverage_complete":true,"unallocated_cents":0}',9007199254740992) then raise exception 'TEST: unsafe overflow accepted';end if;
 if not public.conveni_review_amounts_reconcile('{"units":[{"amount_cents":100000},{"amount_cents":0}],"coverage_complete":true,"unallocated_cents":0}',100000) then raise exception 'TEST: valid zero rejected';end if;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload)
 values(sid,'convenis',sid::text,'Conveni','Conveni amb Fundació de prova',1000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Data signatura":"2025-01-01"}');
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into job;
 select id into strict v from catalog_versions where active and validated limit 1;
 select service_code into strict code from eligible_official_services where version_id=v limit 1;
 path:='cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(doc,sid,'https://example.invalid/'||doc,doc::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||evidence,path,sha,1000,false);
 insert into storage.objects(bucket_id,name) values('cloud-documents',path);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=doc;
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',100000,'amount_state','conditional','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','in_portfolio','service_code',code,'population','Gent gran','description','Servei social','explanation','Servei social acreditat amb proposta revisable','reason',null,'blockers','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('document_id',doc,'page',1,'quote',evidence)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',true,'coverage_complete',true,'unallocated_cents',0,'summary','Anàlisi sintètica');
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
 select unit_id into strict uid from conveni_unit_proposals where job_id=job;
 insert into storage.objects(bucket_id,name) values('cloud-documents','cases/'||sid||'/items/'||uid||'/documents/'||doc||'/'||sha||'.pdf');

 begin
  perform review_conveni_unit(sid,job,uid,gen_random_uuid(),null,'select',code,'Revisió social sense atribució econòmica',true);
  raise exception 'TEST: unsafe select accepted';
 exception when raise_exception then if sqlerrm not like 'Aprovació temporalment desactivada:%' then raise;end if;end;
 if exists(select 1 from service_provisions where source_record_id=sid) or exists(select 1 from conveni_review_events where source_record_id=sid) then raise exception 'TEST: blocked approval left effects';end if;
 event_id:=gen_random_uuid();
 perform review_conveni_unit(sid,job,uid,event_id,null,'outside',null,'Servei social fora de cartera',true);
 perform review_conveni_unit(sid,job,uid,gen_random_uuid(),event_id,'reject',null,'Descart posterior justificat',false);
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: outside or reject created provision';end if;
 if (select count(*) from conveni_review_events where source_record_id=sid)<>2 then raise exception 'TEST: alternate review outcomes missing';end if;
end $$;
