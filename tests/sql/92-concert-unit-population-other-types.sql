do $$
declare sid uuid;rid uuid;j uuid;v text;code text;d uuid;u uuid;pid uuid;digest text:=repeat('b',64);doc_path text;item_path text;kind text;dataset text;q text;
begin
 for kind,dataset in select * from (values('contractacio','contractacions'),('subvencio','raisc_local')) values_(kind,dataset) loop
  sid:=gen_random_uuid();
  insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,amount) values(sid,dataset,'OTHER-'||sid,'Sintètic','Unit fixture',kind,10000);
  insert into pipeline_runs default values returning id into rid;
  insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'approved') returning id into j;
  select id into v from catalog_versions where active and validated;
  select service_code into code from eligible_official_services limit 1;
  q:='Entitat de prova A. Centre A. Servei '||code||'. Període 2026. Import 3000 euros.';
  insert into source_documents(source_record_id,url,url_hash,document_type,status,extracted_text,text_length,extraction_partial,storage_sha256) values(sid,'https://example.invalid/'||sid,sid::text,'annex','fetched',q,100,false,digest) returning id into d;
  doc_path:='cases/'||sid||'/documents/'||d||'/'||digest||'.pdf';
  update source_documents set storage_path=doc_path where id=d;
  insert into storage.objects(bucket_id,name) values('cloud-documents',doc_path);
  insert into service_provisions(source_record_id,source_id,mechanism,target_population,source_reference,service_code,catalog_version_id) values(sid,'SYNTHETIC','Sintètic','Població global de prova','synthetic',code,v);
  insert into record_units(source_record_id,pipeline_job_id,unit_key,act_type,provider_name,period,service_code,catalog_version_id,amount,document_id,page,evidence_quote)
   values(sid,j,'other-unit','award','Entitat de prova A','2026',code,v,3000,d,1,q) returning id into u;
  item_path:='cases/'||sid||'/items/'||u||'/documents/'||d||'/'||digest||'.pdf';
  insert into storage.objects(bucket_id,name) values('cloud-documents',item_path);
  update record_units set storage_path=item_path,storage_sha256=digest where id=u;
  pid:=review_record_unit(u,j,true,'Validació individual sintètica');
  if (select target_population from service_provisions where id=pid) is distinct from 'Població global de prova' then raise exception 'OTHER_TYPE_POPULATION_CHANGED';end if;
 end loop;
end $$;
