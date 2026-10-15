-- Additive recovery journal: preserve previous observations and every human decision.
create table public.concert_line_observations (
 id uuid primary key default gen_random_uuid(),
 source_record_id uuid not null references public.source_records(id) on delete cascade,
 unit_id uuid not null references public.record_units(id) on delete cascade,
 document_id uuid not null references public.source_documents(id) on delete cascade,
 pipeline_job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
 parser_version text not null,
 payload_hash text not null,
 previous_value jsonb,
 proposed_value jsonb not null,
 applied boolean not null,
 created_at timestamptz not null default now(),
 unique(unit_id,parser_version,payload_hash)
);
alter table public.concert_line_observations enable row level security;
grant select,insert on public.concert_line_observations to service_role;
alter table public.concert_annex_reconciliations add column coverage jsonb;

create function public.cloud_stage_program_observation(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_line jsonb,p_hash text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;d source_documents;u record_units;uid uuid;q text;can_apply boolean;prior jsonb;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from pipeline_jobs where id=p_job;
 if not exists(select 1 from worker_tasks t where t.id=p_task and (t.run_id=j.run_id or t.source_record_id=j.source_record_id))
  or not exists(select 1 from source_records where id=j.source_record_id and financing_type='concert') then raise exception 'CONCERT_SCOPE';end if;
 select * into strict d from source_documents where id=p_document and source_record_id=j.source_record_id
  and status='fetched' and mime_type like '%pdf%' and not coalesce(extraction_partial,false)
  and storage_path is not null and storage_sha256 is not null;
 if coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'] then raise exception 'CONCERT_DOCUMENT_QUALITY';end if;
 q:=trim(p_line->>'quote');
 if length(q)<40 or position(regexp_replace(q,'\s+',' ','g') in regexp_replace(d.extracted_text,'\s+',' ','g'))=0 then raise exception 'CONCERT_QUOTE_MISMATCH';end if;
 if p_line->>'parserVersion'<>'program-columns-v2' or p_hash !~ '^[0-9a-f]{64}$'
  or p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$' or p_line->>'resesCode' !~ '^[SC][0-9]{5}$'
  or (p_line->>'page')::integer<1 or (p_line->>'amountCents')::bigint<0
  or position(p_line->>'nif' in q)=0 or position(p_line->>'resesCode' in q)=0
  or p_line->>'actType' not in ('award','renewal','amendment','modification','termination','cession','appeal','validation')
 then raise exception 'CONCERT_LINE_INVALID';end if;
 if p_line->>'observedServiceCode' is not null and not exists(select 1 from official_services s join catalog_versions v on v.id=s.version_id
  where v.active and v.validated and s.benefit_type='service' and s.service_code=p_line->>'observedServiceCode') then raise exception 'CONCERT_CODE_INVALID';end if;
 perform 1 from source_records where id=j.source_record_id for update;
 if p_line->>'existingUnitId' is not null then
  select * into strict u from record_units where id=(p_line->>'existingUnitId')::uuid and source_record_id=j.source_record_id
   and document_id=d.id and provider_nif=p_line->>'nif' and (reses_code=p_line->>'resesCode' or (reses_code is null and unit_key=p_line->>'unitKey' and position(p_line->>'resesCode' in evidence_quote)>0)) for update;
 else
  select * into u from record_units where source_record_id=j.source_record_id and unit_key=p_line->>'unitKey' for update;
  if u.id is not null and (u.document_id<>d.id or u.provider_nif<>p_line->>'nif' or (u.reses_code is distinct from p_line->>'resesCode' and not(u.reses_code is null and position(p_line->>'resesCode' in u.evidence_quote)>0))) then raise exception 'CONCERT_IDENTITY_CONFLICT';end if;
 end if;
 if u.id is not null and exists(select 1 from concert_line_observations where unit_id=u.id and parser_version='program-columns-v2' and payload_hash=p_hash) then return u.id;end if;
 prior:=case when u.id is null then null else to_jsonb(u) end;
 can_apply:=u.id is null or (u.status='draft' and u.reviewed_at is null and u.pipeline_job_id is null);
 if u.id is null then
  if p_line->>'unitKey' not like 'official-program:'||d.storage_sha256||':%' then raise exception 'CONCERT_IDENTITY_INVALID';end if;
  insert into record_units(source_record_id,unit_key,provider_nif,reses_code,document_id,status,act_type,horizon_state)
   values(j.source_record_id,p_line->>'unitKey',p_line->>'nif',case when p_line->>'resesCode' like 'S%' then p_line->>'resesCode' end,d.id,'draft',p_line->>'actType',case when p_line->>'actType'='award' then 'in_scope' else 'undetermined' end) returning id into uid;
 else uid:=u.id;end if;
 if can_apply then
  update record_units set observed_provider_name=nullif(p_line->>'observedProviderName',''),observed_service_name=nullif(p_line->>'observedServiceName',''),
   observed_service_code=nullif(p_line->>'observedServiceCode',''),municipality=nullif(p_line->>'municipality',''),
   period=nullif(p_line->>'period',''),effective_start=(p_line->>'effectiveStart')::date,effective_end=(p_line->>'effectiveEnd')::date,
   amount=(p_line->>'amountCents')::numeric/100,quantity=(p_line->>'quantity')::integer,
   page=(p_line->>'page')::integer,evidence_quote=q,extraction_origin='program-columns-v2'
  where id=uid;
 end if;
 insert into concert_line_observations(source_record_id,unit_id,document_id,pipeline_job_id,parser_version,payload_hash,previous_value,proposed_value,applied)
  values(j.source_record_id,uid,d.id,j.id,'program-columns-v2',p_hash,prior,p_line,can_apply);
 return uid;
end $$;

-- Only equivalent fields are comparable. Never substitute publication for award dates.
create function public.imported_priority_value(p_dataset text,p_payload jsonb,p_field text) returns text
language plpgsql immutable security invoker set search_path=public as $$
declare value text;parsed date;
begin
 value:=case p_field
  when 'nif' then case when p_dataset in ('raisc_ccaa','raisc_local') then p_payload->>'CIF Beneficiari' end
  when 'date' then case when p_dataset in ('raisc_ccaa','raisc_local') then p_payload->>'Data concessió' when p_dataset='convenis' then p_payload->>'Data signatura' end
  when 'body' then case when p_dataset in ('raisc_ccaa','raisc_local') then p_payload->>'Entitat, OO.AA. o Departament convocant' when p_dataset='contractacions' then p_payload->>'Órgano de contratación' end end;
 value:=nullif(trim(value),'');
 if p_field='date' and value is not null then
  begin
   if value ~ '^\d{4}-\d{2}-\d{2}' then parsed:=left(value,10)::date;
   elsif value ~ '^\d{2}/\d{2}/\d{4}$' then parsed:=(split_part(value,'/',3)||'-'||split_part(value,'/',2)||'-'||split_part(value,'/',1))::date;
   else return null;end if;
   return parsed::text;
  exception when others then return null;end;
 end if;
 if p_field='nif' and value !~ '^[A-Z0-9][A-Z0-9 -]{7,12}$' then return null;end if;
 return value;
end $$;
revoke all on function public.imported_priority_value(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.imported_priority_value(text,jsonb,text) to service_role;

-- The import remains authoritative for populated fields in general mechanisms.
-- Concert line observations retain their separate document-based policy.
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 patched:=replace(original,'coalesce(e.provider_name,r.provider_name)',
  'case when r.financing_type=''concert'' then coalesce(e.provider_name,r.provider_name) else coalesce(nullif(trim(r.provider_name),''''),e.provider_name) end');
 patched:=replace(patched,'coalesce(e.amount,r.amount)',
  'case when r.financing_type=''concert'' then coalesce(e.amount,r.amount) else coalesce(r.amount,e.amount) end');
 patched:=replace(patched,'coalesce(e.mechanism,r.mechanism)',
  'case when r.financing_type=''concert'' then coalesce(e.mechanism,r.mechanism) else coalesce(nullif(trim(r.mechanism),''''),e.mechanism) end');
 patched:=replace(patched,'e.provider_nif,case when r.financing_type',
  'case when r.financing_type=''concert'' then e.provider_nif else coalesce(imported_priority_value(r.source_dataset,r.source_payload,''nif''),e.provider_nif) end,case when r.financing_type');
 patched:=replace(patched,'e.award_date,case when r.financing_type',
  'case when r.financing_type=''concert'' then e.award_date else coalesce(imported_priority_value(r.source_dataset,r.source_payload,''date'')::date,e.award_date) end,case when r.financing_type');
 patched:=replace(patched,'e.contracting_body,e.target_population',
  'case when r.financing_type=''concert'' then e.contracting_body else coalesce(imported_priority_value(r.source_dataset,r.source_payload,''body''),e.contracting_body) end,e.target_population');
 if patched=original then raise exception 'Excel precedence patch not applied';end if;
 execute patched;
end $$;

-- Configure the selected pages in the same transaction as the new attempt.
create function public.begin_targeted_ocr(p_record uuid,p_expected_job uuid,p_executor text,p_document uuid,p_pages integer[])
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 if p_executor is distinct from 'vercel_workflow' or p_pages is null or array_position(p_pages,null) is not null or cardinality(p_pages) not between 1 and 25 or exists(select 1 from unnest(p_pages) p where p<1 or p>2000)
  or not exists(select 1 from source_documents where id=p_document and source_record_id=p_record and mime_type like '%pdf%' and storage_path is not null)
 then raise exception 'TARGETED_OCR_INVALID';end if;
 if p_expected_job is null then result:=begin_record_operation(p_record,'ocr',p_executor);
 else result:=retry_job_operation(p_record,p_expected_job,'ocr',p_executor);end if;
 update pipeline_runs set parameters=coalesce(parameters,'{}')||jsonb_build_object('ocr_recovery',true,'targeted_ocr',jsonb_build_object('documentId',p_document,'pages',p_pages,'dpi',400)) where id=(result->>'runId')::uuid;
 return result;
end $$;
revoke all on function public.begin_targeted_ocr(uuid,uuid,text,uuid,integer[]) from public,anon,authenticated;
grant execute on function public.begin_targeted_ocr(uuid,uuid,text,uuid,integer[]) to service_role;
revoke all on function public.cloud_stage_program_observation(uuid,uuid,bigint,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.cloud_stage_program_observation(uuid,uuid,bigint,uuid,uuid,jsonb,text) to service_role;

create function public.cloud_finalize_program_observations(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_rows integer,p_sum_cents bigint,p_declared_cents bigint,p_coverage jsonb
) returns boolean language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;d source_documents;n integer;total bigint;complete boolean;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from pipeline_jobs where id=p_job;
 if not exists(select 1 from worker_tasks t where t.id=p_task and (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict d from source_documents where id=p_document and source_record_id=j.source_record_id and status='fetched' and not coalesce(extraction_partial,false);
 select count(*),coalesce(sum((amount*100)::bigint),0) into n,total from record_units where document_id=d.id
  and extraction_origin='program-columns-v2' and storage_path is not null and storage_sha256=d.storage_sha256;
 complete:=n=p_rows and total=p_sum_cents and p_sum_cents=p_declared_cents and coalesce((p_coverage->>'complete')::boolean,false)
  and (p_coverage->>'missingAmounts')::integer=0 and not exists(select 1 from concert_line_observations where document_id=d.id and not applied);
 insert into concert_annex_reconciliations(source_record_id,document_id,document_sha256,extraction_version,annex,row_count,sum_cents,declared_cents,reconciled,coverage)
 values(j.source_record_id,d.id,d.storage_sha256,'program-columns-v2',0,p_rows,p_sum_cents,p_declared_cents,coalesce(complete,false),p_coverage)
 on conflict(document_id,annex,extraction_version) do update set row_count=excluded.row_count,sum_cents=excluded.sum_cents,declared_cents=excluded.declared_cents,reconciled=excluded.reconciled,coverage=excluded.coverage,checked_at=now();
 return coalesce(complete,false);
end $$;
revoke all on function public.cloud_finalize_program_observations(uuid,uuid,bigint,uuid,uuid,integer,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_finalize_program_observations(uuid,uuid,bigint,uuid,uuid,integer,bigint,bigint,jsonb) to service_role;

-- Parent codes remain restricted to documented, archived concert lines.
create or replace function public.is_reconciled_concert_code(p_record uuid,p_code text,p_unit uuid default null)
returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from source_records r join record_units u on u.source_record_id=r.id
  join source_documents d on d.id=u.document_id and d.source_record_id=r.id
  left join concert_annex_reconciliations a on a.source_record_id=r.id and a.document_id=u.document_id and a.reconciled
  join official_services s on s.service_code=p_code and s.benefit_type='service'
  join catalog_versions v on v.id=s.version_id and v.active and v.validated
  where r.id=p_record and r.financing_type='concert' and u.observed_service_code=p_code
   and d.status='fetched' and not coalesce(d.extraction_partial,false)
   and u.storage_sha256=d.storage_sha256 and u.storage_path is not null and (p_unit is null or u.id=p_unit)
   and ((a.document_sha256=u.storage_sha256 and u.extraction_origin in ('official-annex-v1','program-columns-v2'))
    or (u.extraction_origin like 'official-%' and length(u.evidence_quote)>30
     and position(p_code in u.evidence_quote)>0 and position(u.evidence_quote in d.extracted_text)>0)))
$$;

-- A multi-service resolution has one documented proposal per service, not three arbitrary alternatives.
alter table matching_candidates drop constraint matching_candidates_rank_check;
alter table matching_candidates add constraint matching_candidates_rank_check check(rank between 1 and 1000);
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.persist_analysis(uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
 patched:=replace(original,'if jsonb_array_length(p_candidates)>3 or jsonb_array_length(p_evidence)=0 then',
 'if jsonb_array_length(p_candidates)>1000 or (jsonb_array_length(p_candidates)>3 and (p_result->''rule_audit''->>''version'' is distinct from ''concert-program-lines-v2'' or exists(select 1 from jsonb_array_elements(p_candidates) c where not public.is_reconciled_concert_code(j.source_record_id,c->>''code'')))) or jsonb_array_length(p_evidence)=0 then');
 if patched=original then raise exception 'Analysis contract patch not applied';end if;
 execute patched;
 original:=pg_get_functiondef('public.prepare_extracted_concert_unit(uuid,uuid,text,text)'::regprocedure);
 patched:=replace(original,'u.extraction_origin<>''official-annex-v1''','u.extraction_origin not in (''official-annex-v1'',''program-columns-v2'')');
 if patched=original then raise exception 'Observed code patch not applied';end if;
 execute patched;
end $$;

create or replace function public.review_reconciled_concert(
 p_record uuid,p_expected_job uuid,p_note text,p_names jsonb default '{}'::jsonb
) returns integer language plpgsql security invoker set search_path=public as $$
declare r public.source_records;j public.pipeline_jobs;a public.analysis_results;
        recon public.concert_annex_reconciliations;u public.record_units;candidate_id uuid;
        chosen_name text;reviewed integer:=0;actual_cents bigint;
begin
 if length(trim(coalesce(p_note,'')))<10 or jsonb_typeof(p_names)<>'object' then raise exception 'Cal justificar la validació conjunta';end if;
 select * into strict r from public.source_records where id=p_record for update;
 if r.financing_type<>'concert' then raise exception 'CONCERT_SCOPE';end if;
 select * into strict j from public.pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1 for update;
 if j.id is distinct from p_expected_job or j.status<>'needs_review' then raise exception 'Revisió obsoleta';end if;
 select * into strict a from public.analysis_results where pipeline_job_id=j.id and classification='in_portfolio'
  and rule_audit->>'version' in ('concert-reconciled-annex-v1','concert-program-lines-v2');
 select * into strict recon from public.concert_annex_reconciliations where source_record_id=p_record
  and document_id=coalesce(a.rule_audit->>'document_id',a.rule_audit->'documents'->>0)::uuid and reconciled=true;
 if recon.annex not in (0,6,7) or recon.sum_cents is distinct from recon.declared_cents then raise exception 'Annex no conciliat';end if;
 if (select count(*) from public.record_units where source_record_id=p_record and unit_key<>'legacy')<>recon.row_count then
  raise exception 'Hi ha línies alienes o pendents de conciliació';end if;
 if exists(select 1 from public.record_units where source_record_id=p_record and unit_key<>'legacy' and
  (document_id<>recon.document_id or status<>'draft' or storage_path is null or storage_sha256<>recon.document_sha256
   or (act_type<>'award' and a.rules_version<>'concert-program-lines-v2') or amount is null or observed_service_code is null)) then
  raise exception 'Les línies no estan completes o ja han estat revisades';end if;
 select id into strict candidate_id from public.matching_candidates where pipeline_job_id=j.id order by rank,id limit 1;
 perform set_config('app.concert_bulk_review','on',true);
 perform public.review_analysis(p_record,'select',p_expected_job,'{}'::text[],candidate_id,null,p_note);
 for u in select * from public.record_units where source_record_id=p_record and unit_key<>'legacy' order by unit_key loop
  chosen_name:=coalesce(nullif(trim(p_names->>(u.id::text)),''),nullif(trim(u.provider_name),''),nullif(trim(u.observed_provider_name),''));
  if chosen_name is null then raise exception 'Falta el nom de l’entitat a la línia %',u.id;end if;
  perform public.prepare_extracted_concert_unit(u.id,p_expected_job,chosen_name,u.observed_service_code);
  perform public.review_record_unit(u.id,p_expected_job,true,p_note);
  reviewed:=reviewed+1;
 end loop;
 if reviewed<>recon.row_count then raise exception 'Nombre de línies incomplet';end if;
 if a.rules_version='concert-program-lines-v2' then
  -- A renewal/amendment is an observed movement, never fresh funding in the legacy result.
  if not exists(select 1 from record_units where source_record_id=p_record and unit_key<>'legacy' and act_type='award') then
   update service_provisions set superseded_at=coalesce(superseded_at,now()) where source_record_id=p_record
    and unit_id in(select id from record_units where source_record_id=p_record and unit_key='legacy');
   delete from entity_catalog_relations where source_type='provision' and source_reference in
    (select id::text from service_provisions where source_record_id=p_record and superseded_at is not null);
  end if;
  select coalesce(sum((amount*100)::bigint),0) into actual_cents from record_units where source_record_id=p_record and unit_key<>'legacy' and status='approved';
 else
  select coalesce(sum((amount*100)::bigint),0) into actual_cents from public.service_provisions
   where source_record_id=p_record and superseded_at is null;
 end if;
 if actual_cents<>recon.declared_cents then raise exception 'El resultat econòmic no quadra amb la resolució';end if;
 return reviewed;
end $$;

do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.guard_reconciled_concert_review()'::regprocedure);
 patched:=replace(original,'a.rules_version=''concert-reconciled-annex-v1''','a.rules_version in (''concert-reconciled-annex-v1'',''concert-program-lines-v2'')');
 if patched=original then raise exception 'Program review guard patch not applied';end if;
 execute patched;
end $$;
