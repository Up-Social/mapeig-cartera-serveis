do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();da1 uuid:=gen_random_uuid();da2 uuid:=gen_random_uuid();db1 uuid:=gen_random_uuid();ra uuid;rb uuid;ja uuid;jb uuid;ta uuid;tb uuid;t1 uuid;t2 uuid;t3 uuid;outcome jsonb;
 legacy text:='ocr:'||repeat('a',64)||':1:dpi300:readable-markdown-v4';modern text;resource_before jsonb;
begin
 update app_settings set enabled=true where key='processing_enabled';
 select to_jsonb(r) into resource_before from cloud_resources r where name='sandbox';
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(a,'concerts',a::text,'Concert','A'),(b,'concerts',b::text,'Concert','B');
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values
  (da1,a,'https://example.invalid/a1',da1::text,'publication','fetched'),
  (da2,a,'https://example.invalid/a2',da2::text,'annex','fetched'),
  (db1,b,'https://example.invalid/b1',db1::text,'publication','fetched');
 insert into pipeline_runs default values returning id into ra;insert into pipeline_runs default values returning id into rb;
 insert into pipeline_jobs(run_id,source_record_id,status) values(ra,a,'error') returning id into ja;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rb,b,'error') returning id into jb;
 insert into worker_tasks(run_id,pipeline_job_id,task_type,executor,status,execution_state) values(ra,ja,'process_run','vercel_workflow','completed','completed') returning id into ta;
 insert into worker_tasks(run_id,pipeline_job_id,task_type,executor,status,execution_state) values(rb,jb,'process_run','vercel_workflow','completed','completed') returning id into tb;
 insert into cloud_checkpoints(task_id,item_key,value) values(tb,legacy,jsonb_build_object('text',repeat('b',10000)));
 outcome:=begin_record_operation(a,'ocr','vercel_workflow');t1:=(outcome->>'taskId')::uuid;
 if exists(select 1 from cloud_checkpoints where task_id=t1 and item_key like 'legacy-ocr-pending:%') then raise exception 'Unrelated record blocked';end if;
 update worker_tasks set status='completed',execution_state='completed',created_at=now()+interval '1 second' where id=t1;
 insert into cloud_checkpoints(task_id,item_key,value) values(ta,legacy,jsonb_build_object('text',repeat('a',10000)));
 modern:='ocr-v2:'||da1||':'||repeat('b',64)||':1:dpi300:readable-markdown-v4';
 insert into cloud_checkpoints(task_id,item_key,value) values(t1,modern,'{"version":"ocr-page-v2","text":"fixture"}');
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd) values(t1,'ai:'||ja||':matching',0.02,0.01);
 outcome:=begin_record_operation(a,'ocr','vercel_workflow');t2:=(outcome->>'taskId')::uuid;
 if (select count(*) from cloud_checkpoints where task_id=t2 and item_key in ('legacy-ocr-pending:'||da1,'legacy-ocr-pending:'||da2))<>2 then raise exception 'Missing per-document marker';end if;
 if exists(select 1 from cloud_checkpoints where task_id=t2 and item_key='legacy-ocr-pending:'||db1) then raise exception 'Another record marked';end if;
 if exists(select 1 from cloud_checkpoints where task_id=t2 and item_key=legacy) then raise exception 'Legacy OCR payload was copied';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=t2 and item_key=modern and value->>'text'='fixture') then raise exception 'Modern checkpoint not preserved';end if;
 if exists(select 1 from cloud_checkpoints where task_id=t2 and item_key like 'legacy-ocr-pending:%' and (value is distinct from '{"version":"legacy-ocr-pending-v1"}'::jsonb or pg_column_size(value)>100)) then raise exception 'Marker is not minimal';end if;
 if not exists(select 1 from cloud_budget_reservations where task_id=t2 and item_key='ai:'||ja||':matching' and reserved_usd=0 and actual_usd=0) then raise exception 'Historical cost was counted twice';end if;
 update worker_tasks set status='completed',execution_state='completed',created_at=now()+interval '2 seconds' where id=t2;
 outcome:=begin_record_operation(a,'ocr','vercel_workflow');t3:=(outcome->>'taskId')::uuid;
 if (select count(*) from cloud_checkpoints where task_id=t3 and item_key in ('legacy-ocr-pending:'||da1,'legacy-ocr-pending:'||da2))<>2 then raise exception 'Markers did not survive another recovery';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=t3 and item_key=modern) then raise exception 'Modern checkpoint lost on later recovery';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=ta and item_key=legacy and length(value->>'text')=10000) then raise exception 'Historical OCR changed';end if;
 if (select to_jsonb(r) from cloud_resources r where name='sandbox') is distinct from resource_before then raise exception 'Recovery acquired Sandbox';end if;
end $$;
