do $$
declare
 sid uuid:=gen_random_uuid();
 rid uuid;
 jid uuid;
 first_task uuid;
 copied_task uuid;
 original_key text;
 checkpoint_response jsonb;
 provider_response jsonb;
 before_records integer;
 before_calls integer;
 before_runs integer;
 before_unsettled integer;
 before_total numeric;
 before_pending numeric;
begin
 select coalesce(measured_records,0),coalesce(measured_calls,0),coalesce(runs_with_cost,0),
  coalesce(unsettled_calls,0),coalesce(total_usd,0),coalesce(pending_reserved_usd,0)
 into before_records,before_calls,before_runs,before_unsettled,before_total,before_pending
 from ai_cost_summary where scope='concert';
 before_records:=coalesce(before_records,0);
 before_calls:=coalesce(before_calls,0);
 before_runs:=coalesce(before_runs,0);
 before_unsettled:=coalesce(before_unsettled,0);
 before_total:=coalesce(before_total,0);
 before_pending:=coalesce(before_pending,0);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type)
 values(sid,'concerts','AI-COST-'||sid,'test','AI cost fixture','concert');
 insert into pipeline_runs(status,stage,selected_count,batch_number,parameters)
 values('completed','completed',1,(select coalesce(max(batch_number),0)+1000000 from pipeline_runs),'{}') returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status)
 values(rid,sid,'selected') returning id into jid;
 insert into worker_tasks(task_type,run_id,status,executor)
 values('process_run',rid,'completed','vercel_workflow') returning id into first_task;
 insert into worker_tasks(task_type,run_id,source_record_id,status,executor)
 values('enrich_record',rid,sid,'completed','vercel_workflow') returning id into copied_task;
 original_key:='ai:'||jid||':matching';
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd)
 values(first_task,original_key,0.10,0.012),
       (copied_task,original_key,0.10,0),
       (copied_task,'ai:'||jid||':positive-audit-v4',0.05,null);
 checkpoint_response:=jsonb_build_object('id','checkpoint-'||sid,'model','gpt-4o-mini-2024-07-18',
  'usage',jsonb_build_object('input_tokens',1000,'output_tokens',100));
 provider_response:=jsonb_build_object('id','provider-'||sid,'model','gpt-4o-mini-2024-07-18',
  'usage',jsonb_build_object('input_tokens',1000,'output_tokens',100));
 if ai_usage_cost_usd('{"input_tokens":1000,"input_tokens_details":{"cached_tokens":500},"output_tokens":100}'::jsonb,'gpt-4o-mini')<>0.0001725 then
  raise exception 'Cached input pricing is incorrect';
 end if;
 insert into cloud_checkpoints(task_id,item_key,value)
 values(first_task,'ai:'||jid||':enrichment',jsonb_build_object('state','received','response',checkpoint_response)),
       (copied_task,'ai:'||jid||':enrichment',jsonb_build_object('state','received','response',checkpoint_response));
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response)
 values(jid,'enrichment','same-checkpoint','received',checkpoint_response),
       (jid,'analysis','separate-call','received',provider_response);
 if (select cost_usd from ai_cost_per_record where source_record_id=sid)<>0.01242 then
  raise exception 'A copied reservation was counted as another charge';
 end if;
 if not exists(select 1 from ai_cost_summary where scope='concert'
  and measured_records=before_records+1 and measured_calls=before_calls+3 and runs_with_cost=before_runs+1
  and total_usd=before_total+0.01242
  and average_usd=(before_total+0.01242)/(before_records+1)
  and unsettled_calls=before_unsettled+1 and pending_reserved_usd=before_pending+0.05) then
  raise exception 'Confirmed cost, average or pending ceiling is incorrect';
 end if;
end $$;
