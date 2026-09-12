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
