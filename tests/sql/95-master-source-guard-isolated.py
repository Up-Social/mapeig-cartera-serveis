"""Actual candidate migrations in an isolated ephemeral PostgreSQL; no network."""
from pathlib import Path
import subprocess,time,uuid,select

root=Path(__file__).resolve().parents[2]
name='mapeig-master-guard-'+uuid.uuid4().hex[:12]
started=False
def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode:raise RuntimeError(p.stderr[-3000:])
 return p.stdout
def sql(value,user='postgres'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],value)
try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 excluded={'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000'}
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in excluded:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as exc:raise RuntimeError(f.name+' '+str(exc)) from exc
 sql("""
 begin;
 set local role service_role;
 do $$ declare id_ uuid:=gen_random_uuid();expected_ jsonb;previous_ jsonb;archive_ jsonb;
   digest_ text:=repeat('a',64);book_ text:=repeat('b',64);path_ text; begin
  insert into public.master_services(id,service_code,service_name,source_file,source_sheet,source_row,source_payload,source_payload_hash)
   values(id_,'test-master-guard','Synthetic','book.xlsx','sheet',4,'{"a":1}','hash');
  expected_:=jsonb_build_object('source_file','book.xlsx','source_sheet','sheet','source_row',4,'source_payload','{"a":1}'::jsonb,'source_payload_hash','hash');
  previous_:='{"storage_path":null,"storage_sha256":null}';archive_:=jsonb_build_object('path','imports/legacy/'||book_||'.xlsx','sha256',book_);
  path_:='references/master/items/'||id_||'/source/'||digest_||'.json';
  if public.publish_historical_master_source(id_,expected_,previous_,archive_,path_,digest_) is not true then raise exception 'initial';end if;
  if public.publish_historical_master_source(id_,expected_,previous_,archive_,path_,digest_) is not true then raise exception 'replay';end if;
  if public.publish_historical_master_source(id_,expected_,previous_,archive_,replace(path_,digest_,repeat('c',64)),repeat('c',64)) is not false then raise exception 'overwrite';end if;
  update public.master_services set source_payload='{"a":2}' where id=id_;
  if public.publish_historical_master_source(id_,expected_,previous_,archive_,path_,digest_) is not false then raise exception 'stale payload';end if;
  if public.publish_historical_master_source(gen_random_uuid(),expected_,previous_,archive_,path_,digest_) is not false then raise exception 'missing row';end if;
  if has_function_privilege('anon','public.publish_historical_master_source(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE') or
     has_function_privilege('authenticated','public.publish_historical_master_source(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE') or
     not has_function_privilege('service_role','public.publish_historical_master_source(uuid,jsonb,jsonb,jsonb,text,text)','EXECUTE') then raise exception 'acl';end if;
 end $$;
 rollback;
 """)
 print('PASS: actual schema: source/pointer CAS, idempotent replay, overwrite, stale payload, missing row, ACL')
 # A locked Master row causes a bounded, explicit conflict, never a second write.
 rowid=str(uuid.uuid4());digest='a'*64;book='b'*64
 sql("insert into public.master_services(id,service_code,service_name,source_file,source_sheet,source_row,source_payload,source_payload_hash) values('"+rowid+"','test-lock','Synthetic','book.xlsx','sheet',4,'{\"a\":1}','hash');")
 locker=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  assert locker.stdin and locker.stdout
  locker.stdin.write("begin; do $$ begin perform id from public.master_services where id='"+rowid+"' for update; end $$; \\echo LOCKED\n");locker.stdin.flush()
  if not select.select([locker.stdout],[],[],10)[0]:raise RuntimeError('LOCK_TIMEOUT')
  if locker.stdout.readline().strip()!='LOCKED':raise RuntimeError('LOCK_NOT_CONFIRMED')
  attempt="""set role service_role; select public.publish_historical_master_source(
    '%s','{"source_file":"book.xlsx","source_sheet":"sheet","source_row":4,"source_payload":{"a":1},"source_payload_hash":"hash"}',
    '{"storage_path":null,"storage_sha256":null}', '{"path":"imports/legacy/%s.xlsx","sha256":"%s"}',
    'references/master/items/%s/source/%s.json','%s');"""%(rowid,book,book,rowid,digest,digest)
  try:sql(attempt)
  except RuntimeError as exc:
   if 'MASTER_SOURCE_BUSY' not in str(exc):raise
  else:raise RuntimeError('LOCK_DID_NOT_FENCE')
  if sql("select count(*) from public.master_services where id='"+rowid+"' and storage_path is not null;").strip()!='0':raise RuntimeError('LOCKED_POINTER_CHANGED')
  print('PASS: concurrent lock returns MASTER_SOURCE_BUSY and preserves the pointer')
 finally:
  if locker.stdin:
   try:locker.stdin.write('rollback; \\q\n');locker.stdin.flush()
   except BrokenPipeError:pass
  try:locker.wait(timeout=10)
  except subprocess.TimeoutExpired:locker.kill();locker.wait(timeout=10);raise RuntimeError('LOCKER_CLEANUP_FAILED')
finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode:raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
