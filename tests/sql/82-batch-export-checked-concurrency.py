"""Two-session private receipt prototype in a disposable isolated database.
No project environment, physical Excel, HTTP, or real Storage is involved.
"""
from pathlib import Path
import json
import hashlib
import select
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
name = 'mapeig-export-check-' + uuid.uuid4().hex[:12]
base = ['docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
created = False
reader = None

def run(args, *, text_input=None, timeout=90):
    result = subprocess.run(args, input=text_input, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-3000:])
    return result.stdout.strip()

def sql(statement):
    return run(base, text_input=statement)

try:
    run(['docker', 'run', '-d', '--pull=never', '--network', 'none', '--label', 'codex-test=export-snapshot',
         '--name', name, '-e', 'POSTGRES_PASSWORD=synthetic', 'public.ecr.aws/supabase/postgres:17.11.0.004'])
    created = True
    for _ in range(60):
        probe = subprocess.run(base + ['-c', 'select 1'], capture_output=True)
        if probe.returncode == 0:
            time.sleep(3)  # The image restarts once after its initial bootstrap.
            if subprocess.run(base + ['-c', 'select 1'], capture_output=True).returncode == 0:
                break
        time.sleep(.5)
    else:
        raise RuntimeError('isolated postgres not ready')
    run(['docker', 'exec', '-i', name, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], text_input='''
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);
      grant usage on schema storage to postgres,service_role;
      grant select,insert,update on storage.buckets to postgres;
      grant select,insert on storage.objects to postgres;
      grant select on storage.objects to service_role;
    ''')
    migrations = sorted([*(root / 'supabase/migrations').glob('*.sql'), *(root / 'supabase/experiments/migrations').glob('*.sql')], key=lambda p: p.name)
    # Capture contents before applying so concurrent file edits cannot make the
    # version under test ambiguous.
    captured = [(p.name, p.read_text()) for p in migrations]
    for migration, content in captured:
        try:
            sql('begin;\n' + content + '\ncommit;')
        except RuntimeError as error:
            raise RuntimeError(f'{migration}: {error}') from error
    sql('begin;\n' + (root / 'tests/sql/81-batch-export-checked.sql').read_text() + '\nrollback;')
    sql('''
      insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
       values('snapshot-fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixture','notice','context','{}',1,true,true);
      insert into official_services(version_id,service_code,service_name,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
       values('snapshot-fixture','X','Synthetic','service','Description','Population','Conditions','Law','{}');
      insert into pipeline_runs(id) values('a4000000-0000-4000-8000-000000000001');
      insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
       values('a4000000-0000-4000-8000-000000000002','contractacions','snapshot-fixture','Contractació','Synthetic','{}');
      insert into pipeline_jobs(run_id,source_record_id,status)
       values('a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','queued');
      insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
       values('a4000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000002','source','Contractació','source','X','snapshot-fixture',0);
    ''')
    runid = 'a4000000-0000-4000-8000-000000000001'
    snapshot = json.loads(sql(f"select public.batch_export_snapshot_prototype('{runid}');"))
    fingerprint = snapshot['fingerprint']
    call = f"public.record_batch_export_snapshot_prototype('{runid}','{fingerprint}','fixture.xlsx',repeat('a',64))"
    # Every relevant table is blocked by an active writer before revalidation.
    tables = ['conveni_analyses','conveni_review_events','conveni_unit_proposals','master_services','official_services',
              'pipeline_jobs','pipeline_runs','record_units','review_decisions','service_provisions','source_documents','source_records']
    for table in tables:
        reader = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        reader.stdin.write(f'begin; lock table public.{table} in row exclusive mode;\n\\echo LOCK_HELD\n')
        reader.stdin.flush()
        ready, _, _ = select.select([reader.stdout], [], [], 10)
        if not ready or reader.stdout.readline().strip() != 'LOCK_HELD':
            raise RuntimeError('writer lock not obtained for ' + table)
        result = subprocess.run(base, input='\\set VERBOSITY verbose\nselect '+call+';', text=True,capture_output=True,timeout=10)
        if result.returncode == 0 or '55P03' not in result.stderr:
            raise RuntimeError('expected lock failure for ' + table + ': ' + result.stderr)
        reader.stdin.write('rollback;\n\\q\n')
        reader.stdin.close()
        reader.wait(timeout=10)
        if reader.returncode:
            raise RuntimeError(reader.stderr.read())
        reader = None
    # A READ COMMITTED transaction can have taken an earlier snapshot before
    # another transaction commits; the guard must acquire a fresh one.
    reader = subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    reader.stdin.write(f"begin; select public.batch_export_snapshot_prototype('{runid}')->>'fingerprint';\n\\echo SNAPSHOT_TAKEN\n")
    reader.stdin.flush()
    ready, _, _ = select.select([reader.stdout], [], [], 10)
    if not ready or reader.stdout.readline().strip()!=fingerprint or reader.stdout.readline().strip()!='SNAPSHOT_TAKEN':
        raise RuntimeError('initial transaction snapshot was not captured')
    sql("update service_provisions set amount=400 where id='a4000000-0000-4000-8000-000000000003';")
    reader.stdin.write('\\set VERBOSITY verbose\nselect '+call+';\n')
    reader.stdin.close()
    reader.wait(timeout=10)
    if reader.returncode==0 or '40001' not in reader.stderr.read():
        raise RuntimeError('old READ COMMITTED transaction snapshot was accepted')
    reader = None
    # A committed change after capture invalidates the fingerprint.
    sql("update service_provisions set amount=500 where id='a4000000-0000-4000-8000-000000000003';")
    stale = subprocess.run(base,input='\\set VERBOSITY verbose\nselect '+call+';',text=True,capture_output=True,timeout=10)
    if stale.returncode == 0 or '40001' not in stale.stderr or sql('select count(*) from excel_exports') != '0':
        raise RuntimeError('stale capture accepted or receipt created: ' + stale.stderr)
    # Non-READ-COMMITTED transactions cannot rely on the new snapshot.
    current = json.loads(sql(f"select public.batch_export_snapshot_prototype('{runid}');"))
    fingerprint = current['fingerprint']
    call = f"public.record_batch_export_snapshot_prototype('{runid}','{fingerprint}','fixture.xlsx',repeat('a',64))"
    for isolation in ('repeatable read', 'serializable'):
        rejected = subprocess.run(base,input=f'\\set VERBOSITY verbose\nbegin isolation level {isolation}; select {call};',text=True,capture_output=True,timeout=10)
        if rejected.returncode == 0 or '40001' not in rejected.stderr:
            raise RuntimeError('isolation not rejected: ' + isolation)
    # Hold a successful receipt transaction and show its SHARE locks block a
    # competing writer; after COMMIT a later change is deliberately allowed.
    reader = subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    reader.stdin.write('begin; select '+call+';\n\\echo RECEIPT_HELD\n')
    reader.stdin.flush()
    ready, _, _ = select.select([reader.stdout], [], [], 10)
    if not ready or not reader.stdout.readline().strip():
        raise RuntimeError('receipt was not created')
    if reader.stdout.readline().strip() != 'RECEIPT_HELD':
        raise RuntimeError('receipt lock marker missing')
    blocked = subprocess.run(base,input='\\set VERBOSITY verbose\nbegin; lock table public.service_provisions in row exclusive mode nowait;',text=True,capture_output=True,timeout=10)
    if blocked.returncode == 0 or '55P03' not in blocked.stderr:
        raise RuntimeError('receipt did not block the writer: '+blocked.stderr)
    reader.stdin.write('commit;\n\\q\n')
    reader.stdin.close()
    reader.wait(timeout=10)
    if reader.returncode:
        raise RuntimeError(reader.stderr.read())
    reader = None
    sql("update service_provisions set amount=600 where id='a4000000-0000-4000-8000-000000000003';")
    after = json.loads(sql(f"select public.batch_export_snapshot_prototype('{runid}');"))
    if after['fingerprint']==fingerprint or sql('select count(*) from excel_exports')!='1':
        raise RuntimeError('post-commit change or historic receipt missing')
    if any(next(p for p in migrations if p.name == migration).read_text()!=content for migration,content in captured):
        raise RuntimeError('migration file changed while the test ran')
    for migration,content in captured:
        if migration.startswith(('20261029033000_', '20261029034000_', '20261029035000_')):
            print('MIGRATION_SHA256',migration,hashlib.sha256(content.encode()).hexdigest())
    print(f'PASS: {len(captured)} migrations; 12 write-lock conflicts, stale data, isolation, receipt lock and post-commit change; no Excel or HTTP verified')
finally:
    if reader is not None and reader.poll() is None:
        reader.kill()
        reader.wait(timeout=10)
    if created:
        run(['docker', 'rm', '-f', name], timeout=30)
        print('Isolated container removed:', name)
