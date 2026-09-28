do $$
declare r uuid;j uuid;s uuid:=gen_random_uuid();first jsonb;second jsonb;
begin
 perform reconcile_paused_workloads();
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload,processing_status)
 values(s,'contractacions','PAUSED-'||s,'Contractació pública','Registre pausat fictici','{}','preparant');
 insert into pipeline_runs(status,stage,pause_kind,pause_reason) values('paused','preparation','vercel_quota','Fixture') returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status,enrichment_status)
 values(r,s,'selected','pending','pending') returning id into j;
 update job_attempts set status='running',completed_at=null,diagnostic=null where pipeline_job_id=j;
 first:=reconcile_paused_workloads();
 if (first->>'attempts')::integer<>1 or (first->>'records')::integer<>1 then raise exception 'Paused workload was not reconciled';end if;
 if (select processing_status::text from source_records where id=s)<>'pendent' then raise exception 'Record remained falsely active';end if;
 if exists(select 1 from job_attempts where pipeline_job_id=j and status='running') then raise exception 'Attempt remained falsely active';end if;
 second:=reconcile_paused_workloads();
 if (second->>'attempts')::integer<>0 or (second->>'records')::integer<>0 then raise exception 'Reconciliation is not idempotent';end if;
end $$;
