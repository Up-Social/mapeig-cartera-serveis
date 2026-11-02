do $$
declare sid uuid:=gen_random_uuid();run uuid;job uuid;v text;code text;doc uuid:=gen_random_uuid();uid uuid;sibling uuid:=gen_random_uuid();field_ text;
 prep uuid:=gen_random_uuid();parent_ uuid:=gen_random_uuid();successor_ uuid:=gen_random_uuid();proposal_hash text;analysis_hash text;source_hash text;revisions jsonb;monetary jsonb;identity_ jsonb;role_period jsonb;confirmations jsonb;unit jsonb;bundle jsonb;bad jsonb;other_unit jsonb;sha text:=repeat('a',64);path text;revision text;
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

 update source_documents set extraction_method='pdftotext',extracted_text=extracted_text||chr(10)||'Aportació prevista de 1.000,00 euros per a l’any 2025.' where id=doc;
 select encode(extensions.digest(data::text,'sha256'),'hex') into proposal_hash from conveni_unit_proposals where job_id=job and unit_id=uid;
 select encode(extensions.digest(a.payload::text,'sha256'),'hex'),a.document_revisions,a.source_hash into analysis_hash,revisions,source_hash from conveni_analyses a where a.job_id=job;
 monetary:=jsonb_build_object('document_id',doc,'page',1,'quote','Aportació prevista de 1.000,00 euros per a l’any 2025.');
 identity_:=jsonb_build_object('document_id',doc,'page',1,'quote',evidence);role_period:=identity_;
 confirmations:='{"public_contribution":true,"recipient_role":true,"period":true,"not_shared_or_maximum":true,"conditions_preserved":true,"not_payment":true}';
 if has_function_privilege('service_role','public.prepare_conveni_unit_economic_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,bigint,text,jsonb,jsonb,jsonb,jsonb,text)','EXECUTE') then raise exception 'TEST: draft RPC is enabled';end if;
 if has_table_privilege('service_role','public.conveni_unit_economic_draft_events','SELECT') or has_table_privilege('service_role','public.conveni_unit_economic_draft_events','INSERT') or has_table_privilege('service_role','public.conveni_unit_economic_draft_events','UPDATE') or has_table_privilege('service_role','public.conveni_unit_economic_draft_events','DELETE') then raise exception 'TEST: draft table is exposed';end if;
 perform set_config('role','service_role',true);
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'No ha d’estar disponible');
  raise exception 'TEST: service role could execute draft';
 exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 -- An explicitly linked successor with an earlier wall clock is still newer.
 insert into conveni_review_events(id,source_record_id,job_id,unit_id,outcome,reason,actor,snapshot,created_at) values
 (parent_,sid,job,uid,'insufficient','Antecedent sintètic','fixture','{}',clock_timestamp()+interval '2 minutes'),
 (successor_,sid,job,uid,'insufficient','Successor sintètic','fixture',jsonb_build_object('replay_previous',parent_),clock_timestamp());
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,parent_,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Successor amb rellotge anterior');
  raise exception 'TEST: successor with earlier clock ignored';
 exception when sqlstate 'PT409' then if sqlerrm<>'Revisió posterior detectada' then raise;end if;end;
 delete from conveni_review_events where id=successor_;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,parent_,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Antecedent sense linatge verificat');
  raise exception 'TEST: historical review chain accepted';
 exception when sqlstate 'PT409' then if sqlerrm not like 'Les revisions anteriors%' then raise;end if;end;
 delete from conveni_review_events where id=parent_;
 other_unit:=jsonb_set(jsonb_set(unit,'{classification}',to_jsonb('out_of_portfolio'::text)),'{service_code}','null');
 update conveni_unit_proposals set data=other_unit where job_id=job and unit_id=uid;
 update conveni_analyses set payload=jsonb_set(bundle,'{units}',jsonb_build_array(other_unit)) where job_id=job;
 select encode(extensions.digest(data::text,'sha256'),'hex') into proposal_hash from conveni_unit_proposals where job_id=job and unit_id=uid;
 select encode(extensions.digest(payload::text,'sha256'),'hex') into analysis_hash from conveni_analyses where job_id=job;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Fora de cartera no és selecció');
  raise exception 'TEST: outside proposal accepted for selection';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update conveni_unit_proposals set data=unit where job_id=job and unit_id=uid;
 update conveni_analyses set payload=bundle where job_id=job;
 select encode(extensions.digest(data::text,'sha256'),'hex') into proposal_hash from conveni_unit_proposals where job_id=job and unit_id=uid;
 select encode(extensions.digest(payload::text,'sha256'),'hex') into analysis_hash from conveni_analyses where job_id=job;
 -- A freshly hashed proposal cannot differ silently from the saved analysis.
 update conveni_unit_proposals set data=jsonb_set(unit,'{period}',to_jsonb('2026'::text)) where job_id=job and unit_id=uid;
 select encode(extensions.digest(data::text,'sha256'),'hex') into proposal_hash from conveni_unit_proposals where job_id=job and unit_id=uid;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Proposta divergente de l’anàlisi');
  raise exception 'TEST: fresh divergent proposal accepted';
 exception when sqlstate 'PT409' then if sqlerrm not like 'Unitat o proposta diferents%' then raise;end if;end;
 update conveni_unit_proposals set data=unit where job_id=job and unit_id=uid;
 select encode(extensions.digest(data::text,'sha256'),'hex') into proposal_hash from conveni_unit_proposals where job_id=job and unit_id=uid;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations-'period','Falta confirmació del període');
  raise exception 'TEST: missing confirmation accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',jsonb_set(monetary,'{page}','2'),identity_,role_period,confirmations,'Cita en pàgina equivocada');
  raise exception 'TEST: wrong page accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,gen_random_uuid(),null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'100,00',monetary,identity_,role_period,confirmations,'Import literal incorrecte');
  raise exception 'TEST: wrong amount accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
 perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
 if (select count(*) from conveni_unit_economic_draft_events where unit_id=uid)<>1 then raise exception 'TEST: draft replay duplicated';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) or exists(select 1 from conveni_review_events where source_record_id=sid) then raise exception 'TEST: draft created decision or provision';end if;
 begin
  update record_units set unit_key='conveni:changed' where id=uid;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed unit identity accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update source_records set source_file='different.xlsx' where id=sid;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed source provenance accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update source_records set source_dataset='contractacions' where id=sid;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed source dataset accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update source_records set source_record_id=source_record_id||'-other' where id=sid;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed source ID accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  update source_documents set extraction_coverage='{"complete":false}' where id=doc;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: explicit incomplete coverage accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'Cobertura documental canviada' then raise;end if;end;
 begin
  update source_documents set extraction_method='pdf-text' where id=doc;
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed extraction method accepted';
 exception when sqlstate 'PT409' then null;end;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Contingut diferent del replay');
  raise exception 'TEST: changed replay accepted';
 exception when sqlstate 'PT409' then null;end;
 update source_documents set url=url||'?changed' where id=doc;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed URL accepted';
 exception when sqlstate 'PT409' then null;end;
 update source_documents set url=replace(url,'?changed','') where id=doc;
 update pipeline_jobs set created_at=created_at+interval '1 second' where id=job;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed job context accepted';
 exception when sqlstate 'PT409' then null;end;
 update pipeline_jobs set created_at=created_at-interval '1 second' where id=job;
 update source_documents set extracted_text=extracted_text||chr(10)||'Canvi independent de les cites.' where id=doc;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed extraction text accepted';
 exception when sqlstate 'PT409' then null;end;
 update source_documents set extracted_text=replace(extracted_text,chr(10)||'Canvi independent de les cites.','') where id=doc;
 update conveni_unit_proposals set data=jsonb_set(data,'{period}',to_jsonb('2026'::text)) where job_id=job and unit_id=uid;
 begin
  perform prepare_conveni_unit_economic_draft(sid,job,uid,prep,null,null,source_hash,proposal_hash,analysis_hash,revisions,code,100000,'1.000,00',monetary,identity_,role_period,confirmations,'Atribució documental proposta');
  raise exception 'TEST: changed proposal accepted';
 exception when sqlstate 'PT409' then null;end;
 if (select count(*) from conveni_unit_economic_draft_events where unit_id=uid)<>1 then raise exception 'TEST: stale replay modified drafts';end if;
end $$;
