do $$
declare sid uuid:=gen_random_uuid();run uuid;job uuid;v text;code text;doc uuid;uid uuid;event uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();payload jsonb;unit jsonb;bundle jsonb;sha text:=repeat('a',64);path text;hash text;revision text;prior_review uuid;op uuid:=gen_random_uuid();evidence text:='La Fundació de prova rep mil euros per prestar un servei social a persones grans al municipi de Vic durant 2025.';
begin
 if conveni_scope_reason('Conveni de col·laboració interadministrativa entre A i B','{}')<>'interadministrative_agreement' then raise exception 'TEST: interadministrative title not screened';end if;
 if conveni_scope_reason('Conveni entre A i B en desenvolupament del conveni interadministratiu anterior','{}') is not null then raise exception 'TEST: incidental title screened';end if;
 if conveni_public_amount('{"Total aportacions previstes Generalitat":"1.234,56 €","Total aportacions previstes ens locals":"0"}')<>1234.56 then raise exception 'TEST: locale amount mismatch';end if;
 if conveni_public_amount('{"Total aportacions previstes Generalitat":null,"Total aportacions previstes ens locals":0}') is not null then raise exception 'TEST: missing became zero';end if;
 if conveni_scope_reason('Segona Addenda al Conveni','{}')<>'excluded_amendment' then raise exception 'TEST: amendment not excluded';end if;
 payload:='{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Total aportacions previstes altres Organismes":1000,"Sumatori aportacions totals previstes":2000,"Data signatura":"2025-01-01"}'::jsonb;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni amb Fundació de prova',2000,payload);
 hash:=conveni_source_hash(sid);
 perform migrate_conveni_amount(sid,op,hash,2000);
 if (select amount from source_records where id=sid)<>1000 then raise exception 'TEST: private funding included';end if;
 perform migrate_conveni_amount(sid,op,hash,2000);
 perform revert_conveni_amount(op);
 if (select amount from source_records where id=sid)<>2000 then raise exception 'TEST: amount reversal failed';end if;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into job;
 select id into v from catalog_versions where active and validated limit 1;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 if screen_conveni(job) then raise exception 'TEST: private case screened';end if;
 doc:=gen_random_uuid();path:='cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(doc,sid,'https://example.invalid/'||doc,doc::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||evidence,path,sha,1000,false);
 insert into storage.objects(bucket_id,name) values('cloud-documents',path);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=doc;
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',100000,'amount_state','conditional','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','in_portfolio','service_code',code,'population','Gent gran','description','Servei social','explanation','Servei social acreditat amb proposta revisable','reason',null,'blockers','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('document_id',doc,'page',1,'quote',evidence)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',true,'coverage_complete',true,'unallocated_cents',0,'summary','Anàlisi de conveni sintètic de prova');
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),hash);
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),hash);
 if (select count(*) from record_units where source_record_id=sid)<>1 then raise exception 'TEST: duplicate units';end if;
 select unit_id into uid from conveni_unit_proposals where job_id=job;
 begin
  perform review_conveni_unit(sid,gen_random_uuid(),uid,gen_random_uuid(),null,'select',code,'Aprovació obsoleta',true);raise exception 'TEST: stale approved';
 exception when no_data_found or sqlstate 'PT409' then null;end;
 begin
  perform review_conveni_unit(sid,job,uid,event,null,'select',code,'Aprovació sense còpia',true);raise exception 'TEST: unarchived approved';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 insert into storage.objects(bucket_id,name) values('cloud-documents','cases/'||sid||'/items/'||uid||'/documents/'||doc||'/'||sha||'.pdf');
 begin
  perform review_conveni_unit(sid,job,uid,event,null,'select',code,'No s’ha confirmat la naturalesa social');raise exception 'TEST: positive without semantic confirmation';
 exception when raise_exception then if sqlerrm not like 'Cal confirmar la naturalesa social%' then raise;end if;end;
 begin
  perform review_conveni_unit(sid,job,uid,gen_random_uuid(),null,'outside',null,'No s’ha confirmat la naturalesa social');raise exception 'TEST: outside without semantic confirmation';
 exception when raise_exception then if sqlerrm not like 'Cal confirmar la naturalesa social%' then raise;end if;end;
 perform review_conveni_unit(sid,job,uid,event,null,'select',code,'Aprovació amb evidència revisada',true);
 perform review_conveni_unit(sid,job,uid,event,null,'select',code,'Aprovació amb evidència revisada',true);
 if (select count(*) from service_provisions where source_record_id=sid and superseded_at is null)<>1 then raise exception 'TEST: missing or duplicate provision';end if;
 if (select amount from service_provisions where unit_id=uid)<>1000 then raise exception 'TEST: aggregate imported amount used';end if;
 if not (select (snapshot->'semantic_confirmation'->>'confirmed')::boolean from conveni_review_events where id=event) then raise exception 'TEST: semantic attestation missing in audit';end if;
 if (select count(*) from conveni_review_events where unit_id=uid)<>1 then raise exception 'TEST: review not idempotent';end if;
 if not exists(select 1 from conveni_reviewed_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: reviewed amount not exportable';end if;
 begin
  perform review_conveni_unit(sid,job,uid,gen_random_uuid(),null,'reject',null,'Revisió concurrent');raise exception 'TEST: concurrent accepted';
 exception when sqlstate 'PT409' then null;end;
 update source_documents set storage_sha256=repeat('b',64) where id=doc;
 if exists(select 1 from conveni_reviewed_provisions where unit_id=uid) then raise exception 'TEST: stale evidence exported';end if;
 update source_documents set storage_sha256=sha where id=doc;
 perform review_conveni_unit(sid,job,uid,event2,event,'outside',null,'Servei social fora de la cartera',true);
 if exists(select 1 from service_provisions where unit_id=uid and superseded_at is null) then raise exception 'TEST: outside still counted';end if;
 -- A new analysis proposes changes without silently overwriting the reviewed unit.
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '1 second') returning id into job;
 unit:=jsonb_set(unit,'{joint}','true');unit:=jsonb_set(unit,'{blockers}','["joint"]');bundle:=jsonb_set(bundle,'{units}',jsonb_build_array(unit));
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),hash);
 begin
  perform review_conveni_unit(sid,job,uid,gen_random_uuid(),event2,'select',code,'No es pot aprovar l’import conjunt',true);raise exception 'TEST: joint amount approved';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 -- A prior human decision receives an exclusion proposal, never an automatic overwrite.
 update source_records set title='Addenda al conveni sintètic' where id=sid;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '2 seconds') returning id into job;
 perform screen_conveni(job);
 if (select automatic from conveni_analyses where job_id=job) then raise exception 'TEST: human decision overwritten automatically';end if;
 select id into prior_review from review_decisions where source_record_id=sid order by created_at desc,id desc limit 1;
 begin perform confirm_conveni_exclusion(sid,job,gen_random_uuid(),null,'Confirmació concurrent no vàlida');raise exception 'TEST: stale exclusion review accepted';exception when sqlstate 'PT409' then null;end;
 perform confirm_conveni_exclusion(sid,job,gen_random_uuid(),prior_review,'Exclusió d’abast confirmada amb revisió humana');
 if (select status from pipeline_jobs where id=job)<>'rejected' then raise exception 'TEST: exclusion not confirmed';end if;
 -- Automatic exclusions need no document and reopening preserves their original audit.
 sid:=gen_random_uuid();insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Segona Addenda al Conveni','{}');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into job;
 if not screen_conveni(job) or not screen_conveni(job) then raise exception 'TEST: exclusion not idempotent';end if;
 if (select processing_status from source_records where id=sid)<>'rebutjat' then raise exception 'TEST: exclusion not closed';end if;
 perform reopen_conveni(sid,job,gen_random_uuid(),'El títol requereix revisar el contingut');
 if (select processing_status from source_records where id=sid)<>'sense_evidencia' then raise exception 'TEST: reopen failed';end if;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '1 second') returning id into job;
 if screen_conveni(job) then raise exception 'TEST: reopened source excluded again';end if;
end $$;
