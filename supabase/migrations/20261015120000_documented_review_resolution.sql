-- Additive, append-only human observations. Automatic proposals and original imports remain intact.
create table public.documented_corrections (
 id uuid primary key, source_record_id uuid not null references public.source_records(id) on delete cascade,
 pipeline_job_id uuid not null references public.pipeline_jobs(id), unit_id uuid references public.record_units(id),
 field text not null check(field in ('service_code','final_service','final_population','financed_object','provider_name','provider_nif')),
 value text not null check(length(trim(value)) between 1 and 2000), previous_value text,
 document_id uuid not null references public.source_documents(id), document_revision text not null,
 page integer not null check(page between 1 and 2000), evidence text not null, visual_check boolean not null,
 reason text not null, reviewer text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.documented_corrections enable row level security;
revoke all on public.documented_corrections from public,anon,authenticated,service_role;
grant select,insert on public.documented_corrections to service_role;
create index documented_corrections_latest on public.documented_corrections(source_record_id,field,created_at desc,id desc);

create view public.current_documented_corrections with(security_invoker=true) as
select c.*, c.document_revision=(coalesce(d.storage_sha256,'')||':'||coalesce(d.active_extraction_id::text,''))
 and d.storage_path is not null and d.status='fetched' as valid
from (select distinct on(source_record_id,coalesce(unit_id,'00000000-0000-0000-0000-000000000000'::uuid),field) *
 from public.documented_corrections order by source_record_id,coalesce(unit_id,'00000000-0000-0000-0000-000000000000'::uuid),field,created_at desc,id desc)c
join public.source_documents d on d.id=c.document_id;
revoke all on public.current_documented_corrections from public,anon,authenticated;
grant select on public.current_documented_corrections to service_role;

create table public.record_reservation_events (
 id uuid primary key, source_record_id uuid not null references public.source_records(id) on delete cascade,
 pipeline_job_id uuid not null references public.pipeline_jobs(id), action text not null check(action in ('accept','reopen')),
 reason text not null, missing_items text not null, reviewer text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.record_reservation_events enable row level security;
revoke all on public.record_reservation_events from public,anon,authenticated,service_role;
grant select,insert on public.record_reservation_events to service_role;
create index record_reservation_latest on public.record_reservation_events(source_record_id,created_at desc,id desc);
create view public.current_record_reservations with(security_invoker=true) as
select distinct on(source_record_id) * from public.record_reservation_events order by source_record_id,created_at desc,id desc;
revoke all on public.current_record_reservations from public,anon,authenticated;
grant select on public.current_record_reservations to service_role;

create function public.assert_human_resolution(p_record uuid,p_job uuid) returns void language plpgsql set search_path=public as $$
declare j pipeline_jobs;
begin
 perform 1 from source_records where id=p_record for update;
 select * into strict j from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1 for update;
 if j.id is distinct from p_job then raise exception 'STALE_JOB' using errcode='40001';end if;
 if j.status not in ('needs_review','approved','corrected','rejected','insufficient_evidence','error')
 or exists(select 1 from worker_tasks where (pipeline_job_id=j.id or progress_job_id=j.id) and execution_state='running' and lease_until>now())
 then raise exception 'El procés encara no ha finalitzat';end if;
end $$;

create function public.record_reservation(p_record uuid,p_job uuid,p_id uuid,p_expected uuid,p_action text,p_reason text,p_missing text,p_reviewer text)
returns uuid language plpgsql set search_path=public as $$
declare previous current_record_reservations; saved record_reservation_events;
begin
 perform assert_human_resolution(p_record,p_job);
 select * into saved from record_reservation_events where id=p_id;
 if found then
  if saved.source_record_id=p_record and saved.pipeline_job_id=p_job and saved.action=p_action and saved.reason=trim(p_reason)
   and saved.missing_items=trim(p_missing) and saved.reviewer=trim(p_reviewer) then return saved.id;end if;
  raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 select * into previous from current_record_reservations where source_record_id=p_record;
 if previous.id is distinct from p_expected then raise exception 'STALE_REVIEW' using errcode='40001';end if;
 if p_action is null or p_action not in ('accept','reopen') or coalesce(length(trim(p_reason)),0) not between 10 and 2000
 or coalesce(length(trim(p_reviewer)),0) not between 3 and 120 or (p_action='accept' and coalesce(length(trim(p_missing)),0) not between 10 and 2000)
 then raise exception 'Cal indicar el motiu, les mancances i la persona revisora';end if;
 if p_action='reopen' and (previous.id is null or previous.action<>'accept') then raise exception 'No hi ha cap reserva per reobrir';end if;
 -- A reservation cannot silently withdraw already approved funding or replace a human approval.
 if p_action='accept' and (exists(select 1 from service_provisions where source_record_id=p_record and superseded_at is null)
 or exists(select 1 from record_units where source_record_id=p_record and status='approved')
 or exists(select 1 from pipeline_jobs where id=p_job and status in ('approved','corrected')))
 then raise exception 'El cas ja té finançament validat. Revisa la decisió existent abans d’acceptar amb reserves.';end if;
 insert into record_reservation_events values(p_id,p_record,p_job,p_action,trim(p_reason),coalesce(trim(p_missing),''),trim(p_reviewer),clock_timestamp());
 return p_id;
end $$;

create function public.save_documented_correction(p_record uuid,p_job uuid,p_id uuid,p_expected uuid,p_unit uuid,p_field text,p_value text,p_document uuid,p_revision text,p_page integer,p_evidence text,p_visual boolean,p_reason text,p_reviewer text)
returns uuid language plpgsql set search_path=public as $$
declare d source_documents;r source_records;u record_units;previous current_documented_corrections;saved documented_corrections;old_value text;
begin
 perform assert_human_resolution(p_record,p_job);
 select * into strict r from source_records where id=p_record;
 select * into saved from documented_corrections where id=p_id;
 if found then
  if saved.source_record_id=p_record and saved.pipeline_job_id=p_job and saved.unit_id is not distinct from p_unit
   and saved.field=p_field and saved.value=trim(p_value) and saved.document_id=p_document and saved.document_revision=p_revision
   and saved.page=p_page and saved.evidence=trim(p_evidence) and saved.visual_check=p_visual and saved.reason=trim(p_reason) and saved.reviewer=trim(p_reviewer)
  then return saved.id;end if;raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 if p_field is null or p_field not in ('service_code','final_service','final_population','financed_object','provider_name','provider_nif')
 or coalesce(length(trim(p_value)),0) not between 1 and 2000 or coalesce(length(trim(p_reason)),0) not between 10 and 2000
 or coalesce(length(trim(p_reviewer)),0) not between 3 and 120 or coalesce(length(trim(p_evidence)),0) not between 12 and 4000
 or p_page is null or p_page not between 1 and 2000 or p_visual is null then raise exception 'Correcció documental incompleta';end if;
 select * into strict d from source_documents where id=p_document and source_record_id=p_record and status='fetched' and storage_path is not null;
 if p_revision is distinct from (coalesce(d.storage_sha256,'')||':'||coalesce(d.active_extraction_id::text,'')) then raise exception 'SOURCE_CHANGED' using errcode='40001';end if;
 if not exists(select 1 from storage.objects where bucket_id='cloud-documents' and name=d.storage_path) then raise exception 'Falta la còpia arxivada';end if;
 if not p_visual and position(regexp_replace(trim(p_evidence),'\s+',' ','g') in regexp_replace(coalesce(d.extracted_text,''),'\s+',' ','g'))=0 then raise exception 'La cita no consta al text; comprova el PDF o declara una verificació visual';end if;
 if p_field='provider_nif' and upper(trim(p_value)) !~ '^[A-Z0-9][A-Z0-9]{7,11}$' then raise exception 'NIF no vàlid';end if;
 if p_field='service_code' and not exists(select 1 from official_services s join catalog_versions v on v.id=s.version_id and v.active and v.validated where s.service_code=trim(p_value) and s.benefit_type='service'
  and (r.financing_type='concert' or exists(select 1 from eligible_official_services e where e.service_code=s.service_code and e.version_id=s.version_id))) then raise exception 'Codi de servei no vàlid';end if;
 if p_unit is not null then
  select * into strict u from record_units where id=p_unit and source_record_id=p_record and document_id=p_document for update;
  if u.status<>'draft' or u.reviewed_at is not null or u.pipeline_job_id is not null then raise exception 'La línia ja ha estat preparada o revisada';end if;
  if p_field not in ('service_code','provider_name') then raise exception 'Camp no aplicable a la línia';end if;
  old_value:=case p_field when 'service_code' then u.observed_service_code when 'provider_name' then coalesce(u.provider_name,u.observed_provider_name) when 'provider_nif' then u.provider_nif else u.observed_service_name end;
 else
  if exists(select 1 from service_provisions where source_record_id=p_record and superseded_at is null)
   or exists(select 1 from record_units where source_record_id=p_record and status='approved') then raise exception 'Revisa primer les provisions aprovades';end if;
  select case p_field when 'provider_name' then coalesce(e.provider_name,r.provider_name) when 'provider_nif' then e.provider_nif when 'final_population' then e.target_population else null end into old_value from record_enrichments e where e.source_record_id=p_record;
 end if;
 select * into previous from current_documented_corrections where source_record_id=p_record and unit_id is not distinct from p_unit and field=p_field;
 if previous.id is distinct from p_expected then raise exception 'STALE_CORRECTION' using errcode='40001';end if;
 insert into documented_corrections values(p_id,p_record,p_job,p_unit,p_field,trim(p_value),coalesce(previous.value,old_value),p_document,p_revision,p_page,trim(p_evidence),p_visual,trim(p_reason),trim(p_reviewer),clock_timestamp());
 return p_id;
end $$;

create function public.corrected_unit_code(p_unit uuid,p_original text) returns text language sql stable set search_path=public as $$
 select coalesce((select value from current_documented_corrections where unit_id=p_unit and field='service_code' and valid),p_original)
$$;

-- Guard every write path, including older clients and worker receipts.
create function public.guard_concert_classification() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from source_records where id=new.source_record_id and financing_type='concert') then
  if tg_table_name='review_decisions' then
   if new.classification='out_of_portfolio' then raise exception 'Fora de cartera no és una decisió vàlida per a concerts';end if;
  else
   if new.reviewed_classification='out_of_portfolio' and (tg_op='INSERT' or old.reviewed_classification is distinct from new.reviewed_classification) then raise exception 'Fora de cartera no és una decisió vàlida per a concerts';end if;
   if new.classification='out_of_portfolio' and (tg_op='INSERT' or old.classification is distinct from new.classification) then
    new.classification:='insufficient_evidence';new.reasons:='[]';
    new.explanation:='La resposta proposava Fora de cartera, una categoria no vàlida per a concerts. Cal revisar la resolució.';
    new.rule_audit:=coalesce(new.rule_audit,'{}')||'{"original_classification":"out_of_portfolio","diagnostics":[{"code":"concert_outside_not_allowed","message":"La classificació proposada no és vàlida per a concerts. Cal revisar la resolució.","action":"match","rule":"concert_classification_policy"}]}'::jsonb;
   end if;
  end if;
 end if;return new;
end $$;
create trigger concert_analysis_classification before insert or update on public.analysis_results for each row execute function public.guard_concert_classification();
create trigger concert_review_classification before insert or update on public.review_decisions for each row execute function public.guard_concert_classification();

-- Patch the existing transaction, keeping its unit, catalog, cost and lineage safeguards.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 needle:='select * into strict r from source_records where id=p_record for update;';
 if position(needle in definition)=0 then raise exception 'Review guard insertion point changed';end if;
 definition:=replace(definition,needle,needle||$patch$
 if r.financing_type='concert' and p_outcome='outside' then raise exception 'Fora de cartera no és una decisió vàlida per a concerts';end if;
 if exists(select 1 from current_record_reservations where source_record_id=p_record and pipeline_job_id=p_expected_job and action='accept') then raise exception 'Reobre la reserva abans de validar';end if;
 if exists(select 1 from current_documented_corrections where source_record_id=p_record and not valid) then raise exception 'Hi ha correccions amb fonts canviades; cal tornar-les a revisar';end if;
 $patch$);
 -- Corrections override equivalent fields only at explicit human approval, never in the import.
 needle:='select * into e from record_enrichments where source_record_id=p_record;';
 if position(needle in definition)=0 then raise exception 'Review enrichment insertion point changed';end if;
 definition:=replace(definition,needle,needle||$patch$
 select * into e from jsonb_populate_record(e,(select coalesce(jsonb_object_agg(case field when 'final_population' then 'target_population' else field end,value),'{}') from current_documented_corrections where source_record_id=p_record and unit_id is null and valid and field in ('provider_name','provider_nif','final_population')));
 $patch$);
 -- Explicit corrections take priority over the Excel only through this reviewed path.
 definition:=replace(definition,'coalesce(nullif(trim(r.provider_name),''''),e.provider_name)',
 '(coalesce((select value from current_documented_corrections where source_record_id=p_record and unit_id is null and field=''provider_name'' and valid),nullif(trim(r.provider_name),''''),e.provider_name))');
 definition:=replace(definition,'coalesce(imported_priority_value(r.source_dataset,r.source_payload,''nif''),e.provider_nif)',
 '(coalesce((select value from current_documented_corrections where source_record_id=p_record and unit_id is null and field=''provider_nif'' and valid),imported_priority_value(r.source_dataset,r.source_payload,''nif''),e.provider_nif))');
 execute definition;
end $$;

-- Human-documented service codes participate in the same annex-wide approval, not separate funding.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.is_reconciled_concert_code(uuid,text,uuid)'::regprocedure);
 if position('u.observed_service_code' in definition)=0 then raise exception 'Concert code function changed';end if;
 definition:=replace(definition,'u.observed_service_code','public.corrected_unit_code(u.id,u.observed_service_code)');execute definition;
 definition:=pg_get_functiondef('public.prepare_extracted_concert_unit(uuid,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'u.observed_service_code is distinct from p_service_code','public.corrected_unit_code(u.id,u.observed_service_code) is distinct from p_service_code');
 definition:=replace(definition,'position(p_service_code in u.evidence_quote)=0','position(p_service_code in u.evidence_quote)=0 and not exists(select 1 from current_documented_corrections where unit_id=u.id and field=''service_code'' and value=p_service_code and valid)');
 execute definition;
 definition:=pg_get_functiondef('public.review_reconciled_concert(uuid,uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,$find$and classification='in_portfolio'$find$,'and classification in (''in_portfolio'',''insufficient_evidence'')');
 definition:=replace(definition,'observed_service_code is null','public.corrected_unit_code(id,observed_service_code) is null');
 definition:=replace(definition,'u.observed_service_code','public.corrected_unit_code(u.id,u.observed_service_code)');
 definition:=replace(definition,'chosen_name:=coalesce(', 'chosen_name:=coalesce((select value from current_documented_corrections where unit_id=u.id and field=''provider_name'' and valid),');
 definition:=replace(definition,'select id into strict candidate_id from public.matching_candidates where pipeline_job_id=j.id order by rank,id limit 1;','select id into candidate_id from public.matching_candidates where pipeline_job_id=j.id order by rank,id limit 1;');
 definition:=replace(definition,$find$candidate_id,null,p_note)$find$,$replace$candidate_id,case when candidate_id is null then (select public.corrected_unit_code(id,observed_service_code) from record_units where source_record_id=p_record and unit_key<>'legacy' order by unit_key limit 1) else null end,p_note)$replace$);
 execute definition;
end $$;

-- Existing consumers inherit the reservation destination without changing automatic classification.
do $$declare definition text;needle text;begin
 definition:=pg_get_viewdef('public.current_record_results'::regclass,true);
 needle:='THEN ''processing''::text';
 if position(needle in definition)=0 then raise exception 'Current-result projection changed';end if;
 definition:=replace(definition,needle,needle||$patch$
 WHEN EXISTS(select 1 from public.current_record_reservations h where h.source_record_id=r.id and h.pipeline_job_id=j.id and h.action='accept') THEN 'reserved'::text
 WHEN r.financing_type='concert' and coalesce(d.classification,a.reviewed_classification,a.classification)='out_of_portfolio' THEN 'issues'::text
 $patch$);
 execute 'create or replace view public.current_record_results with(security_invoker=true) as '||definition;
end $$;

revoke all on function public.assert_human_resolution(uuid,uuid),public.record_reservation(uuid,uuid,uuid,uuid,text,text,text,text),public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text),public.corrected_unit_code(uuid,text),public.guard_concert_classification() from public,anon,authenticated;
grant execute on function public.assert_human_resolution(uuid,uuid),public.record_reservation(uuid,uuid,uuid,uuid,text,text,text,text),public.save_documented_correction(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,boolean,text,text),public.corrected_unit_code(uuid,text) to service_role;

