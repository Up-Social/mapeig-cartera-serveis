#!/usr/bin/env python3
"""Exercise the contract computed field via real isolated PostgREST.

Both disposable containers share a network=none namespace. All data and
credentials are synthetic; no existing Supabase project or network is used.
"""
from pathlib import Path
import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
import uuid

root=Path(__file__).resolve().parents[2]
tag='mapeig-contract-field-'+uuid.uuid4().hex[:12]
db=tag+'-db'
rest=tag+'-rest'
created=[]
secret='fixture-postgrest-secret-at-least-32-characters'

def run(args, *, data=None, timeout=90):
 result=subprocess.run(args,input=data,text=True,capture_output=True,timeout=timeout)
 if result.returncode:
  raise RuntimeError(f'{args[0]} {args[1]} failed: {(result.stderr or result.stdout)[-1200:]}')
 return result.stdout.strip()

def sql(query):
 return run(['docker','exec','-i',db,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],data=query)

def jwt(role):
 encode=lambda data:base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).decode().rstrip('=')
 body=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'role':role})
 signature=base64.urlsafe_b64encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
 return body+'.'+signature

def request(path,role='service_role'):
 return run(['docker','exec',db,'curl','-fsS','--max-time','3','-H','Authorization: Bearer '+jwt(role),'http://127.0.0.1:3000'+path],timeout=10)

def no_duplicates(pairs):
 value={}
 for key,item in pairs:
  if key in value:raise AssertionError('duplicate JSON key: '+key)
  value[key]=item
 return value

