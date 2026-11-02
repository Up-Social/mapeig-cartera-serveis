do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;owner_id uuid:=gen_random_uuid();d uuid;sha text:=repeat('a',64);path text;body jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts',sid::text,'Concert','Prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 d:=gen_random_uuid();path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256) values(d,sid,'https://example.invalid/source',d::text,'publication','fetched',path,sha);
 body:=jsonb_build_object('id',d,'source_sha256',sha,'source_path',path,'source_url','https://example.invalid/source','text','Text documental verificat','method','pdftotext','hash',sha,'text_hash',sha,'mime','application/pdf','extraction_version','test','chunks','[]'::jsonb);
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body||jsonb_build_object('source_sha256',repeat('b',64)));
  raise exception 'TEST: changed source accepted';
 exception when sqlstate '40001' then null;end;
 if (select extracted_text from source_documents where id=d) is not null then raise exception 'Old extraction persisted';end if;
 update source_documents set storage_path=path||'-changed' where id=d;
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body);
  raise exception 'TEST: updated stored path accepted';
 exception when sqlstate '40001' then null;end;
 update source_documents set storage_path=path where id=d;
 begin
  perform cloud_commit_before_readability(t,owner_id,1,j,'document',body||jsonb_build_object('source_path',path||'-changed'));
  raise exception 'TEST: changed path accepted through old wrapper';
 exception when sqlstate '40001' then null;end;
 begin
  perform cloud_commit_v1(t,owner_id,1,j,'document',body-'source_path');
  raise exception 'TEST: missing source path accepted through inner function';
 exception when sqlstate '40001' then null;end;
 perform cloud_commit(t,owner_id,1,j,'document',body);
 if (select extracted_text from source_documents where id=d)<>'Text documental verificat' then raise exception 'Valid extraction rejected';end if;
 update source_documents set url='https://example.invalid/changed' where id=d;
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body);
  raise exception 'TEST: changed URL accepted';
 exception when sqlstate '40001' then null;end;
end $$;
