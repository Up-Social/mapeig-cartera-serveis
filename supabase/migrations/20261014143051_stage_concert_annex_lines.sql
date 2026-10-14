-- Automatic observations are drafts. Only a later human review can publish a
-- provision, and the source document must already be complete and archived.
create function public.cloud_stage_concert_annex_line(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_line jsonb
) returns uuid language plpgsql security invoker set search_path=public as $$
declare j public.pipeline_jobs;d public.source_documents;r public.source_records;
        identity text;existing public.record_units;unit_id uuid;line_quote text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task and
   (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict r from public.source_records where id=j.source_record_id;
 if r.financing_type<>'concert' then raise exception 'CONCERT_SCOPE';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=r.id
  and status='fetched' and mime_type like '%pdf%' and not coalesce(extraction_partial,false)
  and storage_path is not null and storage_sha256 is not null;
 if coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'] then raise exception 'CONCERT_DOCUMENT_QUALITY';end if;
 if (p_line->>'annex')::integer not in (0,6,7) or (p_line->>'row')::integer<1
  or (p_line->>'page')::integer<1 or (p_line->>'quantity')::integer<1
  or (p_line->>'amountCents')::bigint<0 or p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$'
  or p_line->>'resesCode' !~ '^S[0-9]{5}$'
  or p_line->>'actType' not in ('award','renewal','amendment','termination','modification','cession','appeal','validation')
 then raise exception 'CONCERT_LINE_INVALID';end if;
 line_quote:=trim(p_line->>'quote');
 if length(line_quote)<40 or position(regexp_replace(line_quote,'\s+',' ','g') in regexp_replace(d.extracted_text,'\s+',' ','g'))=0
 then raise exception 'CONCERT_QUOTE_MISMATCH';end if;
 identity:='official-annex:'||d.storage_sha256||':'||(p_line->>'annex')||':'||(p_line->>'row');
 select * into existing from public.record_units where source_record_id=r.id and unit_key=identity;
 if found then
  if existing.document_id<>d.id or existing.provider_nif<>p_line->>'nif'
   or existing.reses_code<>p_line->>'resesCode'
   or existing.evidence_quote<>line_quote
   or existing.amount is distinct from (case when p_line->>'actType'='award' then ((p_line->>'amountCents')::bigint::numeric/100) else null end)
  then raise exception 'CONCERT_LINE_CHANGED';end if;
  return existing.id;
 end if;
 insert into public.record_units(source_record_id,unit_key,provider_name,provider_nif,observed_provider_name,
  observed_service_code,observed_service_name,reses_code,territory,municipality,period,act_type,amount,document_id,page,evidence_quote,
  quantity,status,extraction_origin,horizon_state)
 values(r.id,identity,nullif(trim(p_line->>'registeredProviderName'),''),p_line->>'nif',nullif(trim(p_line->>'observedProviderName'),''),
  nullif(trim(p_line->>'observedServiceCode'),''),nullif(trim(p_line->>'observedServiceName'),''),p_line->>'resesCode',
  nullif(trim(p_line->>'territory'),''),nullif(trim(p_line->>'municipality'),''),nullif(p_line->>'period',''),p_line->>'actType',
  case when p_line->>'actType'='award' then ((p_line->>'amountCents')::bigint::numeric/100) else null end,
  d.id,(p_line->>'page')::integer,line_quote,(p_line->>'quantity')::integer,'draft',
  'official-annex-v1','in_scope') returning id into unit_id;
 return unit_id;
end $$;

revoke all on function public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;

create table public.concert_annex_reconciliations (
 id uuid primary key default gen_random_uuid(),
 source_record_id uuid not null references public.source_records(id) on delete cascade,
 document_id uuid not null references public.source_documents(id) on delete cascade,
 document_sha256 text not null,
 extraction_version text not null,
 annex integer not null check(annex in (0,6,7)),
 row_count integer not null check(row_count>0),
 sum_cents bigint not null check(sum_cents>=0),
 declared_cents bigint,
 reconciled boolean not null,
 checked_at timestamptz not null default now(),
 unique(document_id,annex,extraction_version)
);
alter table public.concert_annex_reconciliations enable row level security;
grant select,insert,update on public.concert_annex_reconciliations to service_role;

create function public.cloud_finalize_concert_annex(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,
 p_annex integer,p_rows integer,p_sum_cents bigint,p_declared_cents bigint
) returns boolean language plpgsql security invoker set search_path=public as $$
declare j public.pipeline_jobs;d public.source_documents;actual_rows integer;actual_sum bigint;complete boolean;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task and
   (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=j.source_record_id
  and status='fetched' and not coalesce(extraction_partial,false) and storage_sha256 is not null;
 select count(*)::integer,coalesce(sum((u.amount*100)::bigint),0) into actual_rows,actual_sum
 from public.record_units u where u.source_record_id=j.source_record_id and u.document_id=d.id
  and u.unit_key like 'official-annex:'||d.storage_sha256||':'||p_annex||':%'
  and u.storage_path is not null and u.storage_sha256=d.storage_sha256;
 if actual_rows<>p_rows then raise exception 'CONCERT_ARCHIVE_INCOMPLETE';end if;
 complete:=p_annex in (6,7) and p_declared_cents is not null
  and p_declared_cents=p_sum_cents and actual_sum=p_sum_cents;
 insert into public.concert_annex_reconciliations(source_record_id,document_id,document_sha256,extraction_version,
  annex,row_count,sum_cents,declared_cents,reconciled)
 values(j.source_record_id,d.id,d.storage_sha256,d.extraction_version,p_annex,p_rows,p_sum_cents,p_declared_cents,complete)
 on conflict(document_id,annex,extraction_version) do update
 set row_count=excluded.row_count,sum_cents=excluded.sum_cents,declared_cents=excluded.declared_cents,
     reconciled=excluded.reconciled,checked_at=now();
 return complete;
end $$;
revoke all on function public.cloud_finalize_concert_annex(uuid,uuid,bigint,uuid,uuid,integer,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function public.cloud_finalize_concert_annex(uuid,uuid,bigint,uuid,uuid,integer,integer,bigint,bigint) to service_role;

-- The two official annexes print some valid service codes at a parent level.
-- Preserve that exact granularity only for reconciled concert observations;
-- unrelated mechanisms still require a leaf service.
create function public.is_reconciled_concert_code(p_record uuid,p_code text,p_unit uuid default null)
returns boolean language sql stable security invoker set search_path=public as $$
 select exists(
  select 1 from public.source_records r
   join public.record_units u on u.source_record_id=r.id
   join public.concert_annex_reconciliations a on a.source_record_id=r.id and a.document_id=u.document_id
   join public.official_services s on s.service_code=p_code and s.benefit_type='service'
   join public.catalog_versions v on v.id=s.version_id and v.active and v.validated
  where r.id=p_record and r.financing_type='concert' and a.reconciled and a.annex in (6,7)
   and u.extraction_origin='official-annex-v1' and u.observed_service_code=p_code
   and u.storage_sha256=a.document_sha256 and u.storage_path is not null
   and (p_unit is null or u.id=p_unit)
 )
$$;
revoke all on function public.is_reconciled_concert_code(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.is_reconciled_concert_code(uuid,text,uuid) to service_role;

create or replace function public.guard_leaf_assignment() returns trigger language plpgsql
set search_path=public as $$
declare code text;version text;allowed boolean;
begin
 if tg_table_name='matching_candidates' then
  code:=new.target_code;version:=new.catalog_version_id;
  if new.target_catalog<>'official' then raise exception 'Cal el catàleg oficial';end if;
  select exists(select 1 from pipeline_jobs j where j.id=new.pipeline_job_id
   and public.is_reconciled_concert_code(j.source_record_id,code)) into allowed;
 else
  code:=new.service_code;version:=new.catalog_version_id;
  allowed:=public.is_reconciled_concert_code(new.source_record_id,code,new.unit_id)
   or (current_setting('app.concert_bulk_review',true)='on' and public.is_reconciled_concert_code(new.source_record_id,code));
 end if;
 if not exists(select 1 from eligible_official_services where service_code=code and version_id=version)
   and not allowed then raise exception 'Cal un servei oficial validat sense fills: %',code;end if;
 return new;
end $$;

do $$ declare definition text;updated text;begin
 definition:=pg_get_functiondef('public.guard_source_assignment()'::regprocedure);
 updated:=replace(definition,
  'if not exists(select 1 from eligible_official_services where service_code=new.cartera_code) then',
  'if not exists(select 1 from eligible_official_services where service_code=new.cartera_code)
    and not public.is_reconciled_concert_code(new.id,new.cartera_code) then');
 if updated=definition then raise exception 'Concert source guard patch not applied';end if;
 execute updated;
 definition:=pg_get_functiondef('public.review_record_unit(uuid,uuid,boolean,text)'::regprocedure);
 updated:=replace(definition,
  'if not exists(select 1 from eligible_official_services where version_id=u.catalog_version_id and service_code=u.service_code) then',
  'if not exists(select 1 from eligible_official_services where version_id=u.catalog_version_id and service_code=u.service_code)
    and not public.is_reconciled_concert_code(r.id,u.service_code,u.id) then');
 if updated=definition then raise exception 'Concert unit guard patch not applied';end if;
 execute updated;
end $$;

-- Wrapped codes in official tables are accepted only for our source-verified
-- observations; all other hand-entered units keep the original literal rule.
do $$
declare definition text;updated text;
begin
 definition:=pg_get_functiondef('public.prepare_extracted_concert_unit(uuid,uuid,text,text)'::regprocedure);
 updated:=replace(definition,
  'or position(p_service_code in u.evidence_quote)=0',
  'or (position(p_service_code in u.evidence_quote)=0 and u.extraction_origin<>''official-annex-v1'')');
 if updated=definition then raise exception 'Concert wrapped-code patch not applied';end if;
 definition:=updated;
 updated:=replace(definition,
  'position(u.provider_nif in u.evidence_quote)=0',
  '(position(u.provider_nif in u.evidence_quote)=0 and u.extraction_origin<>''official-annex-v1'')');
 if updated=definition then raise exception 'Concert inherited-NIF patch not applied';end if;
 definition:=updated;
 updated:=replace(definition,
  'select * into strict s from eligible_official_services where service_code=p_service_code;',
  'select os.* into strict s from official_services os join catalog_versions v on v.id=os.version_id and v.active and v.validated
    where os.service_code=p_service_code and os.benefit_type=''service'' and
    (exists(select 1 from eligible_official_services eligible where eligible.version_id=os.version_id and eligible.service_code=os.service_code)
     or public.is_reconciled_concert_code(u.source_record_id,p_service_code,u.id));');
 if updated=definition then raise exception 'Concert observed-parent patch not applied';end if;
 execute updated;
end $$;

-- Concert no-award acts have a truthful discard reason, separate from an
-- ordinary service being outside the social-services scope.
do $$
declare definition text;updated text;
begin
 definition:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 updated:=replace(definition,
  '''economic_benefit'',''technological_benefit'']::text[]',
  '''economic_benefit'',''technological_benefit'',''no_concert_award'']::text[]');
 if updated=definition then raise exception 'Concert review reason patch not applied';end if;
 definition:=updated;
 updated:=replace(definition,
  'select os.* into strict s from eligible_official_services os where os.service_code=coalesce(nullif(trim(p_code),''''),c.target_code);',
  'select os.* into strict s from official_services os join catalog_versions v on v.id=os.version_id and v.active and v.validated
    where os.service_code=coalesce(nullif(trim(p_code),''''),c.target_code) and os.benefit_type=''service'' and
    (exists(select 1 from eligible_official_services eligible where eligible.version_id=os.version_id and eligible.service_code=os.service_code)
     or public.is_reconciled_concert_code(r.id,os.service_code));');
 if updated=definition then raise exception 'Concert parent review patch not applied';end if;
 execute updated;
end $$;

-- One human decision reviews the complete reconciled distribution. The
-- existing unit checks still run, inside the same transaction; any failure
-- rolls back the parent review and every provision together.
create function public.review_reconciled_concert(
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
  and rule_audit->>'version'='concert-reconciled-annex-v1';
 select * into strict recon from public.concert_annex_reconciliations where source_record_id=p_record
  and document_id=(a.rule_audit->>'document_id')::uuid and reconciled=true;
 if recon.annex not in (6,7) or recon.sum_cents is distinct from recon.declared_cents then raise exception 'Annex no conciliat';end if;
 if (select count(*) from public.record_units where source_record_id=p_record and unit_key<>'legacy')<>recon.row_count then
  raise exception 'Hi ha línies alienes o pendents de conciliació';end if;
 if exists(select 1 from public.record_units where source_record_id=p_record and unit_key<>'legacy' and
  (document_id<>recon.document_id or status<>'draft' or storage_path is null or storage_sha256<>recon.document_sha256
   or act_type<>'award' or amount is null or observed_service_code is null)) then
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
 select coalesce(sum((amount*100)::bigint),0) into actual_cents from public.service_provisions
  where source_record_id=p_record and superseded_at is null;
 if actual_cents<>recon.declared_cents then raise exception 'El resultat econòmic no quadra amb la resolució';end if;
 return reviewed;
end $$;
revoke all on function public.review_reconciled_concert(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_reconciled_concert(uuid,uuid,text,jsonb) to service_role;

create function public.guard_reconciled_concert_review() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.decision in ('approved','corrected') and exists(
  select 1 from public.analysis_results a where a.pipeline_job_id=new.pipeline_job_id
   and a.rules_version='concert-reconciled-annex-v1'
 ) and current_setting('app.concert_bulk_review',true) is distinct from 'on' then
  raise exception 'Aquest concert requereix validar el repartiment complet';
 end if;
 return new;
end $$;
create trigger guard_reconciled_concert_review before insert on public.review_decisions
for each row execute function public.guard_reconciled_concert_review();
revoke all on function public.guard_reconciled_concert_review() from public,anon,authenticated;
grant execute on function public.guard_reconciled_concert_review() to service_role;
