do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;v text;result record;
begin
 select id into strict v from catalog_versions where active and validated;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'convenis','PENDING-'||sid,'Conveni','Conveni de prova','conveni');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'needs_review') returning id into j;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit,reviewed_classification,reviewed_at)
 values(j,sid,v,'convenis-sprint2-v1','insufficient_evidence','[]','Propostes per receptor','','','[]',jsonb_build_object('rule','review_by_recipient'),'in_portfolio',now());
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer)
 values(sid,j,'in_portfolio','{}','approved','Revisió parcial d’una unitat','local_user');
 select * into strict result from current_record_results where id=sid;
 if result.destination<>'review' or result.classification is not null or result.human_reviewed or result.review_decision is not null then raise exception 'Pending unit review presented as an aggregate decision';end if;
 update analysis_results set reliability_status='invalidated' where pipeline_job_id=j;
 select * into strict result from current_record_results where id=sid;
 if result.destination<>'issues' then raise exception 'Invalidated result bypassed technical guard';end if;
 delete from review_decisions where pipeline_job_id=j;
 update analysis_results set reliability_status='valid',rule_audit=jsonb_build_object('rule','other'),reviewed_classification=null,reviewed_at=null where pipeline_job_id=j;
 select * into strict result from current_record_results where id=sid;
 if result.destination<>'issues' or result.classification<>'insufficient_evidence' then raise exception 'Real insufficient result changed';end if;
end $$;
