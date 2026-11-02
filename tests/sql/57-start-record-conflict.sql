-- Fixture trigger causes a late transactional conflict after task creation.
-- The SQL runner wraps the complete file in a rollback transaction.
create function pg_temp.test_start_record_conflict() returns trigger language plpgsql as $$
begin
 if current_setting('test.start_conflict',true)='on' and old.source_record_id like 'START-CONFLICT-%' then
  raise exception 'T19_DEDUP_BUSY' using errcode='40001';
 end if;
 return new;
end $$;
create trigger zzzz_test_start_conflict before update of processing_status on public.source_records for each row execute function pg_temp.test_start_record_conflict();
update app_settings set enabled=true where key='processing_enabled';
do $$
declare sid uuid:=gen_random_uuid();sid2 uuid:=gen_random_uuid();sid3 uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();run_ uuid;job_ uuid;result_ jsonb;before_runs bigint;before_tasks bigint;before_snapshots bigint;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values
 (sid,'contractacions','START-CONFLICT-BEGIN','Contract','Synthetic'),
 (sid2,'contractacions','START-CONFLICT-RETRY','Contract','Synthetic'),
 (sid3,'concerts','START-CONFLICT-OCR','Concert','Synthetic');
 insert into pipeline_runs(status) values('ready') returning id into run_;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,sid2,'ready') returning id into job_;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,storage_path,storage_sha256)
 values(doc,sid3,'https://example.invalid/doc',doc::text,'publication','fetched','application/pdf','cases/'||sid3||'/documents/'||doc||'/'||repeat('a',64)||'.pdf',repeat('a',64));
 select count(*) into before_runs from pipeline_runs;select count(*) into before_tasks from worker_tasks;select count(*) into before_snapshots from job_snapshots;
 perform set_config('test.start_conflict','on',true);
 begin perform begin_record_operation(sid,'prepare','local');raise exception 'TEST: begin did not abort';exception when sqlstate '40001' then if sqlerrm<>'T19_DEDUP_BUSY' then raise;end if;end;
 begin perform retry_job_operation(sid2,job_,'prepare','local');raise exception 'TEST: retry did not abort';exception when sqlstate '40001' then if sqlerrm<>'T19_DEDUP_BUSY' then raise;end if;end;
 begin perform begin_targeted_ocr(sid3,null,'vercel_workflow',doc,array[1,3]);raise exception 'TEST: OCR begin did not abort';exception when sqlstate '40001' then if sqlerrm<>'T19_DEDUP_BUSY' then raise;end if;end;
 if (select count(*) from pipeline_runs)<>before_runs or (select count(*) from worker_tasks)<>before_tasks or (select count(*) from job_snapshots)<>before_snapshots or exists(select 1 from pipeline_jobs where source_record_id in(sid,sid3)) then raise exception 'Conflict left partial task, job, run or snapshot';end if;
 perform set_config('test.start_conflict','off',true);
 result_:=begin_record_operation(sid,'prepare','local');
 if not exists(select 1 from worker_tasks where id=(result_->>'taskId')::uuid) or (select count(*) from pipeline_jobs where source_record_id=sid)<>1 then raise exception 'Begin retry did not create one task';end if;
 result_:=retry_job_operation(sid2,job_,'prepare','local');
 if not exists(select 1 from worker_tasks where id=(result_->>'taskId')::uuid) or (select count(*) from pipeline_jobs where source_record_id=sid2)<>1 then raise exception 'Expected-job retry did not create one task';end if;
 result_:=begin_targeted_ocr(sid3,null,'vercel_workflow',doc,array[1,3]);
 if not exists(select 1 from worker_tasks where id=(result_->>'taskId')::uuid) or (select count(*) from pipeline_jobs where source_record_id=sid3)<>1 then raise exception 'Targeted OCR retry did not create one task';end if;
 if (select parameters->'targeted_ocr'->'pages' from pipeline_runs where id=(result_->>'runId')::uuid) is distinct from '[1,3]'::jsonb then raise exception 'Targeted OCR scope changed';end if;
end $$;
