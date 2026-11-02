"""Synthetic job-membership race tests on isolated PostgreSQL (Storage metadata is mocked)."""
from pathlib import Path
import json,subprocess,time,uuid,sys
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
 sql('grant execute on function public.concert_line_export_snapshot(uuid[]),public.concert_line_export_commit(uuid,text,jsonb),public.concert_line_combined_provisions(),public.concert_line_combined_approved(),public.concert_line_approved(public.service_provisions),public.concert_line_award_archive_snapshot(uuid,uuid,uuid),public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid) to service_role;')
 fixture=(exp/'candidate-520-fixture.sql').read_text()
 for marker,key in [('__RECORD__','record_id'),('__JOB__','job_id'),('__UNIT__','unit_id'),('__DOC__','document_id')]:fixture=fixture.replace(marker,ids[key])
 sql(fixture)
 line=json.loads(sql("select row_to_json(z) from (select x.id,x.unit_id,x.service_code,x.amount_literal,x.evidence_quote,x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.population_event_id from public.concert_line_award_decisions x join public.record_units u on u.id=x.unit_id where x.source_record_id='"+ids['record_id']+"' and u.unit_key='synthetic-line-2' order by x.sequence desc limit 1) z"))
 old_id=line['id'];rid=ids['record_id'];jid=ids['job_id']
 fake_job=sql("with run as (insert into public.pipeline_runs default values returning id) insert into public.pipeline_jobs(run_id,source_record_id,status,verification_only,created_at) select id,'"+rid+"','needs_review',true,now()+interval '1 minute' from run returning id")
 other=json.loads(sql("with record as (insert into public.source_records(source_dataset,source_record_id,mechanism,title,financing_type) values('contractacions','fence-other-'||gen_random_uuid(),'Contract','Altre expedient','contractacio') returning id),run as (insert into public.pipeline_runs default values returning id),job as (insert into public.pipeline_jobs(run_id,source_record_id,status,verification_only) select run.id,record.id,'needs_review',true from run,record returning id) select jsonb_build_object('record',(select id from record),'job',(select id from job))"))
 new_run=sql('insert into public.pipeline_runs default values returning id')
 processes=[]
 def paused(stmt,marker):
  command='begin;'+stmt.replace('select ','select /* '+marker+' */ ',1)+';commit;'
  proc=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  processes.append(proc);proc.stdin.write(command);proc.stdin.close()
  for _ in range(100):
   if sql("select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%"+marker+"%'")=='1':return proc
   if proc.poll() is not None:raise RuntimeError('paused action failed early: '+proc.stderr.read())
   time.sleep(.05)
  raise RuntimeError('action did not reach trigger: '+marker)
 def finish(proc):
  code=proc.wait(timeout=20);out=proc.stdout.read();err=proc.stderr.read()
  if code:raise RuntimeError('paused action failed: '+err[-1200:])
  return out
 def expect_locked(statement):
  try:sql("set lock_timeout='400ms';"+statement)
  except RuntimeError as error:
   if 'lock timeout' not in str(error) and 'could not obtain lock' not in str(error):raise
   return
  raise RuntimeError('unexpected concurrent mutation: '+statement)
 def install_pause(table):
  sql('create function public.test_job_fence_pause() returns trigger language plpgsql as $$begin perform pg_sleep(4);return new;end$$;create trigger test_job_fence_pause before insert on '+table+' for each row execute function public.test_job_fence_pause();')
 def remove_pause(table):sql('drop trigger test_job_fence_pause on '+table+';drop function public.test_job_fence_pause();')
 # Pause after the export snapshot comparison, immediately before the receipt.
 snap=sql("select public.concert_line_export_snapshot(array['"+old_id+"'::uuid])")
 receipt=str(uuid.uuid4());install_pause('public.concert_line_export_receipts')
 export="select public.concert_line_export_commit('"+receipt+"','"+'f'*64+"',$snapshot$"+snap+"$snapshot$::jsonb)"
 proc=paused(export,'fence_marker_export')
 expect_locked("update public.pipeline_jobs set verification_only=false where id='"+fake_job+"'")
 expect_locked("update public.pipeline_jobs set source_record_id='"+rid+"' where id='"+other['job']+"'")
 expect_locked("insert into public.pipeline_jobs(run_id,source_record_id,status) values('"+new_run+"','"+rid+"','needs_review')")
 # An unrelated source/job remains writable while this export is paused.
 sql("set lock_timeout='400ms';update public.pipeline_jobs set verification_only=false where id='"+other['job']+"'")
 finish(proc);remove_pause('public.concert_line_export_receipts')
 if sql("select count(*) from public.concert_line_export_receipts where id='"+receipt+"'")!='1':raise RuntimeError('export receipt missing')
 if sql("select count(*) from public.concert_line_financing_projection where unit_id='"+line['unit_id']+"'")!='1':raise RuntimeError('export projection stale despite fence')
 # Reverse order: a writer already holding the verification job makes the
 # NOWAIT export fail without a receipt instead of waiting in a lock cycle.
 other_receipt=str(uuid.uuid4())
 proc=paused("update public.pipeline_jobs set verification_only=false where id='"+fake_job+"';select pg_sleep(4)",'fence_marker_reverse')
 try:sql("select public.concert_line_export_commit('"+other_receipt+"','"+'e'*64+"',$snapshot$"+snap+"$snapshot$::jsonb)")
 except RuntimeError as error:
  if 'could not obtain lock' not in str(error):raise
 else:raise RuntimeError('export ignored in-progress job writer')
 finish(proc)
 if sql("select count(*) from public.concert_line_export_receipts where id='"+other_receipt+"'")!='0':raise RuntimeError('failed export left a receipt')
 # The writer committed a new effective job; restore only in this disposable
 # fixture, then test both human-observation and individual-award commits.
 sql("update public.pipeline_jobs set verification_only=true where id='"+fake_job+"'")
 snapshot=json.loads(sql("select public.concert_population_snapshot('"+rid+"','"+jid+"','"+line['unit_id']+"')"))
 event=str(uuid.uuid4())
 cmd="select public.concert_population_decide('"+rid+"','"+jid+"','"+line['unit_id']+"','"+event+"','"+snapshot['event']['id']+"','unknown',null,'"+snapshot['document_id']+"','"+snapshot['revision']+"',null,null,'Nou contrast de població','Revisor','"+snapshot['document_hash']+"','"+snapshot['unit_hash']+"')"
 install_pause('public.concert_population_events');proc=paused(cmd,'fence_marker_population')
 expect_locked("update public.pipeline_jobs set verification_only=false where id='"+fake_job+"'")
 finish(proc);remove_pause('public.concert_population_events')
 new_decision=str(uuid.uuid4())
 args="'"+rid+"','"+jid+"','"+line['unit_id']+"','"+new_decision+"','"+event+"','"+line['service_code']+"','"+line['amount_literal']+"',$quote$"+line['evidence_quote']+"$quote$,'Nova revisió individual','Revisor',$confirm$"+json.dumps(line['confirmations'])+"$confirm$::jsonb,'"+line['source_object_id']+"','"+line['source_version']+"','"+line['item_object_id']+"','"+line['item_version']+"','"+old_id+"'"
 install_pause('public.concert_line_award_decisions');proc=paused('select public.concert_line_award_decide('+args+')','fence_marker_award')
 expect_locked("update public.pipeline_jobs set verification_only=false where id='"+fake_job+"'")
 finish(proc);remove_pause('public.concert_line_award_decisions')
 if sql("select count(*) from public.concert_line_financing_projection where unit_id='"+line['unit_id']+"'")!='1':raise RuntimeError('award projection not current')
 print('PASS job fence: verification-only updates, FK reassignment/insertion, reverse lock order, population and award commits; PG synthetic Storage metadata')
finally:
 if 'processes' in globals():
  for process in processes:
   if process.poll() is None:process.kill();process.wait(timeout=5)
 errors=[]
 for kind,resource in reversed(created):
  p=subprocess.run(['docker','rm','-f',resource] if kind=='container' else ['docker','network','rm',resource],capture_output=True,text=True,timeout=30)
  if p.returncode:errors.append(resource)
 if errors:
  print('CLEANUP FAILED: '+', '.join(errors),file=sys.stderr)
  sys.exit(1)
