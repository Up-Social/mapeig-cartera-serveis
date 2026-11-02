do $$
declare sid uuid:=gen_random_uuid(); concert uuid:=gen_random_uuid(); contract uuid:=gen_random_uuid(); r uuid; r2 uuid; oldjob uuid; newjob uuid; mixjob uuid; contractjob uuid; ok boolean;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'convenis',sid::text,'Conveni','A'),(concert,'concerts',concert::text,'Concert','B'),(contract,'contractacions',contract::text,'Contractació','C');
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status) values(r,contract,'ready') returning id into contractjob;
 begin perform local_claim_matching_job(contractjob,contract);raise exception 'TEST: generic local matching claimed';exception when raise_exception then if sqlerrm not like 'LOCAL_TYPE_BLOCKED:%' then raise;end if;end;
 if (select status from pipeline_jobs where id=contractjob)<>'ready' then raise exception 'Generic block changed job';end if;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(r,sid,'ready','2000-01-01') returning id into oldjob;
 insert into pipeline_runs default values returning id into r2;
 insert into pipeline_jobs(run_id,source_record_id,status,created_at) values(r2,sid,'ready','2100-01-01') returning id into newjob;
 update source_records set processing_status='pendent' where id=sid;
 begin perform local_claim_matching_job(oldjob,sid);raise exception 'TEST: stale claimed';exception when raise_exception then if sqlerrm not like 'LOCAL_TYPE_BLOCKED:%' then raise;end if;end;
 if (select processing_status from source_records where id=sid)<>'pendent' or (select status from pipeline_jobs where id=oldjob)<>'ready' then raise exception 'Stale claim changed state';end if;
 update pipeline_runs set status='paused' where id=r2;
 begin perform local_claim_matching_job(newjob,sid);raise exception 'TEST: paused claimed';exception when raise_exception then if sqlerrm not like 'LOCAL_TYPE_BLOCKED:%' then raise;end if;end;
 update pipeline_runs set status='ready' where id=r2;
 insert into pipeline_jobs(run_id,source_record_id,status) values(r2,concert,'ready') returning id into mixjob;
 begin perform local_claim_matching_job(newjob,sid);raise exception 'TEST: mixed claimed';exception when raise_exception then if sqlerrm not like 'LOCAL_TYPE_BLOCKED:%' then raise;end if;end;
 update source_records set source_dataset='convenis' where id=concert;
 ok:=local_claim_matching_job(newjob,sid);
 if ok is not true or (select status from pipeline_jobs where id=newjob)<>'matching' or (select processing_status from source_records where id=sid)<>'pendent' then raise exception 'Current claim failed or modified shared source';end if;
 if local_report_matching_failure(oldjob,sid,'internal','old') is not false or (select processing_status from source_records where id=sid)<>'pendent' then raise exception 'Stale failure changed current record';end if;
 update source_records set source_dataset='contractacions' where id=sid;
 ok:=local_report_matching_failure(newjob,sid,'internal','new');
 if ok is not true or (select status from pipeline_jobs where id=newjob)<>'error' or (select processing_status from source_records where id=sid)<>'pendent' or (select financing_type from source_records where id=sid)<>'contractacio' then raise exception 'Failure changed revised source or left its job matching';end if;
 if has_function_privilege('anon','public.local_claim_matching_job(uuid,uuid)','execute') then raise exception 'Public local claim';end if;
end $$;
