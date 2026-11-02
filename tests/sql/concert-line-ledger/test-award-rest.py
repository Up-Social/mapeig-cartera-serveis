"""Synthetic read-only export embeddings on disposable PostgreSQL/PostgREST."""
from pathlib import Path
import json,subprocess,time,uuid,sys,hashlib
root=Path(__file__).resolve().parents[3]
tag='mapeig-poprest-'+uuid.uuid4().hex[:12];network=tag+'-net';pg=tag+'-db';rest=tag+'-rest';created=[]
def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=100)
 if p.returncode:raise RuntimeError('command failed: '+(p.stderr+p.stdout)[-2000:])
 return p.stdout.strip()
def sql(s,user='postgres'):
 return run(['docker','exec','-i',pg,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],s)
try:
 run(['docker','network','create','--internal',network]);created.append(('network',network))
 run(['docker','run','-d','--pull=never','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);created.append(('container',pg))
 for _ in range(120):
  try:
   if subprocess.run(['docker','exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0 and sql('select 1')=='1':break
  except RuntimeError:pass
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000'}:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as e:raise RuntimeError(f.name+' '+str(e))
 exp=Path(__file__).resolve().parent

 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update public.app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")
 fixture=(root/'tests/sql/95-concert-population-event.sql').read_text().rstrip()
 assert fixture.endswith('rollback;')
 ids=json.loads(sql(fixture[:-len('rollback;')]+'reset role;select row_to_json(f) from population_fixture f;commit;'))
 sql('grant execute on function public.concert_line_award_archive_snapshot(uuid,uuid,uuid),public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid) to service_role;')
 fixture=(exp/'candidate-520-fixture.sql').read_text().split(' if public.concert_line_award_decide')[0]
 digest=hashlib.sha256(b'Synthetic archived PDF').hexdigest()
 fixture=fixture.replace("repeat('a',64)","'"+digest+"'")
 fixture=fixture.replace("storage_path=source_path where id=d", "storage_path=source_path,storage_sha256='"+digest+"' where id=d")
 fixture+=" insert into projection_output values(jsonb_build_object('record',r,'job',j,'unit',u1,'event',event1,'code',code,'quote',q1));end $$;select rows from projection_output;commit;"
 for marker,key in [('__RECORD__','record_id'),('__JOB__','job_id'),('__UNIT__','unit_id'),('__DOC__','document_id')]:fixture=fixture.replace(marker,ids[key])
 payload=sql(fixture)
 # Candidate 640: a new individual award must not use an expired correction.
 sql("""do $$ declare p jsonb:=$payload$"""+payload+"""$payload$::jsonb;r uuid:=(p->>'record')::uuid;j uuid:=(p->>'job')::uuid;u uuid:=(p->>'unit')::uuid;e uuid:=(p->>'event')::uuid;d uuid;source_obj uuid;item_obj uuid;cid uuid:=gen_random_uuid();snap jsonb;newe uuid:=gen_random_uuid();begin
 select document_id into d from record_units where id=u;
 select id into source_obj from storage.objects where name=(select storage_path from source_documents where id=d);
 select id into item_obj from storage.objects where name=(select storage_path from record_units where id=u);
 begin
 insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
 values(cid,r,j,u,'service_code',p->>'code',d,'stale:',1,p->>'quote',false,'Correcció sintètica','Revisor');
 snap:=concert_population_snapshot(r,j,u);
 perform concert_population_decide(r,j,u,newe,e,'confirmed','persones grans',d,snap->>'revision',1,p->>'quote','Població contrastada','Revisor',snap->>'document_hash',snap->>'unit_hash');
 begin
  perform concert_line_award_decide(r,j,u,gen_random_uuid(),newe,p->>'code','12.000,00',p->>'quote','Adjudicació contrastada','Revisor','{"award":true,"recipient":true,"allocation":true}',source_obj,'v1',item_obj,'v1');
  raise exception 'STALE_CORRECTION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'LINE_SERVICE_CORRECTION_STALE' then raise;end if;end;
 if exists(select 1 from concert_line_award_decisions where unit_id=u) then raise exception 'STALE_CREATED_DECISION';end if;
 raise exception 'ROLLBACK_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_FIXTURE' then raise;end if;end;
 end $$;""")
 sql("""create function public.test_change_item_version(p_id uuid) returns void language sql security definer set search_path=pg_catalog as $$update storage.objects set version='v2' where id=p_id$$;create function public.test_archive_item(p_id uuid) returns void language sql security definer set search_path=pg_catalog as $$update storage.objects set version='v1',archived_at=now() where id=p_id$$;revoke all on function public.test_change_item_version(uuid),public.test_archive_item(uuid) from public,anon,authenticated;grant execute on function public.test_change_item_version(uuid),public.test_archive_item(uuid) to service_role;""")
 sql("create role isolated_http login password 'fixture';grant anon,authenticated,service_role to isolated_http;")
 bundle=Path('/private/tmp/isolated-export-'+uuid.uuid4().hex+'.cjs')
 run([str(root/'node_modules/esbuild/bin/esbuild'),str(exp/'isolated-award-rest-runner.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(bundle)])
 run(['docker','run','-d','--pull=never','--name',rest,'--network',network,'-e',f'PGRST_DB_URI=postgres://isolated_http:fixture@{pg}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET=private-synthetic-projection-secret-0000000000000000','public.ecr.aws/supabase/postgrest:v16.4']);created.append(('container',rest))
 for _ in range(40):
  p=subprocess.run(['docker','exec',pg,'curl','-sS','--max-time','2',f'http://{rest}:3000/'],capture_output=True,text=True)
  if p.returncode==0 and p.stdout.startswith('{'):break
  time.sleep(.5)
 else:raise RuntimeError('PostgREST timeout')
 output=run(['docker','run','--rm','--pull=never','--network','container:'+rest,'--entrypoint','node','-v',str(bundle)+':/endpoint.cjs:ro','public.ecr.aws/supabase/storage-api:v1.82.1','/endpoint.cjs',payload])
 if 'PASS award handler' not in output:raise RuntimeError(output)
 if sql("select count(*) from public.concert_line_award_decisions")!='1' or sql("select count(*) from public.concert_line_awards")!='1':raise RuntimeError('decision count incorrect')
 sql("""begin;set local role service_role;do $$begin
 begin perform public.review_record_unit('{unit}','{job}',true,'Revisió històrica');raise exception 'UNIT_GUARD_MISSED';
 exception when raise_exception then if sqlerrm not like 'Aquesta línia té una revisió econòmica individual%' then raise;end if;end;
 begin perform public.review_analysis('{record}','insufficient','{job}','{{}}'::text[],null,null,'Revisió global');raise exception 'GLOBAL_GUARD_MISSED';
 exception when raise_exception then if sqlerrm not like 'Aquest expedient té revisions econòmiques individuals%' then raise;end if;end;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id'],unit=ids['unit_id']))
 if sql("select count(*) from public.concert_line_financing_projection where provenance='line_experiment'")!='0':raise RuntimeError('archived source still visible')
 if sql("select count(*) from public.service_provisions where source_record_id='"+ids['record_id']+"'")!='0':raise RuntimeError('shared provision created')
 print(output)

finally:
 if 'bundle' in globals():bundle.unlink(missing_ok=True)
 errors=[]
 for kind,resource in reversed(created):
  p=subprocess.run(['docker','rm','-f',resource] if kind=='container' else ['docker','network','rm',resource],capture_output=True,text=True,timeout=30)
  if p.returncode:errors.append(resource)
 if errors:
  print('CLEANUP FAILED: '+', '.join(errors),file=sys.stderr)
  sys.exit(1)
