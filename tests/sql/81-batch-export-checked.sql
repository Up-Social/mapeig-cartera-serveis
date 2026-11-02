-- Private prototype test. The caller supplies a claimed Excel hash; neither
-- physical bytes nor HTTP delivery are verified here.
do $$
declare run_ uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();pid uuid:=gen_random_uuid();version_ text;code_ text;fp_ text;receipt_ uuid;before_ bigint;
begin
 -- Enumerate direct/transitive view relations. SQL/PLpgSQL function bodies
 -- can hide extra relations, so this catalog check is not a complete audit.
 if exists(with recursive deps(relid) as (
   select 'public.conveni_reviewed_provisions'::regclass::oid
   union
   select d.refobjid from deps x
   join pg_rewrite rw on rw.ev_class=x.relid
   join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=rw.oid and d.refclassid='pg_class'::regclass
   join pg_class c on c.oid=d.refobjid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m')
  )
  select 1 from deps join pg_class c on c.oid=deps.relid
  where c.relkind in ('r','p') and c.relname <> all(array['conveni_analyses','conveni_review_events','conveni_unit_proposals',
   'master_services','official_services','pipeline_jobs','pipeline_runs','record_units','review_decisions',
   'service_provisions','source_documents','source_records'])
 ) then raise exception 'TEST: view dependency not covered by prototype lock set';end if;
 if not exists(select 1 from catalog_versions where active and validated) then
  insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
   values('export-check-fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixture','notice','context','{}',1,true,true);
  insert into official_services(version_id,service_code,service_name,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
   values('export-check-fixture','X','Synthetic','service','Description','Population','Conditions','Law','{}');
 end if;
 select version_id,service_code into strict version_,code_ from eligible_official_services limit 1;
 insert into pipeline_runs(id) values(run_);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
  values(sid,'contractacions',sid::text,'Contractació','Synthetic','{}');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,sid,'queued');
 insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
  values(pid,sid,'synthetic','Contractació','source',code_,version_,0);
 fp_:=public.batch_export_snapshot_prototype(run_)->>'fingerprint';
 receipt_:=public.record_batch_export_snapshot_prototype(run_,fp_,'fixture.xlsx',repeat('a',64));
 if not exists(select 1 from excel_exports where id=receipt_ and content_hash=repeat('a',64) and provision_count=1)
  or not exists(select 1 from excel_export_items where export_id=receipt_ and provision_id=pid)
 then raise exception 'TEST: receipt mismatch';end if;
 select count(*) into before_ from excel_exports;
 update service_provisions set amount=100 where id=pid;
 begin
  perform public.record_batch_export_snapshot_prototype(run_,fp_,'stale.xlsx',repeat('a',64));
  raise exception 'TEST: stale field accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from excel_exports)<>before_ then raise exception 'TEST: stale receipt created';end if;
 fp_:=public.batch_export_snapshot_prototype(run_)->>'fingerprint';
 insert into record_units(source_record_id,unit_key,status) values(sid,'pending','draft');
 begin
  perform public.record_batch_export_snapshot_prototype(run_,fp_,'pending.xlsx',repeat('a',64));
  raise exception 'TEST: stale pending units accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from excel_exports)<>before_ then raise exception 'TEST: pending receipt created';end if;
 begin
  perform public.record_batch_export_snapshot_prototype(run_,'batch-export-v1:'||repeat('0',64),'invalid.xlsx',repeat('a',64));
  raise exception 'TEST: incorrect fingerprint accepted';
 exception when serialization_failure then null;end;
 if has_function_privilege('anon','public.record_batch_export_snapshot_prototype(uuid,text,text,text)','execute')
  or has_function_privilege('authenticated','public.record_batch_export_snapshot_prototype(uuid,text,text,text)','execute')
  or has_function_privilege('service_role','public.record_batch_export_snapshot_prototype(uuid,text,text,text)','execute')
 then raise exception 'TEST: prototype exposed';end if;
end $$;

-- Historical Conveni visibility depends on latest review_decisions, even
-- without a row in conveni_analyses. Its change must invalidate a capture.
do $$
declare run_ uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();version_ text;code_ text;fp_ text;before_ bigint;
begin
 select version_id,service_code into strict version_,code_ from eligible_official_services limit 1;
 insert into pipeline_runs(id) values(run_);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload,processing_status)
  values(sid,'convenis',sid::text,'Conveni','Synthetic','{}','completat');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,sid,'queued');
 insert into review_decisions(source_record_id,decision,created_at) values(sid,'approved',now());
 insert into service_provisions(source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
  values(sid,'synthetic','Conveni','source',code_,version_,100);
 if jsonb_array_length(public.batch_export_snapshot_prototype(run_)#>'{body,provisions}')<>1
 then raise exception 'TEST: historical conveni not visible';end if;
 fp_:=public.batch_export_snapshot_prototype(run_)->>'fingerprint';
 select count(*) into before_ from excel_exports;
 insert into review_decisions(source_record_id,decision,created_at) values(sid,'rejected',now()+interval '1 second');
 if jsonb_array_length(public.batch_export_snapshot_prototype(run_)#>'{body,provisions}')<>0
 then raise exception 'TEST: rejected historical conveni still visible';end if;
 begin
  perform public.record_batch_export_snapshot_prototype(run_,fp_,'stale-review.xlsx',repeat('a',64));
  raise exception 'TEST: stale review accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from excel_exports)<>before_ then raise exception 'TEST: stale historical review left receipt';end if;
end $$;
