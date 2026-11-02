"""Synthetic PostgreSQL only; no provider, environment credentials or network."""
from pathlib import Path
import json,subprocess,time,uuid

root=Path(__file__).resolve().parents[2]
name='mapeig-pop-event-'+uuid.uuid4().hex[:12]
started=False

def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode: raise RuntimeError(p.stderr[-3000:])
 return p.stdout

def sql(value,user='postgres'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],value)

try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004'])
 started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(.5)
 else: raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000'}: continue
  if f.name.startswith('20261030046000'):
   before=sql("select pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure)")
   bulk_before=sql("select pg_get_functiondef('public.review_reconciled_concert(uuid,uuid,text,jsonb)'::regprocedure)")
  try: sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as e: raise RuntimeError(f.name+' '+str(e)) from e
  if f.name.startswith('20261030046000'):
   if before!=sql("select pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure)") or bulk_before!=sql("select pg_get_functiondef('public.review_reconciled_concert(uuid,uuid,text,jsonb)'::regprocedure)"):
    raise RuntimeError('EXISTING_APPROVAL_WRITER_CHANGED')
   print('PASS: existing individual and collective approval functions are unchanged')
 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update public.app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")
 sql((root/'tests/sql/95-concert-population-event.sql').read_text())
 print('PASS: service-role snapshot, unknown decision, idempotency, conflict, scope, grants and financing unchanged')
 print('PASS: rollback-only counterexample reproduces Master/batch exposure of a line without global approval')
 # Keep a fixture only inside this disposable DB, then check that a direct
 # correction writer cannot insert while the source is locked for a decision.
 fixture=(root/'tests/sql/95-concert-population-event.sql').read_text()
 assert fixture.rstrip().endswith('rollback;')
 fixture=fixture.rstrip()[:-len('rollback;')]+'reset role;select row_to_json(f) from population_fixture f;commit;'
 ids=json.loads(sql(fixture).strip())
 fks=sql("select count(*) from pg_constraint where conrelid='public.documented_corrections'::regclass and confrelid='public.source_records'::regclass and contype='f' and not condeferrable;").strip()
 if fks!='1':raise RuntimeError('SOURCE_FK_NOT_IMMEDIATE')
 holder=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin;select id from public.source_records where id='"+ids['record_id']+"' for update;\n\\echo LOCKED\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('HOLDER_FAILED '+holder.stderr.read()[-1000:])
   if line.strip()=='LOCKED':break
  query="""set lock_timeout='750ms';insert into public.documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(gen_random_uuid(),'{record_id}','{job_id}','{unit_id}','provider_name','Entitat nova','{document_id}','fixture',1,'Cita documental sintètica',true,'Correcció de prova','Revisor');""".format(**ids)
  blocked=subprocess.run(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=10)
  if blocked.returncode==0 or 'lock timeout' not in blocked.stderr:raise RuntimeError('CORRECTION_INSERT_NOT_FENCED '+blocked.stderr[-1000:])
 finally:
  holder.stdin.write('rollback;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=10)
  if holder.returncode:raise RuntimeError('HOLDER_FAILED '+holder.stderr.read()[-1000:])
 print('PASS: immediate source FK fences a concurrent direct correction insertion while the decision holds the source lock')
 deletion=(root/'tests/sql/07-delete.sql').read_text().split('do $$\ndeclare a jsonb;')[0]
 check="""
 do $$declare a jsonb;b jsonb;r uuid;j uuid;d uuid;u uuid;e uuid;before_count bigint;begin
 a:=pg_temp.discard_fixture();b:=pg_temp.discard_fixture();r:=(a->>'id')::uuid;j:=(a->>'job_id')::uuid;
 insert into public.source_documents(source_record_id,url,url_hash,document_type,status) values(r,'https://fixture.invalid/delete','pop-delete-'||r,'annex','fetched') returning id into d;
 insert into public.record_units(source_record_id,pipeline_job_id,unit_key,act_type,document_id) values(r,j,'pop-delete','award',d) returning id into u;
 insert into public.concert_population_events(id,source_record_id,unit_id,job_id,sequence,decision,document_id,revision,document_fingerprint,unit_fingerprint,reviewer,reason)
 values(gen_random_uuid(),r,u,j,1,'unknown',d,'fixture','fixture','fixture','Revisor','Justificació') returning id into e;
 select count(*) into before_count from public.storage_purge_batches;
 begin perform public.delete_discarded_records(jsonb_build_array(a,b),2);raise exception 'TEST_POPULATION_HISTORY_DELETED';
 exception when raise_exception then if sqlerrm<>'POPULATION_HISTORY_EXISTS' then raise;end if;end;
 if not exists(select 1 from public.source_records where id=r) or not exists(select 1 from public.concert_population_events where id=e)
  or not exists(select 1 from public.source_records where id=(b->>'id')::uuid) or (select count(*) from public.storage_purge_batches)<>before_count then raise exception 'POP_DELETE_PARTIAL';end if;
 perform public.delete_discarded_records(jsonb_build_array(b),1);
 if exists(select 1 from public.source_records where id=(b->>'id')::uuid) then raise exception 'UNRELATED_DELETE_BLOCKED';end if;
 end $$;
 """
 sql('begin;'+deletion+check+'rollback;')
 print('PASS: history blocks deletion before any effect; unrelated discarded records remain deletable')
finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode: raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
