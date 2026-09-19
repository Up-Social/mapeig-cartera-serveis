do $$
declare r uuid;j uuid;t uuid;v text;selection jsonb;c text;
begin
 if has_table_privilege('anon','public.job_snapshots','SELECT') or has_table_privilege('authenticated','public.provider_calls','SELECT') or has_function_privilege('anon','public.delete_discarded_records(jsonb,integer)','EXECUTE') or has_function_privilege('authenticated','public.create_batch_rerun(uuid,text,uuid,text,text,text)','EXECUTE') then raise exception 'Private workflow data exposed';end if;
 if has_table_privilege('service_role','public.evidence_chunks','UPDATE') then raise exception 'Evidence overwrite allowed';end if;
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status,enrichment_status) values(r,'aaaaaaaa-0000-4000-8000-000000000001','error','error','completed') returning id into j;
 if not exists(select 1 from job_phase_states where id=j and preparation='error' and enrichment='blocked' and matching='blocked') then raise exception 'Old enrichment escaped preparation block';end if;
 begin perform retry_job_operation('aaaaaaaa-0000-4000-8000-000000000001',gen_random_uuid(),'prepare');raise exception 'Stale retry accepted';exception when serialization_failure then null;end;
 insert into worker_tasks(task_type,run_id,executor,status,execution_state) values('process_run',r,'vercel_workflow','completed','completed') returning id into t;
 insert into cloud_checkpoints(task_id,item_key,value) values(t,'ai:'||j||':matching','{"state":"received"}'),(t,j||':audit-ready','true'),(t,'ai:'||j||':positive-audit-v2','{"state":"sending"}');
 begin perform cloud_retry_validation(r,'validation-v9');raise exception 'Unknown cloud outcome reinterpreted';exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update cloud_checkpoints set value='{"state":"received"}' where task_id=t;
 select id into v from catalog_versions where active and validated limit 1;
 perform persist_analysis(j,v,'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Fixture amb proveïdor pendent","service_description":"","target_population":""}','[]','[{"content":"fixture"}]');
 select jsonb_build_array(jsonb_build_object('id',id,'job_id',job_id,'result_token',result_token)) into selection from current_record_results where job_id=j;
 perform claim_provider_call(j,'test','unknown-hash');
 begin perform delete_discarded_records(selection,1);raise exception 'Unknown local receipt deleted';exception when others then if sqlerrm not in ('DELETE_PROVIDER_UNRESOLVED','DELETE_ACTIVE_WORK') then raise;end if;end;
 if not exists(select 1 from analysis_results where pipeline_job_id=j) then raise exception 'Unknown deletion did not roll back';end if;
 foreach c in array array['discarded','out_of_portfolio','insufficient_evidence'] loop
  insert into pipeline_runs default values returning id into r;
  insert into pipeline_jobs(run_id,source_record_id,status) values(r,'aaaaaaaa-0000-4000-8000-000000000001','ready') returning id into j;
  perform persist_analysis(j,v,jsonb_build_object('classification',c,'reasons',case when c='discarded' then '["individual_grant"]'::jsonb else '[]'::jsonb end,'explanation','Fixture terminal sense candidats','service_description','','target_population',''),'[]','[{"content":"fixture"}]');
  if not exists(select 1 from job_phase_states where id=j and automatic_terminal and matching='completed') then raise exception 'Terminal class requires candidates';end if;
 end loop;
end $$;
