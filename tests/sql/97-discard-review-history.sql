-- Requires pg_temp.discard_fixture() from 07-delete.sql, isolated DB only.
create function pg_temp.discard_conveni_fixture() returns jsonb language plpgsql as $$
declare sid uuid:=gen_random_uuid();jid uuid;run uuid;result jsonb;
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'convenis','DELETE-CONVENI-'||sid,'Conveni','Conveni sintètic');
 insert into public.pipeline_runs default values returning id into run;
 insert into public.pipeline_jobs(run_id,source_record_id,status,preparation_status) values(run,sid,'ready','ready') returning id into jid;
 perform public.persist_analysis(jid,(select id from public.catalog_versions where active and validated limit 1),'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Descarte ficticio","service_description":"Fixture","target_population":"Fixture"}','[]','[{"content":"fixture"}]');
 select jsonb_build_object('id',id,'job_id',job_id,'result_token',result_token) into result from public.current_record_results where id=sid and destination='discarded';
 if result is null then raise exception 'CONVENI_NOT_DISCARDED';end if;return result;
end $$;
create function pg_temp.discard_proposal(sel jsonb) returns uuid language plpgsql as $$
declare rid uuid:=(sel->>'id')::uuid;jid uuid:=(sel->>'job_id')::uuid;uid uuid:=gen_random_uuid();doc uuid:=gen_random_uuid();
begin
 insert into public.source_documents(id,source_record_id,url,url_hash,document_type) values(doc,rid,'https://fixture.invalid/'||doc,doc::text,'annex');
 insert into public.record_units(id,source_record_id,pipeline_job_id,unit_key,status,document_id) values(uid,rid,jid,'fixture-pending','draft',doc);
 insert into public.conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,document_revisions) values(jid,rid,public.conveni_source_hash(rid),(select id from public.catalog_versions where active and validated limit 1),'{}','{}');
 insert into public.conveni_unit_proposals(job_id,unit_id,data) values(jid,uid,'{}');return uid;
end $$;
do $$
declare global_case jsonb;mixed_case jsonb;concept_case jsonb;group_case jsonb;binding_case jsonb;clean_case jsonb;before_ bigint;uid uuid;task uuid;
begin
 global_case:=pg_temp.discard_fixture();mixed_case:=pg_temp.discard_fixture();concept_case:=pg_temp.discard_fixture();group_case:=pg_temp.discard_fixture();binding_case:=pg_temp.discard_fixture();clean_case:=pg_temp.discard_conveni_fixture();
 insert into conveni_independent_experiment.global_export_receipts(event_id,snapshot,content_sha256)
 values(gen_random_uuid(),jsonb_build_object('year',null,'records',jsonb_build_array(jsonb_build_object('record_id',global_case->>'id'))),repeat('a',64));
 insert into conveni_independent_experiment.mixed_receipts(event_id,content_sha256,snapshot)
 values(gen_random_uuid(),repeat('b',64),jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'snapshot',jsonb_build_object('source_record_id',mixed_case->>'id'))));
 uid:=pg_temp.discard_proposal(concept_case);
 insert into public.conveni_concept_review_events(id,source_record_id,job_id,unit_id,concept_index,concept_hash,sequence,outcome,reason,selected_citation,social_confirmed,source_hash,document_revisions,catalog_version_id,concept_snapshot)
 values(gen_random_uuid(),(concept_case->>'id')::uuid,(concept_case->>'job_id')::uuid,uid,0,repeat('c',64),1,'insufficient','Motiu sintètic','{}',false,'fixture','{}',(select id from public.catalog_versions where active and validated limit 1),'{}');
 uid:=pg_temp.discard_proposal(group_case);
 insert into public.conveni_group_preparation_events(id,source_record_id,job_id,unit_id,sequence,group_hash,source_hash,analysis_hash,document_revisions,concept_heads,catalog_version_id,service_code,amount_cents,proposed_amount_state,amount_literal,total_citation,identity_citation,confirmations,reason,group_snapshot)
 values(gen_random_uuid(),(group_case->>'id')::uuid,(group_case->>'job_id')::uuid,uid,1,repeat('d',64),'fixture',repeat('e',64),'{}','[]',(select id from public.catalog_versions where active and validated limit 1),'1',100,'planned','1,00','{}','{}','{}','Motiu sintètic','{}');
 insert into public.worker_tasks(task_type,run_id,status) select 'process_run',run_id,'completed' from public.pipeline_jobs where id=(binding_case->>'job_id')::uuid returning id into task;
 insert into public.conveni_receipt_bindings(task_id,job_id,wire_hash) values(task,(binding_case->>'job_id')::uuid,'prepared-json-v1:'||repeat('f',64));
 select count(*) into before_ from public.storage_purge_batches;
 begin perform public.delete_discarded_records(jsonb_build_array(global_case,clean_case),2);raise exception 'TEST_GLOBAL_HISTORY_DELETED';exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 begin perform public.delete_discarded_records(jsonb_build_array(mixed_case),1);raise exception 'TEST_MIXED_HISTORY_DELETED';exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 begin perform public.delete_discarded_records(jsonb_build_array(concept_case),1);raise exception 'TEST_CONCEPT_HISTORY_DELETED';exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 begin perform public.delete_discarded_records(jsonb_build_array(group_case),1);raise exception 'TEST_GROUP_HISTORY_DELETED';exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 begin perform public.delete_discarded_records(jsonb_build_array(binding_case),1);raise exception 'TEST_BINDING_HISTORY_DELETED';exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 if (select count(*) from public.source_records where id in ((global_case->>'id')::uuid,(mixed_case->>'id')::uuid,(concept_case->>'id')::uuid,(group_case->>'id')::uuid,(binding_case->>'id')::uuid,(clean_case->>'id')::uuid))<>6
  or (select count(*) from public.storage_purge_batches)<>before_ then raise exception 'HISTORY_DELETE_PARTIAL';end if;
 perform pg_temp.discard_proposal(clean_case);
 perform public.delete_discarded_records(jsonb_build_array(clean_case),1);
 if exists(select 1 from public.source_records where id=(clean_case->>'id')::uuid) then raise exception 'CLEAN_DELETE_FAILED';end if;
end $$;
