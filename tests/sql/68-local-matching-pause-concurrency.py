"""Two-session test in a disposable local database; no provider or remote state."""
from pathlib import Path
import subprocess, sys, time, uuid

container='supabase_db_cartera-workflow-test'
database='t19_pause_'+uuid.uuid4().hex[:12]
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
    for name in ('20261029011000_local_matching_input_capture.sql','20261029012000_local_matching_commit.sql','20261029023000_local_matching_commit_pause_guard.sql'):
        sql((Path('supabase/migrations')/name).read_text())
    helper=Path('tests/sql/67-local-matching-pause.sql').read_text().split('do $$')[0].replace('pg_temp.pause_matching_input','public.test_pause_input')
    sql(helper)
    sql("""
    insert into app_settings(key,enabled,reason) values('processing_enabled',true,'synthetic isolated test');
    insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('pause-fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
    insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('pause-fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
    insert into source_records(id,source_dataset,source_record_id,mechanism,title) values('a2000000-0000-0000-0000-000000000001','contractacions','pause-fixture','Contract','Synthetic');
    insert into pipeline_runs(id,status) values('a2000000-0000-0000-0000-000000000002','matching');
    insert into pipeline_jobs(id,run_id,source_record_id,status) values('a2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','matching');
    insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values('a2000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001','https://example.invalid/test','pause-fixture','publication','fetched');
    insert into evidence_chunks(id,source_document_id,ordinal,content,content_hash,character_count) values('a2000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000004',0,'synthetic content','hash',17);
    create table expected_input as select public.test_pause_input('a2000000-0000-0000-0000-000000000001','pause-fixture','a2000000-0000-0000-0000-000000000003') v;
    """)
    commit="""public.local_commit_matching('a2000000-0000-0000-0000-000000000003',(select v from expected_input),jsonb_build_object('version','local-matching-commit-v1','mode','deterministic','result',jsonb_build_object('classification','insufficient_evidence','reasons','[]'::jsonb,'explanation','Synthetic review','service_description','','target_population',''),'candidates','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('id','a2000000-0000-0000-0000-000000000005','source_document_id','a2000000-0000-0000-0000-000000000004','ordinal',0,'content','synthetic content')),'enrichment',null),'[]'::jsonb)"""
    process,_=holder("update app_settings set enabled=false where key='processing_enabled';")
    try:
        started=time.monotonic();result=sql('select '+commit+'; select count(*) from analysis_results;').strip().splitlines()
        if result!=['f','0'] or time.monotonic()-started>=2:raise RuntimeError('Switch lock was not rejected promptly: '+repr(result))
        sql("set lock_timeout='500ms'; update source_records set title=title where id='a2000000-0000-0000-0000-000000000001';")
    finally:done(process)
    process,result=holder('select '+commit+';')
    try:
        if result!=['t']:raise RuntimeError('Valid commit rejected: '+repr(result))
        try:sql("set lock_timeout='500ms'; update app_settings set enabled=false where key='processing_enabled';")
        except RuntimeError as error:
            if 'lock timeout' not in str(error):raise
        else:raise RuntimeError('A concurrent pause bypassed the held switch lock')
    finally:done(process)
    if sql('select count(*) from analysis_results; select count(*) from local_matching_commits;').strip().splitlines()!=['0','0']:
        raise RuntimeError('Rollback left committed data')
    print('PASS: switch contention fails before domain lock; active commit holds switch; rollback preserves state')
finally:
    if created:
        result=subprocess.run(base+['dropdb','-U','postgres','--force',database],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:print('CLEANUP FAILED '+database+': '+result.stderr.decode(),file=sys.stderr)
