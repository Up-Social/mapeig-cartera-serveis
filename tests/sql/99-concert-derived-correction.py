"""Synthetic PostgreSQL only. Creates and removes a network-isolated container."""
from pathlib import Path
import subprocess, json, time, uuid

root=Path(__file__).resolve().parents[2]
here=Path(__file__).resolve().parent
name='mapeig-concert-pop-'+uuid.uuid4().hex[:12]
started=False

def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=120)
 if p.returncode: raise RuntimeError(p.stderr[-3000:])
 return p.stdout

def sql(text,user='postgres'):
 return run(['docker','exec','-i',name,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],text)

def fixture(filename,body):
 original=(root/'tests/sql'/filename).read_text()
 anchor=' insert into pipeline_runs default values returning id into rid;'
 assert original.count(anchor)==1
 original=original.replace(anchor," insert into record_enrichments(source_record_id,target_population,summary,confidence,engine,engine_version) values(sid,'Població global de prova','Síntesi sintètica',1,'fixture','v1');\n"+anchor)
 assert original.count('end $$;')==1
 return original.replace('end $$;',body+'\nend $$;')

try:
 run(['docker','run','-d','--pull=never','--network=none','--name',name,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004'])
 started=True
 for _ in range(120):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(.5)
 else: raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 migrations=[]
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  migrations.append((f.name,f.read_text()))
 for name_,contents in migrations:
  try: sql('begin;\n'+contents+'\ncommit;')
  except Exception as exc: raise RuntimeError(name_+' '+str(exc)) from exc
 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")


 fixture=(here/'95-concert-population-event.sql').read_text().rstrip()
 ids=json.loads(sql(fixture[:-len('rollback;')]+'reset role;select row_to_json(f) from population_fixture f;commit;'))
 r,j,u,d=(ids[x] for x in ['record_id','job_id','unit_id','document_id'])
 event=str(uuid.uuid4());correction=str(uuid.uuid4());decision=str(uuid.uuid4());receipt=str(uuid.uuid4())
 parent='1.2.6.2.4.1';code=parent+'.1';sha='a'*64
 source=f'cases/{r}/documents/{d}/{sha}.pdf';item=f'cases/{r}/items/{u}/documents/{d}/{sha}.pdf'
 quote=f'Entitat A, servei {parent} STOI per a persones grans: import 12.000,00 €.'
 sql(f"""update pipeline_jobs set created_at='2000-01-01' where id='{ids['verification_job_id']}';
 insert into storage.objects(bucket_id,name,version) values('cloud-documents','{source}','v1'),('cloud-documents','{item}','v1');
 update source_documents set extracted_text=E'## Pàgina 1\\n{quote}',storage_path='{source}',storage_sha256='{sha}' where id='{d}';
 update record_units set pipeline_job_id=null,observed_service_code='{parent}',observed_provider_name='Entitat A',evidence_quote='{quote}',storage_path='{item}',storage_sha256='{sha}' where id='{u}';""")
 if sql("select has_table_privilege('service_role','public.documented_corrections','INSERT')").strip()!='f':raise RuntimeError('DIRECT_INSERT_STILL_GRANTED')
 if sql("select has_function_privilege('anon','public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text)','EXECUTE')").strip()!='f':raise RuntimeError('ANON_EXECUTE_GRANTED')
 try:
  sql('set role service_role;insert into public.documented_corrections default values;')
 except RuntimeError as e:
  if 'permission denied' not in str(e):raise
 else:raise RuntimeError('DIRECT_INSERT_ACCEPTED')
 try:
  sql(f"""set role service_role;select public.save_documented_correction('{r}','{j}','{uuid.uuid4()}',null,'{u}','service_code','{code}','{d}','{sha}:'||(select active_extraction_id::text from public.source_documents where id='{d}'),1,'cita inventada i no existent',false,'Correcció documental','Revisor prova');""")
 except RuntimeError as e:
  if 'La cita no consta al text' not in str(e):raise
 else:raise RuntimeError('INVALID_CORRECTION_EVIDENCE_ACCEPTED')
 sql(f"""set role service_role;select public.save_documented_correction('{r}','{j}','{correction}',null,'{u}','service_code','{code}','{d}','{sha}:'||(select active_extraction_id::text from public.source_documents where id='{d}'),1,'{quote}',false,'STOI i catàleg acreditats','Revisor prova');reset role;""")
 # A correction cannot be inserted while another operation holds the record.
 holder=subprocess.Popen(['docker','exec','-i',name,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  holder.stdin.write(f"begin;select id from public.source_records where id='{r}' for update;\n\\echo READY\n");holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise RuntimeError('LOCK_SESSION_FAILED '+holder.stderr.read())
   if line.strip()=='READY':break
  try:
   sql(f"""set lock_timeout='300ms';set role service_role;select public.save_documented_correction('{r}','{j}','{uuid.uuid4()}','{correction}','{u}','service_code','{code}','{d}','{sha}:'||(select active_extraction_id::text from public.source_documents where id='{d}'),1,'{quote}',false,'Nova correcció documental','Revisor prova');""")
  except RuntimeError as e:
   if 'lock timeout' not in str(e):raise
  else:raise RuntimeError('CONCURRENT_CORRECTION_NOT_FENCED')
 finally:
  holder.stdin.write('rollback;\n');holder.stdin.close()
  if holder.wait(timeout=10):raise RuntimeError(holder.stderr.read())
 sql(f"""do $$declare r uuid:='{r}';j uuid:='{j}';u uuid:='{u}';d uuid:='{d}';e uuid:='{event}';c uuid:='{correction}';x uuid:='{decision}';s jsonb;prev uuid;bad_event uuid:=gen_random_uuid();sourceobj uuid;itemobj uuid;receipt uuid:='{receipt}';snapshot jsonb;mixed jsonb;mreceipt uuid:=gen_random_uuid();oldreceipt uuid:=gen_random_uuid();oldmixed uuid:=gen_random_uuid();old_snapshot jsonb;pid uuid;begin
 select id into prev from concert_population_events where unit_id=u order by sequence desc limit 1;
 s:=concert_population_snapshot(r,j,u);
 perform concert_population_decide(r,j,u,e,prev,'unknown',null,d,s->>'revision',null,null,'Població pendent','Revisor prova',s->>'document_hash',s->>'unit_hash');
 select id into sourceobj from storage.objects where name='{source}';select id into itemobj from storage.objects where name='{item}';

 begin
  insert into documented_corrections(id,source_record_id,pipeline_job_id,unit_id,field,value,document_id,document_revision,page,evidence,visual_check,reason,reviewer)
  values(gen_random_uuid(),r,j,u,'service_code','{code}',d,'{sha}:'||(select active_extraction_id::text from source_documents where id=d),2,'{quote}',false,'Pàgina incorrecta','Revisor prova');
  s:=concert_population_snapshot(r,j,u);
  perform concert_population_decide(r,j,u,bad_event,e,'unknown',null,d,s->>'revision',null,null,'Població pendent','Revisor prova',s->>'document_hash',s->>'unit_hash');
  begin perform concert_line_award_decide(r,j,u,gen_random_uuid(),bad_event,'{code}','12.000,00','{quote}','Adjudicació contrastada','Revisor prova','{{"award":true,"recipient":true,"allocation":true}}',sourceobj,'v1',itemobj,'v1');raise exception 'WRONG_PAGE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'LINE_EVIDENCE' then raise;end if;end;
  raise exception 'ROLLBACK_WRONG_PAGE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_WRONG_PAGE' then raise;end if;end;
 perform concert_line_award_decide(r,j,u,x,e,'{code}','12.000,00','{quote}','Adjudicació contrastada','Revisor prova','{{"award":true,"recipient":true,"allocation":true}}',sourceobj,'v1',itemobj,'v1');
 if (select service_correction_id from concert_line_award_decisions where id=x) is distinct from c then raise exception 'MISSING_CORRECTION_ID';end if;
 if not exists(select 1 from concert_line_financing_projection where unit_id=u and service_code='{code}' and amount=12000) then raise exception 'DERIVED_NOT_VISIBLE';end if;
 snapshot:=concert_line_export_snapshot(array[x]);
 if snapshot->0->'snapshot'->>'service_correction_id' is distinct from c::text then raise exception 'EXPORT_CORRECTION_MISSING';end if;
 perform concert_line_export_commit(receipt,repeat('b',64),snapshot);
 select jsonb_agg(jsonb_set(value,'{{snapshot}}',(value->'snapshot')-'service_correction_id')) into old_snapshot from jsonb_array_elements(snapshot);
 insert into concert_line_export_receipts(id,content_hash) values(oldreceipt,repeat('d',64));
 insert into concert_line_export_items(receipt_id,decision_id,snapshot) values(oldreceipt,x,old_snapshot->0->'snapshot');
 if concert_line_export_commit(oldreceipt,repeat('d',64),old_snapshot)<>oldreceipt then raise exception 'OLD_REPLAY_FAILED';end if;
 begin perform concert_line_export_commit(oldreceipt,repeat('d',64),snapshot);raise exception 'OLD_RECONSTRUCTION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'ISOLATED_EXPORT_REPLAY_CONFLICT' then raise;end if;end;

 if (select i.snapshot->>'service_correction_id' from concert_line_export_items i where i.receipt_id=receipt) is distinct from c::text then raise exception 'RECEIPT_CORRECTION_MISSING';end if;
 select provision_id into pid from concert_line_award_decisions where id=x;
 mixed:=concert_line_mixed_snapshot(array[pid],true);
 if mixed->0->'snapshot'->>'service_correction_id' is distinct from c::text then raise exception 'MIXED_CORRECTION_MISSING';end if;
 perform concert_line_mixed_commit(mreceipt,repeat('c',64),mixed,true);
 select jsonb_agg(jsonb_set(value,'{{snapshot}}',(value->'snapshot')-'service_correction_id')) into old_snapshot from jsonb_array_elements(mixed);
 insert into concert_line_mixed_receipts(id,hash) values(oldmixed,repeat('e',64));
 insert into concert_line_mixed_items(receipt_id,provision_id,snapshot) values(oldmixed,pid,old_snapshot->0->'snapshot');
 if concert_line_mixed_commit(oldmixed,repeat('e',64),old_snapshot,true)<>oldmixed then raise exception 'OLD_MIXED_REPLAY_FAILED';end if;
 begin perform concert_line_mixed_commit(oldmixed,repeat('e',64),mixed,true);raise exception 'OLD_MIXED_RECONSTRUCTION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'MIXED_REPLAY_CONFLICT' then raise;end if;end;

 if (select i.snapshot->>'service_correction_id' from concert_line_mixed_items i where i.receipt_id=mreceipt) is distinct from c::text then raise exception 'MIXED_RECEIPT_CORRECTION_MISSING';end if;

 update source_documents set active_extraction_id=gen_random_uuid() where id=d;
 if exists(select 1 from concert_line_financing_projection where unit_id=u) then raise exception 'STALE_CORRECTION_VISIBLE';end if;
 if (select i.snapshot->>'service_correction_id' from concert_line_export_items i where i.receipt_id=receipt) is distinct from c::text then raise exception 'HISTORY_CHANGED';end if;
 end $$;""")
 for case in ['23-human-resolution.sql','24-complete-concert-annex.sql']:
  sql('begin;'+(here/case).read_text()+'rollback;')
 print('PASS: role-bound correction, derived line decision, projection, export receipts, stale source and pre-existing human resolution fixtures')

finally:
 if started:
  p=subprocess.run(['docker','rm','-f',name],capture_output=True,text=True,timeout=30)
  if p.returncode: raise RuntimeError('CLEANUP FAILED '+name+': '+p.stderr[-1000:])
