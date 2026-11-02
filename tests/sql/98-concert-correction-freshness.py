"""Synthetic PostgreSQL only. Creates and removes a network-isolated container."""
from pathlib import Path
import subprocess, json, time, uuid

root=Path(__file__).resolve().parents[2]
here=Path(__file__).resolve().parent
name='mapeig-concert-pop-'+uuid.uuid4().hex[:12]
started=False

def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode: raise RuntimeError(p.stderr[-3000:])
 return p.stdout

def sql(text,user='postgres'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],text)

def fixture(filename,body):
 original=(root/'tests/sql'/filename).read_text()
 anchor=' insert into pipeline_runs default values returning id into rid;'
 assert original.count(anchor)==1
 original=original.replace(anchor," insert into record_enrichments(source_record_id,target_population,summary,confidence,engine,engine_version) values(sid,'Població global de prova','Síntesi sintètica',1,'fixture','v1');\n"+anchor)
 assert original.count('end $$;')==1
 return original.replace('end $$;',body+'\nend $$;')

try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004'])
 started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(.5)
 else: raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 migrations=[]
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  migrations.append((f.name,f.read_text()))
 for name_,contents in migrations:
  try: sql('begin;\n'+contents+'\ncommit;')
  except Exception as exc: raise RuntimeError(name_+' '+str(exc)) from exc
 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")

 original=(here/'13-record-units.sql').read_text()
 anchor=" pid:=review_record_unit(u,j,true,'Validació individual amb annex acreditat');"
 assert original.count(anchor)==1
 scenario="""
 insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(gen_random_uuid(),sid,j,u,'service_code',code,d,'obsolete:',1,quote,false,'Correcció de prova','Revisor de prova');
 begin
  perform review_record_unit(u,j,true,'No s’ha d’aprovar amb la font canviada');
  raise exception 'STALE_CORRECTION_ACCEPTED';
 exception when others then
  if sqlerrm not like 'La correcció del servei ha canviat%' then raise;end if;
 end;
 if (select status from record_units where id=u)<>'draft' then raise exception 'STALE_CHANGED_STATUS';end if;
 begin
  perform review_record_unit(u,j,false,'Rebuig documental de prova');
  if (select status from record_units where id=u)<>'rejected' then raise exception 'REJECTION_FAILED';end if;
  raise exception 'ROLLBACK_REJECTION_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_REJECTION_FIXTURE' then raise;end if;end;
 insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(gen_random_uuid(),sid,j,u,'service_code',code||'.999',d,digest||':'||(select active_extraction_id::text from source_documents where id=d),1,quote,false,'Correcció diferent','Revisor de prova');
 begin
  perform review_record_unit(u,j,true,'No acceptar codi preparat diferent');
  raise exception 'MISMATCH_ACCEPTED';
 exception when others then if sqlerrm not like 'La correcció del servei ha canviat%' then raise;end if;end;
 insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(gen_random_uuid(),sid,j,u,'service_code',code,d,digest||':'||(select active_extraction_id::text from source_documents where id=d),1,quote,false,'Correcció actualitzada','Revisor de prova');
 """
 replay=" if review_record_unit(u,j,true,'Segona petició idempotent')<>pid then raise exception 'Approval duplicated';end if;"
 assert original.count(replay)==1
 replay_check=" update source_documents set storage_sha256=repeat('b',64) where id=d; if review_record_unit(u,j,true,'Repetició històrica')<>pid then raise exception 'HISTORICAL_REPLAY_CHANGED';end if; update source_documents set storage_sha256=digest where id=d;"
 sql('begin;'+original.replace(anchor,scenario+anchor).replace(replay,replay+replay_check)+'rollback;')
 print('PASS: stale correction blocked, rejection preserved, current correction and historic replay accepted')

 # Persist only a synthetic prepared fixture, then exercise both lock orders.
 prefix=original.split(anchor)[0]
 setup="""
 insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(gen_random_uuid(),sid,j,u,'service_code',code,d,digest||':'||(select active_extraction_id::text from source_documents where id=d),1,quote,false,'Correcció actual','Revisor de prova');
 end $$;
 """
 sql(prefix+setup)
 uid=sql("select id from record_units where unit_key<>'legacy' order by created_at limit 1;").strip()
 job=sql("select pipeline_job_id from record_units where id='"+uid+"';").strip()
 doc=sql("select document_id from record_units where id='"+uid+"';").strip()
 base=['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']
 def session(statement):
  p=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  p.stdin.write('begin;'+statement+";select 'READY';\n");p.stdin.flush()
  if p.stdout.readline().strip()!='READY': raise RuntimeError('fixture session failed '+p.stderr.read())
  return p
 def close(p):
  p.stdin.write('rollback;\n');p.stdin.close()
  if p.wait(timeout=10): raise RuntimeError(p.stderr.read())
 writer=session("update source_documents set extracted_text=extracted_text where id='"+doc+"'")
 try:
  try: sql("select review_record_unit('"+uid+"','"+job+"',true,'Revisió amb font en canvi');")
  except RuntimeError as e:
   if 'could not obtain lock' not in str(e):raise
  else: raise RuntimeError('concurrent source write allowed approval')
 finally: close(writer)
 reviewer=session("do $$ begin perform review_record_unit('"+uid+"','"+job+"',true,'Validació concurrent de prova'); end $$")
 try:
  try: sql("set lock_timeout='300ms';update source_documents set extracted_text=extracted_text where id='"+doc+"';")
  except RuntimeError as e:
   if 'lock timeout' not in str(e):raise
  else: raise RuntimeError('source write escaped review lock')
 finally: close(reviewer)
 print('PASS: source changes and approval serialize in both transaction orders')

finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode: raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
