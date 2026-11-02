#!/usr/bin/env python3
"""Isolated test-only probe; starts and removes its own local PostgreSQL cluster.

No Docker, TCP listener, project DB, credentials, or real data. Installs a
minimal synthetic schema, the real link-validation trigger body, and the closed
candidate. This does NOT prove compatibility with the full application schema,
remote permissions, all writers, or physical source/document freshness.
"""
from __future__ import annotations

import os
import pwd
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
FIXTURES = ROOT / 'tests' / 'fixtures'
ENV = {'PATH': f'{BIN}:/usr/bin:/bin', 'HOME': '/private/tmp', 'LC_ALL': 'C', 'PGCONNECT_TIMEOUT': '3'}

def call(args: list[str], *, input_: str | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, input=input_, text=True, capture_output=True, env=ENV, timeout=30)
    if check and result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-1800:]}')
    return result

def run() -> None:
    for executable in ('initdb', 'pg_ctl', 'postgres', 'psql'):
        if not (BIN / executable).is_file():
            raise RuntimeError(f'Missing PostgreSQL 17 executable: {executable}')
    root = tempfile.TemporaryDirectory(prefix='mapeig-link-106-', dir='/private/tmp')
    directory = Path(root.name)
    data = directory / 'data'
    sock = directory / 'socket'
    sock.mkdir(mode=0o700)
    port = '55993'  # Socket is private; no TCP listener is created.
    started = False
    try:
        call([str(BIN / 'initdb'), '-D', str(data), '--auth=trust', '--no-instructions'])
        call([str(BIN / 'pg_ctl'), '-D', str(data), '-l', str(directory / 'postgres.log'), '-o',
              f"-h '' -k {sock} -p {port} -c fsync=off -c shared_buffers=8MB -c max_connections=12", '-w', 'start'])
        started = True
        psql = [str(BIN / 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-p', port, '-U', pwd.getpwuid(os.getuid()).pw_name, '-d', 'postgres']
        def query(sql: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
            return call(psql + ['-A', '-t', '-c', sql], check=check)
        def scalar(sql: str) -> str:
            return query(sql).stdout.strip()
        def wait_sleep(name: str) -> None:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if scalar(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event='PgSleep'") == '1':
                    return
                time.sleep(.05)
            raise RuntimeError(f'{name} did not enter expected hold')
        real_migration=(ROOT/'supabase/migrations/20261014220000_concert_economic_review.sql').read_text()
        body=re.search(r'create or replace function public\.validate_concert_unit_link\(\).*?end \$\$;', real_migration, re.I|re.S)
        if not body:
            raise RuntimeError('Cannot find the real validation trigger body')
        schema=(FIXTURES/'concert-link-fingerprint-minimal-schema.sql.txt').read_text()
        trigger="\ncreate trigger validate_concert_unit_link before insert or update on public.concert_unit_links for each row execute function public.validate_concert_unit_link();\n"
        setup=(FIXTURES/'concert-link-fingerprint-setup.sql.txt').read_text()
        candidate=(FIXTURES/'concert-link-fingerprint-candidate.sql.txt').read_text()
        checks=(FIXTURES/'concert-link-fingerprint-test.sql.txt').read_text()
        call(psql, input_=schema+'\n'+body.group(0)+trigger+setup+'\n'+candidate+'\n'+checks)
        print('PASS single-transaction assertions, historic NULL, source drift, rejected fingerprints and guard')
        # The first transaction rolled back. Re-seed a separate synthetic case
        # and install the test candidate in this disposable cluster only.
        call(psql, input_=setup+'\n'+candidate+'\ncreate table public.sandbox_test_ids as select * from concert_link_test_ids;\ncommit;')
        ident=lambda name: scalar(f"select id from public.sandbox_test_ids where name='{name}'")
        original, fresh, link = ident('original'), ident('fresh_unit'), ident('fresh_link')
        historic, historic_unit = ident('historic_link'), ident('historic_unit')
        fp=lambda id_: scalar(f"select source_fingerprint from public.concert_economic_source where id='{id_}'")
        early, before = fp(original), fp(fresh)
        hold_sql=f"set application_name='link106-source-first';begin;update public.record_units set reses_code='S99999' where id='{fresh}';select pg_sleep(2);commit;"
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        wait_sleep('link106-source-first')
        stale=query(f"select public.review_concert_link('{link}',1,'{before}','{early}','confirmed','Revisió sintètica anterior');",check=False)
        _, holder_err=holder.communicate(timeout=8)
        if holder.returncode: raise RuntimeError(f'First holder failed: {holder_err[-1000:]}')
        if stale.returncode == 0 or 'La línia ha canviat' not in stale.stderr:
            raise RuntimeError(f'Stale review was not rejected: {stale.stderr[-1000:]}')
        if scalar(f"select status||':'||(confirmed_later_fingerprint is null)::text from public.concert_unit_links where id='{link}'")!='candidate:true':
            raise RuntimeError('Stale review changed candidate or invented fingerprint')
        print('PASS source change before lock acquisition rejects stale review')
        current=fp(fresh)
        hold_sql=(f"set application_name='link106-review-first';begin;select public.review_concert_link('{link}',1,'{current}','{early}','confirmed','Revisió sintètica nova');"
                  "select pg_sleep(2);commit;")
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        wait_sleep('link106-review-first')
        start=time.monotonic()
        query(f"set lock_timeout='5s';update public.record_units set reses_code='S88888' where id='{fresh}';")
        elapsed=time.monotonic()-start
        _, holder_err=holder.communicate(timeout=8)
        if holder.returncode: raise RuntimeError(f'Second holder failed: {holder_err[-1000:]}')
        if elapsed<0.5: raise RuntimeError('Concurrent source update did not wait for review lock')
        if scalar(f"select (l.confirmed_later_fingerprint is distinct from v.source_fingerprint)::text from public.concert_unit_links l join public.concert_economic_source v on v.id=l.later_unit_id where l.id='{link}'")!='true':
            raise RuntimeError('Post-confirmation change did not make fingerprint stale')
        print('PASS review-first serializes the source update and produces detectable stale fingerprint')
        # Two reviewers using the same version must not both succeed. The
        # loser sees the committed version and cannot leave a permit behind.
        current=fp(fresh)
        hold_sql=(f"set application_name='link106-two-reviewers';begin;select public.review_concert_link('{link}',2,'{current}','{early}','confirmed','Primera revisió sintètica');"
                  "select pg_sleep(2);commit;")
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        wait_sleep('link106-two-reviewers')
        duplicate=query(f"select public.review_concert_link('{link}',2,'{current}','{early}','confirmed','Segona revisió sintètica');",check=False)
        _, holder_err=holder.communicate(timeout=8)
        if holder.returncode: raise RuntimeError(f'Review holder failed: {holder_err[-1000:]}')
        if duplicate.returncode==0 or 'Revisió obsoleta' not in duplicate.stderr:
            raise RuntimeError(f'Concurrent stale version was not rejected: {duplicate.stderr[-1000:]}')
        if scalar('select count(*) from concert_link_fingerprint_candidate.permits')!='0':
            raise RuntimeError('Concurrent review left a permit')
        print('PASS concurrent reviews use CAS and clean their permits')
        forged=query(f"set role service_role;update public.concert_unit_links set evidence='Canvi directe no revisat' where id='{link}';",check=False)
        if forged.returncode==0 or 'CONCERT_LINK_FINGERPRINT_REVIEW_REQUIRED' not in forged.stderr:
            raise RuntimeError(f'Direct evidence change was not rejected: {forged.stderr[-1000:]}')
        print('PASS service-role cannot change confirmed evidence directly')
        # No new confirmation is manufactured for historical links. Ordinary
        # legacy notes and cascading deletion remain functional in this schema.
        query(f"update public.concert_unit_links set review_note='Nota històrica sintètica' where id='{historic}';")
        if scalar(f"select (confirmed_later_fingerprint is null and confirmed_earlier_fingerprint is null)::text from public.concert_unit_links where id='{historic}'")!='true':
            raise RuntimeError('Historic update invented a fingerprint')
        query(f"delete from public.source_records where id=(select source_record_id from public.record_units where id='{historic_unit}');")
        if scalar(f"select count(*) from public.concert_unit_links where id='{historic}'")!='0':
            raise RuntimeError('Historic cascade did not delete synthetic link')
        print('PASS legacy NULL, note update and cascade in minimal schema')
    finally:
        if started:
            stopped=call([str(BIN/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=False)
            if stopped.returncode:
                raise RuntimeError(f'Failed to stop temporary PostgreSQL: {stopped.stderr[-1000:]}')
        root.cleanup()
        print('Temporary cluster removed')

if __name__=='__main__':
    run()
