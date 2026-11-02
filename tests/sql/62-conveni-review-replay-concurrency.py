"""Isolated two-session review/freshness checks; no remote databases or providers."""
from pathlib import Path
import subprocess, uuid, sys

container='supabase_db_cartera-workflow-test'
db='conveni_review_'+uuid.uuid4().hex[:12]
base=['docker','exec','-i',container]
created=False

def run(args, data=None):
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).decode()[-4000:])
    return result.stdout.decode()

def sql(statement):
    return run(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qAt'],statement.encode())

def holder(statement):
    process=subprocess.Popen(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-qAt'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    process.stdin.write('begin;\n'+statement+'\n\\echo LOCK_HELD\nselect pg_sleep(6);\nrollback;\n')
    process.stdin.flush()
    while True:
        line=process.stdout.readline()
        if not line: raise RuntimeError('holder failed: '+process.stderr.read())
        if line.strip()=='LOCK_HELD': return process

def done(process):
    process.stdin.close()
    process.wait(timeout=12)
    if process.returncode: raise RuntimeError(process.stderr.read())

def expect_lock_timeout(statement):
    try:
        sql("set lock_timeout='500ms';"+statement)
    except RuntimeError as error:
        if 'lock timeout' not in str(error): raise
    else:
        raise RuntimeError('Concurrent writer bypassed the review lock')

try:
    run(base+['createdb','-U','postgres',db]);created=True
    dump=subprocess.run(base+['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-acl'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
    dump=b'\n'.join(line for line in dump.splitlines() if not line.strip().startswith(b'SET log_min_messages'))
    run(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-q'],dump)
    expected={'190000','194000','195000','201000','203000','205000','210000','211000','212000','213000','220000','221000','222000','223000','224000','225000','230000','231000','232000','233000','234000','235000','000000','001000','002000','003000','004000','005000','010000','011000','012000','013000','014000','015000','015500','020000'}
    paths=sorted(p for date in ('20261028','20261029') for p in Path('supabase/migrations').glob(date+'*.sql') if p.name[8:14] in expected)
    if len(paths)!=len(expected):raise RuntimeError('Expected migrations missing')
    sql('\n'.join(p.read_text() for p in paths))
    sql("""
    insert into storage.buckets(id,name,public) values('cloud-documents','cloud-documents',false);
    insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
    insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
    """)
    fixture=Path('tests/sql/60-conveni-review-replay.sql').read_text().split(" perform review_conveni_unit(sid,j,u,event,null,'outside'")[0]
    fixture+=" perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);\nend $$;"
    sql(fixture)
    sid,job,unit,event=sql("select s.id,j.id,p.unit_id,e.id from source_records s join pipeline_jobs j on j.source_record_id=s.id join conveni_unit_proposals p on p.job_id=j.id join conveni_review_events e on e.unit_id=p.unit_id where s.title='Conveni sintètic';").strip().split('|')
    review=f"select review_conveni_unit('{sid}','{job}','{unit}','{event}',null,'outside',null,'Revisió documentada de prova',true);"
    print('CLONE_COMPLETE',flush=True)
    process=holder(review)
    try:
        expect_lock_timeout(f"update conveni_unit_proposals set data=jsonb_set(data,'{{period}}','\"2026\"') where job_id='{job}' and unit_id='{unit}';")
        expect_lock_timeout(f"update source_documents set extracted_text='changed' where source_record_id='{sid}';")
        expect_lock_timeout(f"update pipeline_jobs set verification_only=true where id='{job}';")
        expect_lock_timeout(f"insert into source_documents(source_record_id,url,url_hash,document_type,status) values('{sid}','https://example.invalid/concurrent','concurrent','annex','fetched');")
    finally:done(process)
    process=holder(f"select 1 from source_documents where source_record_id='{sid}' for update;")
    try:
        try:sql(review)
        except RuntimeError as error:
            if 'could not obtain lock' not in str(error):raise
        else:raise RuntimeError('Replay waited for document-first writer')
    finally:done(process)
    if sql(f"select count(*) from conveni_review_events where source_record_id='{sid}';").strip()!='1':raise RuntimeError('Replay duplicated an event')
    print('PASS: replay locks jobs, proposals and documents; phantom insert blocked; inverted document lock fails closed; no new event')
finally:
    if created:
        result=subprocess.run(base+['dropdb','-U','postgres','--force',db],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:print('CLEANUP FAILED '+db+': '+result.stderr.decode(),file=sys.stderr)
