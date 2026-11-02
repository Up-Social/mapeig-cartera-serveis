#!/usr/bin/env python3
"""Exercise a synthetic source/copy pair against disposable local Storage.

The test creates a dedicated Docker bridge and containers, never uses an
existing Supabase project, and removes only the resources it created. The
bridge is not egress-isolated; the test addresses only loopback and its own
database container, and binds Storage on loopback with the file backend.
"""
from pathlib import Path
import os
import signal
import subprocess
import sys
import time
import uuid

root = Path(__file__).resolve().parents[2]
tag = 'mapeig-t17-' + uuid.uuid4().hex[:12]
network, db, storage = tag + '-net', tag + '-db', tag + '-storage'
created = []
fixture_password = 'isolated-fixture-password-only'
fixture_secret = 'isolated-fixture-secret-only-with-at-least-32-characters'


def command(args, *, input_text=None):
    result = subprocess.run(args, input=input_text, text=True, capture_output=True, timeout=30)
    if result.returncode:
        # Don't print Docker configuration or credential-bearing arguments.
        raise RuntimeError(f'{args[0]} {args[1]} failed: {result.stderr[-1000:]}')
    return result.stdout.strip()


def interrupt(signum, _frame):
    raise RuntimeError(f'interrupted by signal {signum}')


signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGINT, interrupt)
try:
    command(['docker', 'network', 'create', network])
    created.append(('network', network))
    command(['docker', 'run', '-d', '--pull=never', '--name', db, '--network', network,
             '-e', f'POSTGRES_PASSWORD={fixture_password}', '-e', 'POSTGRES_DB=postgres',
             'public.ecr.aws/supabase/postgres:17.11.0.004'])
    created.append(('container', db))
    for _ in range(120):
        # The database starts accepting SQL before Supabase's init scripts
        # have created the Storage role. Wait for the role, not just psql.
        ready = subprocess.run(['docker', 'exec', db, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
                                "select 1 from pg_roles where rolname='supabase_storage_admin'"], capture_output=True, text=True, timeout=10)
        if ready.returncode == 0 and ready.stdout.strip() == '1':
            break
        time.sleep(.5)
    else:
        raise RuntimeError('isolated PostgreSQL did not start')
    command(['docker', 'exec', '-i', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
            input_text=f"alter role supabase_storage_admin password '{fixture_password}';")
    command(['docker', 'run', '-d', '--pull=never', '--name', storage, '--network', network,
             '-p', '127.0.0.1::5000', '-e', f'DATABASE_URL=postgres://supabase_storage_admin:{fixture_password}@{db}:5432/postgres',
             '-e', f'AUTH_JWT_SECRET={fixture_secret}', '-e', 'ANON_KEY=fixture-only', '-e', 'SERVICE_KEY=fixture-only',
             '-e', 'STORAGE_BACKEND=file', '-e', 'FILE_STORAGE_BACKEND_PATH=/tmp/storage',
             '-e', 'GLOBAL_S3_BUCKET=fixture', '-e', 'TENANT_ID=fixture', '-e', 'STORAGE_S3_REGION=fixture',
             '-e', 'FILE_SIZE_LIMIT=52428800', '-e', 'ENABLE_IMAGE_TRANSFORMATION=false',
             'public.ecr.aws/supabase/storage-api:v1.82.1'])
    created.append(('container', storage))
    port = ''
    for _ in range(20):
        mapped = subprocess.run(['docker', 'port', storage, '5000/tcp'], capture_output=True, text=True, timeout=10)
        if mapped.returncode == 0 and mapped.stdout.strip():
            port = mapped.stdout.strip().rsplit(':', 1)[-1]
            break
        time.sleep(.1)
    if not port:
        logs = subprocess.run(['docker', 'logs', storage], capture_output=True, text=True, timeout=10)
        diagnostic = (logs.stderr + logs.stdout).replace(fixture_password, '[redacted]').replace(fixture_secret, '[redacted]')
        print(diagnostic[-2000:], file=sys.stderr)
        raise RuntimeError('isolated Storage port not mapped')
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG') if key in os.environ}
    env.update({'T17_STORAGE_PORT': port, 'T17_STORAGE_DB': db, 'T17_FIXTURE_SECRET': fixture_secret})
    result = subprocess.run(['node', '--import', 'tsx', 'tests/sql/86-conveni-pinned-unit-copy-storage.ts'],
                            cwd=root, env=env, timeout=120)
    if result.returncode:
        raise RuntimeError(f'isolated Storage fixture failed with exit {result.returncode}')
finally:
    errors = []
    for kind, name in reversed(created):
        args = ['docker', 'rm', '-f', name] if kind == 'container' else ['docker', 'network', 'rm', name]
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        except subprocess.TimeoutExpired:
            errors.append(name)
            continue
        if result.returncode:
            errors.append(name)
    if errors:
        print('CLEANUP FAILED: ' + ', '.join(errors), file=sys.stderr)
        sys.exit(1)
