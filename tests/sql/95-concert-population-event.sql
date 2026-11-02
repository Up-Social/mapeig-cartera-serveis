begin;
create temporary table population_fixture(record_id uuid,job_id uuid,unit_id uuid,document_id uuid,event_id uuid,verification_job_id uuid);
grant select on population_fixture to service_role;
do $$
declare r uuid:=gen_random_uuid();j uuid;vj uuid;runid uuid;verifyrun uuid;d uuid;u uuid;ev uuid:=gen_random_uuid(); sha text:=repeat('a',64); q text:='Línia de prova per al servei de persones grans.';
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,financing_type)
 values(r,'concerts','synthetic-'||r,'Concert','Prova sintètica','concert');
 insert into public.pipeline_runs default values returning id into runid;
 insert into public.pipeline_jobs(run_id,source_record_id,status) values(runid,r,'needs_review') returning id into j;
 insert into public.pipeline_runs default values returning id into verifyrun;
 insert into public.pipeline_jobs(run_id,source_record_id,status,verification_only,created_at) values(verifyrun,r,'needs_review',true,now()+interval '1 second') returning id into vj;
 insert into public.source_documents(source_record_id,url,url_hash,document_type,status,extracted_text,text_length,extraction_partial,storage_path,storage_sha256)
 values(r,'https://fixture.invalid/document','hash-'||r,'annex','fetched',E'## Pàgina 1\n'||q,length(q),false,'fixture',sha) returning id into d;
 insert into public.record_units(source_record_id,pipeline_job_id,unit_key,act_type,document_id,page,evidence_quote,status,amount)
 values(r,j,'synthetic-line','award',d,1,q,'draft',12000) returning id into u;
 insert into population_fixture values(r,j,u,d,ev,vj);
end $$;
set local role service_role;
do $$
declare f record;s jsonb;event2 uuid:=gen_random_uuid();v uuid;begin
 select * into f from population_fixture;
 s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
 if s->'event'<>'null'::jsonb then raise exception 'UNEXPECTED_EVENT';end if;
 begin perform public.concert_population_snapshot(f.record_id,f.verification_job_id,f.unit_id);raise exception 'TEST_VERIFICATION_JOB_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'POP_JOB' then raise;end if;end;
 v:=public.concert_population_decide(f.record_id,f.job_id,f.unit_id,f.event_id,null,'unknown',null,f.document_id,s->>'revision',null,null,'Població no identificada','Revisor',s->>'document_hash',s->>'unit_hash');
 if v<>f.event_id then raise exception 'UNKNOWN_NOT_SAVED';end if;
 if public.concert_population_decide(f.record_id,f.job_id,f.unit_id,f.event_id,null,'unknown',null,f.document_id,s->>'revision',null,null,'Població no identificada','Revisor',s->>'document_hash',s->>'unit_hash')<>v then raise exception 'REPLAY_CHANGED';end if;
 s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
 if s->'event'->>'decision'<>'unknown' or s->'event'->>'matches_recorded_fingerprints'<>'true' then raise exception 'UNKNOWN_NOT_MATCHING';end if;
 begin
  perform public.concert_population_decide(f.record_id,f.job_id,f.unit_id,event2,null,'unknown',null,f.document_id,s->>'revision',null,null,'Població no identificada','Revisor',s->>'document_hash',s->>'unit_hash');
  raise exception 'TEST_PREVIOUS_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'POP_PREVIOUS' then raise;end if;end;
 begin perform public.concert_population_snapshot(gen_random_uuid(),f.job_id,f.unit_id);raise exception 'TEST_SCOPE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'POP_SCOPE' then raise;end if;end;
 v:=public.concert_population_decide(f.record_id,f.job_id,f.unit_id,event2,f.event_id,'confirmed','persones grans',f.document_id,s->>'revision',1,'Línia de prova per al servei de persones grans.','Població contrastada','Revisor',s->>'document_hash',s->>'unit_hash');
 s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
 if s->'event'->>'decision'<>'confirmed' or s->'event'->>'value'<>'persones grans' or s->'event'->>'matches_recorded_fingerprints'<>'true' then raise exception 'CONFIRMED_NOT_MATCHING';end if;
 begin perform public.concert_population_decide(f.record_id,f.job_id,f.unit_id,v,f.event_id,'confirmed','Gent gran',f.document_id,s->>'revision',1,'Línia de prova per al servei de persones grans.','Població contrastada','Revisor',s->>'document_hash',s->>'unit_hash');raise exception 'TEST_REPLAY_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'POP_EVENT_CONFLICT' then raise;end if;end;
