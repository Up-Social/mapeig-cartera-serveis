"""Real advance entrypoint with two clients; isolated PostgreSQL and mocked REST."""
from pathlib import Path
p=Path(__file__).resolve().parent/'94-conveni-retained-real-schema.py'
s=p.read_text();anchor=" sql('''do $$ declare sid uuid:="
assert s.count(anchor)==1
extra=r'''
 sql("""insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,source_payload) values('aa010101-0000-4000-8000-000000000001','convenis','advance-claim','Conveni','Synthetic','conveni','{}');
 insert into pipeline_runs(id) values('aa010101-0000-4000-8000-000000000002');
 insert into pipeline_jobs(id,run_id,source_record_id) values('aa010101-0000-4000-8000-000000000003','aa010101-0000-4000-8000-000000000002','aa010101-0000-4000-8000-000000000001');
 insert into worker_tasks(id,task_type,run_id,executor,execution_state) values('aa010101-0000-4000-8000-000000000004','process_run','aa010101-0000-4000-8000-000000000002','vercel_workflow','pending');
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count) values('advance-fixture','fixture','fixture',now(),current_date,'fixture','','','{}',1);
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence) values('aa010101-0000-4000-8000-000000000003','aa010101-0000-4000-8000-000000000001','advance-fixture','fixture','insufficient_evidence','[]','','','','[]');""")
 import os
 for mode in ['success','failure','existing']:
  sql("delete from cloud_checkpoints where task_id='aa010101-0000-4000-8000-000000000004';update worker_tasks set execution_state='pending',lease_owner=null,lease_until=null where id='aa010101-0000-4000-8000-000000000004';update pipeline_jobs set status='queued' where id='aa010101-0000-4000-8000-000000000003';")
  env={'PATH':os.environ.get('PATH',''),'NODE_ENV':'test','TEST_CONTAINER':name,'FIXTURE_MODE':mode,'WORKER_EXECUTION_MODE':'vercel_workflow','VERCEL_ENV':'production','NEXT_PUBLIC_SUPABASE_URL':'https://vvzxlevbfjvzygorbpxn.supabase.co','SUPABASE_SECRET_KEY':'synthetic-test-key'}
  check=subprocess.run(['/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node','--import','tsx',str(root/'tests/sql/101-advance-invocation.ts')],cwd=root,env=env,capture_output=True,text=True,timeout=45)
  if check.returncode:raise RuntimeError('advance '+mode+': '+check.stderr[-3000:])
  print(check.stdout.strip())
 sql("delete from analysis_results where pipeline_job_id='aa010101-0000-4000-8000-000000000003';")
 t='aa010101-0000-4000-8000-000000000004';j='aa010101-0000-4000-8000-000000000003';o='aa010101-0000-4000-8000-000000000005';new='aa010101-0000-4000-8000-000000000006'
 sql("update worker_tasks set execution_state='running',lease_owner='"+o+"',lease_generation=10,lease_until=now()+interval '4 minutes' where id='"+t+"';")
 assert sql("set role service_role;select public.cloud_screen_conveni('"+t+"','"+o+"',10,'"+j+"');").strip()=='f'
 sql("update source_records set financing_type='concert' where id='aa010101-0000-4000-8000-000000000001';")
 assert sql("set role service_role;select public.cloud_screen_conveni('"+t+"','"+o+"',10,'"+j+"');").strip()=='f'
 sql("update source_records set financing_type='conveni' where id='aa010101-0000-4000-8000-000000000001';")
 try:sql("set role service_role;select public.cloud_screen_conveni('"+t+"','"+o+"',10,'aa010101-0000-4000-8000-000000000099');");raise AssertionError('wrong scope accepted')
 except RuntimeError as e:assert 'CLOUD_SCOPE' in str(e),str(e)
 assert sql("select has_function_privilege('anon','public.cloud_screen_conveni(uuid,uuid,bigint,uuid)','execute')::text||','||has_function_privilege('service_role','public.cloud_screen_conveni(uuid,uuid,bigint,uuid)','execute')::text;").strip()=='false,true'
 assert sql("select has_function_privilege('authenticated','public.cloud_persist_conveni(uuid,uuid,bigint,uuid,text,jsonb,jsonb,text)','execute')::text||','||has_function_privilege('service_role','public.cloud_persist_conveni(uuid,uuid,bigint,uuid,text,jsonb,jsonb,text)','execute')::text;").strip()=='false,true'
 first=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write("begin;set local role service_role;select public.cloud_screen_conveni('"+t+"','"+o+"',10,'"+j+"');select pg_sleep(3);commit;\n");first.stdin.flush();time.sleep(.6)
 try:sql("set lock_timeout='300ms';update worker_tasks set lease_until=now()-interval '1 second' where id='"+t+"';");raise AssertionError('lease changed during guarded transaction')
 except RuntimeError as e:assert 'lock timeout' in str(e),str(e)
 first.stdin.close();err=first.stderr.read();first.wait(timeout=10);assert first.returncode==0,err
 sql("update worker_tasks set lease_until=now()-interval '1 second' where id='"+t+"';select public.cloud_claim('"+t+"','"+new+"','cloud-v1');")
 for operation in ["cloud_screen_conveni('"+t+"','"+o+"',10,'"+j+"')","cloud_persist_conveni('"+t+"','"+o+"',10,'"+j+"','fixture','{}','{}','fixture')"]:
  try:sql('set role service_role;select public.'+operation+';');raise AssertionError('stale writer was accepted')
  except RuntimeError as e:assert 'CLOUD_LEASE_LOST' in str(e),str(e)
 print('PASS candidate blocks stale lease before screen or persist; valid screen runs')
 # 710: no stale mutation, no transition without analysis, and terminal
 # human outcomes are not reverted if the initial read becomes outdated.
 sql("update worker_tasks set execution_state='running',lease_owner='"+o+"',lease_generation=20,lease_until=now()+interval '4 minutes' where id='"+t+"';update pipeline_jobs set status='queued' where id='"+j+"';")
 transition="public.cloud_mark_existing_analysis_review('"+t+"','"+o+"',20,'"+j+"')"
 try:sql('set role service_role;select '+transition+';');raise AssertionError('missing result accepted')
 except RuntimeError as e:assert 'CLOUD_ANALYSIS_MISSING' in str(e),str(e)
 sql("insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence) values('"+j+"','aa010101-0000-4000-8000-000000000001','advance-fixture','fixture','insufficient_evidence','[]','','','','[]');")
 try:sql("set role service_role;select public.cloud_mark_existing_analysis_review('"+t+"','"+o+"',20,'aa010101-0000-4000-8000-000000000099');");raise AssertionError('other scope accepted')
 except RuntimeError as e:assert 'CLOUD_SCOPE' in str(e),str(e)
 try:sql("set role service_role;select public.cloud_mark_existing_analysis_review('"+t+"','"+new+"',20,'"+j+"');");raise AssertionError('stale worker updated job')
 except RuntimeError as e:assert 'CLOUD_LEASE_LOST' in str(e),str(e)
 assert sql("select status from pipeline_jobs where id='"+j+"';").strip()=='queued'
 sql("insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values('aa010101-0000-4000-8000-000000000010','convenis','other-record','Conveni','Other','{}');")
 first=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 first.stdin.write('begin;set local role service_role;select '+transition+';select pg_sleep(5);commit;\n');first.stdin.flush();time.sleep(.6)
 try:sql("set lock_timeout='300ms';update pipeline_jobs set status='approved' where id='"+j+"';");raise AssertionError('job updated concurrently with transition')
 except RuntimeError as e:assert 'lock timeout' in str(e),str(e)
 try:sql("set lock_timeout='300ms';delete from analysis_results where pipeline_job_id='"+j+"';");raise AssertionError('analysis deleted concurrently with transition')
 except RuntimeError as e:assert 'lock timeout' in str(e),str(e)
 try:sql("set lock_timeout='300ms';update analysis_results set source_record_id='aa010101-0000-4000-8000-000000000010' where pipeline_job_id='"+j+"';");raise AssertionError('analysis source changed concurrently with transition')
 except RuntimeError as e:assert 'lock timeout' in str(e),str(e)
 first.stdin.close();err=first.stderr.read();first.wait(timeout=10);assert first.returncode==0,err
 assert sql("select status from pipeline_jobs where id='"+j+"';").strip()=='needs_review'
 sql("update pipeline_jobs set status='approved' where id='"+j+"';")
 assert sql('set role service_role;select '+transition+';').strip()=='f'
 assert sql("select status from pipeline_jobs where id='"+j+"';").strip()=='approved'
 assert sql("select has_function_privilege('authenticated','public.cloud_mark_existing_analysis_review(uuid,uuid,bigint,uuid)','execute')::text||','||has_function_privilege('service_role','public.cloud_mark_existing_analysis_review(uuid,uuid,bigint,uuid)','execute')::text;").strip()=='false,true'
 print('PASS existing analysis transition requires current lease and preserves terminal job status')
'''
s=s.replace(anchor,extra+anchor)
exec(compile(s,str(p),'exec'),{'__file__':str(p),'__name__':'__main__'})
