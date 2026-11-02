"""Two-session test in a disposable local database; no provider or remote state."""
from pathlib import Path
import subprocess, sys, time, uuid

container='supabase_db_cartera-workflow-test'
database='t19_reservation_'+uuid.uuid4().hex[:12]
base=['docker','exec','-i',container]
created=False

def run(args,data=None):
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:raise RuntimeError((result.stderr or result.stdout).decode()[-3000:])
    return result.stdout.decode()

def sql(text):
    return run(base+['psql','-U','postgres','-d',database,'-X','-v','ON_ERROR_STOP=1','-qAt'],text.encode())

def holder(statement):
    process=subprocess.Popen(base+['psql','-U','postgres','-d',database,'-X','-v','ON_ERROR_STOP=1','-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    process.stdin.write('begin;\n'+statement+'\n\\echo LOCK_HELD\nselect pg_sleep(4);\nrollback;\n');process.stdin.flush()
    output=[]
    while True:
        line=process.stdout.readline()
        if not line:raise RuntimeError('holder failed: '+process.stderr.read())
        if line.strip()=='LOCK_HELD':return process,output
        output.append(line.strip())

def done(process):
    process.stdin.close();process.wait(timeout=10)
    if process.returncode:raise RuntimeError(process.stderr.read())

try:
    run(base+['createdb','-U','postgres',database]);created=True
    dump=subprocess.run(base+['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
    dump=b'\n'.join(line for line in dump.splitlines() if not line.strip().startswith(b'SET log_min_messages'))
    run(base+['psql','-U','postgres','-d',database,'-X','-v','ON_ERROR_STOP=1','-q'],dump)
    # The cloned test schema already contains active migrations. Install only
    # the quarantined prototypes, in their original order.
    for migration in sorted(Path('supabase/experiments/migrations').glob('*.sql')):
        if migration.name.startswith(('20261029031000_', '20261029032000_')):sql(migration.read_text())
    sql('begin;\n'+Path('tests/sql/77-local-matching-group-reservation.sql').read_text()+'\nrollback;')
    helper=Path('tests/sql/71-local-matching-dedup-identity.sql').read_text().split('do $$')[0].replace('pg_temp.matching_input','public.test_group_input')
    sql(helper)
    sql("""
    insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('group-fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
    insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('group-fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
    insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('a2000000-0000-0000-0000-000000000001','contractacions','group-fixture','Contract','Unique synthetic');
    insert into pipeline_runs(id,status) values('a2000000-0000-0000-0000-000000000002','matching');
    insert into pipeline_jobs(id,run_id,source_record_id,status) values('a2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','matching');
    insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values('a2000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001','https://example.invalid/test','group-fixture','publication','fetched');
    create table expected_input as select public.test_group_input('a2000000-0000-0000-0000-000000000001','group-fixture','a2000000-0000-0000-0000-000000000003') v;
    insert into source_records(source_dataset,source_record_id,mechanism,title) select 'contractacions','synthetic-'||g,'Contract','Synthetic distinct '||g from generate_series(1,1000) g;
    """)
    reserve="public.local_reserve_matching_group('a2000000-0000-0000-0000-000000000003',(select v from expected_input))"
    process,result=holder('select '+reserve+';')
    try:
        if result!=['t']:raise RuntimeError('Initial reservation rejected: '+repr(result))
        started=time.monotonic();out=sql("set statement_timeout='1s'; select "+reserve+';').strip();elapsed=(time.monotonic()-started)*1000
        if out!='f' or elapsed>=1000:raise RuntimeError('Concurrent reservation not rejected promptly: '+out)
    finally:done(process)
    if sql('select count(*) from local_matching_group_reservations;').strip()!='0':raise RuntimeError('Rolled back reservation survived')
    if sql('select '+reserve+'; select '+reserve+'; select count(*) from local_matching_group_reservations;').strip().splitlines()!=['t','t','1']:raise RuntimeError('Commit/replay not idempotent')
    # Writers not participating in this private protocol can still add a
    # duplicate after commit; replay detects it but reservation cannot stop it.
    sql("insert into source_records(source_dataset,source_record_id,mechanism,title) values('contractacions','external-duplicate','Contract','Unique synthetic');")
    if sql('select '+reserve+'; select count(*) from local_matching_group_reservations;').strip().splitlines()!=['f','1']:raise RuntimeError('Changed group escaped revalidation')
    if sql('select count(*) from provider_calls; select count(*) from local_matching_requests;').strip().splitlines()!=['0','0']:raise RuntimeError('Unexpected provider/journal mutation')
    # Simulate a legacy writer after reservation, without any provider call.
    # The reservation does not fence that path; revalidation rejects sending.
    sql("delete from source_records where source_record_id='external-duplicate'; insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic fixture') on conflict (key) do update set enabled=true; insert into provider_calls(pipeline_job_id,phase,request_hash,state) values('a2000000-0000-0000-0000-000000000003','matching','synthetic-hash','sending');")
    if sql('select '+reserve+'; select count(*) from local_matching_group_reservations;').strip().splitlines()!=['f','1']:raise RuntimeError('Unknown send did not retain and block reservation')
    print(f'PASS: isolated reservation, conflict and permission tests; concurrent reservation rejected in {elapsed:.1f}ms including docker/psql startup; rollback and identical replay verified; external insert is not prevented; uncertain sending blocks replay and retains reservation')
finally:
    if created:
        result=subprocess.run(base+['dropdb','-U','postgres','--force',database],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:print('CLEANUP FAILED '+database+': '+result.stderr.decode(),file=sys.stderr)
