"""Run the 750 suite and the 760 fence races in one disposable, networkless DB.

This applies the test-only candidate fixture explicitly. It exercises
SQL coordination only; it is not a deployment, a real source read, a complete
review workflow or proof of absence of all deadlocks.
"""
from pathlib import Path

here=Path(__file__).resolve().parent
base=here/'104-conveni-bytea-candidate-isolated.py'
source=base.read_text()
marker="    concurrency_checks()\n"
assert source.count(marker)==1

extra=r'''
def fence_checks():
    """Two sessions: both lock orders plus a REPEATABLE READ stale snapshot."""
    sql((root/'tests/fixtures/conveni-bytea-fence.sql').read_text())
    r='00000000-0000-4000-8000-000000000201'
    j='00000000-0000-4000-8000-000000000202'
    u='00000000-0000-4000-8000-000000000203'
    attempt='00000000-0000-4000-8000-000000000204'
    doc='00000000-0000-4000-8000-000000000206'
    event='00000000-0000-4000-8000-000000000208'
    digest=hashlib.sha256(b'synthetic').hexdigest()
    plan=json.dumps({'archives':[{'documentId':doc,'source':{'sha256':digest}}]},separators=(',',':'))
    capture=f"set fixture.plan='{plan}'; select conveni_transactional_bytes_candidate.capture_plan('{r}','{j}','{u}','{attempt}');"
    review=f"insert into public.conveni_review_events(id,source_record_id,job_id,unit_id,outcome,reason,actor,snapshot) values('{event}','{r}','{j}','{u}','insufficient','fixture','fixture','{{}}');"
    move_type=f"update public.source_records set financing_type='concert' where id='{r}';"
    def start(prefix):
        p=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        lines=queue.Queue()
        threading.Thread(target=lambda:[lines.put(line.rstrip()) for line in p.stdout],daemon=True).start()
        try:
            p.stdin.write('\\set VERBOSITY verbose\n'+prefix+'\n\\echo FENCE_READY\n');p.stdin.flush()
            deadline=time.monotonic()+20
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise RuntimeError('fence fixture did not reach marker')
                if lines.get(timeout=remaining)=='FENCE_READY':break
            return p
        except BaseException:
            p.kill();p.wait(timeout=10);raise
    def finish(p,query,code=None):
        p.stdin.write(query+'\n\\q\n');p.stdin.flush();p.stdin.close();p.wait(timeout=20)
        err=p.stderr.read()
        if code is None and p.returncode:raise RuntimeError('fixture session failed: '+err[-1500:])
        if code is not None and (not p.returncode or code not in err):raise RuntimeError('expected '+code+': '+err[-1500:])
    def expect_error(query,code):
        try:sql('\\set VERBOSITY verbose\n'+query)
        except RuntimeError as exc:
            if code not in str(exc):raise
        else:raise AssertionError('expected '+code+' from '+query[:100])

    # Installation must fail closed if a same-named legacy trigger is absent,
    # disabled, points elsewhere or no longer covers every write operation.
    migration=(root/'tests/fixtures/conveni-bytea-fence-candidate.sql.txt').read_text()
    start_guard=migration.index('\ndo $$\n')+1
    end_guard=migration.index('\nend $$;',start_guard)+len('\nend $$;')
    preflight=migration[start_guard:end_guard]
    table='public.conveni_review_events';trigger='conveni_independent_fence_reviews'
    expect_error(f'begin; alter table {table} disable trigger {trigger}; '+preflight,'CONVENI_BYTES_EXISTING_FENCE_MISSING')
    expect_error(f'begin; drop trigger {trigger} on {table}; create trigger {trigger} before insert on {table} for each row execute function conveni_independent_experiment.fence_legacy_write(); '+preflight,'CONVENI_BYTES_EXISTING_FENCE_MISSING')
    expect_error(f'begin; drop trigger {trigger} on {table}; create trigger {trigger} before insert or update or delete on {table} for each row execute function public.guard_reserved_funding(); '+preflight,'CONVENI_BYTES_EXISTING_FENCE_MISSING')
    assert sql(f"select count(*) from pg_trigger where tgrelid='{table}'::regclass and tgname='{trigger}' and tgenabled='O' and tgtype=31 and tgfoid='conveni_independent_experiment.fence_legacy_write()'::regprocedure").strip()=='1'

    # Unrelated Concerts retain their previous REPEATABLE READ behavior, even
    # with the 730 guard enabled. This changes a fixture only and rolls back.
    sql("begin isolation level repeatable read; update public.service_provisions set amount=amount+1 where id='00000000-0000-4000-8000-000000000304'; rollback;")
    sql("begin isolation level repeatable read; update public.source_records set source_dataset='contractacions' where id='00000000-0000-4000-8000-000000000301'; rollback;")
    # Detect an incompatible prospective fence on generic review_decisions:
    # an unrelated Concert review update normally proceeds while its source
    # row is locked, but a blanket source NOWAIT trigger would reject it.
    other='00000000-0000-4000-8000-000000000301'
    decision='00000000-0000-4000-8000-000000000305'
    cascade_source='00000000-0000-4000-8000-000000000401'
    cascade_decision='00000000-0000-4000-8000-000000000402'
    sql(f"insert into public.review_decisions(id,source_record_id,decision,reason,reviewer) values('{decision}','{other}','insufficient_evidence','fixture','fixture');")
    sql(f"insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values('{cascade_source}','concerts','fixture-cascade','Concert','Fixture','concert'); insert into public.review_decisions(id,source_record_id,decision,reason,reviewer) values('{cascade_decision}','{cascade_source}','insufficient_evidence','fixture','fixture');")
    sql(f"begin; delete from public.source_records where id='{cascade_source}'; rollback;")
    baseline=start(f"begin; select id from public.source_records where id='{other}' for update;")
    try:sql(f"begin; update public.review_decisions set reason='changed' where id='{decision}'; rollback;")
    finally:finish(baseline,'rollback;')
    sql('create trigger zzzz_fixture_decision_fence before insert or update or delete on public.review_decisions for each row execute function conveni_bytea_legacy_fence_candidate.guard_economic_write();')
    try:
        held_source=start(f"begin; select id from public.source_records where id='{other}' for update;")
        try:expect_error(f"update public.review_decisions set reason='changed' where id='{decision}';",'55P03')
        finally:finish(held_source,'rollback;')
        expect_error(f"begin; delete from public.source_records where id='{cascade_source}';",'CONVENI_BYTES_SOURCE_MISSING')
    finally:sql('drop trigger zzzz_fixture_decision_fence on public.review_decisions;')
    print('CONFIRMED prospective blanket review_decisions fence changes Concert concurrency and breaks a source cascade; not installed',flush=True)
    # Config changes must not deadlock a Conveni writer holding its record;
    # unrelated Concert writes do not need the candidate's config lock.
    config_holder=start('begin; update conveni_preparation_guard_candidate.config set enabled=enabled where singleton;')
    try:
        expect_error(review,'55P03')
        sql("begin; update public.service_provisions set amount=amount+1 where id='00000000-0000-4000-8000-000000000304'; rollback;")
    finally:finish(config_holder,'rollback;')
    # Writer first: capture cannot pass the source lock; rollback removes the
    # simulated review. No remote or persisted user data is involved.
    writer=start('begin; '+review)
    try:expect_error("set lock_timeout='250ms'; "+capture,'55P03')
    finally:finish(writer,'rollback;')
    assert sql(f"select count(*) from public.conveni_review_events where id='{event}'").strip()=='0'
    # Capture first: existing legacy fence uses NOWAIT on the same record.
    holder=start('begin; '+capture)
    try:
        expect_error(review,'55P03')
        expect_error("set lock_timeout='250ms'; "+move_type,'55P03')
    finally:finish(holder,'rollback;')
    assert sql(f"select count(*) from conveni_transactional_bytes_candidate.plans where attempt_id='{attempt}'").strip()=='0'
    # Snapshot predates a committed plan. Record was only locked, not updated,
    # so RR must fail closed rather than miss the newly inserted plan.
    stale=start(f"begin isolation level repeatable read; select id from public.source_records where id='{r}';")
    sql(capture)
    finish(stale,review,'25001')
    expect_error(review,'CONVENI_BYTES_LEGACY_WRITER_BLOCKED')
    expect_error(move_type,'CONVENI_BYTES_TYPE_CHANGE_BLOCKED')
    print('PASS 760: both lock orders, stale RR rejected, blocked review/type and unrelated Concert RR',flush=True)

'''
top="\ntry:\n    run(['docker','run'"
assert source.count(top)==1
source=source.replace(top,'\n'+extra+top)
source=source.replace(marker,marker+'    fence_checks()\n')
install="    catalog=json.loads((root/'data/legal/cartera.json').read_text())\n"
assert source.count(install)==1
source=source.replace(install,"    candidate_path=root/'tests/fixtures/conveni-bytea-fence-candidate.sql.txt'\n    candidate_sql=candidate_path.read_text()\n    sql('begin;\\n'+candidate_sql+'\\ncommit;')\n    print('PASS test-only partial fence SHA-256',hashlib.sha256(candidate_sql.encode()).hexdigest(),flush=True)\n"+install)
exec(compile(source,str(base),'exec'),{'__file__':str(base),'__name__':'__main__'})
