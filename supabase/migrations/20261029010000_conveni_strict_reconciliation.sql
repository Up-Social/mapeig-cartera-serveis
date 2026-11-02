-- Read-only mathematical diagnosis. This is not an approval or a finalization:
-- a future committing transaction must repeat it while holding its locks.
create function public.conveni_strict_reconciliation(p_record uuid,p_job uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare r public.source_records;a public.conveni_analyses;item record;prepared record;
 expected numeric;allocated numeric:=0;remainder numeric;amount_ numeric;difference numeric;
 proposal_count integer;input_units jsonb;proposal_units jsonb;entries jsonb:='[]'::jsonb;
begin
 select * into r from public.source_records where id=p_record;
 select * into a from public.conveni_analyses where job_id=p_job and source_record_id=p_record;
 if r.id is null or a.job_id is null or r.financing_type<>'conveni'
  or p_job is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1)
  or a.source_hash is distinct from public.conveni_source_hash(p_record)
 then return jsonb_build_object('status','pending','reason','STALE_ANALYSIS');end if;
 if a.payload->'coverage_complete' is distinct from 'true'::jsonb or jsonb_typeof(a.document_revisions) is distinct from 'object'
  or exists(select 1 from public.source_documents sd where sd.source_record_id=p_record and sd.document_type in ('agreement','annex')
   and (sd.status<>'fetched' or sd.extraction_partial is not false or sd.storage_sha256 is null or sd.storage_path is null
    or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or a.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
  or exists(select 1 from jsonb_each_text(case when jsonb_typeof(a.document_revisions)='object' then a.document_revisions else '{}'::jsonb end) rev
   left join public.source_documents sd on sd.id::text=rev.key where sd.id is null or sd.source_record_id<>p_record
    or coalesce(sd.document_type,'') not in ('agreement','annex') or sd.status<>'fetched' or sd.extraction_partial is not false
    or sd.storage_sha256 is null or sd.storage_path is null or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
 then return jsonb_build_object('status','pending','reason','INCOMPLETE_COVERAGE');end if;
 if jsonb_typeof(a.payload->'units') is distinct from 'array' then return jsonb_build_object('status','pending','reason','INVALID_PROPOSALS');end if;
 select count(*),jsonb_agg(cp.data order by cp.data::text) into proposal_count,proposal_units
 from public.conveni_unit_proposals cp where cp.job_id=p_job;
 select jsonb_agg(value order by value::text) into input_units from jsonb_array_elements(a.payload->'units');
 if proposal_count<1 or proposal_count>500 or proposal_units is distinct from input_units
  or exists(select 1 from public.conveni_unit_proposals cp left join public.record_units ru on ru.id=cp.unit_id
   where cp.job_id=p_job and (ru.id is null or ru.source_record_id<>p_record or coalesce(cp.data->>'key','')='' or ru.unit_key is distinct from 'conveni:'||(cp.data->>'key')))
 then return jsonb_build_object('status','pending','reason','PROPOSALS_CHANGED');end if;
 if exists(select 1 from public.conveni_unit_proposals cp where cp.job_id=p_job and
  (public.conveni_identity_words(cp.data->>'recipient')='' or
   (cp.data->>'year' is not null and case when jsonb_typeof(cp.data->'year')='number' and (cp.data->>'year') ~ '^[0-9]{4}$' then (cp.data->>'year')::integer not between 1900 and 2200 else true end)))
 then return jsonb_build_object('status','pending','reason','INVALID_IDENTITY_OR_YEAR');end if;
 -- Same NIF or same normalized name and equal/unknown years may overlap. The
 -- diagnostic only treats two different explicit years as disjoint when each
 -- period is exactly that year; otherwise a human must resolve overlap.
 if exists(select 1 from public.conveni_unit_proposals x join public.conveni_unit_proposals y on y.job_id=x.job_id and y.unit_id>x.unit_id
  where x.job_id=p_job and (
   (coalesce(x.data->>'recipient_nif','')<>'' and regexp_replace(upper(x.data->>'recipient_nif'),'[[:space:]-]','','g')=regexp_replace(upper(coalesce(y.data->>'recipient_nif','')),'[[:space:]-]','','g'))
   or public.conveni_identity_words(x.data->>'recipient')=public.conveni_identity_words(y.data->>'recipient'))
  and (x.data->>'year' is null or y.data->>'year' is null or x.data->>'year'=y.data->>'year'
   or coalesce(trim(x.data->>'period'),'')<>x.data->>'year' or coalesce(trim(y.data->>'period'),'')<>y.data->>'year'))
 then return jsonb_build_object('status','pending','reason','POSSIBLE_PERIOD_OVERLAP');end if;
 expected:=public.conveni_public_amount(r.source_payload)*100;
 if expected is null or jsonb_typeof(a.payload->'unallocated_cents') is distinct from 'number'
  or coalesce(a.payload->>'unallocated_cents','') !~ '^[0-9]+$'
 then return jsonb_build_object('status','pending','reason','UNKNOWN_TOTAL_OR_REMAINDER');end if;
 remainder:=(a.payload->>'unallocated_cents')::numeric;
 if remainder>9007199254740991 then return jsonb_build_object('status','pending','reason','AMOUNT_OVERFLOW');end if;
 for item in select cp.unit_id,cp.data from public.conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id loop
  if jsonb_typeof(item.data->'concepts')='array' and jsonb_array_length(case when jsonb_typeof(item.data->'concepts')='array' then item.data->'concepts' else '[]'::jsonb end)>0 then
   select gp.preparation_id,gp.preparation_is_current,gp.amount_cents,gp.sequence,gp.group_hash,gp.analysis_hash
   into prepared from public.conveni_group_preparations gp where gp.job_id=p_job and gp.unit_id=item.unit_id;
   if not found or prepared.preparation_id is null or prepared.preparation_is_current is distinct from true
    then return jsonb_build_object('status','pending','reason','GROUP_PREPARATION_STALE_OR_MISSING','unit_id',item.unit_id);end if;
   amount_:=prepared.amount_cents;
   entries:=entries||jsonb_build_array(jsonb_build_object('unit_id',item.unit_id,'kind','group_preparation','amount_cents',amount_,'preparation_id',prepared.preparation_id,'sequence',prepared.sequence,'group_hash',prepared.group_hash,'analysis_hash',prepared.analysis_hash));
  elsif item.data ? 'concepts' and item.data->'concepts'<>'null'::jsonb and jsonb_typeof(item.data->'concepts') is distinct from 'array' then
   return jsonb_build_object('status','pending','reason','INVALID_CONCEPTS','unit_id',item.unit_id);
  else
   if jsonb_typeof(item.data->'amount_cents') is distinct from 'number' or coalesce(item.data->>'amount_cents','') !~ '^[0-9]+$'
    then return jsonb_build_object('status','pending','reason','UNIT_AMOUNT_UNKNOWN','unit_id',item.unit_id);end if;
   amount_:=(item.data->>'amount_cents')::numeric;
   if amount_>9007199254740991 then return jsonb_build_object('status','pending','reason','AMOUNT_OVERFLOW');end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('unit_id',item.unit_id,'kind','proposal','amount_cents',amount_));
  end if;
  allocated:=allocated+amount_;
  if allocated>9007199254740991 then return jsonb_build_object('status','pending','reason','AMOUNT_OVERFLOW');end if;
 end loop;
 if allocated+remainder>9007199254740991 then return jsonb_build_object('status','pending','reason','AMOUNT_OVERFLOW');end if;
 difference:=expected-allocated-remainder;
 if difference<>0 then return jsonb_build_object('status','pending','reason','TOTAL_MISMATCH','expected_cents',expected,'allocated_cents',allocated,'unallocated_cents',remainder,'difference_cents',difference,'units',entries);end if;
 return jsonb_build_object('status','balanced','expected_cents',expected,'allocated_cents',allocated,'unallocated_cents',remainder,'difference_cents',0,'units',entries,'note','Diagnòstic aritmètic; no és una aprovació ni una atribució econòmica.');
end $$;
revoke all on function public.conveni_strict_reconciliation(uuid,uuid) from public,anon,authenticated,service_role;
