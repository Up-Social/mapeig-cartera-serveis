\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() not like 'cartera_cloud_test_%' then raise exception 'Isolated test database required';end if;end $$;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount)
select 'contractacions','RECOVERY-TEST-'||n,'contracte','Mostra sintètica','','',0,'',0 from generate_series(1,4) n;
set local role service_role;
do $$ declare rid uuid;other_run uuid;tid uuid;ids uuid[];jid uuid;sid uuid;g bigint;o uuid:=gen_random_uuid();begin
 select array_agg(id order by source_record_id) into ids from source_records where source_record_id like 'RECOVERY-TEST-%';
 rid:=cloud_create_run(ids,false);select id into tid from worker_tasks where run_id=rid;
 update pipeline_jobs set status='error',error_kind='validation',error_message='Synthetic validation',preparation_status='ready' where run_id=rid;
 update worker_tasks set execution_state='completed',status='completed' where id=tid;
 update pipeline_jobs set status='needs_review' where run_id=rid and source_record_id=ids[2];
 insert into review_decisions(source_record_id,decision,reason) values(ids[3],'rejected','Synthetic human decision');
 insert into pipeline_runs(status,stage,parameters) values('needs_review','review','{}') returning id into other_run;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(other_run,ids[4],'needs_review',now()+interval '1 second');
 select id into jid from pipeline_jobs where run_id=rid and source_record_id=ids[1];
 insert into cloud_checkpoints(task_id,item_key,value) values(tid,'ai:'||jid||':matching','{"state":"received","response":{"id":"mock"}}'),(tid,jid||':audit-ready','true'),(tid,'ai:'||jid||':positive-audit-v2','{"state":"sending","attempt":1}');
 if cloud_retry_validation(rid,'validation-v1')<>tid then raise exception 'task replaced';end if;
 if cloud_retry_validation(rid,'validation-v1')<>tid then raise exception 'repeated recovery';end if;
 if (select count(*) from pipeline_jobs where run_id=rid and status='ready')<>1 then raise exception 'wrong recovery cohort';end if;
 if (select count(*) from worker_tasks where run_id=rid)<>1 then raise exception 'duplicate task';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=tid and item_key='ai:'||jid||':matching' and value->>'state'='received') then raise exception 'cached result lost';end if;
 if not exists(select 1 from cloud_checkpoints where task_id=tid and item_key='recovery:validation-v1:ai:'||jid||':positive-audit-v2' and value->>'state'='sending') then raise exception 'old diagnostic lost';end if;
 g:=cloud_claim(tid,o,'cloud-v1');
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':contract-repair-v1','{"input_tokens":100,"output_tokens":10}');
 perform cloud_provider_usage(tid,o,g,'usage:'||jid||':contract-repair-v1','{"input_tokens":100,"output_tokens":10}');
 if (select actual_input_tokens from pipeline_runs where id=rid)<>100 then raise exception 'duplicate repair usage';end if;
 perform cloud_finish(tid,o,g,'completed');
 update pipeline_jobs set status='error',error_kind='validation' where id=jid;
 update cloud_checkpoints set value='{"state":"sending","attempt":1}' where task_id=tid and item_key='ai:'||jid||':matching';
 begin perform cloud_retry_validation(rid,'validation-v2');raise exception 'UNKNOWN_RETRIED';exception when others then if sqlerrm<>'Unknown provider outcome' then raise;end if;end;
 if (select status from pipeline_jobs where id=jid)<>'error' then raise exception 'partial recovery';end if;
 update cloud_checkpoints set value='{"state":"received","response":{"id":"mock"}}' where task_id=tid and item_key='ai:'||jid||':matching';
 update cloud_checkpoints set value='{"state":"rejected","attempt":1,"http_status":400}' where task_id=tid and item_key='ai:'||jid||':positive-audit-v2';
 perform cloud_retry_validation(rid,'validation-v2');
 if not exists(select 1 from cloud_checkpoints where task_id=tid and item_key='recovery:validation-v2:ai:'||jid||':positive-audit-v2' and value->>'state'='rejected') then raise exception 'confirmed rejection archive missing';end if;
end $$;
rollback;
