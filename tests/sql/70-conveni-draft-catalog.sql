-- This check is only for the disabled, private preparation RPC. It does not
-- approve a provision or verify physical Storage.
do $$
declare sid uuid:=gen_random_uuid();run uuid;job uuid;v text;code text;other_code text:='fixture-'||gen_random_uuid()::text;doc uuid:=gen_random_uuid();uid uuid;
 prep uuid:=gen_random_uuid();proposal_hash text;analysis_hash text;source_hash text;revisions jsonb;
 monetary jsonb;identity_ jsonb;confirmations jsonb;unit jsonb;bundle jsonb;sha text:=repeat('a',64);revision text;
 evidence text:='La Fundació de prova amb NIF G12345678 rep mil euros per prestar un servei social a persones grans al municipi de Vic durant 2025.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload)
 values(sid,'convenis',sid::text,'Conveni','Conveni amb Fundació de prova',1000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Data signatura":"2025-01-01"}');
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into job;
 select id into strict v from catalog_versions where active and validated limit 1;
 select service_code into strict code from eligible_official_services where version_id=v limit 1;
 -- Add a distinct, unrelated service before preparing: the context used for
 -- selecting the service comprises the complete catalog, not only one row.
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
 values(v,other_code,'Servei sintètic',null,'service','Descripció','Persones','Condicions','Norma','{}');
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial,extraction_method)
 values(doc,sid,'https://example.invalid/'||doc,doc::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||evidence||chr(10)||'Aportació prevista de 1.000,00 euros per a l’any 2025.',
  'cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf',sha,1000,false,'pdftotext');
 insert into storage.objects(bucket_id,name) values('cloud-documents','cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf');
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=doc;
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',100000,'amount_state','conditional','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','in_portfolio','service_code',code,'population','Gent gran','description','Servei social','explanation','Servei social acreditat amb proposta revisable','reason',null,'blockers','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('document_id',doc,'page',1,'quote',evidence)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',true,'coverage_complete',true,'unallocated_cents',0,'summary','Anàlisi sintètica');
 perform persist_conveni(job,v,bundle,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
 select unit_id,encode(extensions.digest(data::text,'sha256'),'hex') into strict uid,proposal_hash from conveni_unit_proposals where job_id=job;
 select encode(extensions.digest(a.payload::text,'sha256'),'hex'),a.document_revisions,a.source_hash into analysis_hash,revisions,source_hash from conveni_analyses a where a.job_id=job;
 monetary:=jsonb_build_object('document_id',doc,'page',1,'quote','Aportació prevista de 1.000,00 euros per a l’any 2025.');
 identity_:=jsonb_build_object('document_id',doc,'page',1,'quote',evidence);
 confirmations:='{"public_contribution":true,"recipient_role":true,"period":true,"not_shared_or_maximum":true,"conditions_preserved":true,"not_payment":true}';
 perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
 perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
 if coalesce((select catalog_snapshot_hash from conveni_unit_economic_draft_events where id=prep),'') !~ '^[0-9a-f]{64}$' then raise exception 'TEST: catalog fingerprint missing';end if;
 -- Same ID/code, materially different meaning: a replay must not succeed.
 begin
  update official_services set description=description||' Canvi semàntic' where version_id=v and service_code=code;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed service accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
  values(v,other_code||'-new','Nova alternativa',null,'service','Descripció','Persones','Condicions','Norma','{}');
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
  raise exception 'TEST: new alternative accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update official_services set description=description||' Canvi d’alternativa' where version_id=v and service_code=other_code;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed alternative accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update catalog_versions set general_context=general_context||' Canvi semàntic' where id=v;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed catalog context accepted';
 exception when sqlstate 'PT409' then null;end;
 -- An old event lacks the new fingerprint and cannot certify a replay.
 update conveni_unit_economic_draft_events set catalog_snapshot_hash=null where id=prep;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,identity_,confirmations,'Atribució documental proposta');
  raise exception 'TEST: historical event without fingerprint accepted';
 exception when sqlstate 'PT409' then null;end;
 if (select count(*) from conveni_unit_economic_draft_events where unit_id=uid)<>1 or exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: replay changed persisted state';end if;
end $$;
