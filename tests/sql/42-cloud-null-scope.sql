do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();ra uuid;rb uuid;ja uuid;jb uuid;run_task uuid;record_task uuid;owner_id uuid:=gen_random_uuid();doc_b uuid:=gen_random_uuid();
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(a,'concerts',a::text,'Concert','A'),(b,'concerts',b::text,'Concert','B');
 insert into pipeline_runs default values returning id into ra;insert into pipeline_runs default values returning id into rb;
 insert into pipeline_jobs(run_id,source_record_id,status) values(ra,a,'selected') returning id into ja;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rb,b,'selected') returning id into jb;
 insert into worker_tasks(run_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until)
 values(ra,'prepare_run','vercel_workflow','running',owner_id,1,now()+interval '4 minutes') returning id into run_task;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until)
 values(a,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '4 minutes') returning id into record_task;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(doc_b,b,'https://example.invalid/b',doc_b::text,'publication','fetched');
 begin perform cloud_commit_v1(run_task,owner_id,1,jb,'ready','{}');raise exception 'TEST: other run accepted in direct writer';
 exception when raise_exception then if sqlerrm<>'CLOUD_SCOPE' then raise;end if;end;
 if (select status from pipeline_jobs where id=jb)<>'selected' then raise exception 'Foreign job modified';end if;
 begin perform verify_targeted_ocr_checkpoint(run_task,owner_id,1,jb,doc_b,'[1]');raise exception 'TEST: other run accepted for targeted OCR';
 exception when raise_exception then if sqlerrm<>'CLOUD_SCOPE' then raise;end if;end;
 begin perform cloud_commit_v1(record_task,owner_id,1,jb,'ready','{}');raise exception 'TEST: other record accepted in direct writer';
 exception when raise_exception then if sqlerrm<>'CLOUD_SCOPE' then raise;end if;end;
 begin perform verify_targeted_ocr_checkpoint(record_task,owner_id,1,jb,doc_b,'[1]');raise exception 'TEST: other record accepted for targeted OCR';
 exception when raise_exception then if sqlerrm<>'CLOUD_SCOPE' then raise;end if;end;
 perform cloud_commit_v1(run_task,owner_id,1,ja,'ready','{}');
 if (select status from pipeline_jobs where id=ja)<>'ready' then raise exception 'Valid run scope rejected';end if;
end $$;
