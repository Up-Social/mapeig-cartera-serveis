do $$
declare r uuid; j uuid; j2 uuid; a uuid; version text; record uuid:='aaaaaaaa-0000-4000-8000-000000000001';
begin
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(id,run_id,source_record_id,status) values('bbbbbbbb-0000-4000-8000-000000000001',r,record,'needs_review') returning id into j;
 select id into version from catalog_versions where active and validated limit 1;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
 values(j,record,version,'test','discarded','["individual_grant"]','Discard fixture','Fixture','Fixture','[{"content":"fixture"}]') returning id into a;
 if not exists(select 1 from current_record_results where id=record and destination='discarded' and not human_reviewed) then raise exception 'Automatic discard routing failed';end if;
 perform review_analysis(record,'outside',j,'{}',null,null,'Rectificació fora de cartera');
 if not exists(select 1 from current_record_results where id=record and destination='outside' and human_reviewed) then raise exception 'Outside routing failed';end if;
 perform review_analysis(record,'insufficient',j,'{}',null,null,'Cal documentació');
 if not exists(select 1 from current_record_results where id=record and destination='issues') then raise exception 'Insufficient routing failed';end if;
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(id,run_id,source_record_id,status,created_at) select 'bbbbbbbb-0000-4000-8000-000000000002',r,record,'queued',created_at from pipeline_jobs where id=j returning id into j2;
 if not exists(select 1 from current_record_results where id=record and job_id=j2 and classification is null and destination='processing') then raise exception 'Tie/new incomplete job retrieved old classification';end if;
 if (select count(*) from current_record_results where id=record)<>1 then raise exception 'Duplicate current result';end if;
end $$;

-- Above the REST default page size: SQL counts must remain exact.
insert into source_records(source_dataset,source_record_id,mechanism,title)
select 'contractacions','COUNT-FIXTURE-'||n,'Contractació','Fictici '||n from generate_series(1,1005) n;
do $$begin
 if (select count(*) from current_record_results where source_record_id like 'COUNT-FIXTURE-%')<>1005 then raise exception 'Count truncated';end if;
end $$;
