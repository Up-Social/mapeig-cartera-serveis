do $$
declare run uuid; job uuid; record uuid:='aaaaaaaa-0000-4000-8000-000000000001'; version text; code text; export uuid; candidate uuid;
begin
 insert into pipeline_runs default values returning id into run;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run,record,'needs_review') returning id into job;
 select id into version from catalog_versions where active and validated limit 1;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
 values(job,record,version,'test','insufficient_evidence','[]','Explicació fictícia suficient','Servei fictici','Població fictícia','[{"content":"fixture"}]');
 begin
  perform review_analysis(record,'reject',gen_random_uuid(),array['individual_grant'],null,null,'Motiu');
  raise exception 'Expected stale review rejection';
 exception when serialization_failure then null;
 end;
 begin
  perform review_analysis(record,'reject',job,'{}',null,null,'Motiu');
  raise exception 'TEST: accepted missing reasons';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise; end if;
 end;
 perform review_analysis(record,'reject',job,array['individual_grant'],null,null,'Ajuda directa fictícia');
 if not exists(select 1 from review_decisions where pipeline_job_id=job and classification='discarded' and reasons=array['individual_grant']) then raise exception 'Missing structured review';end if;
 perform review_analysis(record,'outside',job,'{}',null,null,'Rectificació justificada');
 if (select reviewed_classification from analysis_results where pipeline_job_id=job)<>'out_of_portfolio' then raise exception 'Outside lost';end if;
 if (select count(*) from review_decisions where pipeline_job_id=job)<>2 then raise exception 'Review history lost';end if;
 perform review_analysis(record,'insufficient',job,'{}',null,null,'Encara falta evidència');
 select service_code into code from eligible_official_services where version_id=version limit 1;
 insert into matching_candidates(pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,rank,score,rationale,engine,engine_version) values(job,'official',version,code,'Fixture',1,0.8,'Fixture','mock','mock') returning id into candidate;
 perform review_analysis(record,'select',job,'{}',candidate,null,'Aprovació justificada');
 if (select status from pipeline_jobs where id=job)<>'approved' then raise exception 'Approval failed';end if;
 perform review_analysis(record,'select',job,'{}',null,code,'Correcció manual justificada');
 if (select status from pipeline_jobs where id=job)<>'corrected' then raise exception 'Correction failed';end if;
 insert into excel_exports(filename,provision_count,content_hash) values('fixture.xlsx',1,'fixture') returning id into export;
 insert into excel_export_items(export_id,provision_id) select export,id from service_provisions where source_record_id=record;
 perform review_analysis(record,'reject',job,array['individual_grant'],null,null,'Retirada amb exportació');
 if exists(select 1 from service_provisions where source_record_id=record) or exists(select 1 from excel_export_items where export_id=export) then raise exception 'Provision reference remains';end if;
 if not exists(select 1 from excel_exports where id=export) then raise exception 'Shared export removed';end if;
end $$;
