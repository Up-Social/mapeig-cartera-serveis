"""Exercise the metadata-only inventory in a separate, networkless container.

The postgres:16-alpine image must already exist locally; no image is pulled.
This test creates and removes only its own uniquely named container.
"""
from pathlib import Path
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
name = 'mapeig-t19-audit-' + uuid.uuid4().hex[:12]
created = False
try:
    subprocess.run(['docker', 'run', '-d', '--pull', 'never', '--name', name,
        '--label', 'codex-test=t19-audit', '--network', 'none',
        '-e', 'POSTGRES_PASSWORD=synthetic', 'postgres:16-alpine'],
        check=True, stdout=subprocess.DEVNULL)
    created = True
    for _ in range(30):
        # The image starts a temporary socket-only server during initdb; wait
        # for the final server listening on loopback before seeding the test.
        if subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            break
        time.sleep(.5)
    else:
        raise RuntimeError('Postgres did not start')

    base = ['docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1']
    seed = '''
    create role anon; create role service_role; create role synthetic_writer;
    grant synthetic_writer to service_role;
    create table public.source_records(id int);
    alter table public.source_records enable row level security;
    grant select,insert on public.source_records to synthetic_writer;
    create function public.claim_provider_call() returns boolean language sql as 'select true';
    create function public.claim_provider_call(integer) returns boolean language sql as 'select true';
    revoke all on function public.claim_provider_call(integer) from public;
    create function public.local_reserve_matching_group() returns boolean language sql security definer as 'select true';
    revoke all on function public.local_reserve_matching_group() from public;
    '''
    subprocess.run(base, input=seed, text=True, check=True, capture_output=True)
    query = (root / 'scripts/matching-coordination-audit-readonly.sql').read_text()
    result = subprocess.run(base + ['-A', '-F', '|', '-t'], input='set role anon;\n' + query,
        text=True, check=True, capture_output=True)
    rows = [line.split('|') for line in result.stdout.splitlines()
        if line.startswith(('anon|', 'authenticated|', 'service_role|'))]
    tables = [row for row in rows if len(row) == 14]
    routines = [row for row in rows if len(row) == 7]
    assert len(tables) == 24 and len(routines) == 27, result.stdout
    source = next(row for row in tables if row[0] == 'service_role' and row[4] == 'source_records')
    assert source[5:] == ['t', 't', 'f', 't', 't', 'f', 'f', 'f', 'f'], source
    absent = next(row for row in tables if row[0] == 'service_role' and row[4] == 'provider_calls')
    assert absent[5] == 'f' and all(value == '' for value in absent[6:]), absent
    calls = [row for row in routines if row[0] == 'service_role' and row[2] == 'claim_provider_call']
    assert len(calls) == 2 and sorted(row[6] for row in calls) == ['f', 't'], calls
    private = next(row for row in routines if row[0] == 'service_role' and row[2] == 'local_reserve_matching_group')
    assert private[3] == 't' and private[5:] == ['t', 'f'], private
    assert all(row[1] == 'f' and all(value == '' for value in row[2:4] + row[8:])
        for row in tables if row[0] == 'authenticated')
    assert all(row[1] == 'f' and row[6] == '' for row in routines if row[0] == 'authenticated')
    print('PASS: inherited and PUBLIC grants, revoked overload, RLS flag, SECURITY DEFINER and missing role/table/routine')
finally:
    if created:
        subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)
