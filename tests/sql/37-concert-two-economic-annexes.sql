do $$ declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;owner_id uuid:=gen_random_uuid();d uuid;u6 uuid;u7 uuid;digest text:=repeat('a',64);doc_path text;
 q6 text:='G12345678 1.2.3.1 Servei de suport social S01234 Vic 1 100,00 €';
 q7 text:='G87654321 1.2.3.2 Servei de suport social S54321 Vic 1 200,00 €';base jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts','TWO-'||sid,'Concert','Resolució de prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 doc_path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/two-annexes.pdf','two-annexes-test','annex','fetched','application/pdf',q6||E'\n'||q7,400,doc_path,digest,'readable-markdown-v4') returning id into d;
 base:=jsonb_build_object('annex',6,'page',1,'row',1,'quantity',1,'amountCents',10000,'nif','G12345678','resesCode','S01234','actType','award','quote',q6,'observedServiceCode','1.2.3.1');
 u6:=cloud_stage_concert_annex_line(t,owner_id,1,j,d,base);
 u7:=cloud_stage_concert_annex_line(t,owner_id,1,j,d,base||jsonb_build_object('annex',7,'row',2,'amountCents',20000,'nif','G87654321','resesCode','S54321','quote',q7,'observedServiceCode','1.2.3.2'));
 update record_units set storage_path='cases/'||sid||'/items/'||id||'/documents/'||d||'/'||digest||'.pdf',storage_sha256=digest where id in (u6,u7);
 if not cloud_finalize_concert_annex(t,owner_id,1,j,d,6,1,10000,10000) then raise exception 'Annex 6 did not reconcile independently';end if;
 if not cloud_finalize_concert_annex(t,owner_id,1,j,d,7,1,20000,20000) then raise exception 'Annex 7 did not reconcile independently';end if;
 if (select count(*) from concert_annex_reconciliations where document_id=d and reconciled)<>2 then raise exception 'Independent reports missing';end if;
 if cloud_stage_concert_annex_line(t,owner_id,1,j,d,base)<>u6 then raise exception 'Restaging produced a duplicate';end if;
 if not cloud_finalize_concert_annex(t,owner_id,1,j,d,6,1,10000,10000) then raise exception 'Reconciliation retry failed';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'Reconciliation approved funding';end if;
end $$;