try:
 run(['docker','run','-d','--pull=never','--network=none','--name',db,'-e','POSTGRES_PASSWORD=synthetic-fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);created.append(db)
 for _ in range(120):
  ready=subprocess.run(['docker','exec',db,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True,timeout=5)
  if ready.returncode==0:
   try:
    if sql('select 1;')=='1':break
   except RuntimeError:pass
  time.sleep(.5)
 else:raise RuntimeError('isolated database not ready')
 # Minimal synthetic tables and ACLs model the actual PostgREST relationships;
 # they are not a copy or snapshot of the production schema.
 sql('''create table public.source_records(id uuid primary key,source_record_id text unique,financing_type text,source_dataset text,source_payload jsonb,amount numeric(16,2),title text);
 create table public.current_analysis_results(id uuid primary key,source_record_id uuid references public.source_records(id),reviewed_classification text,reviewed_at timestamptz);
 create table public.source_documents(id uuid primary key,source_record_id uuid references public.source_records(id),url text);
 create table public.record_enrichments(id uuid primary key,source_record_id uuid unique references public.source_records(id),amount numeric(16,2));
 grant usage on schema public to service_role; grant select on public.source_records,public.current_analysis_results,public.source_documents,public.record_enrichments to service_role;''')
 helper=(root/'supabase/migrations/20261029040000_contract_award_provenance.sql').read_text().split('-- Keep the existing review transaction')[0]
 sql(helper)
 sql('''insert into source_records(id,source_record_id,financing_type,source_dataset,source_payload,amount) values
 ('10000000-0000-4000-8000-000000000001','award','contractacio','contractacions','{"Importe de adjudicación":700}',700),
 ('10000000-0000-4000-8000-000000000002','zero','contractacio','contractacions','{"Importe de adjudicación":0}',0),
 ('10000000-0000-4000-8000-000000000003','tender','contractacio','contractacions','{"Presupuesto de licitación":1000}',1000),
 ('10000000-0000-4000-8000-000000000004','precision','contractacio','contractacions','{"Importe de adjudicación":1.00000000000000001}',1),
 ('10000000-0000-4000-8000-000000000005','unicode','contractacio','contractacions','{"Importe de adjudicación":" 700 "}',700),
 ('10000000-0000-4000-8000-000000000006','grant','subvencio','raisc_local','{}',42),
 ('10000000-0000-4000-8000-000000000007','dataset-mismatch','subvencio','contractacions','{"Importe de adjudicación":700}',700),
 ('10000000-0000-4000-8000-000000000008','type-mismatch','contractacio','raisc_local','{"Importe de adjudicación":700}',700);
 update source_records set title='Expedient sintètic';
 insert into current_analysis_results select id,id,'out_of_portfolio',now() from source_records;
 insert into source_documents select gen_random_uuid(),id,'https://fixture.invalid/document' from source_records;
 insert into record_enrichments select gen_random_uuid(),id,900 from source_records;''')
 run(['docker','run','-d','--pull=never','--network','container:'+db,'--name',rest,
  '-e','PGRST_DB_URI=postgres://postgres:synthetic-fixture@127.0.0.1:5432/postgres',
  '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,
  'public.ecr.aws/supabase/postgrest:v16.4']);created.append(rest)
 for _ in range(60):
  try:
   json.loads(request('/source_records?select=source_record_id'))
   break
  except (RuntimeError,json.JSONDecodeError):time.sleep(.5)
 else:raise RuntimeError('isolated PostgREST not ready')
 try:
  request('/source_records?select=*,contract_verified_award')
  raise AssertionError('field was unexpectedly present before its migration')
 except RuntimeError:pass
 # Migration 410 sends NOTIFY while PostgREST is already running. Do not
 # restart the service: success requires its schema cache to refresh in place.
 sql((root/'supabase/migrations/20261029041000_contract_verified_award_field.sql').read_text())
 for _ in range(60):
  try:
   values=json.loads(request('/source_records?select=*,contract_verified_award'),object_pairs_hook=no_duplicates)
   break
  except (RuntimeError,json.JSONDecodeError):time.sleep(.5)
 else:raise RuntimeError('PostgREST did not reload the schema after migration')
 direct={row['source_record_id']:row for row in values}
 expected={'award':700,'zero':0,'tender':None,'precision':None,'unicode':None,'grant':None,'dataset-mismatch':None,'type-mismatch':None}
 assert {k:v['contract_verified_award'] for k,v in direct.items()}==expected
 # Client JSON parsing rounds the payload but the database computed field stays NULL.
 assert direct['precision']['source_payload']['Importe de adjudicación']==1
 embedded=json.loads(request('/current_analysis_results?select=*,source_records!inner(source_record_id,title,amount,source_dataset,contract_verified_award,financing_type,source_documents(url),record_enrichments(amount))&reviewed_classification=eq.out_of_portfolio&source_records.financing_type=neq.concert&order=reviewed_at.desc'),object_pairs_hook=no_duplicates)
 assert {v['source_records']['source_record_id']:v['source_records']['contract_verified_award'] for v in embedded}==expected
 privileges=sql("select has_function_privilege('anon','public.contract_verified_award(public.source_records)','execute'),has_function_privilege('authenticated','public.contract_verified_award(public.source_records)','execute'),has_function_privilege('service_role','public.contract_verified_award(public.source_records)','execute');")
 assert privileges=='f|f|t',privileges
 print('PASS: live schema reload, direct and embedded computed fields, exact JSON decimal, zero and scoped privileges.')
finally:
 active_error=sys.exc_info()[1]
 errors=[]
 for name in reversed(created):
  try:
   result=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=25)
   if result.returncode:errors.append(name)
  except subprocess.TimeoutExpired:errors.append(name)
 try:
  listed=subprocess.run(['docker','ps','-a','--format','{{.Names}}'],capture_output=True,text=True,timeout=10)
  if listed.returncode:errors.append('container inventory unavailable')
  else:errors.extend(name for name in (db,rest) if name in listed.stdout.splitlines())
 except subprocess.TimeoutExpired:errors.append('container inventory timed out')
 if errors:
  message='CLEANUP NOT CONFIRMED: '+', '.join(errors)
  print(message,file=sys.stderr)
  # Preserve the original test exception if one is already propagating.
  if active_error is None:raise RuntimeError(message)
