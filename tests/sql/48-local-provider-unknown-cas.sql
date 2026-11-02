do $$
declare sid uuid:=gen_random_uuid();r uuid;j uuid;c uuid;scope jsonb;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'convenis',sid::text,'Conveni','Synthetic');
 insert into pipeline_runs(status) values('matching') returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status) values(r,sid,'matching') returning id into j;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j,'conveni','synthetic','sending') returning id into c;
 scope:=local_provider_scope(r,j);
 if scope is null then raise exception 'Active scope not captured';end if;
 update pipeline_jobs set status='approved' where id=j;
 if local_pause_provider_unknown(r,j,scope) is not false or (select status from pipeline_jobs where id=j)<>'approved' then raise exception 'Reviewed job overwritten';end if;
 update pipeline_jobs set status='matching' where id=j;
 update pipeline_runs set status='completed' where id=r;
 if local_pause_provider_unknown(r,j,scope) is not false or (select status from pipeline_runs where id=r)<>'completed' then raise exception 'Completed run overwritten';end if;
 update pipeline_runs set status='matching' where id=r;
 update provider_calls set state='received' where id=c;
 if local_pause_provider_unknown(r,j,scope) is not false or (select status from pipeline_jobs where id=j)<>'matching' then raise exception 'Resolved receipt treated as uncertain';end if;
 update provider_calls set state='sending' where id=c;
 if local_pause_provider_unknown(r,j,jsonb_set(scope,'{job_status}','"ready"')) is not false or local_pause_provider_unknown(r,j,jsonb_set(scope,'{run_xmin}','"999999"')) is not false then raise exception 'Incorrect scope accepted';end if;
 if local_pause_provider_unknown(r,j,scope) is not true then raise exception 'Matching uncertainty not saved';end if;
 if (select status from pipeline_jobs where id=j)<>'error' or (select error_kind from pipeline_jobs where id=j)<>'provider_unknown' or (select status from pipeline_runs where id=r)<>'paused' or (select pause_kind from pipeline_runs where id=r)<>'provider_unknown' or (select state from provider_calls where id=c)<>'sending' then raise exception 'Unexpected uncertainty state';end if;
 if has_function_privilege('anon','public.local_pause_provider_unknown(uuid,uuid,jsonb)','execute') then raise exception 'Public uncertainty transition';end if;
end $$;
