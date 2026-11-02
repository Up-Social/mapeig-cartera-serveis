do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;d uuid;d2 uuid:=gen_random_uuid();u uuid;v text;code text;event uuid:=gen_random_uuid();sha text:=repeat('9',64);path text;revision text;hash text;unit jsonb;bundle jsonb;
 q text:='El projecte presta a les persones grans un servei social documentat al municipi de prova, durant l’any 2025.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":1000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 d:=gen_random_uuid();path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d,sid,'https://example.invalid/'||d,d::text,'agreement','fetched','application/pdf',q,path,sha,400,false);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=d;
 unit:=jsonb_build_object('key','entitat|2025','recipient','Entitat de prova','recipient_nif',null,'recipient_nature','unknown','period','2025','year',2025,'amount_cents',100000,'amount_state','planned','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones grans','description','Servei social','explanation','Proposta insuficient','reason',null,'blockers',jsonb_build_array('unknown_recipient','missing_nif'),'evidence',jsonb_build_array(jsonb_build_object('document_id',d,'page',1,'quote',q)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent');
 perform persist_conveni(j,v,bundle,jsonb_build_object(d::text,revision),hash);
 select unit_id into strict u from conveni_unit_proposals where job_id=j;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',false);raise exception 'TEST: missing social confirmation accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'select',code,'Intent de provisió sense dades',true);raise exception 'TEST: insufficient proposal approved';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','false'::jsonb) where job_id=j;
 begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'outside',null,'Revisió amb cobertura incompleta',true);raise exception 'TEST: incomplete coverage accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update conveni_analyses set payload=jsonb_set(payload,'{coverage_complete}','true'::jsonb) where job_id=j;
 update conveni_unit_proposals set data=jsonb_set(data,'{blockers}',jsonb_build_array('incomplete')) where job_id=j and unit_id=u;
 begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'outside',null,'Revisió amb font incompleta',true);raise exception 'TEST: incomplete unit accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update conveni_unit_proposals set data=unit where job_id=j and unit_id=u;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d2,sid,'https://example.invalid/'||d2,d2::text,'annex','fetched','application/pdf',q,'cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf',sha,400,false);
 begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'outside',null,'Annex nou sense analitzar',true);raise exception 'TEST: outside accepted new annex';
 exception when raise_exception then if sqlerrm<>'Cobertura documental canviada' then raise;end if;end;
 delete from source_documents where id=d2;
 update source_documents set extracted_text='Font modificada' where id=d;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: modified evidence accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update source_documents set extracted_text=q where id=d;
 perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);
 perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);
 begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'outside',null,'Revisió concurrent obsoleta',true);raise exception 'TEST: stale review accepted';
 exception when sqlstate 'PT409' then null;end;
 if (select count(*) from conveni_review_events where id=event)<>1 then raise exception 'Review not idempotent';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'Outside correction created a provision';end if;
 if (select classification from review_decisions where pipeline_job_id=j order by created_at desc limit 1)<>'out_of_portfolio' then raise exception 'Human correction not recorded';end if;
end $$;
