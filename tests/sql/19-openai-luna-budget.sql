do $$ declare r uuid;t uuid;j uuid;o uuid:=gen_random_uuid();g bigint;sid uuid:=gen_random_uuid();v numeric;k text;
begin
 if ai_usage_cost_usd('{"input_tokens":1000,"output_tokens":100}','gpt-6-luna')<>0.00015 then raise exception 'Luna Standard price';end if;
 if ai_usage_cost_usd('{"input_tokens":1000,"input_tokens_details":{"cached_tokens":500,"cache_write_tokens":200},"output_tokens":100}','gpt-6-luna')<>0.00011 then raise exception 'Cache read/write price';end if;
 if ai_usage_cost_usd('{"input_tokens":300000,"input_tokens_details":{"cached_tokens":100000,"cache_write_tokens":100000},"output_tokens":1000}','gpt-6-luna')<>0.04775 then raise exception 'Long context price';end if;
 if ai_usage_cost_usd('{"input_tokens":272000,"output_tokens":1000}','gpt-6-luna')<>0.0277 then raise exception 'Boundary must remain short';end if;
 if ai_usage_cost_usd('{"input_tokens":1000,"input_tokens_details":{"cached_tokens":500},"output_tokens":100}','gpt-4o-mini')<>0.0001725 then raise exception 'Historical cost changed';end if;
 if ai_usage_cost_usd('{"input_tokens":10,"output_tokens":1}',null) is not null
  or ai_usage_cost_usd('{"input_tokens":10,"output_tokens":1}','unknown') is not null
  or ai_usage_cost_usd('{"input_tokens":10,"input_tokens_details":{"cached_tokens":6,"cache_write_tokens":5},"output_tokens":1}','gpt-6-luna') is not null
  or ai_usage_cost_usd('{"input_tokens":-1,"output_tokens":1}','gpt-6-luna') is not null
  or ai_usage_cost_usd('{"input_tokens":1.2,"output_tokens":1}','gpt-6-luna') is not null
  or ai_usage_cost_usd('{}','gpt-6-luna') is not null then raise exception 'Invalid usage priced';end if;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'contractacions','LUNA-'||sid,'test','Synthetic Luna fixture');
 r:=cloud_create_run(array[sid],false);
 select id into t from worker_tasks where run_id=r;select id into j from pipeline_jobs where run_id=r;g:=cloud_claim(t,o,'cloud-v1');
 update pipeline_runs set parameters=parameters||'{"provider_budget_usd":0.015}' where id=r;
 k:='ai:'||j||':enrichment';
 if not cloud_budget_reserve(t,o,g,k,'gpt-6-luna',4000,100000) then raise exception 'Luna refused';end if;
 if not cloud_budget_reserve(t,o,g,k,'gpt-6-luna',4000,100000) then raise exception 'Idempotency failed';end if;
 if (select count(*) from cloud_budget_reservations where task_id=t and item_key=k)<>1 then raise exception 'Duplicate reservation';end if;
 if (select reserved_usd from cloud_budget_reservations where task_id=t and item_key=k)<>0.0145 then raise exception 'Cache-write premium missing from ceiling';end if;
 if cloud_budget_reserve(t,o,g,k,'gpt-4o-mini',4000) then raise exception 'In-flight model changed';end if;
 if cloud_budget_reserve(t,o,g,'second','gpt-6-luna',4000,100000) then raise exception 'Budget exceeded';end if;
 perform cloud_budget_settle(t,o,g,k,'{}');
 if (select actual_usd from cloud_budget_reservations where task_id=t and item_key=k) is not null then raise exception 'Missing usage freed reserve';end if;
 perform cloud_budget_settle(t,o,g,k,'{"input_tokens":1000,"input_tokens_details":{"cached_tokens":500,"cache_write_tokens":200},"output_tokens":100}');
 perform cloud_budget_settle(t,o,g,k,'{"input_tokens":0,"output_tokens":0}');
 if (select actual_usd from cloud_budget_reservations where task_id=t and item_key=k)<>0.00011 then raise exception 'Settlement incorrect or repeated';end if;
 if (select cost_usd from ai_cost_per_record where source_record_id=sid)<>0.00011 then raise exception 'Luna missing from cost dashboard';end if;
 if not cloud_budget_reserve(t,o,g,'second','gpt-6-luna',4000,100000) then raise exception 'Settled budget not released';end if;
 if cloud_budget_reserve(t,o,g,'bad','unknown',4000,1000) or cloud_budget_reserve(t,o,g,'bad','gpt-6-luna',4000,0) then raise exception 'Unpriced reservation accepted';end if;
 update pipeline_runs set parameters=parameters||'{"provider_budget_usd":1}' where id=r;
 if not cloud_budget_reserve(t,o,g,'old-signature-luna','gpt-6-luna',4000) then raise exception 'Compatibility signature failed';end if;
 if (select reserved_usd from cloud_budget_reservations where task_id=t and item_key='old-signature-luna')<>0.2655 then raise exception 'Full context fallback not conservative';end if;
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(t,'legacy',0.02);
 perform cloud_budget_settle(t,o,g,'legacy','{"input_tokens":1000,"input_tokens_details":{"cached_tokens":500},"output_tokens":100}');
 if (select actual_usd from cloud_budget_reservations where task_id=t and item_key='legacy')<>0.00021 then raise exception 'Legacy settlement repriced';end if;
 begin perform cloud_budget_reserve(t,gen_random_uuid(),g,'stale','gpt-6-luna',4000,1000);raise exception 'Stale accepted';exception when others then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
end $$;
