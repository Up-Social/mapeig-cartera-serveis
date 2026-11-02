#!/usr/bin/env python3
"""Test-only isolated PostgreSQL 17 probe for the exact sealed migration candidate under concurrent review.

Starts and removes its own local cluster; private Unix socket, no TCP, no
Docker, no existing DB, no credentials, and synthetic data only. The schema is
minimal: this cannot validate complete application migrations or Storage bytes.
"""
from __future__ import annotations

import json
import os
import pwd
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BIN=Path('/opt/homebrew/opt/postgresql@17/bin')
FIX=ROOT/'tests'/'fixtures'
ENV={'PATH':f'{BIN}:/usr/bin:/bin','HOME':'/private/tmp','LC_ALL':'C','PGCONNECT_TIMEOUT':'3'}

def call(args:list[str],*,input_:str|None=None,check:bool=True)->subprocess.CompletedProcess[str]:
    result=subprocess.run(args,input=input_,text=True,capture_output=True,env=ENV,timeout=30)
    if check and result.returncode: raise RuntimeError(f'{args[0]} failed: {result.stderr[-1800:]}')
    return result

def run()->None:
    for name in ('initdb','pg_ctl','postgres','psql'):
        if not (BIN/name).is_file(): raise RuntimeError(f'Missing PostgreSQL 17 executable: {name}')
    tmp=tempfile.TemporaryDirectory(prefix='mapeig-link-110-',dir='/private/tmp')
    root=Path(tmp.name);data=root/'data';sock=root/'socket';sock.mkdir(mode=0o700);started=False
    try:
        call([str(BIN/'initdb'),'-D',str(data),'--auth=trust','--no-instructions'])
        call([str(BIN/'pg_ctl'),'-D',str(data),'-l',str(root/'postgres.log'),'-o',f"-h '' -k {sock} -p 55997 -c fsync=off -c shared_buffers=8MB -c max_connections=12",'-w','start']);started=True
        psql=[str(BIN/'psql'),'-X','-q','-v','ON_ERROR_STOP=1','-h',str(sock),'-p','55997','-U',pwd.getpwuid(os.getuid()).pw_name,'-d','postgres']
        def query(sql:str,*,check:bool=True)->subprocess.CompletedProcess[str]: return call(psql+['-A','-t','-c',sql],check=check)
        def scalar(sql:str)->str:return query(sql).stdout.strip()
        def wait_sleep(name:str)->None:
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                if scalar(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event='PgSleep'")=='1':return
                time.sleep(.05)
            raise RuntimeError(f'{name} did not reach hold')
        def function(path:str,signature:str)->str:
            text=(ROOT/path).read_text();body=re.search(signature+r'.*?\$\$;',text,re.I|re.S)
            if not body:raise RuntimeError(f'Missing actual function {signature}')
            return body.group(0)
        schema=(FIX/'concert-link-fingerprint-minimal-schema.sql.txt').read_text()
        doc_schema=(FIX/'concert-link-document-v2-minimal-schema.sql.txt').read_text()
        validate=function('supabase/migrations/20261014220000_concert_economic_review.sql',r'create or replace function public\.validate_concert_unit_link\(\)')
        doc_hash=function('supabase/migrations/20261030046000_concert_population_events.sql',r'create function public\.concert_population_document_hash\(d public\.source_documents\)')
        trigger='\ncreate trigger validate_concert_unit_link before insert or update on public.concert_unit_links for each row execute function public.validate_concert_unit_link();\n'
        setup=(FIX/'concert-link-fingerprint-setup.sql.txt').read_text()
        doc_setup=(FIX/'concert-link-document-v2-setup.sql.txt').read_text()
        candidate=(ROOT/'supabase/migrations/20261102011000_concert_link_revision_guard_candidate.sql').read_text()
        import hashlib
        expected='d9b7e4b77792130542a431364c7e71b889350b7c6a3efe2c38e6593471870cab'
        if hashlib.sha256(candidate.encode()).hexdigest()!=expected:raise RuntimeError('Candidate hash changed; aborting')
        forced="alter table concert_link_fingerprint_candidate.config drop constraint concert_link_activation_sealed; update concert_link_fingerprint_candidate.config set enabled=true;"
        call(psql,input_=schema+'\n'+doc_schema+'\n'+validate+'\n'+doc_hash+trigger+setup+'\n'+doc_setup+'\n'+candidate+'\n'+forced+'\ncreate table public.sandbox_test_ids as select * from concert_link_test_ids;\ncommit;')
        print('Candidate hash verified; forced activation is synthetic and confined to this temporary database')
        def ident(name:str)->str:return scalar(f"select id from public.sandbox_test_ids where name='{name}'")
        link=ident('fresh_link');doc=ident('fresh_unit_document')
        def snapshot()->dict:return json.loads(scalar(f"select concert_link_fingerprint_candidate.document_review_snapshot('{link}')::text"))
        def confirm(s:dict)->str:
            return ("select concert_link_fingerprint_candidate.document_review_confirm("
                    f"'{link}',{s['version']},'{s['laterUnitFingerprint']}','{s['earlierUnitFingerprint']}',"
                    f"'{s['laterDocument']}','{s['laterDocumentHash']}','{s['earlierDocument']}','{s['earlierDocumentHash']}',"
                    "'Revisió sintètica documental');")
        s=snapshot()
        hold_sql=("set application_name='link110-document-first';begin;"
                  f"update public.source_documents set extracted_text='text modificat',extracted_text_hash=encode(extensions.digest(convert_to('text modificat','UTF8'),'sha256'),'hex'),active_extraction_id=gen_random_uuid() where id='{doc}';"
                  "select pg_sleep(2);commit;")
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV);wait_sleep('link110-document-first')
        start=time.monotonic();blocked=query(confirm(s),check=False);elapsed=time.monotonic()-start
        _,err=holder.communicate(timeout=8)
        if holder.returncode:raise RuntimeError(f'Document holder failed: {err[-1000:]}')
        if blocked.returncode==0 or 'could not obtain lock' not in blocked.stderr or elapsed>1.5:raise RuntimeError(f'Document lock did not fail fast: {blocked.stderr[-1000:]}')
        stale=query(confirm(s),check=False)
        if stale.returncode==0 or 'CONCERT_LINK_DOCUMENT_CHANGED' not in stale.stderr:raise RuntimeError('Changed document accepted stale snapshot')
        print('PASS document-first: NOWAIT and stale snapshot rejection')
        s=snapshot();hold_sql="set application_name='link110-review-first';begin;"+confirm(s)+"select pg_sleep(2);commit;"
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV);wait_sleep('link110-review-first')
        start=time.monotonic();query(f"set lock_timeout='5s';update public.source_documents set active_extraction_id=gen_random_uuid() where id='{doc}';");elapsed=time.monotonic()-start
        _,err=holder.communicate(timeout=8)
        if holder.returncode:raise RuntimeError(f'Review holder failed: {err[-1000:]}')
        if elapsed<0.5:raise RuntimeError('Document update did not wait for review lock')
        if scalar(f"select (l.confirmed_later_document_hash is distinct from public.concert_population_document_hash(d))::text from public.concert_unit_links l join public.source_documents d on d.id=l.confirmed_later_document_id where l.id='{link}'")!='true':raise RuntimeError('Post-review change not detected')
        print('PASS review-first: document update waits and makes the snapshot stale')
        s=snapshot();hold_sql="set application_name='link110-cas';begin;"+confirm(s)+"select pg_sleep(2);commit;"
        holder=subprocess.Popen(psql+['-c',hold_sql],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV);wait_sleep('link110-cas')
        competing=query(confirm(s),check=False)
        _,err=holder.communicate(timeout=8)
        if holder.returncode:raise RuntimeError(f'First reviewer failed: {err[-1000:]}')
        if competing.returncode==0 or 'CONCERT_LINK_DOCUMENT_VERSION' not in competing.stderr:raise RuntimeError(f'Concurrent stale reviewer was accepted: {competing.stderr[-1000:]}')
        print('PASS simultaneous reviewers: one version accepted, competing old version rejected')

    finally:
        if started:
            stopped=call([str(BIN/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=False)
            if stopped.returncode:raise RuntimeError(f'Failed to stop temporary PostgreSQL: {stopped.stderr[-1000:]}')
        tmp.cleanup();print('Temporary cluster removed')

if __name__=='__main__':run()
