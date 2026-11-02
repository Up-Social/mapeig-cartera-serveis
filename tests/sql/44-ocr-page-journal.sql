do $$
declare sid uuid:=gen_random_uuid();other_sid uuid:=gen_random_uuid();d uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();other_doc uuid:=gen_random_uuid();rid uuid;other_run uuid;j uuid;other_job uuid;t1 uuid;t2 uuid;owner1 uuid:=gen_random_uuid();owner2 uuid:=gen_random_uuid();sha text:=repeat('a',64);image text:=repeat('b',64);path text;url text:='https://example.invalid/a';v text:='readable-markdown-v4';payload jsonb;page_key text;state text;
begin
 update app_settings set enabled=true where key='processing_enabled';
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'concerts',sid::text,'Concert','A'),(other_sid,'concerts',other_sid::text,'Concert','B');
 insert into pipeline_runs default values returning id into rid;insert into pipeline_runs default values returning id into other_run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 insert into pipeline_jobs(run_id,source_record_id,status) values(other_run,other_sid,'ready') returning id into other_job;
 insert into worker_tasks(run_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(rid,'prepare_run','vercel_workflow','running',owner1,1,now()+interval '4 minutes') returning id into t1;
 insert into worker_tasks(run_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until) values(rid,'process_run','vercel_workflow','running',owner2,1,now()+interval '4 minutes') returning id into t2;
 path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256) values(d,sid,url,d::text,'publication','fetched',path,sha),
  (d2,sid,'https://example.invalid/second',d2::text,'publication','fetched','cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf',sha),
  (other_doc,other_sid,'https://example.invalid/other',other_doc::text,'publication','fetched','cases/'||other_sid||'/documents/'||other_doc||'/'||sha||'.pdf',sha);
 insert into cloud_checkpoints(task_id,item_key,value) values
  (t1,'pdf-input:'||d||':'||v,jsonb_build_object('sourceSha256',sha,'sourcePath',path,'sourceUrl',url,'snapshotHash',image)),
  (t2,'pdf-input:'||d||':'||v,jsonb_build_object('sourceSha256',sha,'sourcePath',path,'sourceUrl',url,'snapshotHash',image));
 if cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,0,300,v,'document_status',null)<>'new' then raise exception 'New document unavailable';end if;
 state:=cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'status',null);
 if state<>'new' then raise exception 'New page unavailable';end if;
 state:=cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'begin',null);
 if state<>'started' then raise exception 'Start not persisted';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,0,300,v,'document_status',null)<>'uncertain' then raise exception 'Missing preflight missed uncertainty';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,0,400,v,'document_status',null)<>'uncertain' then raise exception 'Changed DPI bypassed uncertainty';end if;
 -- A crash before or during OCR blocks both the same task and another recovery task.
 if cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'status',null)<>'uncertain' then raise exception 'Uncertain OCR not preserved';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,300,v,'begin',null)<>'uncertain' then raise exception 'Cross-task uncertain OCR repeated';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,400,v,'status',null)<>'uncertain' then raise exception 'Changed DPI bypassed uncertainty';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,2,300,v,'status',null)<>'new' then raise exception 'Pages incorrectly shared';end if;
 insert into cloud_checkpoints(task_id,item_key,value) values(t2,'pdf-input:'||d||':future-version',jsonb_build_object('sourceSha256',sha,'sourcePath',path,'sourceUrl',url,'snapshotHash',image));
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,300,'future-version','status',null)<>'uncertain' then raise exception 'Changed extraction version bypassed uncertainty';end if;
 update source_documents set storage_sha256=repeat('d',64),storage_path=path||'-new' where id=d;
 update cloud_checkpoints set value=jsonb_set(jsonb_set(value,'{sourceSha256}',to_jsonb(repeat('d',64))),'{sourcePath}',to_jsonb(path||'-new')) where task_id=t2 and item_key='pdf-input:'||d||':'||v;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,repeat('d',64),path||'-new',url,image,1,300,v,'status',null)<>'new' then raise exception 'Different source revision incorrectly shared';end if;
 update source_documents set storage_sha256=sha,storage_path=path where id=d;
 update cloud_checkpoints set value=jsonb_set(jsonb_set(value,'{sourceSha256}',to_jsonb(sha)),'{sourcePath}',to_jsonb(path)) where task_id=t2 and item_key='pdf-input:'||d||':'||v;

 update cloud_checkpoints set value=jsonb_set(value,'{snapshotHash}',to_jsonb(repeat('c',64))) where task_id=t2 and item_key='pdf-input:'||d||':'||v;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,repeat('c',64),1,300,v,'status',null)<>'uncertain' then raise exception 'Changed image bypassed uncertainty';end if;
 update cloud_checkpoints set value=jsonb_set(value,'{snapshotHash}',to_jsonb(image)) where task_id=t2 and item_key='pdf-input:'||d||':'||v;
 insert into cloud_checkpoints(task_id,item_key,value) values(t2,'pdf-input:'||d2||':'||v,jsonb_build_object('sourceSha256',sha,'sourcePath','cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf','sourceUrl','https://example.invalid/second','snapshotHash',image));
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d2,sha,'cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf','https://example.invalid/second',image,1,300,v,'status',null)<>'new' then raise exception 'Documents incorrectly shared';end if;
 begin perform cloud_ocr_page_journal_step(t2,owner2,1,other_job,other_doc,sha,'cases/'||other_sid||'/documents/'||other_doc||'/'||sha||'.pdf','https://example.invalid/other',image,1,300,v,'status',null);raise exception 'TEST: foreign record accepted';exception when raise_exception then if sqlerrm<>'CLOUD_SCOPE' then raise;end if;end;
 page_key:='ocr-v2:'||d||':'||sha||':1:dpi300:'||v;
 payload:=jsonb_build_object('version','ocr-page-v2','documentId',d,'sourceSha256',sha,'sourcePath',path,'sourceUrl',url,'page',1,'dpi',300,'text','text OCR','textHash',encode(extensions.digest('text OCR','sha256'),'hex'));
 begin perform cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'confirm',payload||'{"textHash":"bad"}'::jsonb);raise exception 'TEST: invalid text accepted';exception when raise_exception then if sqlerrm<>'OCR_JOURNAL_INVALID_RESULT' then raise;end if;end;
 if exists(select 1 from cloud_checkpoints where task_id=t1 and item_key=page_key) then raise exception 'Invalid result persisted';end if;
 update worker_tasks set lease_until=now()-interval '1 second' where id=t1;
 begin perform cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'confirm',payload);raise exception 'TEST: stale lease confirmed';exception when raise_exception then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 if (select q.state from cloud_ocr_page_journal q where q.task_id=t1 and q.document_id=d and q.page=1)<>'started' then raise exception 'Uncertain state lost';end if;
 update worker_tasks set lease_until=now()+interval '4 minutes' where id=t1;
 if cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'confirm',payload)<>'confirmed' then raise exception 'Result not confirmed';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=t1 and item_key=page_key and value=payload) or not exists(select 1 from cloud_ocr_page_journal where task_id=t1 and document_id=d and cloud_ocr_page_journal.state='confirmed') then raise exception 'Marker and page not committed together';end if;
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,300,v,'status',null)<>'existing' then raise exception 'Confirmed page outside task can be repeated';end if;
 if cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'verify',jsonb_build_object('textHash',payload->>'textHash'))<>'verified' then raise exception 'Confirmed page not verifiable';end if;
 insert into cloud_checkpoints(task_id,item_key,value) values(t2,page_key,payload);
 if cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,300,v,'verify',jsonb_build_object('textHash',payload->>'textHash'))<>'verified' then raise exception 'Safely copied page not verifiable';end if;
 update cloud_checkpoints set value=jsonb_set(value,'{text}',to_jsonb('altered'::text)) where task_id=t2 and item_key=page_key;
 begin perform cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,image,1,300,v,'verify',jsonb_build_object('textHash',payload->>'textHash'));raise exception 'TEST: modified page accepted';exception when raise_exception then if sqlerrm<>'OCR_JOURNAL_UNVERIFIED' then raise;end if;end;
 update cloud_checkpoints set value=payload where task_id=t2 and item_key=page_key;
 update cloud_checkpoints set value=jsonb_set(value,'{snapshotHash}',to_jsonb(repeat('c',64))) where task_id=t2 and item_key='pdf-input:'||d||':'||v;
 begin perform cloud_ocr_page_journal_step(t2,owner2,1,j,d,sha,path,url,repeat('c',64),1,300,v,'verify',jsonb_build_object('textHash',payload->>'textHash'));raise exception 'TEST: changed image accepted';exception when raise_exception then if sqlerrm<>'OCR_JOURNAL_UNVERIFIED' then raise;end if;end;
 update cloud_checkpoints set value=jsonb_set(value,'{snapshotHash}',to_jsonb(image)) where task_id=t2 and item_key='pdf-input:'||d||':'||v;
 insert into cloud_ocr_page_journal(task_id,document_id,source_sha256,source_path,source_url,snapshot_hash,page,dpi,extraction_version,state) values(t2,d,sha,path,url,repeat('c',64),1,400,v,'started');
 begin perform cloud_ocr_page_journal_step(t1,owner1,1,j,d,sha,path,url,image,1,300,v,'verify',jsonb_build_object('textHash',payload->>'textHash'));raise exception 'TEST: unresolved different image accepted';exception when raise_exception then if sqlerrm<>'OCR_JOURNAL_UNCERTAIN' then raise;end if;end;

 if has_table_privilege('anon','public.cloud_ocr_page_journal','select') or has_function_privilege('anon','public.cloud_ocr_page_journal_step(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,integer,text,text,jsonb)','execute') then raise exception 'Public journal access';end if;
end $$;
