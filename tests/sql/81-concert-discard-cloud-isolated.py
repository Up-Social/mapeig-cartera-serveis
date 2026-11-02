from pathlib import Path
import subprocess,time,uuid,json,os,sys
root=Path(__file__).resolve().parents[2]
name='mapeig-review-'+uuid.uuid4().hex[:12];pg=name+'-pg';rest=name+'-rest';network=name+'-net';created=[]
def run(args,input=None,timeout=90):
 p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('failed '+str(args[:3])+': '+(p.stderr or p.stdout)[-2500:])
 return p.stdout.strip()
def sql(s,user='postgres'):
 return run(['docker','exec','-i',pg,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=s)
try:
 run(['docker','network','create','--internal','--label','codex-test=concert-review',network]);created.append(network)
 run(['docker','run','-d','--pull=never','--name',pg,'--network',network,'--label','codex-test=concert-review','-e','POSTGRES_PASSWORD=synthetic','public.ecr.aws/supabase/postgres:17.11.0.004']);created.append(pg)
 for i in range(120):
  # The temporary initdb server listens only on the Unix socket. The final
  # server must accept TCP before migrations touch its newly initialized DB.
  probe=subprocess.run(['docker','exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if probe.returncode==0:
   try:
    if sql('select 1;')=='1':break
   except RuntimeError:pass
  time.sleep(.5)
 else:raise RuntimeError('database not ready')
 sql('''create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint); create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text); grant usage on schema storage to postgres,service_role; grant select,insert,update on storage.buckets to postgres; grant select on storage.objects to postgres,service_role;''','supabase_admin')
 migrations=[(p.name,p.read_text()) for p in sorted((root/'supabase/migrations').glob('*.sql'))]
 for filename,contents in migrations:
  try:sql('begin;\n'+contents+'\ncommit;')
  except RuntimeError as e:raise RuntimeError(filename+': '+str(e)) from e
 print('MIGRATIONS',len(migrations),flush=True)
 sql("insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic') on conflict(key) do update set enabled=true;")
 sql('begin;\n'+(root/'tests/sql/82-record-reconciliation-guard.sql').read_text()+'\nrollback;')
 sql('begin;\n'+(root/'tests/sql/83-phase-reconciliation-guard.sql').read_text()+'\nrollback;')
 sql('begin;\n'+(root/'tests/sql/84-cloud-create-run-null.sql').read_text()+'\nrollback;')
 # Synthetic catalog and isolated task fixtures. All ids and text are fictitious.
 sql('''
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
 values('fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixed','notice','context','{"parser_version":"normative-fields-v2"}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
 values('fixture','1','Servei',null,'service','Descripció','Població','Condicions','Llei','{}');
 ''')
 for n in range(1,12):
  record=f'10000000-0000-4000-8000-{n:012}';job=f'20000000-0000-4000-8000-{n:012}';task=f'30000000-0000-4000-8000-{n:012}';runid=f'40000000-0000-4000-8000-{n:012}';doc=f'50000000-0000-4000-8000-{n:012}';owner='60000000-0000-4000-8000-000000000001'
  title='Resolució de convocatòria de serveis' if n==9 else 'Resolució de places desertes del concert social'
  content=('La resolució considera que les places desertes del procediment necessiten revisió i descriu el seu context. '*8).replace("'","''")
  if n==9:content='Resolc: 1. Assignar els serveis de suport social a l’entitat beneficiària. '+content
  sql(f'''insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values('{record}','concerts','fixture-{n}','Concert','{title}','{{}}');
   insert into pipeline_runs(id,status) values('{runid}','matching');
   insert into pipeline_jobs(id,run_id,source_record_id,status) values('{job}','{runid}','{record}','matching');
   insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,extraction_method,extraction_partial,quality_flags)
   values('{doc}','{record}','https://example.invalid/{n}','hash-{n}','agreement','fetched','application/pdf','{content}',{len(content)},'pdf-text',false,'{{}}');
   insert into evidence_chunks(source_document_id,ordinal,content,content_hash,character_count) values('{doc}',0,'{content}','hash-{n}',{len(content)});
   insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,lease_owner,lease_generation,lease_until,pipeline_job_id)
   values('{task}','match_run','{runid}','vercel_workflow','running','running','{owner}',1,now()+interval '30 minutes','{job}');''')
  if n==10:sql(f"delete from evidence_chunks where source_document_id='{doc}';")
  if n==11:sql(f"update source_documents set extraction_partial=true where id='{doc}';")
  if n==9:sql(f"insert into concert_annex_reconciliations(source_record_id,document_id,document_sha256,extraction_version,annex,row_count,sum_cents,reconciled,coverage) values('{record}','{doc}',repeat('a',64),'program-columns-v2',0,1,0,false,'{{\"complete\":false}}');")
  if n in (2,3,4,5,6,7,8,10,11):
   state={2:'received',3:'retry',4:'sending',5:'unknown',6:'received',7:'received',8:'rejected',10:'received',11:'received'}[n]
   receipt_job=job if n!=6 else '90000000-0000-4000-8000-000000000001'
   phase='enrichment' if n==6 else 'concert-role-review-v2' if n==7 else 'matching'
   key=f'ai:{receipt_job}:{phase}';value=json.dumps({'state':state,'attempt':1,'response':{'id':'synthetic','usage':{'input_tokens':10,'output_tokens':3}}})
   sql(f'''insert into cloud_checkpoints(task_id,item_key,value) values('{task}','{key}','{value}'::jsonb);
    insert into cloud_budget_reservations(task_id,item_key,reserved_usd,actual_usd) values('{task}','{key}',0.42,null);''')
 run(['docker','run','-d','--pull=never','--name',rest,'--network',network,'--label','codex-test=concert-review','-e',f'PGRST_DB_URI=postgres://postgres:synthetic@{pg}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=postgres','public.ecr.aws/supabase/postgrest:v16.4']);created.append(rest)
 for i in range(30):
  try:
   if run(['docker','exec',pg,'curl','-sS','--max-time','2',f'http://{rest}:3000/'])[:1]=='{':break
  except RuntimeError:pass
  time.sleep(.5)
 else:raise RuntimeError('PostgREST not ready')
 env=dict(os.environ);env.update({'REVIEW_TEST_PG':pg,'REVIEW_TEST_REST':rest,'OPENAI_API_KEY':'synthetic','OPENAI_MATCHING_MODEL':'fixture','PATH':'/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:'+os.environ['PATH']})
 env.pop('WORKFLOW_TEST_PROJECT',None);env.pop('PIPELINE_PROVIDER',None)
 p=subprocess.run(['node','--import','tsx',str(root/'tests/fixtures/concert-review-isolated.ts')],cwd=root,text=True,capture_output=True,env=env,timeout=90)
 print(p.stdout,flush=True)
 if p.returncode:raise RuntimeError(p.stderr[-4000:])
 # Run the actual guard under the application role; this fixture's grants are
 # synthetic and do not establish the production permission configuration.
 sql("""set role service_role;
 do $$ begin begin perform cloud_start_phase('40000000-0000-4000-8000-000000000002','match_run');raise exception 'TEST_STARTED';
 exception when others then if sqlerrm<>'PROVIDER_RECONCILIATION_REQUIRED' then raise;end if;end;end $$;
 reset role;""")
 # Resume is a separately exposed SQL RPC. Confirm that the new marker and
 # both uncertain states stop it before snapshots, attempts or task changes.
 for n in (2,3,4,5,6,7,8,10,11):
  runid=f'40000000-0000-4000-8000-{n:012}'
  expected='PROVIDER_UNKNOWN' if n in (4,5) else 'PROVIDER_RECONCILIATION_REQUIRED'
  sql(f"""do $$ begin
   begin perform public.cloud_resume('{runid}'); raise exception 'TEST_RESUMED';
   exception when others then if sqlerrm<>'{expected}' then raise; end if; end;
  end $$;""")
 # Even without the task failure marker, an unknown checkpoint is unsafe.
 sql("""update worker_tasks set failure_kind='internal' where id='30000000-0000-4000-8000-000000000005';
 do $$ begin begin perform public.cloud_resume('40000000-0000-4000-8000-000000000005'); raise exception 'TEST_RESUMED';
 exception when others then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;end $$;""")
 if sql("select has_function_privilege('anon','public.cloud_resume(uuid)','execute') or has_function_privilege('authenticated','public.cloud_resume(uuid)','execute');")!='f':
  raise RuntimeError('cloud_resume exposed to public roles')
 # A concurrent updater holding the same task row cannot be bypassed: a
 # competing resume times out without mutating the task, then fails closed.
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin; select 1 from worker_tasks where id='30000000-0000-4000-8000-000000000002' for update;\\n\\echo HELD\\nselect pg_sleep(2); rollback;\\n".replace('\\n','\n'))
  holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('lock holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input="set statement_timeout='300ms'; select cloud_resume('40000000-0000-4000-8000-000000000002');",text=True,capture_output=True,timeout=5)
  if result.returncode==0 or 'statement timeout' not in result.stderr:raise RuntimeError('competing resume did not time out safely: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=5)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 if sql("select execution_state||':'||failure_kind from worker_tasks where id='30000000-0000-4000-8000-000000000002';")!='paused:provider_reconciliation':raise RuntimeError('competing resume changed the task')
 # The resume transaction also fences both insertion of a new checkpoint and
 # mutation of an existing one. The resume itself is rolled back afterwards.
 sql("update worker_tasks set execution_state='paused',status='failed',failure_kind='internal',lease_owner=null,lease_until=null where id='30000000-0000-4000-8000-000000000001';")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin; select cloud_resume('40000000-0000-4000-8000-000000000001');\n\\echo HELD\nselect pg_sleep(3); rollback;\n")
  holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('resume holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  for statement in (
   "insert into cloud_checkpoints(task_id,item_key,value) values('30000000-0000-4000-8000-000000000001','ai:synthetic:matching','{\"state\":\"unknown\"}')",
   "update cloud_checkpoints set value='{\"state\":\"unknown\"}' where task_id='30000000-0000-4000-8000-000000000001' and item_key=(select min(item_key) from cloud_checkpoints where task_id='30000000-0000-4000-8000-000000000001')",
  ):
   result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input="set statement_timeout='300ms'; "+statement+';',text=True,capture_output=True,timeout=5)
   if result.returncode==0 or 'statement timeout' not in result.stderr:raise RuntimeError('checkpoint race escaped: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=5)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 if sql("select execution_state||':'||failure_kind from worker_tasks where id='30000000-0000-4000-8000-000000000001';")!='paused:internal':raise RuntimeError('resume rollback failed')
 # Guarded cloud phase holds run, jobs, tasks and checkpoint rows. New
 # membership/receipts and changes to an existing checkpoint cannot slip in.
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin; select cloud_start_phase('40000000-0000-4000-8000-000000000001','match_run');\n\\echo HELD\nselect pg_sleep(6); rollback;\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('phase holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  for statement in (
   "insert into pipeline_jobs(run_id,source_record_id,status) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','selected')",
   "insert into worker_tasks(task_type,run_id,executor,status) values('prepare_run','40000000-0000-4000-8000-000000000001','vercel_workflow','queued')",
   "insert into cloud_checkpoints(task_id,item_key,value) values('30000000-0000-4000-8000-000000000001','ai:synthetic:matching','{\"state\":\"unknown\"}')",
   "update cloud_checkpoints set value='{\"state\":\"unknown\"}' where task_id='30000000-0000-4000-8000-000000000001' and item_key=(select min(item_key) from cloud_checkpoints where task_id='30000000-0000-4000-8000-000000000001')",
   "insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('20000000-0000-4000-8000-000000000001','matching','synthetic-phase','sending')",
  ):
   result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input="set statement_timeout='300ms'; "+statement+';',text=True,capture_output=True,timeout=5)
   if result.returncode==0 or 'statement timeout' not in result.stderr:raise RuntimeError('phase guard race escaped: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=9)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 # Reverse order: source held first makes the phase fail NOWAIT; source
 # transaction can then acquire the run. This is not a global deadlock proof.
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin; select 1 from source_records where id='10000000-0000-4000-8000-000000000001' for update;\n\\echo HELD\nselect pg_sleep(2); select 1 from pipeline_runs where id='40000000-0000-4000-8000-000000000001' for update; rollback;\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('source holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input="set statement_timeout='1s'; select cloud_start_phase('40000000-0000-4000-8000-000000000001','match_run');",text=True,capture_output=True,timeout=5)
  if result.returncode==0 or 'could not obtain lock' not in result.stderr:raise RuntimeError('source-first phase contention was not NOWAIT: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=8)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 sql("""begin isolation level repeatable read;
 do $$ begin begin perform cloud_start_phase('40000000-0000-4000-8000-000000000001','match_run'); raise exception 'TEST_STARTED';
 exception when others then if sqlerrm<>'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED' then raise;end if;end;end $$; rollback;""")
 print('PASS: cloud phase guard fences membership/receipts, rejects older snapshots and source-first contention',flush=True)
 # A caller holding an older transaction snapshot must not decide from it.
 sql("""begin isolation level repeatable read;
 do $$ begin begin perform cloud_resume('40000000-0000-4000-8000-000000000001'); raise exception 'TEST_RESUMED';
 exception when others then if sqlerrm<>'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED' then raise;end if;end;end $$; rollback;""")
 # Separate source/run/job/task with an ordinary historical pause and settled
 # synthetic receipts: lock the real individual operation and race writers.
 sid='a6000000-0000-4000-8000-000000000001';runid='a6000000-0000-4000-8000-000000000002';job='a6000000-0000-4000-8000-000000000003';task='a6000000-0000-4000-8000-000000000004';owner='a6000000-0000-4000-8000-000000000005'
 sql(f"""insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values('{sid}','contractacions','individual-lock-fixture','Contractació','Synthetic individual lock','{{}}');
 insert into pipeline_runs(id,status) values('{runid}','paused');
 insert into pipeline_jobs(id,run_id,source_record_id,status) values('{job}','{runid}','{sid}','ready');
 insert into worker_tasks(id,task_type,run_id,executor,status,execution_state,failure_kind,pipeline_job_id) values('{task}','match_run','{runid}','vercel_workflow','failed','paused','internal','{job}');
 insert into cloud_checkpoints(task_id,item_key,value) values('{task}','synthetic-existing','{{"state":"received"}}');
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('{job}','matching','fixture','received');""")
 sql(f"""begin isolation level repeatable read;
 do $$ begin begin perform begin_record_operation('{sid}','process','vercel_workflow');raise exception 'TEST_STARTED';
 exception when others then if sqlerrm<>'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED' then raise;end if;end;end $$; rollback;""")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write(f"begin; select begin_record_operation('{sid}','process','vercel_workflow');\n\\echo HELD\nselect pg_sleep(7); rollback;\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('individual holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  statements=(
   f"insert into pipeline_jobs(run_id,source_record_id,status) values('{runid}','{sid}','selected')",
   f"insert into worker_tasks(task_type,run_id,executor,status) values('prepare_run','{runid}','vercel_workflow','queued')",
   f"insert into cloud_checkpoints(task_id,item_key,value) values('{task}','ai:synthetic:matching','{{\"state\":\"unknown\"}}')",
   f"update cloud_checkpoints set value='{{\"state\":\"unknown\"}}' where task_id='{task}' and item_key='synthetic-existing'",
   f"insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('{job}','matching','synthetic-new','sending')",
   f"update provider_calls set state='sending' where pipeline_job_id='{job}' and request_hash='fixture'",
   f"update worker_tasks set failure_kind='provider_reconciliation' where id='{task}'",
  )
  for statement in statements:
   result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input="set statement_timeout='300ms'; "+statement+';',text=True,capture_output=True,timeout=5)
   if result.returncode==0 or 'statement timeout' not in result.stderr:raise RuntimeError('individual operation race escaped: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=10)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 if sql(f"select count(*) from worker_tasks where run_id='{runid}';")!='1':raise RuntimeError('individual transaction rollback left a task')
 # Reverse order: a cloud worker first holds the task lease and then commits;
 # the individual path fails NOWAIT, releases its earlier locks and the cloud
 # commit completes. This is one ordering, not a global deadlock proof.
 sql(f"update worker_tasks set status='running',execution_state='running',failure_kind=null,lease_owner='{owner}',lease_generation=1,lease_until=now()+interval '4 minutes' where id='{task}';")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write(f"begin; select cloud_assert_lease('{task}','{owner}',1);\n\\echo HELD\nselect pg_sleep(2); select cloud_commit('{task}','{owner}',1,'{job}','ready','{{}}'); rollback;\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('cloud holder failed: '+holder.stderr.read())
   if line.strip()=='HELD':break
  result=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=f"set statement_timeout='1s'; select begin_record_operation('{sid}','process','vercel_workflow');",text=True,capture_output=True,timeout=5)
  if result.returncode==0 or 'could not obtain lock' not in result.stderr:raise RuntimeError('cloud-first contention was not rejected NOWAIT: '+result.stderr)
 finally:
  holder.stdin.close();holder.wait(timeout=8)
  if holder.returncode:raise RuntimeError(holder.stderr.read())
 print('PASS: individual operation fences job/task/receipt writers; cloud-first contention fails NOWAIT and cloud commit succeeds after rollback',flush=True)
 # A legacy generic internal marker carries no reliable provenance; it is
 # intentionally not reclassified by this migration and remains resumable.
 sql("update worker_tasks set failure_kind='internal' where id='30000000-0000-4000-8000-000000000002';")
 if sql("select cloud_resume('40000000-0000-4000-8000-000000000002'); select execution_state from worker_tasks where id='30000000-0000-4000-8000-000000000002';").splitlines()!=['30000000-0000-4000-8000-000000000002','pending']:
  raise RuntimeError('historical internal behavior unexpectedly changed')
 print('PASS: SQL resume guard, unknown receipt, roles and concurrent lock; historical internal pause remains resumable',flush=True)
finally:
 for c in (rest,pg):
  if c in created:
   subprocess.run(['docker','rm','-f',c],check=True,capture_output=True)
 if network in created:subprocess.run(['docker','network','rm',network],check=True,capture_output=True)
 print('CLEANUP_OK',name,flush=True)
