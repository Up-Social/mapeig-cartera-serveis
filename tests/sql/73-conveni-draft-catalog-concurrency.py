"""Isolated catalog/draft contention checks; no remote databases or providers."""
from pathlib import Path
import subprocess, uuid, sys

container='supabase_db_cartera-workflow-test'
db='conveni_draft_'+uuid.uuid4().hex[:12]
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
    print('SCHEMA_DUMP_COMPLETE',flush=True)
    dump=b'\n'.join(line for line in dump.splitlines() if not line.strip().startswith(b'SET log_min_messages'))
    run(base+['psql','-U','postgres','-d',db,'-X','-v','ON_ERROR_STOP=1','-q'],dump)
    expected={'190000','194000','195000','201000','203000','205000','210000','211000','212000','213000','220000','221000','222000','223000','224000','225000','230000','231000','232000','233000','234000','235000','000000','001000','002000','003000','004000','005000','010000','011000','012000','013000','014000','015000','015500','020000','021000','021500','022000','023000','024000','025000'}
    paths=sorted(p for date in ('20261028','20261029') for p in Path('supabase/migrations').glob(date+'*.sql') if p.name[8:14] in expected)
    if len(paths)!=len(expected):raise RuntimeError('Expected migrations missing')
    sql('\n'.join(p.read_text() for p in paths))
    sql("""
    insert into storage.buckets(id,name,public) values('cloud-documents','cloud-documents',false);
    insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active) values('fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
    insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
    """)
    fixture=Path('tests/sql/58-conveni-review-null-reconciliation.sql').read_text().split(' -- A NULL sibling')[0]+'\nend $$;'
    sql(fixture)
    sid,job,unit,doc=sql("select s.id,j.id,p.unit_id,d.id from source_records s join pipeline_jobs j on j.source_record_id=s.id join conveni_unit_proposals p on p.job_id=j.id join source_documents d on d.source_record_id=s.id where s.title='Conveni amb Fundació de prova';").strip().split('|')
    sibling=str(uuid.uuid4())
    sql(f"insert into record_units(id,source_record_id,unit_key) values('{sibling}','{sid}','conveni:sibling');")
    parent=str(uuid.uuid4())
    sql(f"update source_documents set extraction_method='pdftotext',extracted_text=extracted_text||chr(10)||'Aportació prevista de 1.000,00 euros per a l’any 2025.' where id='{doc}';")
    monetary=f"jsonb_build_object('document_id','{doc}','page',1,'quote','Aportació prevista de 1.000,00 euros per a l’any 2025.')"
    identity=f"jsonb_build_object('document_id','{doc}','page',1,'quote','La Fundació de prova amb NIF G12345678 rep mil euros per prestar un servei social a persones grans al municipi de Vic durant 2025.')"
    confirms="'{\"public_contribution\":true,\"recipient_role\":true,\"period\":true,\"not_shared_or_maximum\":true,\"conditions_preserved\":true,\"not_payment\":true}'::jsonb"
    review=f"select prepare_conveni_unit_economic_draft('{sid}','{job}','{unit}','{uuid.uuid4()}',null,null,(select source_hash from conveni_analyses where job_id='{job}'),(select encode(extensions.digest(data::text,'sha256'),'hex') from conveni_unit_proposals where job_id='{job}' and unit_id='{unit}'),(select encode(extensions.digest(payload::text,'sha256'),'hex') from conveni_analyses where job_id='{job}'),(select document_revisions from conveni_analyses where job_id='{job}'),'1',100000,'1.000,00',{monetary},{identity},{identity},{confirms},'Revisió econòmica concurrent');"
    # An active draft holds its catalog version and all rows. The foreign key
    # to the version also fences insertion of a new service during the check.
    process=holder(review)
    try:
        expect_lock_timeout("update catalog_versions set general_context='changed' where id='fixture';")
        expect_lock_timeout("update official_services set description='changed' where version_id='fixture' and service_code='1';")
        expect_lock_timeout("insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields) values('fixture','1.2','Child','1','service','D','P','C','L','{}');")
    finally: done(process)
    # An editor holding either row makes the preparation fail immediately,
    # rather than waiting while domain locks are held.
    for statement in ("update catalog_versions set general_context='changed' where id='fixture';", "update official_services set description='changed' where version_id='fixture' and service_code='1';"):
        process=holder(statement)
        try:
            try: sql(review)
            except RuntimeError as error:
                if 'could not obtain lock' not in str(error): raise
            else: raise RuntimeError('Draft waited on a catalog writer')
        finally: done(process)
    if sql(f"select count(*) from conveni_unit_economic_draft_events where source_record_id='{sid}';").strip()!='0':raise RuntimeError('Rollback retained a draft')
    if sql(f"select count(*) from service_provisions where source_record_id='{sid}';").strip()!='0':raise RuntimeError('Draft persisted a provision')
    print('PASS: catalog version and service writers are fenced; conflicting writers fail closed; rollback preserves state')
finally:
    if created:
        result=subprocess.run(base+['dropdb','-U','postgres','--force',db],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:print('CLEANUP FAILED '+db+': '+result.stderr.decode(),file=sys.stderr)
