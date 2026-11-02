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
 sql(open('supabase/migrations/20261029014000_conveni_amount_replay_guard.sql').read())
 sql("""
 insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
 insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload) values('b2000000-0000-0000-0000-000000000001','convenis','fixture','Conveni','Synthetic',2000,'{\"Total aportacions previstes Generalitat\":0,\"Total aportacions previstes ens locals\":1000,\"Total aportacions previstes altres Organismes\":1000}');
 select migrate_conveni_amount('b2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002',conveni_source_hash('b2000000-0000-0000-0000-000000000001'),2000);
 insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,superseded_at) values('b2000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000001','fixture','Conveni','fixture','1','fixture',clock_timestamp());
 """)
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
 p=holder("update service_provisions set superseded_at=null where id='b2000000-0000-0000-0000-000000000003';")
 try:
  sql("select revert_conveni_amount('b2000000-0000-0000-0000-000000000002');")
  raise RuntimeError('Revert ignored concurrent reactivation')
 except RuntimeError as e:
  if 'could not obtain lock' not in str(e):raise
 done(p)
 if sql("select amount from source_records where id='b2000000-0000-0000-0000-000000000001';").strip()!='1000.00':raise RuntimeError('Failed revert changed amount')
 p=holder("select revert_conveni_amount('b2000000-0000-0000-0000-000000000002');")
 try:
  sql("set lock_timeout='500ms';update service_provisions set superseded_at=null where id='b2000000-0000-0000-0000-000000000003';")
  raise RuntimeError('Concurrent reactivation bypassed revert')
 except RuntimeError as e:
  if 'lock timeout' not in str(e):raise
 done(p)
 if sql("select amount from source_records where id='b2000000-0000-0000-0000-000000000001';").strip()!='1000.00':raise RuntimeError('Rollback did not restore amount')
 sql("""
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload) values('b2000000-0000-0000-0000-000000000004','convenis','fixture-apply','Conveni','Synthetic',2000,'{\"Total aportacions previstes Generalitat\":0,\"Total aportacions previstes ens locals\":1000,\"Total aportacions previstes altres Organismes\":1000}');
 insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,superseded_at) values('b2000000-0000-0000-0000-000000000005','b2000000-0000-0000-0000-000000000004','fixture','Conveni','fixture','1','fixture',clock_timestamp());
 """)
 apply="select migrate_conveni_amount('b2000000-0000-0000-0000-000000000004','b2000000-0000-0000-0000-000000000006',conveni_source_hash('b2000000-0000-0000-0000-000000000004'),2000);"
 p=holder("update service_provisions set superseded_at=null where id='b2000000-0000-0000-0000-000000000005';")
 try:
  sql(apply)
  raise RuntimeError('First apply ignored concurrent reactivation')
 except RuntimeError as e:
  if 'could not obtain lock' not in str(e):raise
 done(p)
 p=holder(apply)
 try:
  sql("set lock_timeout='500ms';update service_provisions set superseded_at=null where id='b2000000-0000-0000-0000-000000000005';")
  raise RuntimeError('Concurrent reactivation bypassed first apply')
 except RuntimeError as e:
  if 'lock timeout' not in str(e):raise
 done(p)
 if sql("select amount from source_records where id='b2000000-0000-0000-0000-000000000004';").strip()!='2000.00':raise RuntimeError('Apply rollback did not restore amount')
 sql("""
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload) values('b2000000-0000-0000-0000-000000000007','convenis','fixture-review','Conveni','Synthetic',2000,'{\"Total aportacions previstes Generalitat\":0,\"Total aportacions previstes ens locals\":1000,\"Total aportacions previstes altres Organismes\":1000}');
 insert into review_decisions(id,source_record_id,decision,reviewer) values('b2000000-0000-0000-0000-000000000008','b2000000-0000-0000-0000-000000000007','rejected','system:convenis-sprint2-v1');
 """)
 apply_review="select migrate_conveni_amount('b2000000-0000-0000-0000-000000000007','b2000000-0000-0000-0000-000000000009',conveni_source_hash('b2000000-0000-0000-0000-000000000007'),2000);"
 p=holder("update review_decisions set reviewer='human' where id='b2000000-0000-0000-0000-000000000008';")
 try:
  sql(apply_review)
  raise RuntimeError('Apply ignored concurrent review change')
 except RuntimeError as e:
  if 'could not obtain lock' not in str(e):raise
 done(p)
 p=holder(apply_review)
 try:
  sql("set lock_timeout='500ms';update review_decisions set reviewer='human' where id='b2000000-0000-0000-0000-000000000008';")
  raise RuntimeError('Review change bypassed apply')
 except RuntimeError as e:
  if 'lock timeout' not in str(e):raise
 done(p)
 if sql("select amount from source_records where id='b2000000-0000-0000-0000-000000000007';").strip()!='2000.00':raise RuntimeError('Review fixture rollback did not restore amount')
 print('PASS: concurrent provision reactivation or review change cannot race apply/revert; rollbacks preserve source')

finally:
 if created:
  p=subprocess.run(base+['dropdb','-U','postgres','--force',db],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if p.returncode:print('CLEANUP FAILED for '+db+': '+p.stderr.decode(),file=sys.stderr)
