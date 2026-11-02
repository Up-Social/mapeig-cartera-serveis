#!/usr/bin/env python3
"""Synthetic, private PostgreSQL probe for sealed migration candidate compatibility.

No Docker, TCP, existing database, real data, credentials or remote writes.
The simplified schema cannot certify compatibility with all product writers.
"""
from __future__ import annotations
import os,pwd,re,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BIN=Path('/opt/homebrew/opt/postgresql@17/bin');FIX=ROOT/'tests'/'fixtures'
ENV={'PATH':f'{BIN}:/usr/bin:/bin','HOME':'/private/tmp','LC_ALL':'C','PGCONNECT_TIMEOUT':'3'}
def call(args:list[str],*,input_:str|None=None,check:bool=True):
 result=subprocess.run(args,input=input_,text=True,capture_output=True,env=ENV,timeout=30)
 if check and result.returncode:raise RuntimeError(f'{args[0]} failed: {result.stderr[-1800:]}')
 return result
def run():
 tmp=tempfile.TemporaryDirectory(prefix='mapeig-link-109-',dir='/private/tmp');root=Path(tmp.name);data=root/'data';sock=root/'socket';sock.mkdir(mode=0o700);started=False
 try:
  call([str(BIN/'initdb'),'-D',str(data),'--auth=trust','--no-instructions'])
  call([str(BIN/'pg_ctl'),'-D',str(data),'-l',str(root/'postgres.log'),'-o',f"-h '' -k {sock} -p 55996 -c fsync=off -c shared_buffers=8MB -c max_connections=12",'-w','start']);started=True
  psql=[str(BIN/'psql'),'-X','-q','-v','ON_ERROR_STOP=1','-h',str(sock),'-p','55996','-U',pwd.getpwuid(os.getuid()).pw_name,'-d','postgres']
  def function(path,pattern):
   text=(ROOT/path).read_text();match=re.search(pattern+r'.*?\$\$;',text,re.I|re.S)
   if not match:raise RuntimeError(f'Missing function {pattern}')
   return match.group(0)
  schema=(FIX/'concert-link-fingerprint-minimal-schema.sql.txt').read_text()+'\n'+(FIX/'concert-link-document-v2-minimal-schema.sql.txt').read_text()
  validate=function('supabase/migrations/20261014220000_concert_economic_review.sql',r'create or replace function public\.validate_concert_unit_link\(\)')
  doc_hash=function('supabase/migrations/20261030046000_concert_population_events.sql',r'create function public\.concert_population_document_hash\(d public\.source_documents\)')
  trigger='\ncreate trigger validate_concert_unit_link before insert or update on public.concert_unit_links for each row execute function public.validate_concert_unit_link();\n'
  setup=(FIX/'concert-link-fingerprint-setup.sql.txt').read_text();baseline=(FIX/'concert-link-document-v3-baseline.sql.txt').read_text()
  v3=(ROOT/'supabase/migrations/20261102011000_concert_link_revision_guard_candidate.sql').read_text();closed=(FIX/'concert-link-document-v3-closed-test.sql.txt').read_text()
  call(psql,input_=schema+'\n'+validate+'\n'+doc_hash+trigger+setup+'\n'+baseline+'\n'+v3+'\n'+closed)
  print('PASS sealed disabled guard preserves legacy RPC OID/ACL and confirmation behavior; private activation unavailable')
  doc_setup=(FIX/'concert-link-document-v2-setup.sql.txt').read_text();v2test=(FIX/'concert-link-document-v2-test.sql.txt').read_text()
  forced='alter table concert_link_fingerprint_candidate.config drop constraint concert_link_activation_sealed; update concert_link_fingerprint_candidate.config set enabled=true;'
  call(psql,input_=setup+'\n'+doc_setup+'\n'+v3+'\n'+forced+'\n'+v2test)
  print('PASS privately forced enabled-branch fixture: historical pending, stale documents and confirmed snapshots')
 finally:
  if started:
   stopped=call([str(BIN/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=False)
   if stopped.returncode:raise RuntimeError(f'Failed to stop temporary PostgreSQL: {stopped.stderr[-1000:]}')
  tmp.cleanup();print('Temporary cluster removed')
if __name__=='__main__':run()
