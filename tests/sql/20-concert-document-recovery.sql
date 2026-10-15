do $$ declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;o uuid:=gen_random_uuid();d uuid;uid uuid;again uuid;
 digest text:=repeat('c',64);q text:='G12345678 Entitat completa de prova S01234 Servei de centre de dia per a gent gran 100,01 €';p text;line jsonb;n integer;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts',sid::text,'Concert','Pròrroga de prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until)
 values(sid,'enrich_record','vercel_workflow','running',o,1,now()+interval '5 minutes') returning id into t;
 p:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/recovery.pdf',md5(sid::text),'annex','fetched','application/pdf',q,length(q),p,digest,'readable-markdown-v4') returning id into d;
 insert into storage.objects(bucket_id,name) values('cloud-documents',p);
 line:=jsonb_build_object('parserVersion','program-columns-v2','unitKey','official-program:'||digest||':test','nif','G12345678','resesCode','S01234','quote',q,'page',1,'quantity',2,'amountCents',10001,'observedProviderName','Entitat completa de prova','observedServiceName','Servei de centre de dia per a gent gran','observedServiceCode','1.2.3.1','actType','renewal');
 uid:=cloud_stage_program_observation(t,o,1,j,d,line,repeat('a',64));
 again:=cloud_stage_program_observation(t,o,1,j,d,line,repeat('a',64));
 if uid<>again or (select count(*) from record_units where source_record_id=sid and unit_key<>'legacy')<>1 then raise exception 'Duplicate line on retry';end if;
 if (select amount from record_units where id=uid)<>100.01 then raise exception 'Renewal amount lost';end if;
 if (select count(*) from concert_line_observations where unit_id=uid)<>1 then raise exception 'Duplicate revision';end if;
 p:='cases/'||sid||'/items/'||uid||'/documents/'||d||'/'||digest||'.pdf';
 insert into storage.objects(bucket_id,name) values('cloud-documents',p);
 update record_units set storage_path=p,storage_sha256=digest where id=uid;
 if not cloud_finalize_program_observations(t,o,1,j,d,1,10001,10001,'{"complete":true,"missingAmounts":0}') then raise exception 'Complete annex rejected';end if;
 line:=line||jsonb_build_object('existingUnitId',uid,'observedProviderName','Nom corregit');
 perform cloud_stage_program_observation(t,o,1,j,d,line,repeat('b',64));
 if (select observed_provider_name from record_units where id=uid)<>'Nom corregit' then raise exception 'Draft not updated';end if;
 if not exists(select 1 from concert_line_observations where unit_id=uid and previous_value->>'observed_provider_name'='Entitat completa de prova') then raise exception 'Old observation lost';end if;
 -- A manually prepared draft is protected just like a reviewed line.
 update record_units set pipeline_job_id=j where id=uid;
 line:=line||jsonb_build_object('observedProviderName','No ha de substituir');
 perform cloud_stage_program_observation(t,o,1,j,d,line,repeat('d',64));
 if (select observed_provider_name from record_units where id=uid)<>'Nom corregit' then raise exception 'Human input overwritten';end if;
 if not exists(select 1 from concert_line_observations where unit_id=uid and not applied) then raise exception 'Missing review proposal';end if;
 if cloud_finalize_program_observations(t,o,1,j,d,1,10001,10001,'{"complete":true,"missingAmounts":0}') then raise exception 'Pending revision marked complete';end if;
 begin
  perform cloud_stage_program_observation(t,o,1,j,d,line||'{"quote":"Text inventat que no es troba en cap de les pàgines del document oficial"}',repeat('e',64));
  raise exception 'Ungrounded quote accepted';
 exception when others then if sqlerrm='Ungrounded quote accepted' then raise;end if;end;
 -- Codes printed as C... are retained without claiming a verified RESES.
 update source_documents set extracted_text=extracted_text||E'\n'||replace(q,'S01234','C01234') where id=d;
 line:=line||jsonb_build_object('existingUnitId',null,'unitKey','official-program:'||digest||':equipment','resesCode','C01234','quote',replace(q,'S01234','C01234'));
 again:=cloud_stage_program_observation(t,o,1,j,d,line,repeat('f',64));
 if exists(select 1 from record_units where id=again and reses_code is not null) or not exists(select 1 from concert_line_observations where unit_id=again and proposed_value->>'resesCode'='C01234') then raise exception 'Equipment code mislabeled as RESES';end if;
 select count(*) into n from service_provisions where source_record_id=sid;
 if n<>0 then raise exception 'Extraction silently approved provisions';end if;
end $$;
