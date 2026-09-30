do $$ declare r uuid;t uuid;j uuid;o uuid:=gen_random_uuid();g bigint;k text;sid uuid:=gen_random_uuid();begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions','USAGE-'||sid,'test','Usage fixture');
 r:=cloud_create_run(array[sid],false);
 select id into t from worker_tasks where run_id=r;select id into j from pipeline_jobs where run_id=r;g:=cloud_claim(t,o,'cloud-v1');
 foreach k in array array['enrichment','analysis','positive-audit-v1','positive-audit-v2','positive-audit-v3','positive-audit-v4','contract-repair-v1'] loop
 perform cloud_provider_usage(t,o,g,'usage:'||j||':'||k,'{"input_tokens":10,"output_tokens":2}');
 perform cloud_provider_usage(t,o,g,'usage:'||j||':'||k,'{"input_tokens":10,"output_tokens":2}');end loop;
 if (select actual_input_tokens from pipeline_runs where id=r)<>70 then raise exception 'Usage must be idempotent for every emitted phase';end if;
 begin perform cloud_provider_usage(t,o,g,'usage:'||j||':untrusted','{}');raise exception 'Unexpected phase accepted';exception when others then if sqlerrm<>'Invalid usage key' then raise;end if;end;
end $$;