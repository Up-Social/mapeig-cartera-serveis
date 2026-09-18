do $$
declare r uuid;j uuid;v text;result jsonb;claim jsonb;before_count int;
begin
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) values(r,'aaaaaaaa-0000-4000-8000-000000000001','error','error') returning id into j;
 select count(*) into before_count from job_attempts where pipeline_job_id=j;
 result:=begin_record_operation('aaaaaaaa-0000-4000-8000-000000000001','prepare');
 if (result->>'jobId')::uuid<>j or (result->>'newJob')::boolean then raise exception 'Recovery changed job';end if;
 if (select count(*) from job_attempts where pipeline_job_id=j)<>before_count+1 then raise exception 'Recovery lost attempt';end if;
 update worker_tasks set status='completed' where id=(result->>'taskId')::uuid;
 select id into v from catalog_versions where active and validated limit 1;
 perform persist_analysis(j,v,'{"classification":"insufficient_evidence","reasons":[],"explanation":"Fixture sense candidats","service_description":"","target_population":""}','[]','[{"content":"fixture"}]');
 result:=begin_record_operation('aaaaaaaa-0000-4000-8000-000000000001','process');
 if not (result->>'newJob')::boolean or not exists(select 1 from pipeline_jobs where id=(result->>'jobId')::uuid and previous_job_id=j) then raise exception 'Reanalysis overwrote final job';end if;
 if not exists(select 1 from analysis_results where pipeline_job_id=j) then raise exception 'Historical analysis lost';end if;
 claim:=claim_provider_call((result->>'jobId')::uuid,'matching','hash');
 begin
  perform claim_provider_call((result->>'jobId')::uuid,'matching','hash');raise exception 'Unknown request retried';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update provider_calls set state='received',response='{"id":"receipt"}' where id=(claim->>'id')::uuid;
 claim:=claim_provider_call((result->>'jobId')::uuid,'matching','hash');
 if (claim->>'send')::boolean or claim->'response'->>'id'<>'receipt' then raise exception 'Receipt not resumed';end if;
end $$;
