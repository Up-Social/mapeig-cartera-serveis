do $$
declare sid uuid:=gen_random_uuid();run uuid;job uuid;v text;code text;doc uuid:=gen_random_uuid();uid uuid;sibling uuid:=gen_random_uuid();field_ text;
 j2 uuid;detail_ text;unit jsonb;bundle jsonb;bad jsonb;other_unit jsonb;sha text:=repeat('a',64);path text;revision text;
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

 -- Exact historical replay remains valid and does not rewrite the proposal.
 bad:=jsonb_set(bundle,'{units,0,classification}',to_jsonb('discarded'::text));
 bad:=jsonb_set(bad,'{units,0,reason}',to_jsonb('service_not_in_catalog'::text));
 update conveni_analyses set payload=bad where job_id=job;
 perform persist_conveni(job,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
 if (select payload from conveni_analyses where job_id=job) is distinct from bad then raise exception 'TEST: historical analysis changed';end if;
 update conveni_analyses set payload=bundle where job_id=job;
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(run,sid,'ready',clock_timestamp()+interval '1 second') returning id into j2;
 begin
  perform persist_conveni(j2,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
  raise exception 'TEST: conflicting parent persisted';
 exception when raise_exception then
  get stacked diagnostics detail_=PG_EXCEPTION_DETAIL;
  if detail_<>'CONVENI_DISCARD_REASON_CONFLICT' then raise;end if;
 end;
 -- A grouped parent can be insufficient while a child has the conflict.
 other_unit:=jsonb_set(unit,'{classification}',to_jsonb('discarded'::text));
 other_unit:=jsonb_set(other_unit,'{reason}',to_jsonb((chr(160)||'SERVICE_NOT_IN_CATALOG'||chr(160))::text));
 bad:=jsonb_set(bundle,'{units,0,classification}',to_jsonb('insufficient_evidence'::text));
 bad:=jsonb_set(bad,'{units,0,concepts}',jsonb_build_array(other_unit));
 begin
  perform persist_conveni(j2,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
  raise exception 'TEST: conflicting child persisted';
 exception when raise_exception then
  get stacked diagnostics detail_=PG_EXCEPTION_DETAIL;
  if detail_<>'CONVENI_DISCARD_REASON_CONFLICT' then raise;end if;
 end;
 if exists(select 1 from conveni_analyses where job_id=j2) or exists(select 1 from conveni_unit_proposals where job_id=j2) or exists(select 1 from analysis_results where pipeline_job_id=j2) then raise exception 'TEST: conflicting persistence left effects';end if;
 -- Reject malformed nested grouping and more than 500 original concepts.
 bad:=jsonb_set(bundle,'{units,0,concepts}',jsonb_build_array(jsonb_build_object('concepts',jsonb_build_array(unit))));
 begin
  perform persist_conveni(j2,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
  raise exception 'TEST: recursive concepts persisted';
 exception when raise_exception then if sqlerrm<>'Estructura de conceptes invàlida' then raise;end if;end;
 bad:=jsonb_set(bundle,'{units}',(select jsonb_agg(unit) from generate_series(1,501)));
 begin
  perform persist_conveni(j2,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
  raise exception 'TEST: too many concepts persisted';
 exception when raise_exception then if sqlerrm<>'Estructura de conceptes invàlida' then raise;end if;end;
 -- This does not infer the right reason: a different proposal can proceed.
 bad:=jsonb_set(bundle,'{units,0,classification}',to_jsonb('discarded'::text));
 bad:=jsonb_set(bad,'{units,0,reason}',to_jsonb('interadministrative_agreement'::text));
 perform persist_conveni(j2,v,bad,jsonb_build_object(doc::text,revision),conveni_source_hash(sid));
 if not exists(select 1 from conveni_analyses where job_id=j2) then raise exception 'TEST: valid reason was blocked';end if;
end $$;
