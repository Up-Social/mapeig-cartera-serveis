"""Exercise real candidate 750 in a networkless, disposable PostgreSQL.

Tests both the real 730 plan generator with synthetic Storage metadata and a
separate synthetic plan. No physical Storage, app routes or real data are used.
"""
from pathlib import Path
import hashlib, json, queue, subprocess, threading, time, uuid

root=Path(__file__).resolve().parents[2]
fixture=root/'tests/fixtures/conveni-bytea-candidate.sql'
real_plan=root/'tests/fixtures/conveni-bytea-real-plan.sql'
name='mapeig-750-'+uuid.uuid4().hex[:12]
started=False

def run(args,content=None):
    result=subprocess.run(args,input=content,text=True,capture_output=True,timeout=120)
    if result.returncode:raise RuntimeError(f'{args[0]} failed: {result.stdout[-1500:]} {result.stderr[-3500:]}')
    return result.stdout

def sql(content,user='postgres'):
    return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],content)

def concurrency_checks():
    """Test actual SQL row locks in two connections; no physical Storage."""
    r='00000000-0000-4000-8000-000000000101'
    j='00000000-0000-4000-8000-000000000102'
    d='00000000-0000-4000-8000-000000000107'
    u='00000000-0000-4000-8000-000000000110'
    attempt='00000000-0000-4000-8000-000000000111'
    event='00000000-0000-4000-8000-000000000113'
    digest=hashlib.sha256(b'synthetic').hexdigest()
    plan=json.dumps({'archives':[{'documentId':d,'source':{'sha256':digest}}]},separators=(',',':'))
    items=json.dumps([{'documentId':d,'base64':'c3ludGhldGlj'}],separators=(',',':'))
    setup="set fixture.plan='"+plan+"';"
    scope="'"+"','".join((r,j,u,attempt))+"'"
    prefix='conveni_transactional_bytes_candidate.'
    capture=f'select {prefix}capture_plan({scope});'
    commit=f"select {prefix}commit_batch({scope},'{event}','{items}'::jsonb);"
    inspect=f'select {prefix}inspect_attempt({scope});'
    verify=f"select {prefix}verify_batch({scope},'{event}');"

    def held(statement):
        process=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        lines=queue.Queue()
        def collect():
            for line in process.stdout:lines.put(line.rstrip())
        threading.Thread(target=collect,daemon=True).start()
        try:
            process.stdin.write('begin;\n'+setup+'\n'+statement+'\n\\echo LOCK_ACQUIRED\n')
            process.stdin.flush()
            deadline=time.monotonic()+20
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise RuntimeError('fixture lock holder did not acquire lock')
                if lines.get(timeout=remaining)=='LOCK_ACQUIRED':break
            return process
        except BaseException:
            process.kill();process.wait(timeout=10);raise

    def release(process):
        process.stdin.write('rollback;\n\\q\n');process.stdin.flush()
        process.stdin.close();process.wait(timeout=20);stderr=process.stderr.read()
        if process.returncode:raise RuntimeError('fixture lock holder failed: '+stderr[-1000:])

    def blocked(statement):
        try:sql('\\set VERBOSITY verbose\nset lock_timeout=\'250ms\';\n'+setup+'\n'+statement)
        except RuntimeError as exc:
            if '55P03' not in str(exc) or '40P01' in str(exc):raise
        else:raise AssertionError('contending operation unexpectedly completed')

    holder=held(capture)
    try:
        for operation in (capture,commit,inspect):blocked(operation)
    finally:release(holder)
    state=json.loads(sql(inspect));assert state['planCaptured'] is False and state['eventId'] is None and state['state']=='pending_reconciliation'
    assert json.loads(sql(setup+capture))['replay'] is False

    holder=held(commit)
    try:
        for operation in (commit,inspect,verify):blocked(operation)
    finally:release(holder)
    state=json.loads(sql(inspect));assert state['planCaptured'] is True and state['eventId'] is None and state['current'] is False
    assert json.loads(sql(setup+commit))['historicalReplay'] is False

    holder=held(inspect)
    try:
        for operation in (capture,verify):blocked(operation)
    finally:release(holder)
    state=json.loads(sql(inspect));assert state['eventId']==event and len(state['documents'])==1 and state['current'] is False
    checked=json.loads(sql(setup+verify));assert checked['bytesVerified'] is True and checked['physicalSourceVerified'] is False
    print('PASS two-session capture, commit and inspection contention; uncommitted plan and batch roll back',flush=True)

try:
    run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004'])
    started=True
    for _ in range(120):
        if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('fixture database startup timeout')
    sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
    paths=sorted((root/'supabase/migrations').glob('*.sql'))
    if not any(p.name=='20261030075000_conveni_transactional_bytes_candidate.sql' for p in paths):raise RuntimeError('real migration 750 not found')
    contents={path:path.read_text() for path in paths}
    for path in paths:
        try:sql('begin;\n'+contents[path]+'\ncommit;')
        except Exception as exc:raise RuntimeError(path.name+': '+str(exc)) from exc
    candidate=next(p for p in paths if p.name=='20261030075000_conveni_transactional_bytes_candidate.sql')
    print('PASS migrations',len(paths),'750 SHA-256',hashlib.sha256(contents[candidate].encode()).hexdigest(),flush=True)
    catalog=json.loads((root/'data/legal/cartera.json').read_text())
    quote=lambda value:json.dumps(value,ensure_ascii=False).replace("'","''")
    sql("select install_official_catalog('"+quote(catalog['version'])+"'::jsonb,'"+quote(catalog['services'])+"'::jsonb);")
    print(sql('begin;\n'+real_plan.read_text()+'\nrollback;'),flush=True)
    print('PASS actual 730 copy plan with synthetic Storage metadata',flush=True)
    print(sql(fixture.read_text()),flush=True)
    print('PASS candidate 750 with synthetic plan; no HTTP or physical Storage',flush=True)
    concurrency_checks()
finally:
    if started:
        result=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
        if result.returncode:raise RuntimeError('could not remove own fixture container '+name)
        print('CLEANUP own fixture container removed',flush=True)
