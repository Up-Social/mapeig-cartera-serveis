do $$
declare sid uuid:=gen_random_uuid();run uuid;j uuid;d uuid:=gen_random_uuid();annex uuid:=gen_random_uuid();u uuid;v text;code text;sha text:=repeat('d',64);
 path text;rev text;hash text;group_hash text;analysis_hash text;changed_analysis text;h1 text;h2 text;unit jsonb;bundle jsonb;revisions jsonb;heads jsonb;
 c1 jsonb;c2 jsonb;ct jsonb;ci jsonb;cz jsonb;confirmations jsonb;receipts jsonb;object_version text:=gen_random_uuid()::text;event1 uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();prep uuid:=gen_random_uuid();
 q1 text:='El primer servei social està destinat a persones grans durant l’any 2025.';
 q2 text:='El segon concepte del mateix servei social es presta al municipi durant l’any 2025.';
 qt text:='L’aportació pública total per al servei durant 2025 és de 20.000,00 € segons el conveni.';
 qi text:='La Fundació de prova, amb NIF G12345678, consta com a entitat receptora.';
 qz text:='La quantia indicada en aquesta proposta és de 0,00 € per al període esmentat.';
begin
 if conveni_group_literal_cents('1.234,56 €')<>123456 or conveni_group_literal_cents('1234.56')<>123456 or conveni_group_literal_cents('0')<>0 then raise exception 'TEST: valid amount format';end if;
 if conveni_group_literal_cents('1.234') is not null or conveni_group_literal_cents('-10') is not null or conveni_group_literal_cents('1,2') is not null or conveni_group_literal_cents('90071992547409,92') is not null then raise exception 'TEST: invalid amount format';end if;
 if conveni_quote_has_amount_literal('Import 12.345,00 euros','345,00') then raise exception 'TEST: partial number accepted';end if;
 if conveni_quote_has_amount_literal('Import -20000 euros','20000') or conveni_quote_has_amount_literal('Import 20 000 euros','000') or conveni_quote_has_amount_literal('Import (20000) euros','20000') then raise exception 'TEST: negative or ambiguous token accepted';end if;
 if conveni_quote_has_amount_literal('Import ( 20000 ) euros','20000') or conveni_quote_has_amount_literal('Import (   20000   ) euros','20000') then raise exception 'TEST: spaced accounting parentheses accepted';end if;
 if conveni_quote_has_amount_literal('Import 20000 - 5000 euros','20000') or conveni_quote_has_amount_literal('Import 20000 - 5000 euros','5000') or conveni_quote_has_amount_literal('Import 20000+5000 euros','20000') or conveni_quote_has_amount_literal('Import 20000 × 2 euros','20000') or conveni_quote_has_amount_literal('Import 20000 – 5000 euros','20000') or conveni_quote_has_amount_literal('Import 20000 = 5000 euros','20000') then raise exception 'TEST: mathematical expression accepted';end if;
 if not conveni_quote_has_amount_literal('Import total de 20000 euros per al servei','20000') then raise exception 'TEST: plain total rejected';end if;

 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":20000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d,sid,'https://example.invalid/'||d,d::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||q1||chr(10)||q2||chr(10)||qt||chr(10)||qi||chr(10)||qz,path,sha,400,false);
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',path,object_version);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into rev from source_documents where id=d;
 revisions:=jsonb_build_object(d::text,rev);
 c1:=jsonb_build_object('document_id',d,'page',1,'quote',q1);c2:=jsonb_build_object('document_id',d,'page',1,'quote',q2);
 ct:=jsonb_build_object('document_id',d,'page',1,'quote',qt);ci:=jsonb_build_object('document_id',d,'page',1,'quote',qi);cz:=jsonb_build_object('document_id',d,'page',1,'quote',qz);
 confirmations:='{"public_total":true,"recipient_period":true,"covers_concepts":true,"same_social_service":true,"recipient_role":true,"conditions_preserved":true,"not_a_sum_or_shared":true}';
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',null,'amount_state','planned','joint',false,'mixed',true,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones','description','Dos conceptes','explanation','Conceptes pendents','reason',null,'blockers',jsonb_build_array('mixed','missing_amount','reconciliation'),'evidence',jsonb_build_array(c1,c2),
  'concepts',jsonb_build_array(jsonb_build_object('description','Primer','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_state','planned','amount_cents',1800000,'joint',false,'mixed',false,'blockers','[]'::jsonb,'evidence',jsonb_build_array(c1)),jsonb_build_object('description','Segon','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_state','planned','amount_cents',400000,'joint',false,'mixed',false,'blockers','[]'::jsonb,'evidence',jsonb_build_array(c2))));
 bundle:=jsonb_build_object('actors',jsonb_build_array(jsonb_build_object('name','Fundació de prova','nif','G12345678','nature','private','roles',jsonb_build_array('recipient'),'evidence',jsonb_build_array(ci))),'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent');
 perform persist_conveni(j,v,bundle,revisions,hash);
 select unit_id into strict u from conveni_unit_proposals where job_id=j;
 select concept_hash into strict h1 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=0;
 select concept_hash into strict h2 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=1;
 perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Primer concepte revisat',c1,true);
 select cp.group_hash,cp.analysis_hash into strict group_hash,analysis_hash from conveni_group_preparations cp where cp.job_id=j and cp.unit_id=u;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,jsonb_build_object('0',event1,'1',event2),code,2000000,'20.000,00 €',ct,ci,confirmations,'Segon concepte no revisat');raise exception 'TEST: incomplete concept heads accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 perform review_conveni_concept(sid,j,u,1,event2,null,null,h2,hash,revisions,'select',code,'Segon concepte revisat',c2,true);
 heads:=jsonb_build_object('0',event1,'1',event2);
 select cp.group_hash,cp.analysis_hash into strict group_hash,analysis_hash from conveni_group_preparations cp where cp.job_id=j and cp.unit_id=u;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2200000,'22.000,00 €',ct,ci,confirmations,'Preparació amb import inventat');raise exception 'TEST: unquoted sum accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations-'recipient_role','Confirmació incompleta');raise exception 'TEST: missing confirmation accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations-'not_a_sum_or_shared','Sense confirmació de no solapament');raise exception 'TEST: shared amount attestation missing';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',jsonb_set(ct,'{page}','2'),ci,confirmations,'Cita a pàgina equivocada');raise exception 'TEST: wrong page accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,jsonb_set(ci,'{quote}',to_jsonb('La persona signant aporta el conveni sense identificar cap NIF.'::text)),confirmations,'Identitat no acreditada');raise exception 'TEST: unproven identity accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,repeat('a',64),hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Anàlisi no vigent');raise exception 'TEST: stale analysis accepted';exception when sqlstate 'PT409' then null;end;

 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,jsonb_build_object('0',event1),code,2000000,'20.000,00 €',ct,ci,confirmations,'Falta una revisió');raise exception 'TEST: missing head accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update storage.objects set name=path||'.changed' where bucket_id='cloud-documents' and name=path;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Font arxivada absent');raise exception 'TEST: missing source object accepted';exception when sqlstate 'PT409' or raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update storage.objects set name=path where bucket_id='cloud-documents' and name=path||'.changed';
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,0,'0,00 €',cz,ci,confirmations,'Prova de zero documentat');raise exception 'ZERO_ACCEPTED';exception when raise_exception then if sqlerrm<>'ZERO_ACCEPTED' then raise;end if;end;
 receipts:=conveni_archive_snapshot(sid,array[d]);
 if receipts is null then raise exception 'TEST: archive snapshot unavailable';end if;
 perform set_config('role','service_role',true);
 if conveni_archive_snapshot(sid,array[d]) is distinct from receipts then raise exception 'TEST: service role cannot capture archive snapshot';end if;
 if has_function_privilege('service_role','public.prepare_conveni_group_verified(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,bigint,text,jsonb,jsonb,jsonb,text,jsonb)','EXECUTE') then raise exception 'TEST: verified RPC available before storage validation';end if;
 begin perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat',receipts);raise exception 'TEST: service role bypassed disabled RPC';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat',receipts);
 perform prepare_conveni_group_verified(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat',receipts);
 perform set_config('role','service_role',true);
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and preparation_is_current and amount_cents=2000000 and proposed_amount_state='planned') then raise exception 'TEST: current preparation not visible';end if;
 perform set_config('role','none',true);
 if (select count(*) from conveni_group_preparation_events where unit_id=u)<>1 then raise exception 'TEST: duplicate preparation';end if;
 update storage.objects set version=gen_random_uuid()::text where bucket_id='cloud-documents' and name=path;
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: changed object version remained current';end if;
 begin perform prepare_conveni_group_verified(sid,j,u,gen_random_uuid(),prep,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Objecte canviat durant verificació',receipts);raise exception 'TEST: changed object version accepted';exception when sqlstate 'PT409' then null;end;
 if (select count(*) from conveni_group_preparation_events where unit_id=u)<>1 then raise exception 'TEST: changed object left partial event';end if;
 update storage.objects set version=object_version where bucket_id='cloud-documents' and name=path;

 update storage.objects set name=path||'.changed' where bucket_id='cloud-documents' and name=path;
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: missing source object did not invalidate preparation';end if;
 begin perform prepare_conveni_group(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat');raise exception 'TEST: missing source object accepted';exception when sqlstate 'PT409' or raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update storage.objects set name=path where bucket_id='cloud-documents' and name=path||'.changed';

 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Predecessor obsolet');raise exception 'TEST: stale predecessor accepted';exception when sqlstate 'PT409' then null;end;
 begin perform prepare_conveni_group(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Canvi de contingut');raise exception 'TEST: event ID reused with changed input';exception when sqlstate 'PT409' then null;end;
 update conveni_analyses set payload=jsonb_set(payload,'{actors,0,roles}',jsonb_build_array('signatory')) where job_id=j;
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: actor change did not invalidate preparation';end if;
 select cp.analysis_hash into strict changed_analysis from conveni_group_preparations cp where cp.job_id=j and cp.unit_id=u;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),prep,null,group_hash,changed_analysis,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Rol de receptor no acreditat');raise exception 'TEST: signatory actor accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;

 begin perform prepare_conveni_group(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat');raise exception 'TEST: actor change replay accepted';exception when sqlstate 'PT409' then null;end;
 update conveni_analyses set payload=bundle where job_id=j;
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and preparation_is_current) then raise exception 'TEST: restored unchanged analysis not current';end if;

 if exists(select 1 from service_provisions where source_record_id=sid) or exists(select 1 from conveni_review_events where unit_id=u) then raise exception 'TEST: preparation finalized or created provision';end if;
 if (select data from conveni_unit_proposals where job_id=j and unit_id=u)<>unit or (select amount from record_units where id=u) is not null then raise exception 'TEST: original facts changed';end if;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(annex,sid,'https://example.invalid/'||annex,annex::text,'annex','fetched','application/pdf',q1,'cases/'||sid||'/documents/'||annex||'/'||sha||'.pdf',sha,400,false);
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: new annex did not invalidate preparation';end if;
 begin perform prepare_conveni_group(sid,j,u,prep,null,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Total literal documentat');raise exception 'TEST: stale retry accepted';exception when sqlstate 'PT409' or raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 delete from source_documents where id=annex;
 perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'insufficient',null,'Revisió individual posterior',c1,false);
 if not exists(select 1 from conveni_group_preparations where unit_id=u and preparation_id=prep and not preparation_is_current) then raise exception 'TEST: new concept head did not invalidate preparation';end if;
 begin perform prepare_conveni_group(sid,j,u,gen_random_uuid(),prep,null,group_hash,analysis_hash,hash,revisions,heads,code,2000000,'20.000,00 €',ct,ci,confirmations,'Preparació amb revisió antiga');raise exception 'TEST: stale heads accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if has_table_privilege('service_role','public.conveni_group_preparation_events','INSERT') then raise exception 'TEST: direct event insert';end if;
end $$;
