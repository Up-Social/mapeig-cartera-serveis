create table public.record_units (
 id uuid primary key default gen_random_uuid(),
 source_record_id uuid not null references public.source_records(id) on delete cascade,
 pipeline_job_id uuid references public.pipeline_jobs(id),
 unit_key text not null,
 provider_name text, provider_nif text, centre text, period text,
 act_type text not null default 'award' check(act_type in ('legacy','award','renewal','amendment','termination')),
 service_code text, catalog_version_id text,
 amount numeric(16,2),
 document_id uuid references public.source_documents(id), page integer check(page>0), evidence_quote text,
 status text not null default 'draft' check(status in ('draft','approved','rejected')),
 review_note text, reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(source_record_id,unit_key),
 foreign key(catalog_version_id,service_code) references public.official_services(version_id,service_code)
);
alter table public.record_units enable row level security;
grant select,insert,update,delete on public.record_units to service_role;
alter table public.service_provisions add column unit_id uuid references public.record_units(id), add column superseded_at timestamptz,
 add column centre text, add column period text, add column act_type text, add column annex_reference text;
insert into public.record_units(source_record_id,unit_key,provider_name,provider_nif,service_code,catalog_version_id,amount,status,act_type)
 select source_record_id,'legacy',provider_name,provider_nif,case when catalog_version_id is not null then service_code end,catalog_version_id,amount,'approved','legacy' from service_provisions;
update public.service_provisions p set unit_id=u.id from public.record_units u where u.source_record_id=p.source_record_id and u.unit_key='legacy';
alter table public.service_provisions drop constraint service_provisions_source_record_id_key;
alter table public.service_provisions add constraint service_provisions_unit_id_key unique(unit_id);
create function public.bind_legacy_provision_unit() returns trigger language plpgsql security invoker set search_path=public as $$ begin
 if new.unit_id is null then
 insert into record_units(source_record_id,unit_key,status,act_type) values(new.source_record_id,'legacy','approved','legacy') on conflict(source_record_id,unit_key) do nothing;
 select id into new.unit_id from record_units where source_record_id=new.source_record_id and unit_key='legacy';
 end if;
 if not exists(select 1 from record_units where id=new.unit_id and source_record_id=new.source_record_id) then raise exception 'UNIT_SCOPE';end if;
 return new;
