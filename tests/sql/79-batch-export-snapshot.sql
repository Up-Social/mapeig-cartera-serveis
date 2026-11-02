-- Private snapshot experiment: no receipt, route, or physical Excel is tested.
do $$
declare run_ uuid:=gen_random_uuid();other_run uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();other_sid uuid:=gen_random_uuid();
 provision_ uuid:=gen_random_uuid();version_ text;code_ text;initial jsonb;changed jsonb;again jsonb;
begin
 if not exists(select 1 from catalog_versions where active and validated) then
  insert into catalog_versions(id,source_url,publication_url,retrieved_at,version_date,content_hash,legal_notice,general_context,provenance,entry_count,validated,active)
  values('snapshot-fixture','https://example.invalid','https://example.invalid',now(),current_date,'fixture','notice','context','{}',1,true,true);
  insert into official_services(version_id,service_code,service_name,benefit_type,description,target_population,conditions,legal_reference,normative_fields)
  values('snapshot-fixture','X','Synthetic','service','Description','Population','Conditions','Law','{}');
 end if;
 select version_id,service_code into strict version_,code_ from eligible_official_services limit 1;
 insert into pipeline_runs(id) values(run_),(other_run);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
 values(sid,'contractacions',sid::text,'Contractació','Synthetic','{}'),(other_sid,'contractacions',other_sid::text,'Contractació','Other','{}');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,sid,'queued'),(other_run,other_sid,'queued');
 insert into service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,amount)
 values(provision_,sid,'synthetic','Contractació','source',code_,version_,0);
 insert into record_units(source_record_id,unit_key,status) values(sid,'pending','draft');
 initial:=public.batch_export_snapshot_prototype(run_);
 if jsonb_array_length(initial#>'{body,jobs}')<>1 or jsonb_array_length(initial#>'{body,record_ids}')<>1
  or jsonb_array_length(initial#>'{body,provisions}')<>1 or jsonb_array_length(initial#>'{body,pending_units}')<>1
  or (initial#>>'{body,provisions,0,amount}')::numeric<>0
  or initial#>>'{body,provisions,0,official_services,service_name}' is null
  or initial->>'fingerprint' !~ '^batch-export-v1:[0-9a-f]{64}$'
 then raise exception 'TEST: snapshot projection or zero incorrect';end if;
 again:=public.batch_export_snapshot_prototype(run_);
 if again is distinct from initial then raise exception 'TEST: stable contents changed fingerprint';end if;
 update service_provisions set amount=123.45 where id=provision_;
 changed:=public.batch_export_snapshot_prototype(run_);
 if changed->>'fingerprint'=initial->>'fingerprint' or (changed#>>'{body,provisions,0,amount}')::numeric<>123.45
 then raise exception 'TEST: changed field not represented';end if;
 initial:=changed;
 update record_units set status='rejected' where source_record_id=sid and unit_key='pending';
 changed:=public.batch_export_snapshot_prototype(run_);
 if changed->>'fingerprint'=initial->>'fingerprint' or jsonb_array_length(changed#>'{body,pending_units}')<>0
 then raise exception 'TEST: pending change not represented';end if;
 initial:=changed;
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,other_sid,'queued');
 changed:=public.batch_export_snapshot_prototype(run_);
 if changed->>'fingerprint'=initial->>'fingerprint' or jsonb_array_length(changed#>'{body,record_ids}')<>2
 then raise exception 'TEST: batch membership change not represented';end if;
 if has_function_privilege('anon','public.batch_export_snapshot_prototype(uuid)','execute')
  or has_function_privilege('authenticated','public.batch_export_snapshot_prototype(uuid)','execute')
  or has_function_privilege('service_role','public.batch_export_snapshot_prototype(uuid)','execute')
 then raise exception 'TEST: private prototype exposed';end if;
end $$;

-- Exercise cardinality above the PostgREST page limit, deterministic order,
-- distinct zero and NULL amounts, pending-unit scope, and both name embeds.
-- The historical master-only row and HTTP embedding still need separate tests.
do $$
declare run_ uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); doc_ uuid:=gen_random_uuid();
 version_ text; code_ text; master_ text:='snapshot-master-'||sid; result_ jsonb; before_ text; missing_ jsonb;
begin
 select version_id,service_code into strict version_,code_ from eligible_official_services limit 1;
 insert into pipeline_runs(id) values(run_);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
  values(sid,'contractacions',sid::text,'Contractació','Synthetic','{}'),(outsider,'contractacions',outsider::text,'Contractació','Outsider','{}');
 insert into pipeline_jobs(run_id,source_record_id,status) values(run_,sid,'queued');
 insert into master_services(service_code,service_name,source_file,source_sheet,source_row,source_payload_hash)
  values(master_,'Nom Master sintètic','fixture','sheet',4,'fixture');
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256)
  values(doc_,sid,'https://example.invalid/fixture',doc_::text,'agreement','fetched',
   'cases/'||sid||'/documents/'||doc_||'/'||repeat('a',64)||'.pdf',repeat('a',64));
 insert into storage.objects(bucket_id,name)
  select 'cloud-documents','cases/'||sid||'/documents/'||doc_||'/'||repeat('a',64)||'.pdf'
  union all select 'cloud-documents','cases/'||sid||'/items/'||('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))||'/documents/'||doc_||'/'||repeat('a',64)||'.pdf' from generate_series(1,1001) i;
 insert into record_units(id,source_record_id,unit_key,status,document_id,storage_sha256,storage_path)
  select ('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,sid,'fixture-'||i,'approved',doc_,repeat('a',64),
   'cases/'||sid||'/items/'||('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))||'/documents/'||doc_||'/'||repeat('a',64)||'.pdf' from generate_series(1,1001) i;
 insert into service_provisions(id,unit_id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,historical_master_code,amount)
  select ('d4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
   ('c4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,sid,'fixture-'||i,
   'Contractació','source',code_,version_,master_,case when i=1 then null when i=2 then 0 else i end
  from generate_series(1,1001) i;
 insert into record_units(source_record_id,unit_key,status)
  values(sid,'pending-1','draft'),(sid,'pending-2','draft'),(sid,'rejected','rejected'),(outsider,'other-pending','draft');
 result_:=public.batch_export_snapshot_prototype(run_);
 if jsonb_array_length(result_#>'{body,provisions}')<>1001 or jsonb_array_length(result_#>'{body,pending_units}')<>2
 then raise exception 'TEST: projection truncated or pending scope incorrect';end if;
 if exists(
  select 1 from jsonb_array_elements(result_#>'{body,provisions}') row_
  join service_provisions p on p.id=(row_->>'id')::uuid
  cross join unnest(array['id','source_id','unit_id','centre','period','act_type','annex_reference','call_url',
   'regulatory_basis_url','provider_name','provider_nif','mechanism','award_date','amount','contracting_body',
   'target_population','source_reference','service_code']) field_
  where row_->field_ is distinct from to_jsonb(p)->field_
 ) then raise exception 'TEST: Excel projection differs from provision fields';end if;
 if exists(select 1 from (
   select (row_->>'id')::uuid as id,lag((row_->>'id')::uuid) over (order by ord) as previous
   from jsonb_array_elements(result_#>'{body,provisions}') with ordinality as a(row_,ord)
  ) sorted where previous>=id) then raise exception 'TEST: export order not deterministic';end if;
 if (result_#>'{body,provisions,0,amount}') <> 'null'::jsonb or (result_#>>'{body,provisions,1,amount}')::numeric<>0
 then raise exception 'TEST: NULL and zero collapsed';end if;
 if result_#>>'{body,provisions,0,official_services,service_name}' is distinct from
   (select service_name from official_services where version_id=version_ and service_code=code_)
  or result_#>>'{body,provisions,0,master_services,service_name}'<>'Nom Master sintètic'
 then raise exception 'TEST: names not embedded independently';end if;
 before_:=result_->>'fingerprint';
 update master_services set service_name='Nom Master modificat' where service_code=master_;
 result_:=public.batch_export_snapshot_prototype(run_);
 if result_->>'fingerprint'=before_ or result_#>>'{body,provisions,0,master_services,service_name}'<>'Nom Master modificat'
 then raise exception 'TEST: master name change not reflected';end if;
 before_:=result_->>'fingerprint';
 update official_services set service_name='Nom oficial modificat' where version_id=version_ and service_code=code_;
 result_:=public.batch_export_snapshot_prototype(run_);
 if result_->>'fingerprint'=before_ or result_#>>'{body,provisions,0,official_services,service_name}'<>'Nom oficial modificat'
 then raise exception 'TEST: official name change not reflected';end if;
 before_:=result_->>'fingerprint';
 update service_provisions set superseded_at=now() where id='d4000000-0000-4000-8000-000000001001';
 result_:=public.batch_export_snapshot_prototype(run_);
 if result_->>'fingerprint'=before_ or jsonb_array_length(result_#>'{body,provisions}')<>1000
 then raise exception 'TEST: superseded provision still exported';end if;
 missing_:=public.batch_export_snapshot_prototype(gen_random_uuid());
 if missing_#>'{body,run}' <> 'null'::jsonb or jsonb_array_length(missing_#>'{body,provisions}')<>0
 then raise exception 'TEST: absent batch represented incorrectly';end if;
end $$;
