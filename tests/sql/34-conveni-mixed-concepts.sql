do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;d uuid;u uuid;v text;code text;sha text:=repeat('d',64);path text;revision text;hash text;unit jsonb;bundle jsonb;
 q text:='La Fundació de prova presta dos serveis socials diferents a persones i conserva una despesa compartida en el període 2025.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":20000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 d:=gen_random_uuid();path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d,sid,'https://example.invalid/'||d,d::text,'agreement','fetched','application/pdf',q,path,sha,400,false);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=d;
 unit:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',null,'amount_state','planned','joint',false,'mixed',true,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones','description','Dos serveis','explanation','Conceptes pendents','reason',null,'blockers',jsonb_build_array('mixed','missing_amount','reconciliation'),'evidence',jsonb_build_array(jsonb_build_object('document_id',d,'page',1,'quote',q)),'concepts',jsonb_build_array(jsonb_build_object('amount_cents',1800000),jsonb_build_object('amount_cents',200000),jsonb_build_object('amount_cents',400000)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent dels conceptes');
 perform persist_conveni(j,v,bundle,jsonb_build_object(d::text,revision),hash);
 select unit_id into strict u from conveni_unit_proposals where job_id=j;
 if (select amount from record_units where id=u) is not null then raise exception 'Unknown aggregate was assigned an amount';end if;
 if (select data->'concepts'->2->>'amount_cents' from conveni_unit_proposals where unit_id=u and job_id=j)<>'400000' then raise exception 'Shared concept not preserved';end if;
 begin
  perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'select',code,'Intent amb import pendent',true);
  raise exception 'TEST: unresolved concepts approved';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'outside',null,'Intent de classificar conceptes agrupats',true);
  raise exception 'TEST: unresolved concepts classified as one';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform review_conveni_unit(sid,j,u,gen_random_uuid(),null,'reject',null,'Intent de descartar conceptes agrupats',false);
  raise exception 'TEST: unresolved concepts rejected together';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'Unresolved concepts created a provision';end if;
end $$;
