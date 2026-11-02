"""Prospective binding on candidate schema, synthetic PostgreSQL without network."""
from pathlib import Path
here=Path(__file__).resolve().parent
root=here.parents[1]
harness=root/'tests/sql/94-conveni-retained-real-schema.py'
source=harness.read_text()
anchor=" sql('''do $$ declare sid uuid:="
assert source.count(anchor)==1
extra=r'''
 sql("""do $$ declare s uuid:='51000001-0000-4000-8000-000000000001';r uuid:='51000001-0000-4000-8000-000000000002';j uuid:='51000001-0000-4000-8000-000000000003';t uuid:='51000001-0000-4000-8000-000000000004';t2 uuid:='51000001-0000-4000-8000-000000000005';o uuid:='51000001-0000-4000-8000-000000000006';k text;h text:='__WIRE_HASH__';rh text;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Sintètic','{}');
 insert into pipeline_runs(id,parameters) values(r,'{\"provider_budget_usd\":2}');insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until,current_step,progress_job_id) values
 (t,'process_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes','matching',j),
 (t2,'match_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes','matching',j);
 k:='ai:'||j||':conveni';
 insert into pipeline_runs(id) values('51000001-0000-4000-8000-000000000007');
 update worker_tasks set run_id='51000001-0000-4000-8000-000000000007' where id=t2;
 begin perform conveni_bind_begin(t2,o,1,j,h);raise exception 'mismatched scope accepted';exception when raise_exception then if sqlerrm<>'BIND_SCOPE' then raise;end if;end;
 update worker_tasks set run_id=r where id=t2;
 if conveni_bind_begin(t,o,1,j,h)<>'created' or conveni_bind_begin(t,o,1,j,h)<>'existing' then raise exception 'binding';end if;
 begin perform conveni_bind_begin(t2,o,1,j,h);raise exception 'other task bound';exception when raise_exception then if sqlerrm<>'BIND_OTHER_TASK' then raise;end if;end;
 begin perform cloud_budget_reserve(t2,o,1,k,'gpt-6-luna',100,100);raise exception 'other reserve accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 begin perform cloud_checkpoint(t2,o,1,k,'{\"state\":\"sending\"}');raise exception 'old cloud writer accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 begin perform claim_provider_call(j,'conveni',h);raise exception 'old local writer accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 if not cloud_budget_reserve(t,o,1,k,'gpt-6-luna',100,100) then raise exception 'owner reserve failed';end if;
 perform cloud_checkpoint(t,o,1,'conveni-input:'||j,to_jsonb(h));perform cloud_checkpoint(t,o,1,'provider-wire:'||k,to_jsonb(h));
 perform cloud_checkpoint(t,o,1,k,'{\"state\":\"sending\"}');perform cloud_checkpoint(t,o,1,k,'{\"state\":\"received\",\"response\":{\"status\":\"completed\",\"output_text\":\"{}\"}}');
 rh:=conveni_bind_complete(t,o,1,j,h);if rh<>conveni_bind_complete(t,o,1,j,h) or not conveni_bound_receipt_valid(t,j) then raise exception 'valid receipt';end if;
 update pipeline_jobs set status='error',error_kind='validation' where id=j;
 perform cloud_checkpoint(t,o,1,'last_failure',jsonb_build_object('kind','validation','job',j,'diagnostic',jsonb_build_object('operation','conveni_analysis','code','CONVENI_MODEL_DISCARD_REVIEW_REQUIRED')));
 if read_conveni_retained_receipt(s,j)->>'status'<>'received' then raise exception 'bound process_run receipt unavailable';end if;
 insert into cloud_checkpoints(task_id,item_key,value) values(t2,k,'{"state":"received","response":{"status":"completed"}}');
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'ambiguous receipt exposed';end if;
 delete from cloud_checkpoints where task_id=t2 and item_key=k;
 if has_table_privilege('service_role','public.conveni_receipt_bindings','insert') or has_table_privilege('authenticated','public.conveni_receipt_bindings','select') or has_function_privilege('anon','public.conveni_bind_begin(uuid,uuid,bigint,uuid,text)','execute') then raise exception 'binding ACL';end if;

 update cloud_checkpoints set value=jsonb_set(value,'{response,output_text}','\"changed\"') where task_id=t and item_key=k;
 if conveni_bound_receipt_valid(t,j) then raise exception 'changed receipt accepted';end if;
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'changed receipt exposed';end if;
 end $$;""".replace('__WIRE_HASH__',wire))
 sql("""do $$ declare s uuid:='51000002-0000-4000-8000-000000000001';r uuid:='51000002-0000-4000-8000-000000000002';j uuid:='51000002-0000-4000-8000-000000000003';t uuid:='51000002-0000-4000-8000-000000000004';t2 uuid:='51000002-0000-4000-8000-000000000005';o uuid:='51000002-0000-4000-8000-000000000006';begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Carrera','{}');
 insert into pipeline_runs(id) values(r);insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until,current_step,progress_job_id) values
 (t,'process_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes','matching',j),
 (t2,'match_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes','matching',j);
 end $$;""")
 first=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write("begin;select conveni_bind_begin('51000002-0000-4000-8000-000000000004','51000002-0000-4000-8000-000000000006',1,'51000002-0000-4000-8000-000000000003','"+wire+"');select pg_sleep(3);commit;\n")
 first.stdin.flush();time.sleep(1)
 try:
  sql("select cloud_checkpoint('51000002-0000-4000-8000-000000000005','51000002-0000-4000-8000-000000000006',1,'ai:51000002-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');")
  raise AssertionError('concurrent old cloud writer accepted')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_BUSY' in str(e),str(e)
 first.stdin.close();err=first.stderr.read();first.wait(timeout=20);assert first.returncode==0,err
 try:
  sql("select cloud_checkpoint('51000002-0000-4000-8000-000000000005','51000002-0000-4000-8000-000000000006',1,'ai:51000002-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');")
  raise AssertionError('committed bind bypassed')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_OTHER_RECEIPT' in str(e),str(e)
 sql("""do $$ declare s uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();r uuid;j1 uuid;j2 uuid;j3 uuid;t uuid;o uuid:=gen_random_uuid();h text:='__WIRE_HASH__';begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Històric','{}'),(s2,'convenis',s2::text,'Conveni','Històric','{}'),(s3,'convenis',s3::text,'Conveni','Històric','{}');
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id) values(r,s) returning id into j1;
 insert into pipeline_jobs(run_id,source_record_id) values(r,s2) returning id into j2;
 insert into pipeline_jobs(run_id,source_record_id) values(r,s3) returning id into j3;
 insert into worker_tasks(task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until,current_step,progress_job_id) values('process_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes','matching',j1) returning id into t;
 insert into cloud_checkpoints(task_id,item_key,value) values(t,'ai:'||j1||':conveni','{\"state\":\"received\"}');
 if conveni_bind_begin(t,o,1,j1,h)<>'legacy' then raise exception 'historic receipt backfilled';end if;
 update worker_tasks set progress_job_id=j2 where id=t;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j2,'conveni',h,'received');
 if conveni_bind_begin(t,o,1,j2,h)<>'legacy' then raise exception 'historic local call backfilled';end if;
 update worker_tasks set progress_job_id=j3 where id=t;
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(t,'ai:'||j3||':conveni',1);
 if conveni_bind_begin(t,o,1,j3,h)<>'legacy' then raise exception 'historic reserve backfilled';end if;
 if exists(select 1 from conveni_receipt_bindings where job_id in (j1,j2,j3)) then raise exception 'legacy binding written';end if;
 end $$;""".replace('__WIRE_HASH__',wire))
 print('PASS concurrent bind and old sender fail closed before and after commit')
 print('PASS prospective bind fences old cloud/local senders; retains receipt/replay and rejects changed response')
'''.replace('__HERE__',str(here))
source=source.replace(anchor,extra+anchor)
exec(compile(source,str(harness),'exec'),{'__file__':str(harness),'__name__':'__main__'})
