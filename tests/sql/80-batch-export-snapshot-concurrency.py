"""Two-session synthetic PostgreSQL test. It creates and removes only its own
network-disabled container and never reads project environment configuration.

This tests the private snapshot reader and a synthetic XLSX, not receipt or HTTP.
The synthetic Storage schema does not verify Supabase Storage or production ACL.
"""
from pathlib import Path
import json
import hashlib
import os
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
name = 'mapeig-export-snapshot-' + uuid.uuid4().hex[:12]
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
    sql('begin;\n' + (root / 'tests/sql/79-batch-export-snapshot.sql').read_text() + '\nrollback;')
    sql('''
      insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
       values('snapshot-fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixture','notice','context','{}',1,true,true);
      insert into official_services(version_id,service_code,service_name,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
       values('snapshot-fixture','X','Synthetic','service','Description','Population','Conditions','Law','{}');
      insert into pipeline_runs(id) values('a4000000-0000-4000-8000-000000000001');
      insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
       values('a4000000-0000-4000-8000-000000000002','contractacions','snapshot-fixture','Contractació','Synthetic','{}');
      insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
       values('a4000000-0000-4000-8000-000000000004','contractacions','snapshot-fixture-second','Contractació','Synthetic second','{}');
      insert into pipeline_jobs(run_id,source_record_id,status)
       values('a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','queued');
      insert into pipeline_jobs(run_id,source_record_id,status)
       values('a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000004','queued');
      insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount,award_date,call_url)
       values('a4000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000002','source','Contractació','source','X','snapshot-fixture',0,'2026-09-30','https://example.invalid/annex');
      insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
       values('a4000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000004','second','Contractació','source','X','snapshot-fixture',null);
    ''')
    runid = 'a4000000-0000-4000-8000-000000000001'
    reader = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    # Sleep inside the same statement before invoking the STABLE function.
    # The statement snapshot precedes the concurrent committed changes.
    reader.stdin.write(f"with pause as materialized (select pg_sleep(3)) select public.batch_export_snapshot_prototype('{runid}') from pause;\n")
    reader.stdin.flush()
    time.sleep(1)
    sql("update service_provisions set amount=500 where id='a4000000-0000-4000-8000-000000000003'; insert into record_units(source_record_id,unit_key,status) values('a4000000-0000-4000-8000-000000000002','new','draft');")
    reader.stdin.close()
    reader.wait(timeout=10)
    if reader.returncode:
        raise RuntimeError(reader.stderr.read())
    old = json.loads(reader.stdout.read())
    reader = None
    current = json.loads(sql(f"select public.batch_export_snapshot_prototype('{runid}');"))
    if old['body']['provisions'][0]['amount'] != 0 or old['body']['pending_units']:
        raise RuntimeError('the original statement included later committed changes')
    if current['body']['provisions'][0]['amount'] != 500 or len(current['body']['pending_units']) != 1:
        raise RuntimeError('a subsequent snapshot did not include committed changes')
    if old['fingerprint'] == current['fingerprint']:
        raise RuntimeError('fingerprint did not change')
    # Send the genuine synthetic SQL JSON directly to a local TypeScript
    # adapter and inspect the resulting real XLSX. No PostgREST or credentials.
    node = '/Users/carlessanz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
    result = subprocess.run([node,'--import','tsx','tests/batch-export-snapshot-sql-fixture.ts'],cwd=root,input=json.dumps(current),
                            text=True,capture_output=True,timeout=30,env={**os.environ,'TZ':'Europe/Madrid'})
    if result.returncode:
        raise RuntimeError('SQL to XLSX test failed: '+result.stderr[-3000:])
    print(result.stdout.strip())
    # Stress only synthetic rows; this is one sampled measurement, not a
    # production budget or a process peak-memory benchmark.
    sql('''
      insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256)
       values('e4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','https://example.invalid/fixture','size-fixture','agreement','fetched',
        'cases/a4000000-0000-4000-8000-000000000002/documents/e4000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.pdf',repeat('a',64));
      insert into storage.objects(bucket_id,name) values('cloud-documents','cases/a4000000-0000-4000-8000-000000000002/documents/e4000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.pdf');
      insert into storage.objects(bucket_id,name) select 'cloud-documents',
       'cases/a4000000-0000-4000-8000-000000000002/items/'||('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))||'/documents/e4000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.pdf' from generate_series(1,1000) i;
      insert into record_units(id,source_record_id,unit_key,status,document_id,storage_sha256,storage_path)
       select ('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'a4000000-0000-4000-8000-000000000002','size-'||i,'approved',
        'e4000000-0000-4000-8000-000000000001',repeat('a',64),
        'cases/a4000000-0000-4000-8000-000000000002/items/'||('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))||'/documents/e4000000-0000-4000-8000-000000000001/'||repeat('a',64)||'.pdf' from generate_series(1,1000) i;
      insert into service_provisions(id,unit_id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,provider_name,amount)
       select ('d4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
        'a4000000-0000-4000-8000-000000000002','size-'||i,'Contractació','source','X','snapshot-fixture',repeat(md5(i::text),250),i
       from generate_series(1,1000) i;
    ''')
    large=sql(f"select public.batch_export_snapshot_prototype('{runid}');")
    measured=subprocess.run([node,'--import','tsx','tests/batch-export-snapshot-sql-fixture.ts','--size'],cwd=root,input=large,text=True,capture_output=True,timeout=90,env={**os.environ,'TZ':'Europe/Madrid'})
    if measured.returncode:
        raise RuntimeError('SQL to XLSX size fixture failed: '+measured.stderr[-3000:])
    print(measured.stdout.strip())
    changed=[migration for migration,content in captured if next(p for p in migrations if p.name == migration).read_text()!=content]
    if changed:
        raise RuntimeError('migration files changed while test ran: '+', '.join(changed))
    if [p.name for p in sorted([*(root/'supabase/migrations').glob('*.sql'), *(root/'supabase/experiments/migrations').glob('*.sql')], key=lambda p: p.name)] != [migration for migration,_ in captured]:
        raise RuntimeError('migration inventory changed while test ran')
    manifest='\n'.join(name+':'+hashlib.sha256(content.encode()).hexdigest() for name,content in captured)
    print('MIGRATION_MANIFEST_SHA256',hashlib.sha256(manifest.encode()).hexdigest())
    for migration,content in captured:
        if migration.startswith(('20261029033000_', '20261029034000_')):
            print('MIGRATION_SHA256',migration,hashlib.sha256(content.encode()).hexdigest())
    print(f'PASS: {len(captured)} migrations in isolated container; SQL fixture, two-session snapshot and synthetic XLSX; no receipt or HTTP tested')
finally:
    if reader is not None and reader.poll() is None:
        reader.kill()
        reader.wait(timeout=10)
    if created:
        run(['docker', 'rm', '-f', name], timeout=30)
        print('Isolated container removed:', name)
