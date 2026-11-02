"""Private synthetic test using a disposable PostgreSQL instance without network."""
from pathlib import Path
here=Path(__file__).resolve().parent
root=here.parents[1]
harness=root/'tests/sql/94-conveni-retained-real-schema.py'
source=harness.read_text()
anchor=" sql('''do $$ declare sid uuid:="
assert source.count(anchor)==1
extra=r'''
 sql('select 1;')
 sql("""do $$ declare sid uuid:='aa000001-0000-4000-8000-000000000001';rid uuid:='aa000001-0000-4000-8000-000000000002';j uuid:='aa000001-0000-4000-8000-000000000003';t1 uuid:='aa000001-0000-4000-8000-000000000004';t2 uuid:='aa000001-0000-4000-8000-000000000005';begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{}');
 insert into pipeline_runs(id) values(rid);
 insert into pipeline_jobs(id,run_id,source_record_id) values(j,rid,sid);
 insert into worker_tasks(id,task_type,run_id,executor) values(t1,'process_run',rid,'vercel_workflow'),(t2,'match_run',rid,'vercel_workflow');
 end $$;""")
 import subprocess
 first=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write("begin;insert into cloud_checkpoints(task_id,item_key,value) values('aa000001-0000-4000-8000-000000000004','ai:aa000001-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');select pg_sleep(3);commit;\n")
 first.stdin.flush()
 time.sleep(1)
 try:
  sql("insert into cloud_checkpoints(task_id,item_key,value) values('aa000001-0000-4000-8000-000000000005','ai:aa000001-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');")
  raise AssertionError('expected concurrent fence')
 except RuntimeError as e:
  assert 'CONVENI_JOURNAL_BUSY' in str(e),str(e)
 first.stdin.close();err=first.stderr.read();first.wait(timeout=20);assert first.returncode==0,err
 try:
  sql("insert into cloud_checkpoints(task_id,item_key,value) values('aa000001-0000-4000-8000-000000000005','ai:aa000001-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');")
  raise AssertionError('expected prior receipt fence')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_OTHER_RECEIPT' in str(e),str(e)
 sql("update cloud_checkpoints set value='{\"state\":\"received\"}' where task_id='aa000001-0000-4000-8000-000000000004' and item_key='ai:aa000001-0000-4000-8000-000000000003:conveni';")
 # Recovery preserves the identical receipt in a new task; the guard prevents
 # a new send, without blocking receipt or reservation copies.
 sql("insert into cloud_checkpoints(task_id,item_key,value) select 'aa000001-0000-4000-8000-000000000005',item_key,value from cloud_checkpoints where task_id='aa000001-0000-4000-8000-000000000004' and item_key='ai:aa000001-0000-4000-8000-000000000003:conveni';")
 try:
  sql("update cloud_checkpoints set value='{\"state\":\"sending\"}' where task_id='aa000001-0000-4000-8000-000000000005' and item_key='ai:aa000001-0000-4000-8000-000000000003:conveni';")
  raise AssertionError('cloned receipt allowed second send')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_OTHER_RECEIPT' in str(e),str(e)
 try:
  sql("insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('aa000001-0000-4000-8000-000000000003','conveni','fixture','sending');")
  raise AssertionError('expected cloud/local fence')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_OTHER_RECEIPT' in str(e),str(e)
 try:
  sql("insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('aa000001-0000-4000-8000-000000000003','conveni','fixture','sending');")
  raise AssertionError('received must block new local send')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_OTHER_RECEIPT' in str(e),str(e)
 sql("""do $$ declare s uuid:='bb000001-0000-4000-8000-000000000001';r uuid:='bb000001-0000-4000-8000-000000000002';j uuid:='bb000001-0000-4000-8000-000000000003';t uuid:='bb000001-0000-4000-8000-000000000004';t2 uuid:='bb000001-0000-4000-8000-000000000005';begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Conveni local','{}');
 insert into pipeline_runs(id) values(r);insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor) values(t,'process_run',r,'vercel_workflow'),(t2,'match_run',r,'vercel_workflow');
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j,'conveni','fixture','sending');
 begin insert into cloud_checkpoints(task_id,item_key,value) values(t,'ai:'||j||':conveni','{\"state\":\"sending\"}');raise exception 'cloud after local accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 update provider_calls set state='retry' where pipeline_job_id=j and phase='conveni';
 update provider_calls set state='sending' where pipeline_job_id=j and phase='conveni';
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(t2,'ai:'||j||':conveni',1);
 update provider_calls set state='sending',response='{\"error\":\"simulated 5xx\"}',received_at=now() where pipeline_job_id=j and phase='conveni';
 if (select response->>'error' from provider_calls where pipeline_job_id=j and phase='conveni')<>'simulated 5xx' then raise exception 'local 5xx response lost';end if;
 update provider_calls set state='sending',response=response,received_at=received_at where pipeline_job_id=j and phase='conveni';
 begin update provider_calls set state='sending',response='{\"error\":\"different\"}' where pipeline_job_id=j and phase='conveni';raise exception 'different local 5xx accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_RESPONSE_CONFLICT' then raise;end if;end;
 if (select response->>'error' from provider_calls where pipeline_job_id=j and phase='conveni')<>'simulated 5xx' then raise exception 'local 5xx overwritten';end if;
 update provider_calls set state='retry' where pipeline_job_id=j and phase='conveni';
 begin update provider_calls set state='sending' where pipeline_job_id=j and phase='conveni';raise exception 'retry bypassed other reserve';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 update provider_calls set state='received' where pipeline_job_id=j and phase='conveni';
 end $$;""")
 sql("""do $$ declare s uuid:='cc000001-0000-4000-8000-000000000001';r uuid:='cc000001-0000-4000-8000-000000000002';j uuid:='cc000001-0000-4000-8000-000000000003';t uuid:='cc000001-0000-4000-8000-000000000004';t2 uuid:='cc000001-0000-4000-8000-000000000005';k text;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Reserva sintètica','{}');
 insert into pipeline_runs(id) values(r);insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor) values(t,'process_run',r,'vercel_workflow'),(t2,'match_run',r,'vercel_workflow');
 k:='ai:'||j||':conveni';
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd) values(t,k,1);
 begin perform public.conveni_before_provider_reserve(t2,k);raise exception 'double reserve accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 begin insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j,'conveni','fixture','sending');raise exception 'local after reserve accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 insert into cloud_checkpoints(task_id,item_key,value) values(t,k,'{\"state\":\"sending\"}');
 update cloud_budget_reservations set actual_usd=.5 where task_id=t and item_key=k;
 if (select actual_usd from cloud_budget_reservations where task_id=t and item_key=k)<>.5 then raise exception 'settlement failed';end if;
 -- Historical recovery can preserve a reservation on another task; it does
 -- not grant either task permission to send again without reconciliation.
 insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd) values(t2,k,1,.5);
 begin perform public.conveni_before_provider_reserve(t,k);raise exception 'ambiguous cloned reserve accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 insert into cloud_checkpoints(task_id,item_key,value) values(t,k,'{\"state\":\"sending\",\"unknown\":true,\"response\":{\"code\":\"provider-5xx\"}}') on conflict(task_id,item_key) do update set value=excluded.value;
 if (select value->>'unknown' from cloud_checkpoints where task_id=t and item_key=k)<>'true' then raise exception 'unknown response lost';end if;
 insert into cloud_checkpoints(task_id,item_key,value) values(t,k,'{\"state\":\"sending\",\"unknown\":true,\"response\":{\"code\":\"provider-5xx\"}}') on conflict(task_id,item_key) do update set value=excluded.value;
 begin insert into cloud_checkpoints(task_id,item_key,value) values(t,k,'{\"state\":\"sending\",\"unknown\":true,\"response\":{\"code\":\"changed\"}}') on conflict(task_id,item_key) do update set value=excluded.value;raise exception 'different cloud 5xx accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_RESPONSE_CONFLICT' then raise;end if;end;
 if (select value->'response'->>'code' from cloud_checkpoints where task_id=t and item_key=k)<>'provider-5xx' then raise exception 'cloud 5xx overwritten';end if;
 begin insert into cloud_checkpoints(task_id,item_key,value) values(t,k,'{\"state\":\"sending\",\"attempt\":99,\"unknown\":true,\"response\":{\"code\":\"provider-5xx\"}}') on conflict(task_id,item_key) do update set value=excluded.value;raise exception 'different cloud attempt accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_RESPONSE_CONFLICT' then raise;end if;end;
 end $$;""")
 sql("""do $$ declare s uuid:='dd000001-0000-4000-8000-000000000001';r uuid:='dd000001-0000-4000-8000-000000000002';j uuid:='dd000001-0000-4000-8000-000000000003';t uuid:='dd000001-0000-4000-8000-000000000004';t2 uuid:='dd000001-0000-4000-8000-000000000005';o uuid:='dd000001-0000-4000-8000-000000000006';k text;h text:='prepared-json-v1:'||repeat('a',64);begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','RPC sintètica','{}');
 insert into pipeline_runs(id,parameters) values(r,'{\"provider_budget_usd\":2}');insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until) values(t,'process_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes'),(t2,'match_run',r,'vercel_workflow','running',o,1,now()+interval '4 minutes');
 k:='ai:'||j||':conveni';
 execute 'set local role service_role';
 if not public.cloud_budget_reserve(t,o,1,k,'gpt-6-luna',100,100) then raise exception 'real reserve failed';end if;
 begin perform public.cloud_budget_reserve(t2,o,1,k,'gpt-6-luna',100,100);raise exception 'real second reserve accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 begin perform public.claim_provider_call(j,'conveni',h);raise exception 'real local claim accepted';exception when raise_exception then if sqlerrm<>'CONVENI_JOURNAL_OTHER_RECEIPT' then raise;end if;end;
 perform public.cloud_checkpoint(t,o,1,k,'{\"state\":\"sending\",\"attempt\":1}');
 perform public.cloud_checkpoint(t,o,1,k,'{\"state\":\"sending\",\"attempt\":1,\"unknown\":true,\"response\":{\"code\":\"5xx\"}}');
 perform public.cloud_checkpoint(t,o,1,k,'{\"state\":\"received\",\"attempt\":1,\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":20}}}');
 perform public.cloud_budget_settle(t,o,1,k,'{\"input_tokens\":10,\"output_tokens\":20}');
 execute 'reset role';
 if (select actual_usd from public.cloud_budget_reservations where task_id=t and item_key=k) is null then raise exception 'real settlement failed';end if;
 end $$;""")
 print('PASS real service_role cloud_budget_reserve/cloud_checkpoint/settle and local claim')
 try:
  sql("begin isolation level repeatable read;insert into cloud_checkpoints(task_id,item_key,value) values('aa000001-0000-4000-8000-000000000005','ai:aa000001-0000-4000-8000-000000000003:conveni','{\"state\":\"sending\"}');commit;")
  raise AssertionError('repeatable read was allowed')
 except RuntimeError as e:assert 'CONVENI_JOURNAL_ISOLATION_UNSUPPORTED' in str(e),str(e)
 # Other phases, including under stronger isolation, are not affected.
 sql("begin isolation level repeatable read;insert into cloud_checkpoints(task_id,item_key,value) values('aa000001-0000-4000-8000-000000000005','ai:aa000001-0000-4000-8000-000000000003:matching','{\"state\":\"sending\"}');commit;")
 print('PASS stronger isolation fails closed for conveni and leaves other phases unchanged')
 sql("""do $$ declare s uuid:='ff000001-0000-4000-8000-000000000001';r uuid:='ff000001-0000-4000-8000-000000000002';j uuid:='ff000001-0000-4000-8000-000000000003';t uuid:='ff000001-0000-4000-8000-000000000004';o1 uuid:='ff000001-0000-4000-8000-000000000005';o2 uuid:='ff000001-0000-4000-8000-000000000006';g1 bigint;g2 bigint;k text;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Lease sintètica','{}');
 insert into pipeline_runs(id) values(r);insert into pipeline_jobs(id,run_id,source_record_id) values(j,r,s);
 insert into worker_tasks(id,task_type,run_id,executor) values(t,'process_run',r,'vercel_workflow');
 g1:=public.cloud_claim(t,o1,'cloud-v1');if g1 is null then raise exception 'first claim failed';end if;
 if public.cloud_claim(t,o2,'cloud-v1') is not null then raise exception 'parallel advance claimed same task';end if;
 k:='ai:'||j||':conveni';perform public.cloud_checkpoint(t,o1,g1,k,'{\"state\":\"sending\"}');
 update worker_tasks set lease_until=now()-interval '1 second' where id=t;
 g2:=public.cloud_claim(t,o2,'cloud-v1');if g2<>g1+1 then raise exception 'expired lease not reclaimed';end if;
 begin perform public.cloud_checkpoint(t,o1,g1,k,'{\"state\":\"received\"}');raise exception 'stale writer accepted';exception when raise_exception then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 if (select value->>'state' from cloud_checkpoints where task_id=t and item_key=k)<>'sending' then raise exception 'uncertain checkpoint lost';end if;
 end $$;""")
 print('PASS actual cloud_claim CAS; expired worker cannot replace pending sending')
 sql("""insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values('ee000001-0000-4000-8000-000000000001','convenis','provider-race','Conveni','Carrera sintètica','{}');
 insert into pipeline_runs(id,parameters) values('ee000001-0000-4000-8000-000000000002','{\"provider_budget_usd\":2}');
 insert into pipeline_jobs(id,run_id,source_record_id) values('ee000001-0000-4000-8000-000000000003','ee000001-0000-4000-8000-000000000002','ee000001-0000-4000-8000-000000000001');
 insert into worker_tasks(id,task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until) values('ee000001-0000-4000-8000-000000000004','process_run','ee000001-0000-4000-8000-000000000002','vercel_workflow','running','ee000001-0000-4000-8000-000000000005',1,now()+interval '4 minutes');
 insert into worker_tasks(id,task_type,run_id,executor,execution_state,lease_owner,lease_generation,lease_until) values('ee000001-0000-4000-8000-000000000007','match_run','ee000001-0000-4000-8000-000000000002','vercel_workflow','running','ee000001-0000-4000-8000-000000000008',1,now()+interval '4 minutes');
 update cloud_resources set owner=null,lease_until=null,blocked_kind=null where name='ai';""")
 import os
 for mode in ['lifecycle-429','lifecycle-5xx','lifecycle-timeout','lifecycle-401','lifecycle-expired','lifecycle-foreign','lifecycle-resource-expired','cross-replay','same-task','same-task-different','same-task-other','same-task-5xx','same-task-429','same-task-cross-client']:
  if mode!='original':
   sql("delete from cloud_checkpoints where task_id in ('ee000001-0000-4000-8000-000000000004','ee000001-0000-4000-8000-000000000007');delete from cloud_budget_reservations where task_id in ('ee000001-0000-4000-8000-000000000004','ee000001-0000-4000-8000-000000000007');update cloud_resources set owner=null,lease_until=null,blocked_kind=null where name='ai';update worker_tasks set execution_state='running',lease_owner='ee000001-0000-4000-8000-000000000005',lease_generation=1,lease_until=now()+interval '4 minutes' where id='ee000001-0000-4000-8000-000000000004';")
  check=subprocess.run(['/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node','--import','tsx',str(Path(r"__HERE__")/'95-conveni-provider-fence.ts')],cwd=root,env={'PATH':os.environ.get('PATH',''),'NODE_ENV':'test','TEST_CONTAINER':name,'FIXTURE_MODE':mode},capture_output=True,text=True,timeout=60)
  if check.returncode:raise RuntimeError('provider-race '+mode+': '+check.stderr[-2000:])
  print(check.stdout.strip())
 print('PASS cloud/cloud concurrent fence; committed and received cross-journal fence')
'''.replace('__HERE__',str(here))
source=source.replace(anchor,extra+anchor)
exec(compile(source,str(harness),'exec'),{'__file__':str(harness),'__name__':'__main__'})
