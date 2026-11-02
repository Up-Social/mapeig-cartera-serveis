do $$
declare sid uuid:=gen_random_uuid();run uuid;j uuid;new_job uuid;d uuid:=gen_random_uuid();annex uuid:=gen_random_uuid();u uuid;v text;code text;
 sha text:=repeat('d',64);path text;revision text;hash text;unit jsonb;bundle jsonb;cite1 jsonb;cite2 jsonb;revisions jsonb;h1 text;h2 text;
 event1 uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();other uuid:=gen_random_uuid();parent_event uuid:=gen_random_uuid();changed_hash text;blocked_hash text;
 q1 text:='La Fundació de prova presta el primer servei social a persones grans durant el període de 2025.';
 q2 text:='La Fundació de prova presta un segon servei diferent amb una despesa compartida sense repartiment.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":20000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d,sid,'https://example.invalid/'||d,d::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||q1||chr(10)||q2,path,sha,400,false);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=d;
 revisions:=jsonb_build_object(d::text,revision);
 cite1:=jsonb_build_object('document_id',d,'page',1,'quote',q1);cite2:=jsonb_build_object('document_id',d,'page',1,'quote',q2);
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',null,'amount_state','planned','joint',false,'mixed',true,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones','description','Dos serveis','explanation','Conceptes pendents','reason',null,'blockers',jsonb_build_array('mixed','missing_amount','reconciliation'),'evidence',jsonb_build_array(cite1,cite2),
  'concepts',jsonb_build_array(jsonb_build_object('description','Primer','amount_cents',1800000,'evidence',jsonb_build_array(cite1)),jsonb_build_object('description','Segon','amount_cents',200000,'evidence',jsonb_build_array(cite2))));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent dels conceptes');
 perform persist_conveni(j,v,bundle,revisions,hash);
 select unit_id into strict u from conveni_unit_proposals where job_id=j;
 select concept_hash into strict h1 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=0;
 select concept_hash into strict h2 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=1;
 perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Revisió individual documentada',cite1,true);
 perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Revisió individual documentada',cite1,true);
 if (select count(*) from conveni_concept_review_events where id=event1)<>1 then raise exception 'TEST: retry not idempotent';end if;
 -- Legacy positive reviews cease to be current when analysis coverage is incomplete.
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','false') where job_id=j;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event1 and not review_is_current) then raise exception 'TEST: positive event with incomplete coverage current';end if;
 begin perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Revisió individual documentada',cite1,true);raise exception 'TEST: incomplete positive replay accepted';exception when raise_exception then if sqlerrm not like 'Cal completar la cobertura documental%' then raise;end if;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'select',code,'Cobertura no completada',cite1,true);raise exception 'TEST: incomplete select accepted';exception when raise_exception then if sqlerrm not like 'Cal completar la cobertura documental%' then raise;end if;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'outside',null,'Cobertura no completada',cite1,true);raise exception 'TEST: incomplete outside accepted';exception when raise_exception then if sqlerrm not like 'Cal completar la cobertura documental%' then raise;end if;end;
 -- A pending review remains allowed; roll it back to preserve the fixture sequence.
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'insufficient',null,'Cobertura encara pendent',cite1,false);raise exception 'INSUFFICIENT_ACCEPTED';exception when raise_exception then if sqlerrm<>'INSUFFICIENT_ACCEPTED' then raise;end if;end;
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','true') where job_id=j;
 update conveni_unit_proposals set data=jsonb_set(data,'{blockers}',jsonb_build_array('mixed','incomplete')) where job_id=j and unit_id=u;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event1 and not review_is_current) then raise exception 'TEST: unit blocker left positive current';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'outside',null,'Unitat amb cobertura incompleta',cite1,true);raise exception 'TEST: unit incomplete accepted';exception when raise_exception then if sqlerrm not like 'Cal completar la cobertura documental%' then raise;end if;end;
 update conveni_unit_proposals set data=jsonb_set(unit,'{concepts,1,blockers}',jsonb_build_array('incomplete'),true) where job_id=j and unit_id=u;
 select concept_hash into strict blocked_hash from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=1;
 begin perform review_conveni_concept(sid,j,u,1,gen_random_uuid(),null,null,blocked_hash,hash,revisions,'select',code,'Concepte amb cobertura incompleta',cite2,true);raise exception 'TEST: concept incomplete accepted';exception when raise_exception then if sqlerrm not like 'Cal completar la cobertura documental%' then raise;end if;end;
 update conveni_unit_proposals set data=unit where job_id=j and unit_id=u;

 update source_records set title='Títol canviat' where id=sid;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event1 and not review_is_current) then raise exception 'TEST: changed source not marked stale';end if;
 update source_records set title='Conveni sintètic' where id=sid;
 update source_documents set storage_sha256=repeat('b',64) where id=d;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event1 and not review_is_current) then raise exception 'TEST: changed document revision not marked stale';end if;
 update source_documents set storage_sha256=sha where id=d;

 if not exists(select 1 from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=0 and review_id=event1 and review_sequence=1 and review_is_current) then raise exception 'TEST: missing proposal review';end if;
 begin perform review_conveni_concept(sid,j,u,0,event1,null,null,h1,hash,revisions,'select',code,'Reutilització no permesa',cite1,true);raise exception 'TEST: reused event accepted';exception when sqlstate 'PT409' then null;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),null,null,h1,hash,revisions,'select',code,'Revisió concurrent obsoleta',cite1,true);raise exception 'TEST: stale predecessor accepted';exception when sqlstate 'PT409' then null;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,repeat('a',64),hash,revisions,'select',code,'Contingut obsolet',cite1,true);raise exception 'TEST: stale concept accepted';exception when sqlstate 'PT409' then null;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,'{}','select',code,'Manifest obsolet',cite1,true);raise exception 'TEST: stale manifest accepted';exception when sqlstate 'PT409' then null;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'select',code,'Cita d’un altre concepte',cite2,true);raise exception 'TEST: wrong concept citation accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event1,null,h1,hash,revisions,'select',code,'Sense confirmació social',cite1,false);raise exception 'TEST: missing attestation accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 perform review_conveni_concept(sid,j,u,0,event2,event1,null,h1,hash,revisions,'insufficient',null,'Informació insuficient encara',cite1,false);
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','false') where job_id=j;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and review_is_current and outcome='insufficient') then raise exception 'TEST: pending review lost with incomplete coverage';end if;
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','true') where job_id=j;

 perform set_config('role','service_role',true);
 perform review_conveni_concept(sid,j,u,1,other,null,null,h2,hash,revisions,'outside',null,'Segon concepte social fora',cite2,true);
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=1 and review_id=other) then raise exception 'TEST: service role cannot read proposal';end if;
 perform set_config('role','none',true);
 if (select count(*) from conveni_concept_review_events where unit_id=u)<>3 then raise exception 'TEST: concept history missing';end if;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and review_sequence=2) then raise exception 'TEST: last decision missing';end if;
 if (select data from conveni_unit_proposals where job_id=j and unit_id=u)<>unit then raise exception 'TEST: proposal changed';end if;
 update conveni_unit_proposals set data=jsonb_set(data,'{concepts,0,description}',to_jsonb('Canvi indegut'::text)) where job_id=j and unit_id=u;
 select concept_hash into strict changed_hash from conveni_concept_proposals where job_id=j and unit_id=u and concept_index=0;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and not review_is_current) then raise exception 'TEST: changed concept lost token or appeared current';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,null,changed_hash,hash,revisions,'insufficient',null,'Concepte substituït indegudament',cite1,false);raise exception 'TEST: changed concept inherited review';exception when sqlstate 'PT409' then null;end;
 update conveni_unit_proposals set data=unit where job_id=j and unit_id=u;

 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: concept review created provision';end if;
 if exists(select 1 from conveni_review_events where unit_id=u) then raise exception 'TEST: concept review finalized unit';end if;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(annex,sid,'https://example.invalid/'||annex,annex::text,'annex','fetched','application/pdf',q1,'cases/'||sid||'/documents/'||annex||'/'||sha||'.pdf',sha,400,false);
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and not review_is_current) then raise exception 'TEST: new annex did not mark event stale or preserve predecessor';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,null,h1,hash,revisions,'insufficient',null,'Annex nou sense analitzar',cite1,false);raise exception 'TEST: new annex accepted';exception when sqlstate 'PT409' then null;end;
 delete from source_documents where id=annex;
 update source_documents set extracted_text='## Pàgina 2'||chr(10)||q1||chr(10)||q2 where id=d;
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and not review_is_current) then raise exception 'TEST: changed citation did not mark event stale';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,null,h1,hash,revisions,'insufficient',null,'Cita a pàgina incorrecta',cite1,false);raise exception 'TEST: wrong page accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update source_documents set extracted_text='## Pàgina 1'||chr(10)||q1||chr(10)||q2 where id=d;
 perform review_conveni_unit(sid,j,u,parent_event,null,'insufficient',null,'Unitat encara pendent de revisió',false);
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_id=event2 and not review_is_current) then raise exception 'TEST: changed parent did not mark event stale or preserve predecessor';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,null,h1,hash,revisions,'insufficient',null,'Revisió de grup obsoleta',cite1,false);raise exception 'TEST: stale parent accepted';exception when sqlstate 'PT409' then null;end;
 perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,parent_event,h1,hash,revisions,'insufficient',null,'Revisió amb grup actual',cite1,false);
 if not exists(select 1 from conveni_concept_proposals where unit_id=u and concept_index=0 and review_sequence=3 and review_is_current) then raise exception 'TEST: updated review not current';end if;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '1 second') returning id into new_job;
 perform persist_conveni(new_job,v,bundle,revisions,hash);
 if exists(select 1 from conveni_concept_proposals where job_id=new_job and review_id is not null) then raise exception 'TEST: old reviews inherited';end if;
 begin perform review_conveni_concept(sid,j,u,0,gen_random_uuid(),event2,null,h1,hash,revisions,'insufficient',null,'Anàlisi antiga obsoleta',cite1,false);raise exception 'TEST: old analysis accepted';exception when sqlstate 'PT409' then null;end;
 if has_table_privilege('service_role','public.conveni_concept_review_events','INSERT') then raise exception 'TEST: event table writable outside RPC';end if;
 if has_function_privilege('anon','public.review_conveni_concept(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text,text,text,jsonb,boolean)','EXECUTE') then raise exception 'TEST: anonymous RPC access';end if;
end $$;
