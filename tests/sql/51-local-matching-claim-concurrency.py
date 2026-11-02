import subprocess, uuid, sys, time
c='supabase_db_cartera-workflow-test'; db='t19_iso_'+uuid.uuid4().hex[:16]
base=['docker','exec','-i',c]; created=False

def run(args, data=None):
 p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:
  raise RuntimeError((p.stderr or p.stdout).decode()[-3000:])
 return p.stdout.decode()
def sql(stmt): return run(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qAt'],stmt.encode())
try:
 run(base+['createdb','-U','postgres',db]); created=True
 dump=subprocess.run(base+['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
 dump=b'\n'.join(line for line in dump.splitlines() if not line.strip().startswith(b'SET log_min_messages'))
 run(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-q'],dump)
 for path in ['supabase/migrations/20261029011000_local_matching_input_capture.sql','supabase/migrations/20261029012000_local_matching_commit.sql']:
  sql(open(path).read())
 helper=open('tests/sql/50-local-matching-commit.sql').read().split('do $$')[0].replace('pg_temp.matching_input','public.t19_matching_input')
 sql(helper)
 setup='''
 insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic isolated test');
 update catalog_versions set active=false where active;
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('t19-race','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('t19-race','1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('a1000000-0000-0000-0000-000000000001','contractacions','t19-race','Contract','Synthetic');
 insert into pipeline_runs(id,status) values('a1000000-0000-0000-0000-000000000002','matching');
 insert into pipeline_jobs(id,run_id,source_record_id,status) values('a1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','matching');
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values('a1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','https://example.invalid/race','t19-race','publication','fetched');
 insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values('a1000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000004',0,'synthetic content','hash',17);
 create table t19_expected as select public.t19_matching_input('a1000000-0000-0000-0000-000000000001','t19-race','a1000000-0000-0000-0000-000000000003') v;
 '''
 sql(setup)
 claim="public.local_claim_matching_request('a1000000-0000-0000-0000-000000000003',(select v from t19_expected),'matching','prepared-json-v1:'||repeat('a',64),repeat('b',64),null)"
 def holder(stmt):
  p=subprocess.Popen(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  p.stdin.write('begin;\n'+stmt+'\n\\echo LOCK_HELD\nselect pg_sleep(4);\nrollback;\n');p.stdin.flush()
  while True:
   line=p.stdout.readline()
   if not line: raise RuntimeError('holder failed: '+p.stderr.read())
   if line.strip()=='LOCK_HELD':break
  return p
 def done(p):
  p.stdin.close();p.wait(timeout=10)
  if p.returncode: raise RuntimeError(p.stderr.read())
 p=holder("update app_settings set enabled=false where key='processing_enabled';")
 started=time.monotonic()
 outcome=sql('select '+claim+' is null; select count(*) from provider_calls; select count(*) from local_matching_requests;').strip().splitlines()
 elapsed=time.monotonic()-started
 if outcome != ['t','0','0'] or elapsed>=2:
  raise RuntimeError('Contended safety switch did not fail promptly: '+repr((outcome,elapsed)))
 # A second transaction can still obtain the source lock while the switch is held.
 sql("set lock_timeout='500ms'; update source_records set title=title where id='a1000000-0000-0000-0000-000000000001';")
 done(p)
 p=holder("update source_records set title='other' where id='a1000000-0000-0000-0000-000000000001';")
 outcome=sql('select '+claim+' is null; select count(*) from provider_calls; select count(*) from local_matching_requests;').strip().splitlines()
 done(p)
 if outcome != ['t','0','0']:raise RuntimeError('Concurrent source lock did not fail closed: '+repr(outcome))
 p=holder('select '+claim+';')
 try:
  sql("set lock_timeout='500ms'; update source_records set title='concurrent' where id='a1000000-0000-0000-0000-000000000001';")
  raise RuntimeError('Source update was not blocked while atomic claim held locks')
 except RuntimeError as e:
  if 'lock timeout' not in str(e):raise
 done(p)
 outcome=sql('select count(*) from provider_calls; select count(*) from local_matching_requests;').strip().splitlines()
 if outcome != ['0','0']:raise RuntimeError('Rollback left intent or receipt: '+repr(outcome))
 print('PASS: safety-switch contention fails promptly without source lock; atomic claim refuses competing source update; claim blocks concurrent write; rollback removes intent and receipt')
finally:
 if created:
  p=subprocess.run(base+['dropdb','-U','postgres','--force',db],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if p.returncode:print('CLEANUP FAILED for '+db+': '+p.stderr.decode(),file=sys.stderr)
