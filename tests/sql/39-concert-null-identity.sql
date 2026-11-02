do $$ declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;owner_id uuid:=gen_random_uuid();d uuid;u uuid;digest text:=repeat('f',64);doc_path text;
 q text:='S01234 Servei de suport social al municipi de Vic, una plaça i un import total de 100,00 euros.';line jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts','NULL-ID-'||sid,'Concert','Prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 doc_path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/id.pdf','identity-test','annex','fetched','application/pdf',q,400,doc_path,digest,'readable-markdown-v4') returning id into d;
 line:=jsonb_build_object('annex',6,'page',1,'row',1,'quantity',1,'amountCents',10000,'nif',null,'resesCode','S01234','actType','award','quote',q,'observedServiceCode','1.2.3.1');
 u:=cloud_stage_concert_annex_line(t,owner_id,1,j,d,line);
 if (select provider_nif from record_units where id=u) is not null then raise exception 'Unspecified NIF invented';end if;
 if cloud_stage_concert_annex_line(t,owner_id,1,j,d,line)<>u then raise exception 'Null identity retry changed unit';end if;
 begin
  perform cloud_stage_concert_annex_line(t,owner_id,1,j,d,line||jsonb_build_object('nif','G12345678'));
  raise exception 'TEST: changed identity accepted';
 exception when raise_exception then if sqlerrm<>'CONCERT_LINE_CHANGED' then raise;end if;end;
 begin
  perform prepare_extracted_concert_unit(u,j,'Entitat de prova','1.2.3.1');
  raise exception 'TEST: unresolved NIF was approvable';
 exception when raise_exception then if sqlerrm not like 'La línia no té identificadors%' then raise;end if;end;
end $$;
