import subprocess, uuid, sys
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
 sql(open('supabase/migrations/20261029013000_import_source_pointer_guard.sql').read())
 sql("""
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('a1000000-0000-0000-0000-000000000001','contractacions','t19-race','Contract','Synthetic');
 insert into import_runs(id,storage_manifest) values('a1000000-0000-0000-0000-000000000006',jsonb_build_object('Book.xlsx',jsonb_build_object('bucket','cloud-documents','path','imports/a1000000-0000-0000-0000-000000000006/'||repeat('c',64)||'.xlsx','sha256',repeat('c',64),'byte_size',123)));
 update source_records set source_file='Book.xlsx',source_sheet='Sheet',source_row=2,source_payload='{\"x\":1}',source_payload_hash='hash',import_run_id='a1000000-0000-0000-0000-000000000006' where id='a1000000-0000-0000-0000-000000000001';
 """)
 publish="""public.publish_import_source('a1000000-0000-0000-0000-000000000001',jsonb_build_object('source_dataset','contractacions','source_record_id','t19-race','source_file','Book.xlsx','source_sheet','Sheet','source_row',2,'source_payload','{\"x\":1}'::jsonb,'source_payload_hash','hash','import_run_id','a1000000-0000-0000-0000-000000000006'::uuid),jsonb_build_object('storage_path',null,'storage_sha256',null),jsonb_build_object('path','imports/a1000000-0000-0000-0000-000000000006/'||repeat('c',64)||'.xlsx','sha256',repeat('c',64)),'cases/a1000000-0000-0000-0000-000000000001/imports/a1000000-0000-0000-0000-000000000006/'||repeat('a',64)||'.json',repeat('a',64))"""
 def holder(stmt):
  p=subprocess.Popen(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  p.stdin.write('begin;\n'+stmt+'\n\\echo LOCK_HELD\nselect pg_sleep(4);\nrollback;\n');p.stdin.flush()
  while True:
   line=p.stdout.readline()
   if not line:raise RuntimeError('holder failed: '+p.stderr.read())
   if line.strip()=='LOCK_HELD':break
  return p
 def done(p):
  p.stdin.close();p.wait(timeout=10)
  if p.returncode:raise RuntimeError(p.stderr.read())
 for stmt in ["update import_runs set status=status where id='a1000000-0000-0000-0000-000000000006';", "update source_records set title=title where id='a1000000-0000-0000-0000-000000000001';"]:
  p=holder(stmt)
  try:
   sql('select '+publish+';')
   raise RuntimeError('Lock conflict unexpectedly accepted')
  except RuntimeError as e:
   if 'IMPORT_SOURCE_BUSY' not in str(e):raise
  done(p)
  if sql("select storage_path is null from source_records where id='a1000000-0000-0000-0000-000000000001';").strip()!='t':raise RuntimeError('Conflict changed source pointer')
 p=holder("update import_runs set status=status where id='a1000000-0000-0000-0000-000000000006';")
 try:
  sql("select public.publish_import_workbook('a1000000-0000-0000-0000-000000000006','Extra.xlsx','imports/a1000000-0000-0000-0000-000000000006/'||repeat('d',64)||'.xlsx',repeat('d',64),42);")
  raise RuntimeError('Workbook lock conflict unexpectedly accepted')
 except RuntimeError as e:
  if 'IMPORT_WORKBOOK_BUSY' not in str(e):raise
 done(p)
 if sql("select (storage_manifest ? 'Extra.xlsx')::text from import_runs where id='a1000000-0000-0000-0000-000000000006';").strip()!='false':raise RuntimeError('Contended manifest was modified')
 if sql('select '+publish+';').strip()!='t':raise RuntimeError('Publication after lock release failed')
 print('PASS: concurrent workbook manifest and source locks fail closed without modifying pointer or manifest')

finally:
 if created:
  p=subprocess.run(base+['dropdb','-U','postgres','--force',db],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if p.returncode:print('CLEANUP FAILED for '+db+': '+p.stderr.decode(),file=sys.stderr)
