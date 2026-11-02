do $$
declare sid uuid:=gen_random_uuid();run uuid;j uuid;d1 uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();u uuid;v text;code text;
 sha text:=repeat('e',64);path1 text;path2 text;rev text;hash text;group_hash text;analysis_hash text;h1 text;h2 text;
 unit jsonb;bundle jsonb;revisions jsonb;heads jsonb;c1 jsonb;c2 jsonb;ct jsonb;ci jsonb;conf jsonb;receipts jsonb;one_receipt jsonb;
 event1 uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();prep uuid:=gen_random_uuid();ver2 text:=gen_random_uuid()::text;
 q1 text:='El primer servei social està destinat a persones grans durant l’any 2025.';
 q2 text:='El segon concepte del servei es presta al municipi segons l’annex documentat.';
 qt text:='L’aportació pública total per al servei durant 2025 és de 20.000,00 € segons el conveni.';
 qi text:='La Fundació de prova, amb NIF G12345678, consta com a entitat receptora.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":20000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 path1:='cases/'||sid||'/documents/'||d1||'/'||sha||'.pdf';path2:='cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial) values
 (d1,sid,'https://example.invalid/'||d1,d1::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||q1||chr(10)||qt||chr(10)||qi,path1,sha,400,false),
 (d2,sid,'https://example.invalid/'||d2,d2::text,'annex','fetched','application/pdf','## Pàgina 1'||chr(10)||q2,path2,sha,400,false);
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',path1,gen_random_uuid()::text),('cloud-documents',path2,ver2);
 select jsonb_object_agg(id::text,storage_sha256||':'||coalesce(active_extraction_id::text,'')) into revisions from source_documents where id in (d1,d2);
 c1:=jsonb_build_object('document_id',d1,'page',1,'quote',q1);c2:=jsonb_build_object('document_id',d2,'page',1,'quote',q2);
 ct:=jsonb_build_object('document_id',d1,'page',1,'quote',qt);ci:=jsonb_build_object('document_id',d1,'page',1,'quote',qi);
 conf:='{"public_total":true,"recipient_period":true,"covers_concepts":true,"same_social_service":true,"recipient_role":true,"conditions_preserved":true,"not_a_sum_or_shared":true}';
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',null,'amount_state','planned','joint',false,'mixed',true,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones','description','Dos conceptes','explanation','Conceptes pendents','reason',null,'blockers',jsonb_build_array('mixed','missing_amount','reconciliation'),'evidence',jsonb_build_array(c1,c2),
  'concepts',jsonb_build_array(jsonb_build_object('recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_state','planned','amount_cents',1800000,'joint',false,'mixed',false,'blockers','[]'::jsonb,'evidence',jsonb_build_array(c1)),jsonb_build_object('recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_state','planned','amount_cents',400000,'joint',false,'mixed',false,'blockers','[]'::jsonb,'evidence',jsonb_build_array(c2))));
 bundle:=jsonb_build_object('actors',jsonb_build_array(jsonb_build_object('name','Fundació de prova','nif','G12345678','nature','private','roles',jsonb_build_array('recipient'),'evidence',jsonb_build_array(ci))),'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent');
 perform persist_conveni(j,v,bundle,revisions,hash);select unit_id into strict u from conveni_unit_proposals where job_id=j;
 select concept_hash into strict h1 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=0;
 select concept_hash into strict h2 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=1;
 perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Primer concepte revisat',c1,true);
 perform review_conveni_concept(sid,j,u,1,event2,null,null,h2,hash,revisions,'select',code,'Segon concepte revisat',c2,true);
 heads:=jsonb_build_object('0',event1,'1',event2);
 select cp.group_hash,cp.analysis_hash into strict group_hash,analysis_hash from conveni_group_preparations cp where cp.job_id=j and cp.unit_id=u;
 receipts:=conveni_archive_snapshot(sid,array[d1,d2]);one_receipt:=conveni_archive_snapshot(sid,array[d1]);
 if receipts is null or one_receipt is null then raise exception 'TEST: missing synthetic version';end if;
 begin perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,conf,'Segon document omès',one_receipt);raise exception 'TEST: omitted source accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from conveni_group_preparation_events where id=prep) then raise exception 'TEST: omitted source left event';end if;
 update storage.objects set version=gen_random_uuid()::text where bucket_id='cloud-documents' and name=path2;
 begin perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,conf,'Versió canviada després de lectura',receipts);raise exception 'TEST: replaced source accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from conveni_group_preparation_events where id=prep) then raise exception 'TEST: replaced source left event';end if;
 update storage.objects set version=ver2 where bucket_id='cloud-documents' and name=path2;
 perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,conf,'Dues fonts verificades',receipts);
 perform set_config('role','service_role',true);
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and preparation_is_current) then raise exception 'TEST: verified preparation missing';end if;
 perform set_config('role','none',true);
 if (select count(*) from jsonb_object_keys((select ver.receipts from conveni_group_archive_verifications ver where ver.preparation_id=prep)))<>2 then raise exception 'TEST: missing receipt';end if;
 update storage.objects set version=gen_random_uuid()::text where bucket_id='cloud-documents' and name=path2;
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: later replacement not stale';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: preparation created provision';end if;
end $$;
