do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;t uuid;owner_id uuid:=gen_random_uuid();d uuid;sha text:=repeat('a',64);path text;body jsonb;old_id uuid;new_id uuid;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts',sid::text,'Concert','Prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(sid,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 d:=gen_random_uuid();path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256) values(d,sid,'https://example.invalid/source',d::text,'publication','fetched',path,sha) returning active_extraction_id into old_id;
 update pipeline_runs set parameters=jsonb_build_object('targeted_ocr',jsonb_build_object('documentId',d,'pages','[1]'::jsonb)) where id=rid;
 body:=jsonb_build_object('id',d,'source_sha256',sha,'source_path',path,'source_url','https://example.invalid/source','text','Text OCR verificat','method','pdf-ocr-markdown-v2','hash',sha,'text_hash',encode(extensions.digest('Text OCR verificat','sha256'),'hex'),'mime','application/pdf','extraction_version','test','partial',false,'coverage',jsonb_build_object('complete',true),'chunks',jsonb_build_array(jsonb_build_object('ordinal',0,'content','Text OCR verificat','hash',encode(extensions.digest('Text OCR verificat','sha256'),'hex'))),'target_previous_extraction_id',old_id,'previous_text_sha256',encode(extensions.digest('','sha256'),'hex'),'target_pages','[1]'::jsonb);
 if verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb) then raise exception 'TEST: nonexistent marker accepted';end if;
 begin
  perform cloud_commit_v1(t,owner_id,1,j,'document',body-'target_previous_extraction_id');raise exception 'TEST: old worker bypassed target guard';
 exception when sqlstate '40001' then null;end;
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body||jsonb_build_object('target_pages','[2]'::jsonb));raise exception 'TEST: unexpected target pages accepted';
 exception when sqlstate '40001' then null;end;
 if (select active_extraction_id from source_documents where id=d)<>old_id then raise exception 'TEST: failed target changed extraction';end if;
 -- A concurrent extraction wins before commit; neither target data nor marker may be saved.
 update source_documents set active_extraction_id=gen_random_uuid() where id=d;
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body);raise exception 'TEST: stale extraction accepted';
 exception when sqlstate '40001' then null;end;
 if exists(select 1 from cloud_checkpoints where task_id=t and item_key='targeted-ocr:'||j||':'||d) then raise exception 'TEST: failed commit left marker';end if;
 update source_documents set active_extraction_id=old_id where id=d;
 update source_documents set extracted_text='Edició concurrent' where id=d;
 begin
  perform cloud_commit(t,owner_id,1,j,'document',body);raise exception 'TEST: changed original text accepted';
 exception when sqlstate '40001' then null;end;
 update source_documents set extracted_text=null where id=d;
 perform cloud_commit(t,owner_id,1,j,'document',body);
 select active_extraction_id into new_id from source_documents where id=d;
 if new_id=old_id or not verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb) or (select chunk_count from source_documents where id=d)<>1 then raise exception 'TEST: atomic marker or chunk missing';end if;
 -- Simulates process death immediately after commit: no subsequent checkpoint is needed.
 if not verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb) then raise exception 'TEST: resume failed';end if;
 begin
  perform verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[2]'::jsonb);raise exception 'TEST: changed pages accepted';
 exception when sqlstate '40001' then null;end;
 update source_documents set active_extraction_id=gen_random_uuid() where id=d;
 begin
  perform verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb);raise exception 'TEST: later extraction accepted';
 exception when sqlstate '40001' then null;end;
 update source_documents set active_extraction_id=new_id,storage_path=path||'-changed' where id=d;
 begin
  perform verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb);raise exception 'TEST: later source accepted';
 exception when sqlstate '40001' then null;end;
 update source_documents set storage_path=path,extracted_text='Edició posterior' where id=d;
 begin
  perform verify_targeted_ocr_checkpoint(t,owner_id,1,j,d,'[1]'::jsonb);raise exception 'TEST: modified stored text accepted';
 exception when sqlstate '40001' then null;end;
end $$;
