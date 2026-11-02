"""Two-session export-receipt locking test in a disposable local database.

This is not a test of the earlier paginated read, physical Excel bytes, or
delivery over HTTP. It never uses the project environment or remote services.
"""
from pathlib import Path
import subprocess
import select
import uuid

container = 'supabase_db_cartera-workflow-test'
database = 'batch_export_' + uuid.uuid4().hex[:12]
base = ['docker', 'exec', '-i', container]
created = False
holder_process = None


def run(args, data=None, timeout=30):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).decode()[-3000:])
    return result.stdout.decode()


def sql(text, timeout=10):
    return run(base + ['psql', '-U', 'postgres', '-d', database, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'], text.encode(), timeout)


def holder(statement):
    process = subprocess.Popen(base + ['psql', '-U', 'postgres', '-d', database, '-X', '-v', 'ON_ERROR_STOP=1', '-qAt'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        process.stdin.write('begin;\n' + statement + '\n\\echo LOCK_HELD\nselect pg_sleep(6);\nrollback;\n')
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], 10)
        if not ready:
            raise RuntimeError('holder did not acquire its lock within 10 seconds')
        line = process.stdout.readline()
        if line.strip() != 'LOCK_HELD':
            raise RuntimeError('holder did not report the expected lock marker')
        return process
    except BaseException:
        process.kill()
        process.wait(timeout=10)
        raise


def finish(process):
    process.stdin.close()
    process.wait(timeout=10)
    if process.returncode:
        raise RuntimeError(process.stderr.read()[-3000:])


def conflict(statement):
    try:
        sql("\\set VERBOSITY verbose\nset statement_timeout='2s';\n" + statement)
    except RuntimeError as error:
        if '55P03' not in str(error):
            raise RuntimeError('Expected lock-not-available: ' + str(error)) from error
    else:
        raise RuntimeError('Concurrent operation unexpectedly succeeded')


try:
    run(base + ['createdb', '-U', 'postgres', database]); created = True
    dump = subprocess.run(base + ['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-acl'],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30).stdout
    print('CLONE_COMPLETE', flush=True)
    dump = b'\n'.join(line for line in dump.splitlines() if not line.strip().startswith(b'SET log_min_messages'))
    run(base + ['psql', '-U', 'postgres', '-d', database, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], dump)
    # Apply the same current-view and receipt definitions used by the change.
    for migration in ['20261028220000_conveni_export_document_coverage.sql',
                      '20261029030000_batch_export_atomic_receipt.sql']:
        sql((Path('supabase/migrations') / migration).read_text())
    sql("""
      insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
       values('export-lock-fixture','https://example.invalid/','https://example.invalid/',now(),current_date,'fixed','notice','context','{}',1,true,true);
      insert into official_services(version_id,service_code,service_name,parent_code,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
       values('export-lock-fixture','1','Service',null,'service','Description','People','Conditions','Law','{}');
      insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
       values('a4000000-0000-0000-0000-000000000001','contractacions','export-lock-fixture','Contractació','Synthetic','{}');
      insert into pipeline_runs(id) values('a4000000-0000-0000-0000-000000000002');
      insert into pipeline_jobs(run_id,source_record_id,status)
       values('a4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','queued');
      insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
       values('a4000000-0000-0000-0000-000000000003','a4000000-0000-0000-0000-000000000001','fixture','Contractació','fixture','1','export-lock-fixture',100);
    """)
    receipt = "public.record_batch_export('a4000000-0000-0000-0000-000000000002','fixture.xlsx',repeat('a',64),array['a4000000-0000-0000-0000-000000000003'::uuid])"
    holder_process = holder("update service_provisions set amount=200 where id='a4000000-0000-0000-0000-000000000003';")
    try:
        conflict('select ' + receipt + ';')
        if sql('select count(*) from excel_exports; select count(*) from excel_export_items;').strip().splitlines() != ['0', '0']:
            raise RuntimeError('Contended export left a receipt or items')
    finally:
        finish(holder_process); holder_process = None

    # The export's own SHARE lock must also prevent a conflicting row update
    # until the receipt transaction ends; its rollback must leave no evidence.
    holder_process = holder('do $$ begin perform ' + receipt + '; end $$;')
    try:
        conflict("set lock_timeout='500ms'; update service_provisions set amount=300 where id='a4000000-0000-0000-0000-000000000003';")
    finally:
        finish(holder_process); holder_process = None
    if sql('select count(*) from excel_exports; select count(*) from excel_export_items; select amount from service_provisions;').strip().splitlines() != ['0', '0', '100.00']:
        raise RuntimeError('Rollback left a receipt, item or altered provision')
    print('PASS: NOWAIT prevents a receipt during a competing provision update; export lock and rollback preserve the fixture')
finally:
    if holder_process is not None:
        holder_process.kill()
        holder_process.wait(timeout=10)
    if created:
        result = subprocess.run(base + ['dropdb', '-U', 'postgres', '--force', database], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if result.returncode:
            raise RuntimeError('CLEANUP FAILED ' + database + ': ' + result.stderr.decode())
