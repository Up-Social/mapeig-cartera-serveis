\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() not like 'cartera_cloud_test_%' then raise exception 'Test database required';end if;end $$;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount)
select 'contractacions','CLOUD-TX-'||g,'contracte','Mostra fictícia '||g,'','',0,'',g from generate_series(1,51) g;
do $$ declare ids uuid[];rid uuid;tid uuid;owner uuid:=gen_random_uuid();gen bigint;jid uuid;sid uuid;begin
 select array_agg(id) into ids from source_records where source_record_id like 'CLOUD-TX-%';
 rid:=cloud_create_run(ids,false);
 if(select count(*) from pipeline_jobs where run_id=rid)<>51 then raise exception 'truncated batch';end if;
 select id into tid from worker_tasks where run_id=rid;
 gen:=cloud_claim(tid,owner,'test-v1');
 select id,source_record_id into jid,sid from pipeline_jobs where run_id=rid limit 1;
 begin perform cloud_create_run(ids,false);raise exception 'DUPLICATE_ACCEPTED';exception when others then if sqlerrm='DUPLICATE_ACCEPTED' then raise;end if;end;
 begin
 perform cloud_commit(tid,owner,gen,jid,'enrichment','{"model":"mock","enrichment":{"title":"Fictici","summary":"Fictici","confidence":0.9,"scope_facts":{}},"evidence":[{"id":"00000000-0000-4000-8000-000000000001"}]}');
 raise exception 'BAD_EVIDENCE_ACCEPTED';
 exception when others then if sqlerrm<>'CLOUD_EVIDENCE_SCOPE' then raise;end if;end;
 if exists(select 1 from record_enrichments where source_record_id=sid) then raise exception 'partial enrichment';end if;
 perform cloud_commit(tid,owner,gen,jid,'ready','{}');
 perform cloud_finish(tid,owner,gen,'pending');
 if exists(select 1 from claim_worker_task('legacy') where id=tid) then raise exception 'legacy claimed cloud';end if;
end $$;
rollback;
begin;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount,evidence_status)
values('contractacions','CLOUD-PHASE-TEST','contracte','Fictici','','',0,'',0,'ready');
do $$ declare sid uuid;tid uuid;rid uuid;begin
 select id into sid from source_records where source_record_id='CLOUD-PHASE-TEST';
 tid:=cloud_record_phase(sid,'enrich_record');
 if tid<>cloud_record_phase(sid,'enrich_record') then raise exception 'duplicate phase';end if;
 select run_id into rid from worker_tasks where id=tid;
 if rid is null or (select count(*) from pipeline_jobs where run_id=rid)<>1 then raise exception 'missing atomic job';end if;
end $$;
rollback;
begin;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount)
values('contractacions','CLOUD-DRAFT-TEST','contracte','Fictici','','',0,'',0);
set local role service_role;
do $$ declare sid uuid;rid uuid;tid uuid;begin
 select id into sid from source_records where source_record_id='CLOUD-DRAFT-TEST';
 rid:=cloud_create_draft(array[sid],'{}');
 if exists(select 1 from worker_tasks where run_id=rid) then raise exception 'draft started';end if;
 tid:=cloud_start_phase(rid,'prepare_run');
 if tid<>cloud_start_phase(rid,'prepare_run') then raise exception 'duplicate launch';end if;
end $$;
rollback;
begin;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount) values('contractacions','CLOUD-USAGE-TEST','contracte','Fictici','','',0,'',0);
do $$ declare sid uuid;rid uuid;tid uuid;jid uuid;o uuid:=gen_random_uuid();g bigint;begin
 select id into sid from source_records where source_record_id='CLOUD-USAGE-TEST';rid:=cloud_create_run(array[sid],false);
 select id into tid from worker_tasks where run_id=rid;select id into jid from pipeline_jobs where run_id=rid;g:=cloud_claim(tid,o,'cloud-v1');
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':analysis','{"input_tokens":100,"output_tokens":10}');
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':analysis','{"input_tokens":100,"output_tokens":10}');
 if (select actual_input_tokens from pipeline_runs where id=rid)<>100 then raise exception 'duplicated usage';end if;
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':positive-audit-v2','{"input_tokens":40,"output_tokens":4}');
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':positive-audit-v2','{"input_tokens":40,"output_tokens":4}');
 if (select actual_input_tokens from pipeline_runs where id=rid)<>140 then raise exception 'duplicated audit usage';end if;
end $$;
rollback;