-- An alternative write path must not create approved funding while a reservation is active.
create function public.guard_reserved_funding() returns trigger language plpgsql set search_path=public as $$
begin
 perform 1 from source_records where id=new.source_record_id for update;
 if (tg_table_name='service_provisions' or to_jsonb(new)->>'status'='approved') and exists(
  select 1 from current_record_reservations h where h.source_record_id=new.source_record_id and h.action='accept'
   and h.pipeline_job_id=(select id from pipeline_jobs where source_record_id=new.source_record_id order by created_at desc,id desc limit 1))
 then raise exception 'Reobre la reserva abans de validar finançament';end if;
 return new;
end $$;
create trigger reserved_provision_guard before insert or update on public.service_provisions for each row execute function public.guard_reserved_funding();
create trigger reserved_unit_guard before insert or update on public.record_units for each row execute function public.guard_reserved_funding();
revoke all on function public.guard_reserved_funding() from public,anon,authenticated;

do $$declare definition text;begin
 definition:=pg_get_viewdef('public.imported_record_processing_overview'::regclass,true);
 if position('WHEN c.human_reviewed' in definition)=0 then raise exception 'Imported review projection changed';end if;
 definition:=replace(definition,'WHEN c.human_reviewed', 'WHEN c.destination=''reserved'' THEN ''reserved''::text WHEN c.human_reviewed');
 execute 'create or replace view public.imported_record_processing_overview with(security_invoker=true) as '||definition;
end $$;