end $$;
create trigger bind_provision_unit before insert or update on public.service_provisions for each row execute function public.bind_legacy_provision_unit();
alter table public.service_provisions alter column unit_id set not null;
-- Keep ordinary record review compatible and prevent it erasing split decisions.
do $$ declare definition text; updated text; begin
 definition:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 updated:=replace(definition,'on conflict(source_record_id) do update','on conflict(unit_id) do update');
 updated:=replace(updated,'select * into strict r from source_records where id=p_record for update;',
 'select * into strict r from source_records where id=p_record for update;
 if exists(select 1 from record_units where source_record_id=p_record and unit_key<>''legacy'' and status=''approved'') then raise exception ''Revisa les unitats: aquest expedient té decisions desglossades.'';end if;');
 if definition=updated then raise exception 'Unit review compatibility patch failed';end if;execute updated;
end $$;
create function public.save_record_unit(p_record uuid,p_expected_job uuid,p_unit jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare r source_records;j pipeline_jobs;d source_documents;s official_services;uid uuid;identity text;quote text;begin
 select * into strict r from source_records where id=p_record for update;
 select * into strict j from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1;
 if r.financing_type<>'concert' or j.id is distinct from p_expected_job or j.status not in ('approved','corrected') then raise exception 'Cal validar el registre vigent abans de desglossar el concert';end if;
 select * into strict d from source_documents where id=(p_unit->>'document_id')::uuid and source_record_id=p_record and status='fetched' and not extraction_partial;
 quote:=trim(p_unit->>'evidence_quote');
 if length(coalesce(quote,''))<20 or position(regexp_replace(quote,'\s+',' ','g') in regexp_replace(d.extracted_text,'\s+',' ','g'))=0 or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'] then raise exception 'Cal una cita literal llegible del document del registre';end if;
 if nullif(trim(p_unit->>'provider_name'),'') is null or nullif(trim(p_unit->>'period'),'') is null or coalesce((p_unit->>'page')::integer,0)<1 then raise exception 'Cal indicar entitat, període i pàgina';end if;
 select * into strict s from eligible_official_services where service_code=p_unit->>'service_code';
 if position(s.service_code in quote)=0 then raise exception 'La cita ha d’incloure el codi explícit del servei';end if;
 identity:=md5(lower(trim(p_unit->>'provider_name'))||'|'||coalesce(p_unit->>'provider_nif','')||'|'||coalesce(p_unit->>'centre','')||'|'||s.service_code||'|'||trim(p_unit->>'period')||'|'||coalesce(p_unit->>'act_type','award')||'|'||d.id||'|'||quote);
 insert into record_units(source_record_id,pipeline_job_id,unit_key,provider_name,provider_nif,centre,period,act_type,service_code,catalog_version_id,amount,document_id,page,evidence_quote)
 values(p_record,j.id,identity,trim(p_unit->>'provider_name'),nullif(trim(p_unit->>'provider_nif'),''),nullif(trim(p_unit->>'centre'),''),trim(p_unit->>'period'),coalesce(p_unit->>'act_type','award'),s.service_code,s.version_id,nullif(p_unit->>'amount','')::numeric,d.id,(p_unit->>'page')::integer,quote)
 on conflict(source_record_id,unit_key) do nothing returning id into uid;
 if uid is null then select id into uid from record_units where source_record_id=p_record and unit_key=identity;end if;
 return uid;
end $$;
create function public.review_record_unit(p_unit uuid,p_expected_job uuid,p_approve boolean,p_note text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare u record_units;r source_records;j pipeline_jobs;base service_provisions;pid uuid;begin
 select source_record_id into strict pid from record_units where id=p_unit;
 select * into strict r from source_records where id=pid for update;
 select * into strict u from record_units where id=p_unit for update;
 select * into strict j from pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1;
 if j.id is distinct from p_expected_job or j.id is distinct from u.pipeline_job_id or j.status not in ('approved','corrected') then raise exception 'Revisió obsoleta';end if;
 if u.unit_key='legacy' or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar la decisió de la unitat';end if;
 if u.status='approved' then select id into pid from service_provisions where unit_id=u.id;return pid;end if;
 if u.status<>'draft' then raise exception 'Unitat ja revisada';end if;
 if not p_approve then update record_units set status='rejected',review_note=p_note,reviewed_at=now() where id=u.id;return null;end if;
 if not exists(select 1 from eligible_official_services where version_id=u.catalog_version_id and service_code=u.service_code) then raise exception 'Servei no assignable';end if;
 if not exists(select 1 from source_documents where id=u.document_id and source_record_id=r.id and status='fetched' and not extraction_partial and not(coalesce(quality_flags,'{}') && array['corrupt_text','incomplete_extraction']) and position(regexp_replace(u.evidence_quote,'\s+',' ','g') in regexp_replace(extracted_text,'\s+',' ','g'))>0) then raise exception 'Evidència canviada o no llegible';end if;
 select p.* into strict base from service_provisions p join record_units legacy on legacy.id=p.unit_id where p.source_record_id=r.id and legacy.unit_key='legacy';
 insert into service_provisions(unit_id,source_record_id,source_id,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,review_decision_id,approved_at,call_url,regulatory_basis_url,centre,period,act_type,annex_reference)
 values(u.id,r.id,base.source_id,u.provider_name,u.provider_nif,base.mechanism,base.award_date,u.amount,base.contracting_body,base.target_population,base.source_reference,u.service_code,u.catalog_version_id,base.review_decision_id,now(),base.call_url,base.regulatory_basis_url,u.centre,u.period,u.act_type,(select url from source_documents where id=u.document_id)||' · p. '||u.page)
 returning id into pid;
 update service_provisions set superseded_at=coalesce(superseded_at,now()) where id=base.id;
 delete from entity_catalog_relations where source_type='provision' and source_reference=base.id::text;
 update record_units set status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
 return pid;
end $$;
revoke all on function public.bind_legacy_provision_unit(), public.save_record_unit(uuid,uuid,jsonb), public.review_record_unit(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.bind_legacy_provision_unit(), public.save_record_unit(uuid,uuid,jsonb), public.review_record_unit(uuid,uuid,boolean,text) to service_role;
