create function pg_temp.discard_fixture(batch uuid default null) returns jsonb language plpgsql as $$
declare sid uuid:=gen_random_uuid();j uuid;v text;result jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions','DELETE-FIXTURE-'||sid,'Contractació','Fictici '||sid);
 if batch is null then insert into pipeline_runs default values returning id into batch;end if;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) values(batch,sid,'ready','ready') returning id into j;
 select id into v from catalog_versions where active and validated limit 1;
 perform persist_analysis(j,v,'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Descarte ficticio","service_description":"Fixture","target_population":"Fixture"}','[]','[{"content":"fixture"}]');
 select jsonb_build_object('id',id,'job_id',job_id,'result_token',result_token) into result from current_record_results where id=sid;
 return result;
end $$;
do $$
declare a jsonb;b jsonb;c jsonb;r uuid;task uuid;doc uuid;purge uuid;catalog_count integer;
begin
 select count(*) into catalog_count from official_services;
 insert into pipeline_runs default values returning id into r;
 a:=pg_temp.discard_fixture(r);b:=pg_temp.discard_fixture(r);c:=pg_temp.discard_fixture(r);
 begin perform delete_discarded_records(jsonb_build_array(a,a),2);raise exception 'TEST: repeated UUID accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform delete_discarded_records(jsonb_build_array(a,b||'{"result_token":"old"}'::jsonb),2);raise exception 'TEST: stale result accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if not exists(select 1 from source_records where id=(a->>'id')::uuid) then raise exception 'Partial deletion';end if;
 insert into worker_tasks(task_type,run_id,status) values('process_run',r,'running') returning id into task;
 begin perform delete_discarded_records(jsonb_build_array(a),1);raise exception 'TEST: active worker accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update worker_tasks set status='completed' where id=task;
 insert into cloud_checkpoints(task_id,item_key,value) values(task,'ai:'||(a->>'job_id')||':matching','{"state":"sending"}');
 begin perform delete_discarded_records(jsonb_build_array(a),1);raise exception 'TEST: unknown provider accepted';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 update cloud_checkpoints set value='{"state":"received","response":{"id":"fictional"}}' where task_id=task;
 insert into cloud_checkpoints(task_id,item_key,value) values(task,'workflow','{"id":"shared-fixture"}'),(task,'ai:'||(c->>'job_id')||':matching','{"state":"received"}');
 insert into source_documents(source_record_id,url,url_hash,document_type) values((a->>'id')::uuid,'https://example.invalid/delete','delete-fixture','annex') returning id into doc;
 insert into cloud_checkpoints(task_id,item_key,value) values(task,'original:'||doc,jsonb_build_object('path',task||'/'||doc||'/fixture-hash'));
 purge:=delete_discarded_records(jsonb_build_array(a,b),2);
 if exists(select 1 from source_records where id in((a->>'id')::uuid,(b->>'id')::uuid)) then raise exception 'Sources remain';end if;
 if not exists(select 1 from source_records where id=(c->>'id')::uuid) then raise exception 'Shared record deleted';end if;
 if not exists(select 1 from worker_tasks where id=task) or not exists(select 1 from cloud_checkpoints where task_id=task and item_key='ai:'||(c->>'job_id')||':matching') then raise exception 'Shared task data deleted';end if;
 if exists(select 1 from cloud_checkpoints where task_id=task and item_key like '%'||(a->>'job_id')||'%') then raise exception 'Private checkpoint remains';end if;
 if (select selected_count from pipeline_runs where id=r)<>1 then raise exception 'Shared batch count wrong';end if;
 if (select count(*) from official_services)<>catalog_count then raise exception 'Official catalog changed';end if;
 if not exists(select 1 from storage_purge_items where batch_id=purge and path=task||'/'||doc||'/fixture-hash' and status='pending') then raise exception 'Missing purge work';end if;
 perform delete_discarded_records(jsonb_build_array(c),1);
 if not exists(select 1 from pipeline_runs where id=r and selected_count=0 and status='completed') then raise exception 'Empty batch lost';end if;
end $$;

reset role;
create table public.workflow_test_unexpected_reference(id uuid references public.source_records(id));
grant select,insert on public.workflow_test_unexpected_reference to service_role;
set local role service_role;
do $$declare a jsonb;begin
 a:=pg_temp.discard_fixture();insert into workflow_test_unexpected_reference values((a->>'id')::uuid);
 begin perform delete_discarded_records(jsonb_build_array(a),1);raise exception 'Unexpected dependency accepted';exception when foreign_key_violation then null;end;
 if not exists(select 1 from source_records where id=(a->>'id')::uuid) or not exists(select 1 from analysis_results where pipeline_job_id=(a->>'job_id')::uuid) then raise exception 'Rollback incomplete';end if;
end $$;
