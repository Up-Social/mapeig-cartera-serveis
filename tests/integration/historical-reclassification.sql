\set ON_ERROR_STOP on
begin;
do $$ begin if current_database() not like 'cartera_cloud_test_%' then raise exception 'Isolated test database required';end if;end $$;
-- Fixtures are synthetic; rollback preserves the isolated database too.
update catalog_versions set active=false where active;
insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
values('history-test-catalog','https://example.org/test','https://example.org/test',now(),current_date,'test','Fixture sintètica','Context fictici','{}',1,true,true);
insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
values('history-test-catalog','1.1','Servei fictici',null,'service','Fixture','Fixture','Fixture','Fixture','{}');
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount)
select 'contractacions','HISTORY-TEST-'||n,'contracte','Mostra fictícia','','',0,'',0 from generate_series(1,59) n;
insert into pipeline_runs(id,status,stage,parameters) values('10000000-0000-4000-8000-000000000088','needs_review','review','{}');
insert into pipeline_jobs(run_id,source_record_id,status,preparation_status)
select '10000000-0000-4000-8000-000000000088',id,'needs_review','ready' from source_records where source_record_id like 'HISTORY-TEST-%';
-- Existing legacy proposals (using an eligible code, avoiding prohibited new parents).
insert into matching_candidates(pipeline_job_id,target_catalog,target_code,target_name,rank,score,rationale,engine,engine_version,catalog_version_id)
select j.id,'official',s.service_code,s.service_name,1,0.8,'Mostra antiga','mock','legacy',s.version_id
from pipeline_jobs j join source_records r on r.id=j.source_record_id cross join lateral(select * from eligible_official_services order by service_code limit 1) s
where r.source_record_id like 'HISTORY-TEST-%' and r.source_record_id<>'HISTORY-TEST-59';
insert into review_decisions(source_record_id,decision,reason) select id,'rejected','Decisió preservada' from source_records where source_record_id='HISTORY-TEST-56';
insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
select j.id,r.id,v.id,'test','insufficient_evidence','[]','Mostra normativa prèvia','','','[]' from source_records r join pipeline_jobs j on j.source_record_id=r.id cross join catalog_versions v where r.source_record_id='HISTORY-TEST-57' and v.active and v.validated;
update pipeline_jobs set status='matching' where source_record_id=(select id from source_records where source_record_id='HISTORY-TEST-58');
set local role service_role;
do $$ declare rid uuid;tid uuid;jid uuid;sid uuid;o uuid:=gen_random_uuid();g bigint;before_n int;begin
 select count(*) into before_n from matching_candidates;
 rid:=cloud_reclassify_history();
 if rid is null or rid<>cloud_reclassify_history() then raise exception 'non-idempotent campaign';end if;
 if (select count(*) from pipeline_jobs where run_id=rid)<>55 then raise exception 'wrong cohort';end if;
 if (select count(*) from worker_tasks where run_id=rid)<>1 then raise exception 'duplicate task';end if;
 if (select count(*) from matching_candidates)<>before_n then raise exception 'legacy candidates lost';end if;
 if exists(select 1 from pipeline_jobs j join source_records s on s.id=j.source_record_id where j.run_id=rid and s.source_record_id in ('HISTORY-TEST-56','HISTORY-TEST-57','HISTORY-TEST-58','HISTORY-TEST-59')) then raise exception 'protected record selected';end if;
 select id into tid from worker_tasks where run_id=rid;
 select id,source_record_id into jid,sid from pipeline_jobs where run_id=rid order by id limit 1;
 g:=cloud_claim(tid,o,'cloud-v1');
 -- Human review after enqueue must prevent every subsequent domain write.
 perform review_analysis(sid,'reject',null,null,'Revisió durant la campanya');
 perform cloud_commit(tid,o,g,jid,'ready','{}');
 if (select processing_status::text from source_records where id=sid)<>'rebutjat' then raise exception 'human decision overwritten';end if;
 if (select status from pipeline_jobs where id=jid)<>'rejected' then raise exception 'reviewed job remains pending';end if;
 perform cloud_commit(tid,o,g,jid,'analysis','{}');
 if exists(select 1 from analysis_results where pipeline_job_id=jid) then raise exception 'new analysis after review';end if;
 -- Stale owners cannot write even after the human guard.
 begin perform cloud_commit(tid,gen_random_uuid(),g,jid,'ready','{}');raise exception 'STALE_ACCEPTED';exception when others then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 update pipeline_runs set parameters=parameters||'{"provider_budget_usd":0.03}' where id=rid;
 if not cloud_budget_reserve(tid,o,g,'one','gpt-4o-mini',4000) then raise exception 'initial budget refused';end if;
 if not cloud_budget_reserve(tid,o,g,'one','gpt-4o-mini',4000) then raise exception 'reservation not idempotent';end if;
 if cloud_budget_reserve(tid,o,g,'two','gpt-4o-mini',4000) then raise exception 'budget exceeded';end if;
 perform cloud_budget_settle(tid,o,g,'one','{}');
 if cloud_budget_reserve(tid,o,g,'two','gpt-4o-mini',4000) then raise exception 'unknown usage freed budget';end if;
 perform cloud_budget_settle(tid,o,g,'one','{"input_tokens":1000,"output_tokens":100}');
 perform cloud_budget_settle(tid,o,g,'one','{"input_tokens":0,"output_tokens":0}');
 if (select actual_usd from cloud_budget_reservations where task_id=tid and item_key='one')<>0.00021 then raise exception 'incorrect usage settlement';end if;
 if not cloud_budget_reserve(tid,o,g,'two','gpt-4o-mini',4000) then raise exception 'settled budget unavailable';end if;
 if cloud_budget_reserve(tid,o,g,'three','unknown-model',4000) then raise exception 'unknown pricing accepted';end if;
end $$;
rollback;
