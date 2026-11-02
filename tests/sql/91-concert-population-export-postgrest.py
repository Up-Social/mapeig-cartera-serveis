"""Synthetic read-only export embeddings on disposable PostgreSQL/PostgREST."""
from pathlib import Path
import json,subprocess,time,uuid,sys
root=Path(__file__).resolve().parents[2]
tag='mapeig-poprest-'+uuid.uuid4().hex[:12];network=tag+'-net';pg=tag+'-db';rest=tag+'-rest';created=[]
def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=100)
 if p.returncode:raise RuntimeError('command failed: '+p.stderr[-1200:])
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
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000'}:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as e:raise RuntimeError(f.name+' '+str(e))
 sql("""insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('fixture','1','Servei',null,'service','Descripció','Persones','Condicions','Llei','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('fc000000-0000-4000-8000-000000000001','concerts','FIXTURE','Concert','Synthetic');
 insert into service_provisions(id,source_record_id,source_id,mechanism,amount,target_population,source_reference,service_code,catalog_version_id) values('fc000000-0000-4000-8000-000000000002','fc000000-0000-4000-8000-000000000001','FIXTURE','Concert',2300,null,'fixture','1','fixture');""")
 run(['docker','run','-d','--pull=never','--name',rest,'--network',network,'-e',f'PGRST_DB_URI=postgres://postgres:fixture@{pg}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=service_role','public.ecr.aws/supabase/postgrest:v16.4']);created.append(('container',rest))
 for _ in range(40):
  p=subprocess.run(['docker','exec',pg,'curl','-sS','--max-time','2',f'http://{rest}:3000/'],capture_output=True,text=True)
  if p.returncode==0 and p.stdout.startswith('{'):break
  time.sleep(.5)
 else:raise RuntimeError('PostgREST timeout')
 projections=[
  'id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,master_services(service_name),official_services(service_name),source_records(financing_type)',
  'id,source_record_id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,master_services(service_name),official_services(service_name),source_records!inner(financing_type,processing_status,review_decisions(decision,created_at),pipeline_jobs(status,created_at,pipeline_runs(batch_number)))',
  'id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,historical_master_code,official_services(service_name),master_services(service_name),source_records(financing_type)',
 ]
 sources=[root/'lib/batch-export-reader.ts',root/'app/api/exports/approved/route.ts',root/'app/api/exports/master/route.ts']
 for projection,source in zip(projections,sources):
  if projection not in source.read_text():raise RuntimeError('export projection drifted: '+str(source))
  out=run(['docker','exec',pg,'curl','-sS','--fail-with-body','--max-time','5','-G',f'http://{rest}:3000/conveni_reviewed_provisions','--data-urlencode','select='+projection])
  rows=json.loads(out)
  if len(rows)!=1 or rows[0]['source_records']['financing_type']!='concert' or rows[0]['target_population'] is not None or float(rows[0]['amount'])!=2300:raise RuntimeError('unexpected embedding result '+out[:400])
 print('PASS: batch, approved and master PostgREST projections preserve Concert type, NULL population and amount in isolated DB')
finally:
 errors=[]
 for kind,resource in reversed(created):
  p=subprocess.run(['docker','rm','-f',resource] if kind=='container' else ['docker','network','rm',resource],capture_output=True,text=True,timeout=30)
  if p.returncode:errors.append(resource)
 if errors:
  print('CLEANUP FAILED: '+', '.join(errors),file=sys.stderr)
  sys.exit(1)
