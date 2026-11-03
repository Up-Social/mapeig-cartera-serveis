"""Synthetic read-only export embeddings on disposable PostgreSQL/PostgREST."""
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
 sql('grant execute on function public.concert_line_export_snapshot(uuid[]),public.concert_line_export_commit(uuid,text,jsonb) to service_role;')
 if sql('select public.concert_line_ledger_exists()')!='f':raise RuntimeError('LEDGER_NOT_EMPTY')
 fixture=(exp/'candidate-520-fixture.sql').read_text()
 for marker,key in [('__RECORD__','record_id'),('__JOB__','job_id'),('__UNIT__','unit_id'),('__DOC__','document_id')]:fixture=fixture.replace(marker,ids[key])
 sql(fixture)
 if sql('select public.concert_line_ledger_exists()')!='t':raise RuntimeError('LEDGER_NOT_DETECTED')
 version=sql("select p.catalog_version_id from public.concert_line_awards p join public.concert_line_award_decisions x on x.provision_id=p.id where x.source_record_id='"+ids['record_id']+"' limit 1")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin;select id from public.catalog_versions where id='"+version+"' for update;\n\\echo LOCKED\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('catalog lock holder failed')
   if line.strip()=='LOCKED':break
  query="select public.concert_line_mixed_commit(gen_random_uuid(),repeat('a',64),public.concert_line_mixed_snapshot(array(select provision_id from public.concert_line_award_decisions where source_record_id='"+ids['record_id']+"')));"
  blocked=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=5)
  if blocked.returncode==0 or 'could not obtain lock' not in blocked.stderr:raise RuntimeError('CATALOG_NOT_FENCED '+blocked.stderr[-1000:])
 finally:
  holder.stdin.write('rollback;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=10)
  if holder.returncode:raise RuntimeError('catalog lock holder failed')
 if sql("select count(*) from pg_constraint where conrelid='public.pipeline_jobs'::regclass and confrelid='public.pipeline_runs'::regclass and contype='f' and not condeferrable")!='1':raise RuntimeError('BATCH_RUN_FK_NOT_IMMEDIATE')
 run_id=sql("select run_id from public.pipeline_jobs where id='"+ids['job_id']+"'")
 extra_source=sql("insert into public.source_records(source_dataset,source_record_id,mechanism,title) values('concerts','concurrent-job','Concert','Fixture') returning id")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin;select id from public.pipeline_runs where id='"+run_id+"' for update;\n\\echo LOCKED\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('batch lock holder failed')
   if line.strip()=='LOCKED':break
  query="set lock_timeout='750ms';insert into public.pipeline_jobs(source_record_id,run_id,status) values('"+extra_source+"','"+run_id+"','needs_review');"
  blocked=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=10)
  if blocked.returncode==0 or 'lock timeout' not in blocked.stderr:raise RuntimeError('BATCH_PHANTOM_NOT_FENCED '+blocked.stderr[-1000:])
 finally:
  holder.stdin.write('rollback;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=10)
  if holder.returncode:raise RuntimeError('batch lock holder failed')
 sql("""begin;do $$declare ids uuid[];snapshot jsonb;batch uuid;receipt uuid:=gen_random_uuid();begin
 select j.run_id into batch from public.pipeline_jobs j where j.id='{job}';
 select array_agg(x.provision_id order by x.provision_id) into ids from public.concert_line_award_decisions x where x.source_record_id='{record}';
 snapshot:=public.concert_line_mixed_snapshot(ids);
 if public.concert_line_mixed_batch_commit(receipt,batch,'fixture.xlsx',repeat('a',64),snapshot)<>receipt or public.concert_line_mixed_batch_commit(receipt,batch,'fixture.xlsx',repeat('a',64),snapshot)<>receipt then raise exception 'BATCH_REPLAY';end if;
 if not exists(select 1 from public.excel_exports where id=receipt and pipeline_run_id=batch and provision_count=2) or (select count(*) from public.concert_line_mixed_items where receipt_id=receipt)<>2 then raise exception 'BATCH_RECEIPT';end if;
 begin perform public.concert_line_mixed_batch_commit(gen_random_uuid(),gen_random_uuid(),'fixture.xlsx',repeat('a',64),snapshot);raise exception 'BATCH_SCOPE_ACCEPTED';exception when serialization_failure then null;end;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id']))
 sql("""begin;do $$declare r uuid:='{record}';j uuid:='{job}';other uuid;batch uuid;snapshot jsonb;receipt uuid:=gen_random_uuid();begin
 select run_id into batch from public.pipeline_jobs where id=j;
 snapshot:=public.concert_line_batch_snapshot(batch);
 begin
  insert into public.record_units(source_record_id,pipeline_job_id,unit_key,act_type,status) values(r,j,'pending-after-read','award','draft');
  begin perform public.concert_line_batch_snapshot_commit(receipt,batch,'fixture.xlsx',repeat('a',64),snapshot);raise exception 'BATCH_PENDING_STALE_ACCEPTED';exception when serialization_failure then null;end;
  raise no_data_found;
 exception when no_data_found then null;end;
 begin
  insert into public.source_records(source_dataset,source_record_id,mechanism,title) values('concerts','added-after-read','Concert','Another') returning id into other;
  insert into public.pipeline_jobs(source_record_id,run_id,status) values(other,batch,'needs_review');
  begin perform public.concert_line_batch_snapshot_commit(receipt,batch,'fixture.xlsx',repeat('a',64),snapshot);raise exception 'BATCH_MEMBERSHIP_STALE_ACCEPTED';exception when serialization_failure then null;end;
  raise no_data_found;
 exception when no_data_found then null;end;
 if public.concert_line_batch_snapshot_commit(receipt,batch,'fixture.xlsx',repeat('a',64),snapshot)<>receipt then raise exception 'BATCH_SNAPSHOT_COMMIT_FAILED';end if;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id']))
 sql('grant execute on function public.concert_line_combined_provisions(),public.concert_line_combined_approved(),public.concert_line_approved(public.service_provisions),public.concert_line_mixed_snapshot(uuid[],boolean),public.concert_line_mixed_commit(uuid,text,jsonb,boolean),public.concert_line_mixed_batch_commit(uuid,uuid,text,text,jsonb),public.concert_line_batch_snapshot(uuid),public.concert_line_batch_snapshot_commit(uuid,uuid,text,text,jsonb),public.concert_line_master_snapshot(),public.concert_line_master_snapshot_commit(uuid,text,text,jsonb) to service_role;')
 sql("""begin;do $$declare r uuid;j uuid;run_id uuid;u uuid;p uuid;doc uuid;conveni_record uuid;source_path text;item_path text;sha text:=repeat('a',64);line_id uuid;code text;v text;ids uuid[];snap jsonb;receipt uuid:=gen_random_uuid();before_history jsonb;kind text;i integer;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status) values('concerts','mixed-legacy','Concert','Legacy','completat') returning id into r;
 insert into public.pipeline_runs default values returning id into run_id;
 insert into public.pipeline_jobs(source_record_id,run_id,status) values(r,run_id,'approved') returning id into j;
 insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');
 insert into public.record_units(source_record_id,unit_key,act_type,status) values(r,'legacy','legacy','approved') returning id into u;
 insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id) values(u,r,'legacy','Concert',25000,'fixture',code,v) returning id into p;
 select provision_id into line_id from public.concert_line_award_decisions where source_record_id='{record}' order by amount limit 1;
 ids:=array[p,line_id];
 for i in 1..2 loop
  kind:=case when i=1 then 'convenis' else 'contractacions' end;
  insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status) values(kind,'mixed-'||kind,case when i=1 then 'Conveni' else 'Contracte' end,'Other','completat') returning id into r;
  insert into public.pipeline_runs default values returning id into run_id;
  insert into public.pipeline_jobs(source_record_id,run_id,status) values(r,run_id,'approved') returning id into j;
  insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');
  if i=1 then
   conveni_record:=r;
   doc:=gen_random_uuid();source_path:='cases/'||r||'/documents/'||doc||'/'||sha||'.pdf';
   insert into public.source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256,extraction_partial) values(doc,r,'https://fixture.invalid/'||doc,doc::text,'agreement','fetched',source_path,sha,false);
   insert into public.record_units(source_record_id,pipeline_job_id,unit_key,act_type,status,document_id) values(r,j,'conveni-fixture','award','approved',doc) returning id into u;
   item_path:='cases/'||r||'/items/'||u||'/documents/'||doc||'/'||sha||'.pdf';insert into storage.objects(bucket_id,name,version) values('cloud-documents',item_path,'v1');
   update public.record_units set storage_path=item_path,storage_sha256=sha where id=u;
   insert into public.conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,document_revisions) values(j,r,public.conveni_source_hash(r),v,'{{}}',jsonb_build_object(doc::text,(select storage_sha256||':'||coalesce(active_extraction_id::text,'') from public.source_documents where id=doc)));
   insert into public.conveni_unit_proposals(job_id,unit_id,data) values(j,u,'{{}}');
   insert into public.conveni_review_events(id,source_record_id,job_id,unit_id,outcome,service_code,reason,actor,snapshot) values(gen_random_uuid(),r,j,u,'select',code,'Synthetic','Fixture','{{}}');
  else
   insert into public.record_units(source_record_id,unit_key,act_type,status) values(r,'legacy','legacy','approved') returning id into u;
  end if;
  insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id) values(u,r,kind,case when i=1 then 'Conveni' else 'Contracte' end,i*1000+2000,'fixture',code,v) returning id into p;
  if i=1 and not exists(select 1 from public.conveni_reviewed_provisions where id=p) then raise exception 'CONVENI_FIXTURE_NOT_CURRENT unit=% analysis=% doc=%', (select to_jsonb(c) from public.conveni_current_units c where c.unit_id=u),(select to_jsonb(a) from public.conveni_analyses a where a.job_id=j),(select to_jsonb(d) from public.source_documents d where d.id=doc);end if;
  ids:=array_append(ids,p);
 end loop;
 snap:=public.concert_line_mixed_snapshot(ids);
 if jsonb_array_length(snap)<>4 or (select sum((e->'snapshot'->>'amount')::numeric) from jsonb_array_elements(snap) e)<>44000 then raise exception 'MIXED_SELECTION_WRONG count=% mechanisms=%',jsonb_array_length(snap),(select string_agg(e->'snapshot'->>'mechanism',',') from jsonb_array_elements(snap) e);end if;
 perform public.concert_line_mixed_commit(receipt,repeat('a',64),snap);
 if public.concert_line_mixed_commit(receipt,repeat('a',64),snap)<>receipt then raise exception 'MIXED_REPLAY_FAILED';end if;
 begin perform public.concert_line_mixed_commit(receipt,repeat('b',64),snap);raise exception 'MIXED_REPLAY_CHANGED';exception when raise_exception then if sqlerrm<>'MIXED_REPLAY_CONFLICT' then raise;end if;end;
 select jsonb_agg(snapshot order by provision_id) into before_history from public.concert_line_mixed_items where receipt_id=receipt;
 update public.conveni_review_events set outcome='reject' where source_record_id=conveni_record;
 begin perform public.concert_line_mixed_commit(gen_random_uuid(),repeat('a',64),snap);raise exception 'MIXED_CONVENI_STALE_ACCEPTED';exception when serialization_failure then null;end;
 update public.conveni_review_events set outcome='select' where source_record_id=conveni_record;
 update public.service_provisions set provider_name='Changed' where id=p;
 begin perform public.concert_line_mixed_commit(gen_random_uuid(),repeat('a',64),snap);raise exception 'MIXED_STALE_ACCEPTED';exception when serialization_failure then null;end;
 if (select jsonb_agg(snapshot order by provision_id) from public.concert_line_mixed_items where receipt_id=receipt) is distinct from before_history then raise exception 'MIXED_HISTORY_CHANGED';end if;
 end $$;rollback;""".format(record=ids['record_id']))
 legacy_id=sql("""create temporary table mixed_http_fixture(provision_id uuid);do $$declare r uuid;j uuid;run_id uuid;u uuid;p uuid;code text;v text;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status) values('concerts','mixed-http','Concert','Legacy','completat') returning id into r;
 insert into public.pipeline_runs default values returning id into run_id;insert into public.pipeline_jobs(source_record_id,run_id,status) values(r,run_id,'approved') returning id into j;
 insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');
 insert into public.record_units(source_record_id,unit_key,act_type,status) values(r,'legacy','legacy','approved') returning id into u;
 insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id) values(u,r,'legacy','Concert',25000,'fixture',code,v) returning id into p;
 insert into mixed_http_fixture values(p);end $$;select provision_id from mixed_http_fixture;""")
 sql("""begin;do $$declare r uuid;u uuid;p uuid;j uuid;run_id uuid;code text;v text;master jsonb;batch jsonb;approved jsonb;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status) values('contractacions','legacy-visible','Contracte','Legacy','revisio') returning id into r;
 insert into public.pipeline_runs default values returning id into run_id;insert into public.pipeline_jobs(source_record_id,run_id,status) values(r,run_id,'needs_review') returning id into j;
 insert into public.record_units(source_record_id,unit_key,act_type,status) values(r,'legacy','legacy','approved') returning id into u;
 insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id) values(u,r,'legacy-visible','Contracte',77,'fixture',code,v) returning id into p;
 master:=public.concert_line_master_snapshot();batch:=public.concert_line_batch_snapshot(run_id);approved:=public.concert_line_mixed_snapshot(array[p]);
 if not exists(select 1 from jsonb_array_elements(master->'provisions') e where e->>'id'=p::text) or not exists(select 1 from jsonb_array_elements(batch->'provisions') e where e->>'id'=p::text) or jsonb_array_length(approved)<>0 then raise exception 'LEGACY_VISIBILITY_CHANGED';end if;
 perform public.concert_line_master_snapshot_commit(gen_random_uuid(),'legacy-master.xlsx',repeat('a',64),master);
 perform public.concert_line_batch_snapshot_commit(gen_random_uuid(),run_id,'legacy-batch.xlsx',repeat('a',64),batch);
 end $$;rollback;""")
 sql("""begin;do $$declare expected jsonb;line_id uuid;begin
 expected:=public.concert_line_master_snapshot();
 select provision_id into line_id from public.concert_line_award_decisions limit 1;
 update public.source_documents set extracted_text=extracted_text||' changed' where id=(select u.document_id from public.record_units u join public.concert_line_award_decisions x on x.unit_id=u.id where x.provision_id=line_id);
 begin perform public.concert_line_master_snapshot_commit(gen_random_uuid(),'fixture.xlsx',repeat('a',64),expected);raise exception 'MASTER_STALE_ACCEPTED';exception when serialization_failure then null;end;
 end $$;rollback;""")
 holder=subprocess.Popen(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write("begin;update public.service_provisions set provider_name='busy' where id='"+legacy_id+"';\n\\echo LOCKED\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('master lock holder failed')
   if line.strip()=='LOCKED':break
  query="select public.concert_line_master_snapshot_commit(gen_random_uuid(),'fixture.xlsx',repeat('a',64),public.concert_line_master_snapshot());"
  blocked=subprocess.run(['docker','exec','-i',pg,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=5)
  if blocked.returncode==0 or 'could not obtain lock' not in blocked.stderr:raise RuntimeError('MASTER_BUSY_NOT_FENCED '+blocked.stderr[-1000:])
 finally:
  holder.stdin.write('rollback;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=10)
  if holder.returncode:raise RuntimeError('master lock holder failed')
 timing=sql("""begin;create temporary table timing(ms numeric);do $$declare started timestamptz:=clock_timestamp();snapshot jsonb;begin snapshot:=public.concert_line_master_snapshot();perform public.concert_line_master_snapshot_commit(gen_random_uuid(),'timing.xlsx',repeat('a',64),snapshot);insert into timing values(extract(epoch from clock_timestamp()-started)*1000);end $$;select ms from timing;rollback;""")
 print('Synthetic three-row Master snapshot and commit ms: '+timing)
 scale_timing=sql("""begin;create temporary table scale_timing(ms numeric);do $$declare r uuid;j uuid;run_id uuid;u uuid;code text;v text;i integer;snapshot jsonb;started timestamptz;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 for i in 1..1000 loop
  insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status) values('concerts','master-scale-'||i,'Concert','Fixture '||i,'completat') returning id into r;
  insert into public.pipeline_runs default values returning id into run_id;insert into public.pipeline_jobs(source_record_id,run_id,status) values(r,run_id,'approved') returning id into j;
  insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');insert into public.record_units(source_record_id,unit_key,act_type,status) values(r,'legacy','legacy','approved') returning id into u;
  insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id) values(u,r,'scale-'||i,'Concert',100,'fixture',code,v);
 end loop;
 snapshot:=public.concert_line_master_snapshot();started:=clock_timestamp();perform public.concert_line_master_snapshot_commit(gen_random_uuid(),'scale.xlsx',repeat('a',64),snapshot);insert into scale_timing values(extract(epoch from clock_timestamp()-started)*1000);
 end $$;select ms from scale_timing;rollback;""")
 print('Synthetic 1003-row Master commit ms: '+scale_timing)
 sql("""begin;do $$declare r uuid:='{record}';j uuid:='{job}';u uuid:='{unit}';p uuid;code text;v text;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');
 update public.source_records set processing_status='completat' where id=r;
 insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id)
 values(u,r,'fixture','Concert',12000,'fixture',code,v) returning id into p;
 if (select count(*) from public.concert_line_financing_projection where unit_id=u)<>1
  or (select finance_id from public.concert_line_financing_projection where unit_id=u)<>p then raise exception 'SAME_UNIT_DOUBLE_COUNT';end if;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id'],unit=ids['unit_id']))
 line_ids=sql("select jsonb_agg(id order by id) from public.concert_line_award_decisions where source_record_id='"+ids['record_id']+"'")
 sql("create role isolated_http login password 'fixture';grant anon,authenticated,service_role to isolated_http;")
 bundle=Path('/private/tmp/isolated-export-'+uuid.uuid4().hex+'.cjs')
 run([str(root/'node_modules/esbuild/bin/esbuild'),str(exp/'candidate-520-rest-runner.ts'),'--bundle','--platform=node','--format=cjs','--alias:@/lib/records-page='+str(exp/'db-stub.ts'),'--alias:@='+str(root),'--outfile='+str(bundle)])
 run(['docker','run','-d','--pull=never','--name',rest,'--network',network,'-e',f'PGRST_DB_URI=postgres://isolated_http:fixture@{pg}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET=private-synthetic-projection-secret-0000000000000000','public.ecr.aws/supabase/postgrest:v16.4']);created.append(('container',rest))
 for _ in range(40):
  p=subprocess.run(['docker','exec',pg,'curl','-sS','--max-time','2',f'http://{rest}:3000/'],capture_output=True,text=True)
  if p.returncode==0 and p.stdout.startswith('{'):break
  time.sleep(.5)
 else:raise RuntimeError('PostgREST timeout')
 output=run(['docker','run','--rm','--pull=never','--network','container:'+rest,'--entrypoint','node','-v',str(bundle)+':/endpoint.cjs:ro','public.ecr.aws/supabase/storage-api:v1.82.1','/endpoint.cjs',line_ids,legacy_id,sql("select run_id from public.pipeline_jobs where id='"+ids['job_id']+"'")])
 result=json.loads(output)
 if result['status']!=200 or result['stale']!=409 or not result['anonBlocked']:raise RuntimeError('handler outcome '+output)
 if sql("select count(*) from public.concert_line_export_receipts")!='1' or sql("select count(*) from public.concert_line_export_items")!='2':raise RuntimeError('receipt count incorrect')
 # Only the batch export remains since 03/11/2026 (the approved/master exports were retired by the Mapeig export).
 if sql("select hash from public.concert_line_mixed_receipts where id in(select id from public.excel_exports where pipeline_run_id is not null)")!=result['batchHash']:raise RuntimeError('batch byte hash mismatch')
 if sql("select count(*) from public.service_provisions where source_record_id='"+ids['record_id']+"'")!='0':raise RuntimeError('shared provision created')
 print('PASS private HTTP handler with real PostgREST/PG: XLSX hash, receipt, stale rejection and anon denial')

finally:
 if 'bundle' in globals():bundle.unlink(missing_ok=True)
 errors=[]
 for kind,resource in reversed(created):
  p=subprocess.run(['docker','rm','-f',resource] if kind=='container' else ['docker','network','rm',resource],capture_output=True,text=True,timeout=30)
  if p.returncode:errors.append(resource)
 if errors:
  print('CLEANUP FAILED: '+', '.join(errors),file=sys.stderr)
  sys.exit(1)
