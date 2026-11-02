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
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000','20261030044000'}: continue
  migrations.append((f.name,f.read_text()))
 for name_,contents in migrations:
  try: sql('begin;\n'+contents+'\ncommit;')
  except Exception as exc: raise RuntimeError(name_+' '+str(exc)) from exc
 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")
 check="""
 if (select count(*) from service_provisions p join record_units u on u.id=p.unit_id where p.source_record_id=sid and u.unit_key<>'legacy' and p.target_population is not null)<>2 then raise exception 'EXPECTED_BASELINE_COPY';end if;
 if not exists(select 1 from service_provisions p join record_units u on u.id=p.unit_id where p.source_record_id=sid and u.unit_key='legacy' and p.target_population='Població global de prova') then raise exception 'GLOBAL_NOT_PRESENT';end if;
 """
 individual=fixture('13-record-units.sql',check)
 sql('begin;'+individual+'rollback;')
 print('PASS: baseline reproduces the global population copied to both Concert lines')
 before=sql("select pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure)")
 acl_before=sql("select proacl::text from pg_proc where oid='public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure")
 migration=root/'supabase/migrations/20261030044000_concert_unit_population_scope.sql'
 sql(migration.read_text())
 after=sql("select pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure)")
 anchor='base.contracting_body,base.target_population,base.source_reference'
 replacement="base.contracting_body,case when r.financing_type='concert' then null else base.target_population end,base.source_reference"
 assert before.count(anchor)==1 and after==before.replace(anchor,replacement)
 assert acl_before==sql("select proacl::text from pg_proc where oid='public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure")
 print('PASS: function definition changed at precisely one anchor; all other guards preserved')
 check=check.replace("is not null)<>2 then raise exception 'EXPECTED_BASELINE_COPY'","is not null)<>0 then raise exception 'COPIED_GLOBAL_TO_CONCERT_LINE'")
 individual=fixture('13-record-units.sql',check)
 sql('begin;'+individual+'rollback;')
 print('PASS: individual review, repeat, renewal and award amounts preserved; new line populations null, global retained')
 sql('begin;'+(here/'92-concert-unit-population-other-types.sql').read_text()+'rollback;')
 print('PASS: existing unit writer preserves population for other financing types in a synthetic direct-unit fixture')
 bulk=fixture('18-concert-annex-reconciled.sql',"""
 if exists(select 1 from service_provisions p join record_units u on u.id=p.unit_id where p.source_record_id=sid and u.unit_key<>'legacy' and p.target_population is not null) then raise exception 'COPIED_GLOBAL_TO_BULK_LINE';end if;
 if not exists(select 1 from service_provisions p join record_units u on u.id=p.unit_id where p.source_record_id=sid and u.unit_key='legacy' and p.target_population='Població global de prova') then raise exception 'GLOBAL_NOT_PRESENT';end if;
 if not exists(select 1 from record_enrichments where source_record_id=sid and target_population='Població global de prova') then raise exception 'GLOBAL_ENRICHMENT_CHANGED';end if;
 """)
 sql('begin;'+bulk+'rollback;')
 print('PASS: bulk review keeps both amounts, statuses and global description; line populations null')
 # Existing reviewed units remain idempotent and retain their original content.
 historical=fixture('13-record-units.sql',"""
 update service_provisions set target_population='Població històrica de prova' where unit_id=u;
 if review_record_unit(u,j,true,'Repetició històrica idempotent')<>pid then raise exception 'HISTORIC_ID_CHANGED';end if;
 if (select target_population from service_provisions where unit_id=u) is distinct from 'Població històrica de prova' then raise exception 'HISTORIC_POPULATION_CHANGED';end if;
 """)
 sql('begin;'+historical+'rollback;')
 print('PASS: replay of approved historic line retains its original population')
finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode: raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
