"""Synthetic test in a disposable, networkless PostgreSQL container."""
from pathlib import Path
import subprocess,time,uuid,sys
root=Path(__file__).resolve().parents[2]
name='mapeig-journal-'+uuid.uuid4().hex[:12]
def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=100)
 if p.returncode:raise RuntimeError('command failed: '+p.stderr[-1800:])
 return p.stdout
def sql(s,user='postgres'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],s)
def reject(query,expected):
 p=subprocess.run(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=10)
 if p.returncode==0 or expected not in p.stderr:raise RuntimeError('Expected '+expected+': '+p.stderr[-1000:])
def hold(query):
 p=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 p.stdin.write('begin;\n'+query+'\n\\echo HELD\n');p.stdin.flush()
 out=[]
 while True:
  line=p.stdout.readline()
  if not line:raise RuntimeError('holder failed: '+p.stderr.read()[-1500:])
  if line.strip()=='HELD':return p,out
  out.append(line.strip())
def release(p,commit=False):
 p.stdin.write(('commit;' if commit else 'rollback;')+'\n\\q\n');p.stdin.flush();p.stdin.close();p.wait(timeout=10)
 if p.returncode:raise RuntimeError('holder failed: '+p.stderr.read()[-1500:])
try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004'])
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 excluded={'20261029031000','20261029032000','20261029033000','20261029034000'} if '--exclude-local-prototypes' in sys.argv else set()
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in excluded:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as e:raise RuntimeError(f.name+' '+str(e))
 for file in ('36-conveni-provider-request-guard.sql','39-provider-wire-hash-guard.sql','89-provider-receipt-conflict-guard.sql'):
  sql("begin;update app_settings set enabled=true where key='processing_enabled';"+(root/'tests/sql'/file).read_text()+'rollback;')
 sql("""update app_settings set enabled=true where key='processing_enabled';
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('f1000000-0000-4000-8000-000000000001','convenis','synthetic','Conveni','Synthetic');
 insert into pipeline_runs(id) values('f1000000-0000-4000-8000-000000000002');
 insert into pipeline_jobs(id,run_id,source_record_id,status) values('f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','ready');""")
 j="'f1000000-0000-4000-8000-000000000003'";a="'prepared-json-v1:'||repeat('a',64)";b="'prepared-json-v1:'||repeat('b',64)"
 first=f"select claim_provider_call({j},'matching',{a});"
 p,out=hold(first)
 try:
  if '"send": true' not in ''.join(out):raise RuntimeError('first claim did not send')
  reject("set lock_timeout='250ms';select claim_provider_call("+j+",'matching',"+b+");",'lock timeout')
 finally:release(p,True)
 reject(f"select claim_provider_call({j},'matching',{b});",'PROVIDER_UNKNOWN')
 sql(f"update provider_calls set state='received',response='{{\"id\":\"fixture\"}}' where pipeline_job_id={j};")
 reject(f"select claim_provider_call({j},'matching',{b});",'PROVIDER_REQUEST_CHANGED')
 # Held replay pins job and existing receipts. An update and FK insertion must wait.
 p,out=hold(first)
 try:
  if '"send": false' not in ''.join(out):raise RuntimeError('exact replay rejected')
  reject(f"set lock_timeout='250ms';update provider_calls set response='{{}}' where pipeline_job_id={j};",'lock timeout')
  reject(f"set lock_timeout='250ms';insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values({j},'matching',{b},'received','{{}}');",'lock timeout')
 finally:release(p)
 # A writer of an existing row that began first cannot be overlooked; waiting
 # times out in the fixture and after it commits the conflict is observed.
 sql(f"insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values({j},'matching',{b},'received','{{}}');")
 p,_=hold(f"update provider_calls set response='{{\"changed\":true}}' where pipeline_job_id={j} and request_hash={b};")
 try:reject("set lock_timeout='250ms';"+first,'lock timeout')
 finally:release(p,True)
 reject(first,'PROVIDER_REQUEST_CHANGED')
 reject('begin isolation level repeatable read;'+first,'PROVIDER_SCOPE_ISOLATION_UNSUPPORTED')
 print('PASS ('+('excluding 310–340' if excluded else 'all local migrations')+'): first claim, exact replay, conflicting legacy/versioned receipt, sending priority, pause, concurrent claims/updates/inserts, rollback and isolation; no network provider')
finally:
 result=subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=30)
 if result.returncode:print('CLEANUP FAILED: '+name)
