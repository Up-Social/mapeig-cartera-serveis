"""Synthetic read-only export embeddings on disposable PostgreSQL/PostgREST."""
from pathlib import Path
import json,subprocess,time,uuid,sys
root=Path(__file__).resolve().parents[3]
tag='mapeig-poprest-'+uuid.uuid4().hex[:12];network=tag+'-net';pg=tag+'-db';rest=tag+'-rest';created=[]
def run(args,data=None):
 p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=100)
 if p.returncode:raise RuntimeError('command failed: '+(p.stderr+p.stdout)[-2000:])
 return p.stdout.strip()
def sql(s,user='postgres'):
 return run(['docker','exec','-i',pg,'psql','-U',user,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],s)
try:
 run(['docker','network','create','--internal',network]);created.append(('network',network))
 run(['docker','run','-d','--pull=never','--name',pg,'--network',network,'-e','POSTGRES_PASSWORD=fixture','public.ecr.aws/supabase/postgres:17.11.0.004']);created.append(('container',pg))
 for _ in range(120):
  try:
   if subprocess.run(['docker','exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0 and sql('select 1')=='1':break
  except RuntimeError:pass
  time.sleep(.5)
 else:raise RuntimeError('DB timeout')
 sql('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text,version text,archived_at timestamptz);grant usage on schema storage to postgres,service_role;grant select,insert,update on storage.buckets to postgres;grant select,insert,update,delete on storage.objects to postgres;grant select on storage.objects to service_role;','supabase_admin')
 for f in sorted((root/'supabase/migrations').glob('*.sql')):
  if f.name.split('_',1)[0] in {'20261029031000','20261029032000','20261029033000','20261029034000','20261029043000'}:continue
  try:sql('begin;\n'+f.read_text()+'\ncommit;')
  except Exception as e:raise RuntimeError(f.name+' '+str(e))
 exp=Path(__file__).resolve().parent

 catalog=json.loads((root/'data/legal/cartera.json').read_text())
 sql("update public.app_settings set enabled=true where key='processing_enabled';select public.install_official_catalog($json$"+json.dumps(catalog['version'],ensure_ascii=False)+"$json$::jsonb,$json$"+json.dumps(catalog['services'],ensure_ascii=False)+"$json$::jsonb);")
 fixture=(root/'tests/sql/95-concert-population-event.sql').read_text().rstrip()
 assert fixture.endswith('rollback;')
 ids=json.loads(sql(fixture[:-len('rollback;')]+'reset role;select row_to_json(f) from population_fixture f;commit;'))
 sql('grant execute on function public.concert_line_export_snapshot(uuid[]),public.concert_line_export_commit(uuid,text,jsonb),public.concert_line_combined_provisions(),public.concert_line_combined_approved(),public.concert_line_approved(public.service_provisions),public.concert_line_award_archive_snapshot(uuid,uuid,uuid),public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid) to service_role;')
 fixture=(exp/'candidate-520-fixture.sql').read_text()
 for marker,key in [('__RECORD__','record_id'),('__JOB__','job_id'),('__UNIT__','unit_id'),('__DOC__','document_id')]:fixture=fixture.replace(marker,ids[key])
 sql(fixture)
 sql("""begin;do $$declare r uuid:='{record}';j uuid:='{job}';u public.record_units;d public.source_documents;x public.concert_line_award_decisions;e uuid;new_pop uuid:=gen_random_uuid();new_pop2 uuid:=gen_random_uuid();new_decision uuid:=gen_random_uuid();s jsonb;receipt uuid:=gen_random_uuid();snapshot jsonb;history jsonb;begin
 select * into u from public.record_units where source_record_id=r and unit_key='synthetic-line-2';
 select * into x from public.concert_line_award_decisions where unit_id=u.id and job_id=j;
 if public.concert_line_evolution_states(array[u.id])->0->>'state'<>'current' then raise exception 'EVOLUTION_CURRENT_MISSING';end if;
 s:=public.concert_population_snapshot(r,j,u.id);e:=(s->'event'->>'id')::uuid;
 perform public.concert_population_decide(r,j,u.id,new_pop,e,'confirmed','suport',u.document_id,s->>'revision',u.page,u.evidence_quote,'Població contrastada després','Revisor',s->>'document_hash',s->>'unit_hash');
 if (select sum(amount) from public.concert_line_financing_projection where source_record_id=r)<>25000
 or (select target_population from public.concert_line_financing_projection where unit_id=u.id)<>'suport' then raise exception 'POPULATION_UPDATE_LOST_FINANCING';end if;
 snapshot:=public.concert_line_export_snapshot(array[x.id]);
 perform public.concert_line_export_commit(receipt,repeat('a',64),snapshot);
 select i.snapshot into history from public.concert_line_export_items i where i.receipt_id=receipt and i.decision_id=x.id;
 update public.source_documents set extracted_text=extracted_text||' canvi' where id=u.document_id;
 if public.concert_line_evolution_states(array[u.id])->0->>'state'<>'stale' then raise exception 'EVOLUTION_STALE_MISSING';end if;
 if exists(select 1 from public.concert_line_financing_projection where unit_id=u.id) then raise exception 'STALE_FINANCING_VISIBLE';end if;
 s:=public.concert_population_snapshot(r,j,u.id);
 perform public.concert_population_decide(r,j,u.id,new_pop2,new_pop,'unknown',null,u.document_id,s->>'revision',null,null,'Població pendent després de canvi','Revisor',s->>'document_hash',s->>'unit_hash');
 perform public.concert_line_award_decide(r,j,u.id,new_decision,new_pop2,x.service_code,x.amount_literal,x.evidence_quote,'Nova revisió de font','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);
 if public.concert_line_evolution_states(array[u.id])->0->>'state'<>'current' then raise exception 'EVOLUTION_REOPEN_MISSING';end if;
 if (select count(*) from public.concert_line_award_decisions where unit_id=u.id and job_id=j)<>2 or (select finance_id from public.concert_line_financing_projection where unit_id=u.id) is distinct from (select provision_id from public.concert_line_award_decisions where id=new_decision) then raise exception 'REOPEN_FAILED';end if;
 if (select i.snapshot from public.concert_line_export_items i where i.receipt_id=receipt and i.decision_id=x.id) is distinct from history then raise exception 'REOPEN_CHANGED_HISTORIC_RECEIPT';end if;
 begin perform public.concert_line_award_decide(r,j,u.id,gen_random_uuid(),new_pop2,x.service_code,x.amount_literal,x.evidence_quote,'Revisió concurrent','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);raise exception 'OLD_CAS_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'LINE_PREVIOUS' then raise;end if;end;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id']))
 sql("""begin;do $$declare r uuid:='{record}';j uuid:='{job}';u uuid:='{unit}';p uuid;code text;v text;begin
 select service_code,version_id into code,v from public.eligible_official_services limit 1;
 insert into public.review_decisions(source_record_id,pipeline_job_id,decision,reviewer) values(r,j,'approved','Fixture');
 update public.source_records set processing_status='completat' where id=r;
 insert into public.service_provisions(unit_id,source_record_id,source_id,mechanism,amount,source_reference,service_code,catalog_version_id)
 values(u,r,'fixture','Concert',12000,'fixture',code,v) returning id into p;
 if (select count(*) from public.concert_line_financing_projection where unit_id=u)<>1
  or (select finance_id from public.concert_line_financing_projection where unit_id=u)<>p then raise exception 'SAME_UNIT_DOUBLE_COUNT';end if;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id'],unit=ids['unit_id']))

 sql("""begin;do $$declare r uuid:='{record}';oldj uuid:='{job}';newj uuid;runid uuid;u public.record_units;x public.concert_line_award_decisions;s jsonb;event_ uuid:=gen_random_uuid();next_ uuid:=gen_random_uuid();archive jsonb;hist_count integer;other_ uuid;other_record uuid:=gen_random_uuid();other_unit uuid;begin
 select * into u from public.record_units where source_record_id=r and unit_key='synthetic-line-2';
 select * into x from public.concert_line_award_decisions where unit_id=u.id and job_id=oldj;
 select count(*) into hist_count from public.concert_line_award_decisions where unit_id=u.id;
 insert into public.pipeline_runs default values returning id into runid;
 insert into public.pipeline_jobs(run_id,source_record_id,status,created_at) values(runid,r,'needs_review',now()+interval '2 seconds') returning id into newj;
 if exists(select 1 from public.concert_line_financing_projection where unit_id=u.id) then raise exception 'OLD_LINE_VISIBLE_NEW_JOB';end if;
 s:=public.concert_population_snapshot(r,newj,u.id);
 if s->'event'<>'null'::jsonb then raise exception 'OLD_POPULATION_IN_NEW_JOB';end if;
 perform public.concert_population_decide(r,newj,u.id,event_,null,'unknown',null,u.document_id,s->>'revision',null,null,'Població pendent nou treball','Revisor',s->>'document_hash',s->>'unit_hash');
 archive:=public.concert_line_award_archive_snapshot(r,newj,u.id);
 if archive->>'previous_decision'<>x.id::text then raise exception 'PREVIOUS_DECISION_NOT_AVAILABLE';end if;
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(other_record,'concerts','separate-'||other_record,'Concert','Expedient independent','concert');
 insert into public.record_units(source_record_id,unit_key,act_type) values(other_record,'separate-line','award') returning id into other_unit;
 begin perform public.concert_line_award_decide(r,newj,other_unit,gen_random_uuid(),event_,x.service_code,x.amount_literal,x.evidence_quote,'Línia aliena','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);raise exception 'OTHER_RECORD_UNIT_ALLOWED';exception when no_data_found then null;end;
 select id into strict other_ from public.concert_line_award_decisions where source_record_id=r and unit_id<>u.id limit 1;
 begin perform public.concert_line_award_decide(r,newj,u.id,gen_random_uuid(),event_,x.service_code,x.amount_literal,x.evidence_quote,'Predecessor aliè','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,other_);raise exception 'OTHER_LINE_PREDECESSOR_ALLOWED';exception when raise_exception then if sqlerrm<>'LINE_PREVIOUS' then raise;end if;end;
 perform public.concert_line_award_decide(r,newj,u.id,next_,event_,x.service_code,x.amount_literal,x.evidence_quote,'Nova revisió nou treball','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);
 if (select count(*) from public.concert_line_award_decisions where unit_id=u.id)<>hist_count+1 then raise exception 'HISTORY_NOT_PRESERVED';end if;
 if (select count(*) from public.concert_line_financing_projection where unit_id=u.id)<>1 or (select amount from public.concert_line_financing_projection where unit_id=u.id)<>u.amount then raise exception 'NEW_REVIEW_PROJECTION';end if;
 if (select previous_id from public.concert_line_award_decisions where id=next_) is distinct from x.id then raise exception 'NEW_REVIEW_PREDECESSOR';end if;
 perform public.concert_line_award_decide(r,newj,u.id,next_,event_,x.service_code,x.amount_literal,x.evidence_quote,'Nova revisió nou treball','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);
 begin perform public.concert_line_award_decide(r,newj,u.id,gen_random_uuid(),event_,x.service_code,x.amount_literal,x.evidence_quote,'Duplicat antic','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);raise exception 'STALE_PREDECESSOR_ALLOWED';exception when raise_exception then if sqlerrm<>'LINE_PREVIOUS' then raise;end if;end;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id']))

 sql("""begin;do $$declare r uuid:='{record}';oldj uuid:='{job}';newj uuid;runid uuid;u public.record_units;x public.concert_line_award_decisions;s jsonb;event_ uuid:=gen_random_uuid();next_ uuid:=gen_random_uuid();q_new text;begin
 select * into u from public.record_units where source_record_id=r and unit_key='synthetic-line-2';
 select * into x from public.concert_line_award_decisions where unit_id=u.id and job_id=oldj;
 insert into public.pipeline_runs default values returning id into runid;
 insert into public.pipeline_jobs(run_id,source_record_id,status,created_at) values(runid,r,'needs_review',now()+interval '2 seconds') returning id into newj;
 q_new:=replace(u.evidence_quote,'13.000,00','14.000,00');
 update public.source_documents set extracted_text=replace(extracted_text,u.evidence_quote,q_new) where id=u.document_id;
 update public.record_units set amount=14000,evidence_quote=q_new where id=u.id;
 if exists(select 1 from public.concert_line_financing_projection where unit_id=u.id) then raise exception 'STALE_PRIOR_VISIBLE';end if;
 s:=public.concert_population_snapshot(r,newj,u.id);
 perform public.concert_population_decide(r,newj,u.id,event_,null,'unknown',null,u.document_id,s->>'revision',null,null,'Població pendent nou treball','Revisor',s->>'document_hash',s->>'unit_hash');
 begin perform public.concert_line_award_decide(r,newj,u.id,gen_random_uuid(),event_,x.service_code,x.amount_literal,x.evidence_quote,'Import antic','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);raise exception 'STALE_AMOUNT_ACCEPTED';exception when raise_exception then if sqlerrm<>'LINE_EVIDENCE' then raise;end if;end;
 perform public.concert_line_award_decide(r,newj,u.id,next_,event_,x.service_code,'14.000,00',q_new,'Import nou contrastat','Revisor',x.confirmations,x.source_object_id,x.source_version,x.item_object_id,x.item_version,x.id);
 if (select amount from public.concert_line_financing_projection where unit_id=u.id)<>14000 or (select amount from public.concert_line_award_decisions where id=x.id)<>13000 or (select previous_id from public.concert_line_award_decisions where id=next_) is distinct from x.id then raise exception 'SOURCE_CHANGE_NOT_REVIEWED';end if;
 end $$;rollback;""".format(record=ids['record_id'],job=ids['job_id']))
 line_ids=sql("select jsonb_agg(id order by id) from public.concert_line_award_decisions where source_record_id='"+ids['record_id']+"'")
 sql("create role isolated_http login password 'fixture';grant anon,authenticated,service_role to isolated_http;")
 bundle=Path('/private/tmp/isolated-export-'+uuid.uuid4().hex+'.cjs')
 run([str(root/'node_modules/esbuild/bin/esbuild'),str(exp/'reopen-rest-runner.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(bundle)])
 run(['docker','run','-d','--pull=never','--name',rest,'--network',network,'-e',f'PGRST_DB_URI=postgres://isolated_http:fixture@{pg}:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET=private-synthetic-projection-secret-0000000000000000','public.ecr.aws/supabase/postgrest:v16.4']);created.append(('container',rest))
 for _ in range(40):
  p=subprocess.run(['docker','exec',pg,'curl','-sS','--max-time','2',f'http://{rest}:3000/'],capture_output=True,text=True)
  if p.returncode==0 and p.stdout.startswith('{'):break
  time.sleep(.5)
 else:raise RuntimeError('PostgREST timeout')
 output=run(['docker','run','--rm','--pull=never','--network','container:'+rest,'--entrypoint','node','-v',str(bundle)+':/endpoint.cjs:ro','public.ecr.aws/supabase/storage-api:v1.82.1','/endpoint.cjs',line_ids])
 result=json.loads(output)
 if result['status']!=200 or result['stale']!=409 or not result['anonBlocked']:raise RuntimeError('handler outcome '+output)
 if sql("select count(*) from public.concert_line_export_receipts")!='1' or sql("select count(*) from public.concert_line_export_items")!='2':raise RuntimeError('receipt count incorrect')
 if sql("select count(*) from public.service_provisions where source_record_id='"+ids['record_id']+"'")!='0':raise RuntimeError('shared provision created')

 cross=json.loads(sql("""create temporary table cross_fixture(data jsonb);do $$declare r uuid:='{record}';oldj uuid:='{job}';newj uuid;runid uuid;u public.record_units;x public.concert_line_award_decisions;s jsonb;event_ uuid:=gen_random_uuid();begin
 select * into u from public.record_units where source_record_id=r and unit_key='synthetic-line-2';
 select * into x from public.concert_line_award_decisions where unit_id=u.id and job_id=oldj;
 insert into public.pipeline_runs default values returning id into runid;
 insert into public.pipeline_jobs(run_id,source_record_id,status,created_at) values(runid,r,'needs_review',now()+interval '2 seconds') returning id into newj;
 s:=public.concert_population_snapshot(r,newj,u.id);
 perform public.concert_population_decide(r,newj,u.id,event_,null,'unknown',null,u.document_id,s->>'revision',null,null,'Població pendent nou treball','Revisor',s->>'document_hash',s->>'unit_hash');
 insert into cross_fixture values(jsonb_build_object('record',r,'job',newj,'unit',u.id,'event',event_,'previous',x.id,'code',x.service_code,'quote',x.evidence_quote));
 end $$;select data from cross_fixture;""".format(record=ids['record_id'],job=ids['job_id'])))
 cross_bundle=Path('/private/tmp/cross-award-'+uuid.uuid4().hex+'.cjs')
 run([str(root/'node_modules/esbuild/bin/esbuild'),str(exp/'cross-job-award-rest-runner.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(cross_bundle)])
 outcome=json.loads(run(['docker','run','--rm','--pull=never','--network','container:'+rest,'--entrypoint','node','-v',str(cross_bundle)+':/cross.cjs:ro','public.ecr.aws/supabase/storage-api:v1.82.1','/cross.cjs',json.dumps(cross)]))
 if outcome['arrivals']!=3 or sorted(outcome['statuses'])!=[200,409] or outcome['replay']!=200:raise RuntimeError('cross job CAS '+json.dumps(outcome))
 if sql("select count(*) from public.concert_line_award_decisions where unit_id='"+cross['unit']+"'")!='2':raise RuntimeError('cross job duplicated or lost history')
 if sql("select count(*) from public.concert_line_financing_projection where unit_id='"+cross['unit']+"'")!='1':raise RuntimeError('cross job projection mismatch')
 print('PASS cross-job handler/PostgREST service_role, anon denial, two concurrent CAS submissions and replay; Storage byte verification mocked')
 print('PASS private HTTP handler with real PostgREST/PG: XLSX hash, receipt, stale rejection and anon denial')

finally:
 if 'bundle' in globals():bundle.unlink(missing_ok=True)
 if 'cross_bundle' in globals():cross_bundle.unlink(missing_ok=True)
 errors=[]
 for kind,resource in reversed(created):
  p=subprocess.run(['docker','rm','-f',resource] if kind=='container' else ['docker','network','rm',resource],capture_output=True,text=True,timeout=30)
  if p.returncode:errors.append(resource)
 if errors:
  print('CLEANUP FAILED: '+', '.join(errors),file=sys.stderr)
  sys.exit(1)
