"""Synthetic schema and data only; PostgreSQL container has no network."""
from pathlib import Path
import subprocess,time,uuid

root=Path(__file__).resolve().parents[2]
name='mapeig-conveni-receipt-'+uuid.uuid4().hex[:12]
started=False
wire_hash=subprocess.run(['/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node','--import','tsx','--input-type','module','-e',"import {prepareProviderWireRequest} from './lib/openai-model.ts';process.stdout.write(prepareProviderWireRequest({model:'fixture',input:'fixture'}).fingerprint)"],cwd=root,text=True,capture_output=True,check=True).stdout
assert wire_hash.startswith('prepared-json-v1:') and len(wire_hash)==81
def run(cmd,data=None):
 p=subprocess.run(cmd,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode: raise RuntimeError(p.stderr[-3000:])
 return p.stdout
def sql(text): return run(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],text)
try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('''create table public.source_records(id uuid primary key,financing_type text);
 create table public.pipeline_jobs(id uuid primary key,source_record_id uuid,run_id uuid,status text,error_kind text);
 create table public.conveni_analyses(job_id uuid,source_record_id uuid);
 create table public.provider_calls(pipeline_job_id uuid,phase text,state text,response jsonb,request_hash text);
 create table public.worker_tasks(id uuid primary key,executor text,pipeline_job_id uuid,run_id uuid,source_record_id uuid);
 create table public.cloud_checkpoints(task_id uuid,item_key text,value jsonb);
 grant select on public.source_records,public.pipeline_jobs,public.conveni_analyses,public.provider_calls,public.worker_tasks,public.cloud_checkpoints to service_role;''')
 sql((root/'supabase/migrations/20261030045000_conveni_retained_receipt_read.sql').read_text())
 sql('''do $$ declare s uuid:=gen_random_uuid();j uuid:=gen_random_uuid();r uuid:=gen_random_uuid();t uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();other uuid:=gen_random_uuid(); x jsonb; h text:='__WIRE_HASH__'; begin
 if has_function_privilege('anon','public.read_conveni_retained_receipt(uuid,uuid)','execute') or has_function_privilege('authenticated','public.read_conveni_retained_receipt(uuid,uuid)','execute') or not has_function_privilege('service_role','public.read_conveni_retained_receipt(uuid,uuid)','execute') then raise exception 'ACL';end if;
 insert into source_records values(s,'conveni');insert into pipeline_jobs values(j,s,r,'error','validation');
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'missing';end if;
 insert into worker_tasks values(t,'vercel_workflow',j,r,null);
 insert into cloud_checkpoints values(t,'ai:'||j||':conveni','{"state":"received","response":{"output_text":"{}"}}'),(t,'conveni-input:'||j,to_jsonb(h)),(t,'provider-wire:ai:'||j||':conveni',to_jsonb(h));
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'missing diagnostic';end if;
 insert into cloud_checkpoints values(t,'last_failure',jsonb_build_object('kind','validation','job',j,'diagnostic',jsonb_build_object('operation','conveni_analysis','code','CONVENI_MODEL_DISCARD_REVIEW_REQUIRED')));
 if read_conveni_retained_receipt(s,j)->>'status'<>'received' then raise exception 'received';end if;
 -- A forged identical key in another job of the same run is not its receipt.
 insert into worker_tasks values(t2,'vercel_workflow',other,r,null);
 insert into cloud_checkpoints values(t2,'ai:'||j||':conveni','{"state":"received","response":{"output_text":"{}"}}');
 if read_conveni_retained_receipt(s,j)->>'status'<>'received' then raise exception 'wrong job in same run';end if;
 update worker_tasks set pipeline_job_id=null where id=t;
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'unbound task accepted';end if;
 update worker_tasks set pipeline_job_id=j,run_id=other where id=t;
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'wrong run accepted';end if;
 update worker_tasks set run_id=r where id=t;
 update cloud_checkpoints set value=jsonb_set(value,'{diagnostic,code}','"OTHER_ERROR"') where item_key='last_failure';
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'wrong diagnostic';end if;
 update cloud_checkpoints set value=jsonb_set(value,'{diagnostic,code}','"CONVENI_MODEL_DISCARD_REVIEW_REQUIRED"') where item_key='last_failure';
 update pipeline_jobs set error_kind='internal' where id=j;
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'wrong error kind';end if;
 update pipeline_jobs set error_kind='validation' where id=j;
 update pipeline_jobs set status='matching' where id=j;
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'active job';end if;
 update pipeline_jobs set status='error' where id=j;
 if read_conveni_retained_receipt(other,j)->>'status'<>'unavailable' then raise exception 'record scope';end if;
 update cloud_checkpoints set value=to_jsonb(repeat('b',64)) where item_key like 'provider-wire:%';
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'hash mismatch';end if;
 update cloud_checkpoints set value=to_jsonb(h) where item_key like 'provider-wire:%';
 insert into provider_calls values(j,'conveni','received','{"output_text":"{}"}',h);
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'ambiguous';end if;
 delete from provider_calls;
 update cloud_checkpoints set value='{"state":"sending"}' where item_key like 'ai:%';
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'unknown outcome';end if;
 update cloud_checkpoints set value=jsonb_build_object('state','received','response',jsonb_build_object('output_text',repeat('x',262145))) where item_key like 'ai:%';
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'oversize';end if;
 update cloud_checkpoints set value='{"state":"received","response":{"output_text":"{}"}}' where item_key like 'ai:%';
 insert into conveni_analyses values(j,s);
 if read_conveni_retained_receipt(s,j)->>'status'<>'persisted' then raise exception 'persisted';end if;
 delete from conveni_analyses;delete from cloud_checkpoints;insert into provider_calls values(j,'conveni','received','{"output_text":"{}"}',h);
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'local diagnostic unavailable';end if;
 update provider_calls set request_hash='bad';
 if read_conveni_retained_receipt(s,j)->>'status'<>'unavailable' then raise exception 'local hash';end if;
 end $$;'''.replace('__WIRE_HASH__',wire_hash))
 sql("""insert into source_records values('11111111-1111-4111-8111-111111111111','conveni');
 insert into pipeline_jobs values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','error','validation');
 insert into worker_tasks values('44444444-4444-4444-8444-444444444444','vercel_workflow','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',null);
 insert into cloud_checkpoints values
 ('44444444-4444-4444-8444-444444444444','ai:22222222-2222-4222-8222-222222222222:conveni','{"state":"received","response":{"output_text":"{}"}}'),
 ('44444444-4444-4444-8444-444444444444','conveni-input:22222222-2222-4222-8222-222222222222',to_jsonb('__WIRE_HASH__'::text)),
 ('44444444-4444-4444-8444-444444444444','provider-wire:ai:22222222-2222-4222-8222-222222222222:conveni',to_jsonb('__WIRE_HASH__'::text)),
 ('44444444-4444-4444-8444-444444444444','last_failure','{"kind":"validation","job":"22222222-2222-4222-8222-222222222222","diagnostic":{"operation":"conveni_analysis","code":"CONVENI_MODEL_DISCARD_REVIEW_REQUIRED"}}');""".replace('__WIRE_HASH__',wire_hash))
 assert sql("set role service_role;select read_conveni_retained_receipt('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')->>'status';")=='received\n'
 print('PASS: scoped cloud receipt, local withheld, ambiguity, diagnostic, hash, state, size, persisted and ACL')
finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode:raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