end $$;
reset role;
do $$
declare f record;s jsonb;change text;code text;catalog text;provision uuid;runid uuid;receipt uuid;begin
 select * into f from population_fixture;
 if (select amount from public.record_units where id=f.unit_id)<>12000 or exists(select 1 from public.service_provisions where source_record_id=f.record_id) then raise exception 'DECISION_CHANGED_FINANCING';end if;
 if has_table_privilege('service_role','public.concert_population_events','INSERT') or has_table_privilege('service_role','public.concert_population_events','UPDATE') or has_function_privilege('anon','public.concert_population_snapshot(uuid,uuid,uuid)','EXECUTE') then raise exception 'UNEXPECTED_GRANT';end if;
 if not (select relrowsecurity from pg_class where oid='public.concert_population_events'::regclass) then raise exception 'RLS_NOT_ENABLED';end if;
 -- Counterexample: a direct line provision without a global review would be
 -- visible to Master and accepted by batch export while Aprobados excludes the
 -- record. Keep it inside a rolled-back subtransaction, never in the product.
 begin
  select service_code,version_id into strict code,catalog from public.eligible_official_services limit 1;
  select run_id into strict runid from public.pipeline_jobs where id=f.job_id;
  insert into storage.objects(bucket_id,name) values('cloud-documents','synthetic/item-copy');
  update public.record_units set storage_path='synthetic/item-copy',storage_sha256=repeat('a',64) where id=f.unit_id;
  insert into public.service_provisions(unit_id,source_record_id,source_id,provider_name,mechanism,amount,source_reference,service_code,catalog_version_id)
   values(f.unit_id,f.record_id,'synthetic','Entitat sintètica','Concert',12000,'fixture',code,catalog) returning id into provision;
  if not exists(select 1 from public.conveni_reviewed_provisions where id=provision) then raise exception 'MASTER_DIVERGENCE_NOT_REPRODUCED';end if;
  if (select processing_status from public.source_records where id=f.record_id)='completat' then raise exception 'FIXTURE_GLOBAL_APPROVED';end if;
  receipt:=public.record_batch_export(runid,'synthetic.xlsx',repeat('a',64),array[provision]);
  if receipt is null then raise exception 'BATCH_DIVERGENCE_NOT_REPRODUCED';end if;
  raise no_data_found;
 exception when no_data_found then null;end;
 foreach change in array array[
  'quantity=5','quantity_delta=2','period=''2027''','effective_start=''2027-01-01''',
  'effective_end=''2027-12-31''','territory=''Barcelona''','observed_provider_name=''Altra entitat''',
  'storage_path=''other/path''','storage_sha256=repeat(''b'',64)','amount=12001',
  'provider_name=''Altra entitat''','pipeline_job_id=null'
 ] loop
  begin
   execute 'update public.record_units set '||change||' where id=$1' using f.unit_id;
   s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
   if s->'event'->>'matches_recorded_fingerprints'<>'false' then raise exception 'UNCHANGED_LINE_HASH: %',change;end if;
   raise no_data_found;
  exception when no_data_found then null;end;
 end loop;
 update public.pipeline_jobs set status='insufficient_evidence' where id=f.job_id;
 s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
 if s->'event'->>'matches_recorded_fingerprints'<>'true' then raise exception 'INSUFFICIENT_JOB_HID_OBSERVATION';end if;
 update public.source_documents set extracted_text=extracted_text||' Text addicional.' where id=f.document_id;
end $$;
set local role service_role;
do $$
declare f record;s jsonb;begin
 select * into f from population_fixture;
 s:=public.concert_population_snapshot(f.record_id,f.job_id,f.unit_id);
 if s->'event'->>'matches_recorded_fingerprints'<>'false' then raise exception 'STALE_MARKED_MATCHING';end if;
end $$;
rollback;
