do $$
declare origin uuid;job uuid;v text;pre jsonb;r jsonb;again jsonb;key uuid:=gen_random_uuid();frozen text;
begin
 insert into pipeline_runs default values returning id into origin;
 insert into pipeline_jobs(run_id,source_record_id,status,preparation_status,enrichment_status) values(origin,'aaaaaaaa-0000-4000-8000-000000000001','error','ready','completed') returning id into job;
 select id into v from catalog_versions where active and validated limit 1;
 perform persist_analysis(job,v,'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Fixture de comparació immutable","service_description":"","target_population":""}','[]','[{"content":"fixture"}]');
 perform review_analysis('aaaaaaaa-0000-4000-8000-000000000001','outside',job,'{}',null,null,'Revisió històrica fictícia');
 pre:=preflight_batch_rerun(origin,'mock','fixture-v1');
 if (pre->>'count')::int<>1 or pre->>'estimatedCost' is not null then raise exception 'Incorrect preflight';end if;
 r:=create_batch_rerun(origin,pre->>'token',key,'mock','fixture-v1');
 again:=create_batch_rerun(origin,pre->>'token',key,'mock','fixture-v1');
 if again->>'runId'<>r->>'runId' or not (again->>'reused')::boolean then raise exception 'Duplicate batch';end if;
 if (select array_agg(source_record_id order by source_record_id) from pipeline_jobs where run_id=origin) is distinct from (select array_agg(source_record_id order by source_record_id) from pipeline_jobs where run_id=(r->>'runId')::uuid) then raise exception 'Members changed';end if;
 select baseline::text into frozen from comparison_members where run_id=(r->>'runId')::uuid;
 if frozen::jsonb->'review'->>'classification'<>'out_of_portfolio' then raise exception 'Human decision lost';end if;
 begin
  perform create_batch_rerun(origin,pre->>'token',gen_random_uuid(),'mock','fixture-v1');raise exception 'Active record accepted';
 exception when others then if sqlerrm not in ('PREFLIGHT_CHANGED','RECORD_ACTIVE_OR_UNKNOWN_PROVIDER') then raise;end if;end;
 update source_records set title='Canvi posterior fictici' where id='aaaaaaaa-0000-4000-8000-000000000001';
 if (select baseline::text from comparison_members where run_id=(r->>'runId')::uuid)<>frozen then raise exception 'Frozen baseline mutated';end if;
 insert into pipeline_runs default values returning id into origin;
 pre:=preflight_batch_rerun(origin,'mock','fixture-v1');
 begin
  perform create_batch_rerun(origin,pre->>'token',gen_random_uuid(),'mock','fixture-v1');raise exception 'Empty origin accepted';
 exception when others then if sqlerrm<>'EMPTY_ORIGIN' then raise;end if;end;
end $$;
