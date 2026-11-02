"""Candidate migrations and synthetic rows, in a disposable networkless DB."""
from pathlib import Path
import subprocess,time,uuid
root=Path(__file__).resolve().parents[2]
name='mapeig-conveni-schema-'+uuid.uuid4().hex[:12];started=False
def run(cmd,data=None):
 p=subprocess.run(cmd,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode:raise RuntimeError(p.stderr[-3000:])
 return p.stdout
def sql(text,user='postgres'):return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],text)
wire=subprocess.run(['/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node','--import','tsx','--input-type','module','-e',"import {prepareProviderWireRequest} from './lib/openai-model.ts';process.stdout.write(prepareProviderWireRequest({model:'fixture',input:'fixture'}).fingerprint)"],cwd=root,text=True,capture_output=True,check=True).stdout
assert wire.startswith('prepared-json-v1:') and len(wire)==81
try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000'}:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as exc:raise RuntimeError(f.name+' '+str(exc)) from exc
 sql("update app_settings set enabled=true where key='processing_enabled';")
 sql('''do $$ declare sid uuid:='88aa1111-1111-4111-8111-111111111111';rid uuid;jid uuid;tid uuid;h text:='__WIRE_HASH__';begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{}');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status,error_kind) values(rid,sid,'error','validation') returning id into jid;
 insert into worker_tasks(task_type,run_id,executor) values('process_run',rid,'vercel_workflow') returning id into tid;
 insert into cloud_checkpoints(task_id,item_key,value) values
 (tid,'ai:'||jid||':conveni','{"state":"received","response":{"status":"completed","output_text":"{}"}}'),
 (tid,'conveni-input:'||jid,to_jsonb(h)),(tid,'provider-wire:ai:'||jid||':conveni',to_jsonb(h)),
 (tid,'last_failure',jsonb_build_object('kind','validation','job',jid,'diagnostic',jsonb_build_object('operation','conveni_analysis','code','CONVENI_MODEL_DISCARD_REVIEW_REQUIRED')));
 if read_conveni_retained_receipt(sid,jid)->>'status'<>'unavailable' then raise exception 'process_run without job must remain withheld';end if;
 update worker_tasks set pipeline_job_id=jid where id=tid;
 if read_conveni_retained_receipt(sid,jid)->>'status'<>'received' then raise exception 'scoped receipt unavailable';end if;
 if has_function_privilege('anon','public.read_conveni_retained_receipt(uuid,uuid)','execute') or has_function_privilege('authenticated','public.read_conveni_retained_receipt(uuid,uuid)','execute') or not has_function_privilege('service_role','public.read_conveni_retained_receipt(uuid,uuid)','execute') then raise exception 'ACL';end if;
 end $$;'''.replace('__WIRE_HASH__',wire))
 output=sql("set role service_role;select public.read_conveni_retained_receipt(j.source_record_id,j.id)->>'status' from public.pipeline_jobs j where j.source_record_id='88aa1111-1111-4111-8111-111111111111';")
 assert output=='received\n',output
 print('PASS: candidate migrations, process_run withheld, bound job accepted, effective ACL and service_role execution')
finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode:raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
