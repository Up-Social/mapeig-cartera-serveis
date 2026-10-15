do $$ declare sid uuid:=gen_random_uuid(); rid uuid; j uuid; t uuid; owner_id uuid:=gen_random_uuid(); d uuid; u1 uuid;u2 uuid;v text; doc_path text; digest text:=repeat('b',64); q1 text:='B12345678 Servei de centre ocupacional 1.2.6.2.4. S00845 Barcelona 11.000,00 € 4 12.000,00 €';q2 text:='B12345678 Servei de centre ocupacional 1.2.6.2.4. S03532 Girona 11.000,00 € 3 13.000,00 €'; base jsonb; n integer; begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,amount) values(sid,'concerts','BULK-'||sid,'Concert','Pròrroga de serveis de prova','concert',25000);
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 doc_path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/bulk.pdf','bulk-test','annex','fetched','application/pdf',q1||E'\n'||q2,400,doc_path,digest,'readable-markdown-v3') returning id into d;
 insert into storage.objects(bucket_id,name) values('cloud-documents',doc_path);
 base:=jsonb_build_object('parserVersion','program-columns-v2','unitKey','official-program:'||digest||':line1','annex',0,'page',1,'row',1,'quantity',4,'amountCents',1200000,'nif','B12345678','resesCode','S00845','actType','renewal','quote',q1,'observedServiceCode',null,'observedProviderName','Entitat primera');
 u1:=cloud_stage_program_observation(t,owner_id,1,j,d,base,repeat('a',64));
 base:=base||jsonb_build_object('unitKey','official-program:'||digest||':line2','row',2,'page',2,'quantity',3,'amountCents',1300000,'resesCode','S03532','quote',q2,'observedServiceCode','1.2.6.2.4.2');
 u2:=cloud_stage_program_observation(t,owner_id,1,j,d,base,repeat('b',64));
 insert into storage.objects(bucket_id,name) values('cloud-documents','cases/'||sid||'/items/'||u1||'/documents/'||d||'/'||digest||'.pdf'),('cloud-documents','cases/'||sid||'/items/'||u2||'/documents/'||d||'/'||digest||'.pdf');
 update record_units set storage_path='cases/'||sid||'/items/'||id||'/documents/'||d||'/'||digest||'.pdf',storage_sha256=digest where source_record_id=sid;
 if not cloud_finalize_program_observations(t,owner_id,1,j,d,2,2500000,2500000,'{"complete":true,"missingAmounts":0}') then raise exception 'Reconciliation failed';end if;
 select id into v from catalog_versions where active and validated;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit)
 values(j,sid,v,'concert-program-lines-v2','insufficient_evidence','[]','Annex total verified','Servei ocupacional','Persones amb discapacitat','[{"content":"official annex"}]',jsonb_build_object('version','concert-program-lines-v2','documents',jsonb_build_array(d)));
 update pipeline_jobs set status='needs_review' where id=j;
 begin
  perform review_analysis(sid,'select',j,'{}'::text[],(select id from matching_candidates where pipeline_job_id=j),null,'Intent individual sense revisar el repartiment');
  raise exception 'Single-service approval accepted';
 exception when others then if sqlerrm='Single-service approval accepted' then raise;end if;end;
 perform save_documented_correction(sid,j,gen_random_uuid(),null,u1,'service_code','1.2.6.2.4.1',d,(select storage_sha256||':'||coalesce(active_extraction_id::text,'') from source_documents where id=d),1,q1,false,'Tipologia confirmada a la pàgina de l’annex','Revisor de proves');
 if (select observed_service_code from record_units where id=u1) is not null then raise exception 'Original observation changed';end if;
 n:=review_reconciled_concert(sid,j,'Validació de prova completa','{}');
 if (select classification from analysis_results where pipeline_job_id=j)<>'insufficient_evidence' then raise exception 'Automatic proposal overwritten';end if;
 if n<>2 then raise exception 'Wrong reviewed count';end if;
 if exists(select 1 from service_provisions where source_record_id=sid and superseded_at is null) then raise exception 'Renewal created new funding';end if;
 if (select count(*) from record_units where source_record_id=sid and unit_key<>'legacy' and status='approved')<>2 then raise exception 'Wrong unit statuses';end if;
end $$;
