do $$declare sid uuid:=gen_random_uuid();other uuid:=gen_random_uuid();rid uuid;foreign_run uuid;t uuid;j uuid;other_job uuid;owner uuid:=gen_random_uuid();g bigint;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis','CONVENI-USAGE-'||sid,'Conveni','Conveni de prova','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(other,'contractacions','OTHER-USAGE-'||other,'test','Control no conveni');
 rid:=cloud_create_run(array[sid,other],false);
 select id into t from worker_tasks where run_id=rid;select id into j from pipeline_jobs where source_record_id=sid;select id into other_job from pipeline_jobs where source_record_id=other;
 g:=cloud_claim(t,owner,'cloud-v1');
 perform cloud_provider_usage(t,owner,g,'usage:'||j||':conveni','{"input_tokens":100,"output_tokens":20}');
 perform cloud_provider_usage(t,owner,g,'usage:'||j||':conveni','{"input_tokens":100,"output_tokens":20}');
 if (select actual_input_tokens from pipeline_runs where id=rid)<>100 or (select actual_output_tokens from pipeline_runs where id=rid)<>20 then raise exception 'Conveni usage duplicated';end if;
 begin perform cloud_provider_usage(t,owner,g,'usage:'||other_job||':conveni','{}');raise exception 'Other mechanism accepted';exception when others then if sqlerrm<>'Conveni usage outside task scope' then raise;end if;end;
 begin perform cloud_provider_usage(t,owner,g,'usage:'||gen_random_uuid()||':conveni','{}');raise exception 'Unrelated job accepted';exception when others then if sqlerrm<>'Conveni usage outside task scope' then raise;end if;end;
end $$;
