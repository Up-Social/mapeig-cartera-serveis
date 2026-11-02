do $$ declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;owner_id uuid:=gen_random_uuid();d uuid;u uuid;digest text:=repeat('f',64);doc_path text;
 q text:='RESOLC: 1. Assignar a l’entitat Fundació Prova, 4 places del Servei de suport social, en règim de concert social a la comarca del Segrià. Nom del servei social: Pis Prova Núm. Expedient: PROVIS-01. Preu: 97,07 euros per dia.';
 q2 text:='Assignar a l’entitat Fundació Segona, 3 places del Servei d’acompanyament social, en règim de concert social a la comarca del Bages. Nom del servei social: Pis Segon Núm. Expedient: PROVIS-02.';
 u2 uuid;
 payload jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts','RESOLC-'||sid,'Concert','Resolució de prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 doc_path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/resolc.pdf','resolc-test','resolution','fetched','application/pdf',q||' '||q2,400,doc_path,digest,'readable-markdown-v4') returning id into d;
 payload:=jsonb_build_object('page',1,'providerName','Fundació Prova','nif',null,'serviceName','Servei de suport social','centre','Pis Prova','territory','Segrià','resesCode',null,'quantity',4,'quote',q);
 u:=cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload);
 if cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload)<>u then raise exception 'Non-idempotent draft';end if;
 if (select amount is not null or provider_nif is not null or reses_code is not null or status<>'draft' from record_units where id=u) then raise exception 'Unknown values or status changed';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'Draft created a provision';end if;
 update source_documents set extracted_text=E'## Pàgina 1\n'||q||E'\n## Pàgina 2\n'||q2 where id=d;
 begin
  perform cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload||jsonb_build_object('row',3,'page',2));
  raise exception 'TEST: incorrect evidence page accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 u2:=cloud_stage_concert_resolc_line(t,owner_id,1,j,d,jsonb_build_object('row',2,'page',2,'providerName','Fundació Segona','nif',null,'serviceName','Servei d’acompanyament social','centre','Pis Segon','territory','Bages','resesCode',null,'quantity',3,'quote',q2));
 if u2=u or (select count(*) from record_units where source_record_id=sid)<>2 then raise exception 'Multiple clauses not separated';end if;
 begin
  perform cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload||jsonb_build_object('row',3));
  raise exception 'Duplicate clause accepted';
 exception when raise_exception then if sqlerrm='Duplicate clause accepted' then raise;end if;end;
 begin
  perform cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload||jsonb_build_object('quantity',3));
  raise exception 'Changed evidence accepted';
 exception when raise_exception then if sqlerrm='Changed evidence accepted' then raise;end if;end;
 begin
  perform cloud_stage_concert_resolc_line(t,owner_id,1,j,d,payload||jsonb_build_object('providerName','Fundació Inventada'));
  raise exception 'Invented beneficiary accepted';
 exception when raise_exception then if sqlerrm='Invented beneficiary accepted' then raise;end if;end;
end $$;
