do $$
declare sid uuid; baseline uuid; check_job uuid; r uuid; review_id uuid;
begin
 insert into source_records(source_dataset,source_record_id,mechanism,title,financing_type)
 values('concerts','VERIFY-APPROVED','Concert social','Fixture concert','concert') returning id into sid;
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at)
 values(r,sid,'approved',now()-interval '1 day') returning id into baseline;
 insert into review_decisions(source_record_id,pipeline_job_id,decision,classification,reason,reviewer)
 values(sid,baseline,'approved','in_portfolio','Human decision preserved','fixture') returning id into review_id;
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,verification_only)
 values(r,sid,'selected',true) returning id into check_job;
 if not exists(select 1 from current_record_results where id=sid and job_id=baseline and human_reviewed and destination='approved') then
  raise exception 'Comparative verification replaced approved result'; end if;
 update pipeline_jobs set status='error' where id=check_job;
 if not exists(select 1 from current_record_results where id=sid and job_id=baseline and review_decision='approved') then
  raise exception 'Verification error removed human approval'; end if;
 if not exists(select 1 from review_decisions where id=review_id and pipeline_job_id=baseline) then raise exception 'Human history changed'; end if;
 update pipeline_jobs set verification_only=false where id=check_job;
 if not exists(select 1 from current_record_results where id=sid and job_id=check_job and destination='issues') then
  raise exception 'Normal reprocessing stopped replacing the old attempt'; end if;
 if (select count(*) from current_record_results where id=sid)<>1 then raise exception 'Duplicated result'; end if;
end $$;
