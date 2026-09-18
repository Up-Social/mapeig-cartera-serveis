do $$
declare r uuid;j uuid;p record;v text; empty uuid;
begin
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status) values(r,'aaaaaaaa-0000-4000-8000-000000000001','error','error') returning id into j;
 select * into p from job_phase_states where id=j;
 if p.preparation<>'error' or p.enrichment<>'blocked' or p.matching<>'blocked' then raise exception 'Preparation error duplicated downstream';end if;
 update pipeline_jobs set preparation_status='ready',enrichment_status='error' where id=j;
 select * into p from job_phase_states where id=j;
 if p.preparation<>'completed' or p.enrichment<>'error' or p.matching<>'blocked' then raise exception 'Enrichment error duplicated downstream';end if;
 update pipeline_jobs set enrichment_status='completed' where id=j;
 select * into p from job_phase_states where id=j;
 if p.preparation<>'completed' or p.enrichment<>'completed' or p.matching<>'error' then raise exception 'Matching error not isolated';end if;
 select id into v from catalog_versions where active and validated limit 1;
 perform persist_analysis(j,v,'{"classification":"insufficient_evidence","reasons":[],"explanation":"Fixture sense candidats","service_description":"","target_population":""}','[]','[{"content":"fixture"}]');
 perform refresh_pipeline_run(r);
 if (select processed_count from pipeline_runs where id=r)<>1 then raise exception 'Analysis without candidates omitted';end if;
 if (select processing_completed_at from pipeline_runs where id=r) is null or (select completed_at from pipeline_runs where id=r) is not null then raise exception 'Automatic and human completion conflated';end if;
 insert into pipeline_runs default values returning id into empty;
 perform refresh_pipeline_run(empty);
 if not exists(select 1 from pipeline_runs where id=empty and status='completed' and selected_count=0 and processed_count=0) then raise exception 'Empty batch not closed';end if;
end $$;
