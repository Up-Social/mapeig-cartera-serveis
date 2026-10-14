-- Additive review state. Source lines, documents and earlier decisions are retained.
alter table public.concert_unit_links add column version integer not null default 1;
alter table public.concert_unit_links drop constraint concert_unit_links_relation_kind_check;
alter table public.concert_unit_links add constraint concert_unit_links_relation_kind_check
 check(relation_kind in ('amendment','renewal','modification','delta','replacement','termination','cession','appeal','validation'));
create unique index concert_one_confirmed_predecessor on public.concert_unit_links(later_unit_id) where status='confirmed';

create table public.concert_economic_reviews (
 unit_id uuid primary key references public.record_units(id),
 version integer not null check(version>0),
 status text not null check(status in ('draft','approved','excluded')),
 source_fingerprint text not null,
 expected_job_id uuid not null references public.pipeline_jobs(id),
 operation text not null check(operation in ('award','renewal','delta','replacement','nonfinancial','correction')),
 amount_cents bigint check(abs(amount_cents::numeric)<=9007199254740991),
 amount_kind text not null check(amount_kind in ('exact','maximum','unknown')),
 annualities jsonb not null default '[]'::jsonb check(jsonb_typeof(annualities)='array'),
 period_start date,
 period_end date,
 effective_at date,
 funder text,
 corrects_unit_id uuid references public.record_units(id),
 evidence_quote text not null check(length(trim(evidence_quote))>=20),
 review_note text not null check(length(trim(review_note))>=10),
 updated_at timestamptz not null default now(),
 check(period_start is null or period_end is null or period_end>=period_start),
 check(operation='correction' or corrects_unit_id is null),
 check(corrects_unit_id is distinct from unit_id)
);
alter table public.concert_economic_reviews enable row level security;
grant select on public.concert_economic_reviews to service_role;

create table public.concert_review_audit (
 id bigint generated always as identity primary key,
 kind text not null check(kind in ('link','economic')),
 subject_id uuid not null,
 before_value jsonb,
 after_value jsonb not null,
 changed_at timestamptz not null default now()
);
alter table public.concert_review_audit enable row level security;
grant select on public.concert_review_audit to service_role;

create view public.concert_economic_source with (security_invoker=true) as
 select u.*,md5(to_jsonb(u)::text) as source_fingerprint
 from public.record_units u join public.source_records r on r.id=u.source_record_id
 where r.financing_type='concert' and u.unit_key<>'legacy';
grant select on public.concert_economic_source to service_role;

-- Serialize the small review graph, then resolve the actual root inside the
-- transaction. Concurrent confirmations cannot create a cycle or two roots.
create or replace function public.validate_concert_unit_link() returns trigger language plpgsql security invoker set search_path=public as $$
declare later_row record_units; earlier_row record_units; root_row record_units;
 cursor_id uuid; parent_id uuid; visited uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('concert-review-graph',0));
 select * into strict later_row from record_units where id=new.later_unit_id;
 select * into strict earlier_row from record_units where id=new.earlier_unit_id;
 if later_row.source_record_id=earlier_row.source_record_id then raise exception 'La relació ha de creuar resolucions diferents';end if;
 if later_row.unit_key='legacy' or earlier_row.unit_key='legacy' then raise exception 'Una línia històrica global no pot ser origen acreditat';end if;
 if not exists(select 1 from source_records where id=later_row.source_record_id and financing_type='concert')
  or not exists(select 1 from source_records where id=earlier_row.source_record_id and financing_type='concert') then raise exception 'CONCERT_SCOPE';end if;
 if new.status='confirmed' then
  if later_row.status<>'approved' or earlier_row.status<>'approved' then raise exception 'Cal validar les línies abans de confirmar el vincle';end if;
  if length(trim(coalesce(new.review_note,'')))<10 or new.reviewed_at is null then raise exception 'Cal justificació i revisió humana';end if;
  if later_row.horizon_state in ('out_of_scope','pre_2024_origin_unavailable') or earlier_row.horizon_state in ('out_of_scope','pre_2024_origin_unavailable') then raise exception 'Origen fora de l’horitzó 2024';end if;
  if later_row.territory is not null and earlier_row.territory is not null and later_row.territory<>earlier_row.territory then raise exception 'Territoris incompatibles';end if;
  if later_row.act_type='award' then raise exception 'Una adjudicació inicial no pot tenir predecessor';end if;
  cursor_id:=new.earlier_unit_id;visited:=array[new.later_unit_id];
  loop
   if cursor_id=any(visited) then raise exception 'Cicle en la cadena del concert';end if;
   visited:=array_append(visited,cursor_id);
   select * into strict root_row from record_units where id=cursor_id;
   if root_row.status<>'approved' then raise exception 'Cadena pendent de revisió';end if;
   select earlier_unit_id into parent_id from concert_unit_links where later_unit_id=cursor_id and status='confirmed' and id<>new.id;
   if not found then exit;end if;
   cursor_id:=parent_id;
  end loop;
  if root_row.act_type<>'award' then raise exception 'Falta l’adjudicació original de la cadena';end if;
  if root_row.horizon_state in ('out_of_scope','pre_2024_origin_unavailable') then raise exception 'Origen fora de l’horitzó 2024';end if;
  new.root_unit_id:=cursor_id;
 end if;
 return new;
end $$;

create function public.review_concert_link(p_link uuid,p_version integer,p_later_fingerprint text,p_earlier_fingerprint text,p_status text,p_note text)
returns integer language plpgsql security definer set search_path=public as $$
declare old_row concert_unit_links; updated concert_unit_links;
begin
 perform pg_advisory_xact_lock(hashtextextended('concert-review-graph',0));
 select * into strict old_row from concert_unit_links where id=p_link for update;
 if old_row.version<>p_version then raise exception 'Revisió obsoleta; torna a carregar la fitxa';end if;
 if p_status not in ('confirmed','rejected','out_of_horizon') or length(trim(coalesce(p_note,'')))<10 then raise exception 'Revisió no vàlida';end if;
 if old_row.status='confirmed' and p_status<>'confirmed' and exists(select 1 from concert_unit_links where earlier_unit_id=old_row.later_unit_id and status='confirmed') then raise exception 'Revisa primer els vincles dependents abans de retirar aquest';end if;
 perform 1 from record_units where id in(old_row.later_unit_id,old_row.earlier_unit_id) order by id for update;
 if (select source_fingerprint from concert_economic_source where id=old_row.later_unit_id) is distinct from p_later_fingerprint
  or (select source_fingerprint from concert_economic_source where id=old_row.earlier_unit_id) is distinct from p_earlier_fingerprint then raise exception 'La línia ha canviat; torna a revisar-la';end if;
 update concert_unit_links set status=p_status,review_note=trim(p_note),reviewed_at=now(),version=version+1 where id=p_link returning * into updated;
 insert into concert_review_audit(kind,subject_id,before_value,after_value) values('link',p_link,to_jsonb(old_row),to_jsonb(updated));
 return updated.version;
end $$;
revoke all on function public.review_concert_link(uuid,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.review_concert_link(uuid,integer,text,text,text,text) to service_role;

create function public.review_concert_economics(p_unit uuid,p_version integer,p_fingerprint text,p_job uuid,p_value jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare u record_units; d source_documents; old_row concert_economic_reviews; new_row concert_economic_reviews;latest_job pipeline_jobs;quote text;
begin
 perform pg_advisory_xact_lock(hashtextextended('concert-review-graph',0));
 select * into strict u from record_units where id=p_unit for update;
 if not exists(select 1 from source_records where id=u.source_record_id and financing_type='concert') or u.unit_key='legacy' then raise exception 'CONCERT_SCOPE';end if;
 select * into old_row from concert_economic_reviews where unit_id=p_unit for update;
 if coalesce(old_row.version,0)<>p_version then raise exception 'Revisió obsoleta; torna a carregar la fitxa';end if;
 if md5(to_jsonb(u)::text) is distinct from p_fingerprint then raise exception 'La línia ha canviat; torna a revisar-la';end if;
 select * into strict latest_job from pipeline_jobs where source_record_id=u.source_record_id order by created_at desc,id desc limit 1 for update;
 if latest_job.id<>p_job or latest_job.status not in ('needs_review','approved','corrected') then raise exception 'Anàlisi vigent no disponible';end if;
 select * into strict d from source_documents where id=u.document_id and source_record_id=u.source_record_id
  and status='fetched' and storage_path is not null and storage_sha256=u.storage_sha256
  and not coalesce(extraction_partial,false);
 quote:=trim(p_value->>'evidence_quote');
 if coalesce(length(quote),0)<20 or position(regexp_replace(quote,'\s+',' ','g') in regexp_replace(coalesce(d.extracted_text,''),'\s+',' ','g'))=0 then raise exception 'Cal una cita literal del PDF arxivat';end if;
 if p_value->>'status'='approved' then
  if u.status<>'approved' or latest_job.status not in ('approved','corrected') then raise exception 'Valida primer el resultat i les línies';end if;
  if u.horizon_state in ('out_of_scope','pre_2024_origin_unavailable') then raise exception 'Origen fora de l’horitzó 2024';end if;
  if nullif(p_value->>'period_start','') is null or nullif(p_value->>'period_end','') is null or nullif(p_value->>'effective_at','') is null
   or (p_value->>'period_start')::date<'2024-01-01' or length(trim(coalesce(p_value->>'funder','')))=0 then raise exception 'Cal acreditar període des de 2024, data d’efectes i finançador';end if;
  if p_value->>'operation' not in ('nonfinancial') and (p_value->>'amount_cents' is null or p_value->>'amount_kind' not in ('exact','maximum')) then raise exception 'Import no acreditat';end if;
  if p_value->>'operation' in ('award','renewal','replacement') and (p_value->>'amount_cents')::bigint<0 then raise exception 'La base o el total no poden ser negatius';end if;
  if p_value->>'operation'='nonfinancial' and nullif(p_value->>'amount_cents','') is not null then raise exception 'Un acte sense efecte econòmic no té import sumable';end if;
  if p_value->>'operation'='renewal' and u.act_type<>'renewal' then raise exception 'L’acte no és una pròrroga';end if;
  if u.act_type='award' and p_value->>'operation'<>'award' then raise exception 'La base ha de ser una adjudicació';end if;
  if u.act_type<>'award' and p_value->>'operation'='award' then raise exception 'Un canvi no pot duplicar l’adjudicació';end if;
  if u.act_type='cession' and p_value->>'operation'<>'nonfinancial' then raise exception 'La cessió no crea finançament';end if;
  if u.act_type<>'award' and not exists(select 1 from concert_unit_links where later_unit_id=u.id and status='confirmed') then raise exception 'Cal confirmar el vincle amb l’original';end if;
  if p_value->>'operation'='correction' and nullif(p_value->>'corrects_unit_id','') is null then raise exception 'Cal indicar l’acte que es corregeix';end if;
 end if;
 if jsonb_array_length(coalesce(p_value->'annualities','[]'::jsonb))>0 then
  if p_value->>'operation' not in ('award','renewal') or p_value->>'amount_cents' is null
   or (select sum((a->>'amountCents')::bigint) from jsonb_array_elements(p_value->'annualities') a) is distinct from (p_value->>'amount_cents')::bigint
   or exists(select 1 from jsonb_array_elements(p_value->'annualities') a where nullif(a->>'start','') is null or nullif(a->>'end','') is null
    or (a->>'start')::date<'2024-01-01' or (a->>'end')::date<(a->>'start')::date or (a->>'amountCents')::bigint<0
    or a->>'amountCents' is null or (a->>'start')::date<(p_value->>'period_start')::date or (a->>'end')::date>(p_value->>'period_end')::date)
   or exists(select 1 from jsonb_array_elements(p_value->'annualities') with ordinality a(value,n)
    join jsonb_array_elements(p_value->'annualities') with ordinality b(value,n) on a.n<b.n
    where (a.value->>'start')::date<=(b.value->>'end')::date and (a.value->>'end')::date>=(b.value->>'start')::date)
   then raise exception 'Anualitats invàlides o no conciliades';end if;
 end if;
 insert into concert_economic_reviews(unit_id,version,status,source_fingerprint,expected_job_id,operation,amount_cents,amount_kind,annualities,period_start,period_end,effective_at,funder,corrects_unit_id,evidence_quote,review_note)
 values(p_unit,p_version+1,p_value->>'status',p_fingerprint,p_job,p_value->>'operation',nullif(p_value->>'amount_cents','')::bigint,p_value->>'amount_kind',coalesce(p_value->'annualities','[]'::jsonb),
  nullif(p_value->>'period_start','')::date,nullif(p_value->>'period_end','')::date,nullif(p_value->>'effective_at','')::date,nullif(trim(p_value->>'funder'),''),
  nullif(p_value->>'corrects_unit_id','')::uuid,quote,trim(p_value->>'review_note'))
 on conflict(unit_id) do update set version=excluded.version,status=excluded.status,source_fingerprint=excluded.source_fingerprint,
 expected_job_id=excluded.expected_job_id,operation=excluded.operation,amount_cents=excluded.amount_cents,amount_kind=excluded.amount_kind,annualities=excluded.annualities,
 period_start=excluded.period_start,period_end=excluded.period_end,effective_at=excluded.effective_at,funder=excluded.funder,
 corrects_unit_id=excluded.corrects_unit_id,evidence_quote=excluded.evidence_quote,review_note=excluded.review_note,updated_at=now()
 returning * into new_row;
 insert into concert_review_audit(kind,subject_id,before_value,after_value) values('economic',p_unit,to_jsonb(old_row),to_jsonb(new_row));
 return new_row.version;
end $$;
revoke all on function public.review_concert_economics(uuid,integer,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.review_concert_economics(uuid,integer,text,uuid,jsonb) to service_role;

-- Retain nullable observations and printed dates. No guessed year, quantity or zero.
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb)'::regprocedure);
 patched:=replace(original,'quantity,status,extraction_origin,horizon_state)', 'quantity,effective_start,effective_end,status,extraction_origin,horizon_state)');
 patched:=replace(patched,$needle$(p_line->>'quantity')::integer,'draft',$needle$, $replacement$(p_line->>'quantity')::integer,nullif(p_line->>'effectiveStart','')::date,nullif(p_line->>'effectiveEnd','')::date,'draft',$replacement$);
 -- Use dollar quoted strings for the SQL function body replacements.
 if patched=original then raise exception 'Stage patch not applied';end if;
 execute patched;
end $$;

alter table public.record_units add column quantity_delta integer;
create function public.cloud_stage_concert_change_line(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_line jsonb
) returns uuid language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;d source_documents;existing record_units;uid uuid;identity text;q text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from pipeline_jobs where id=p_job;
 if not exists(select 1 from worker_tasks where id=p_task and (run_id=j.run_id or source_record_id=j.source_record_id))
  or not exists(select 1 from source_records where id=j.source_record_id and financing_type='concert') then raise exception 'CONCERT_SCOPE';end if;
 select * into strict d from source_documents where id=p_document and source_record_id=j.source_record_id and status='fetched'
  and mime_type like '%pdf%' and not coalesce(extraction_partial,false) and storage_path is not null and storage_sha256 is not null;
 if coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'] then raise exception 'CONCERT_DOCUMENT_QUALITY';end if;
 if coalesce(p_line->>'actType','') not in ('modification','termination') or coalesce((p_line->>'row')::integer,0)<1
  or coalesce((p_line->>'page')::integer,0)<1 or coalesce(p_line->>'nif','') !~ '^[A-Z][0-9]{7}[0-9A-Z]$'
  or coalesce(p_line->>'resesCode','') !~ '^S[0-9]{5}$' or coalesce(p_line->>'observedServiceCode','') !~ '^[0-9]+(\.[0-9]+){2,6}$'
  or p_line->>'amountCents' is null or abs((p_line->>'amountCents')::numeric)>9007199254740991
  or coalesce((p_line->>'quantityDelta')::integer,0)=0 then raise exception 'CONCERT_CHANGE_INVALID';end if;
 q:=trim(p_line->>'quote');
 if coalesce(length(q),0)<40 or position(regexp_replace(q,'\s+',' ','g') in regexp_replace(coalesce(d.extracted_text,''),'\s+',' ','g'))=0 then raise exception 'CONCERT_QUOTE_MISMATCH';end if;
 identity:='official-change:'||d.storage_sha256||':'||(p_line->>'row');
 select * into existing from record_units where source_record_id=j.source_record_id and unit_key=identity;
 if found then
  if existing.evidence_quote<>q or existing.amount is distinct from (p_line->>'amountCents')::numeric/100
   or existing.provider_nif is distinct from p_line->>'nif' or existing.reses_code is distinct from p_line->>'resesCode'
   or existing.observed_service_code is distinct from p_line->>'observedServiceCode' then raise exception 'CONCERT_CHANGE_CHANGED';end if;
  return existing.id;
 end if;
 insert into record_units(source_record_id,unit_key,provider_nif,observed_service_code,reses_code,provider_name,territory,act_type,amount,quantity_delta,
 document_id,page,evidence_quote,status,extraction_origin,horizon_state)
 values(j.source_record_id,identity,p_line->>'nif',p_line->>'observedServiceCode',p_line->>'resesCode',nullif(trim(p_line->>'registeredProviderName'),''),nullif(trim(p_line->>'territory'),''),p_line->>'actType',
 (p_line->>'amountCents')::numeric/100,(p_line->>'quantityDelta')::integer,d.id,(p_line->>'page')::integer,q,'draft','official-change-v1','undetermined') returning id into uid;
 return uid;
end $$;
revoke all on function public.cloud_stage_concert_change_line(uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_stage_concert_change_line(uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;

-- Human-assisted proposal for explicit references that are not machine-matchable
-- (including a documented transfer between two RESES). Still not a confirmation.
create function public.propose_concert_link(p_later uuid,p_earlier uuid,p_fingerprint text,p_quote text)
returns uuid language plpgsql security definer set search_path=public as $$
declare u record_units;previous record_units;d source_documents;lid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('concert-review-graph',0));
 select * into strict u from record_units where id=p_later for update;
 select * into strict previous from record_units where id=p_earlier;
 if md5(to_jsonb(u)::text) is distinct from p_fingerprint then raise exception 'La línia ha canviat';end if;
 if u.act_type not in ('renewal','amendment','modification','termination','cession','appeal','validation') then raise exception 'L’acte no modifica un concert';end if;
 select * into strict d from source_documents where id=u.document_id and status='fetched' and not coalesce(extraction_partial,false) and storage_sha256=u.storage_sha256 and storage_path is not null;
 if coalesce(length(trim(p_quote)),0)<20 or position(regexp_replace(trim(p_quote),'\s+',' ','g') in regexp_replace(coalesce(d.extracted_text,''),'\s+',' ','g'))=0 then raise exception 'Cal una cita literal del PDF posterior';end if;
 insert into concert_unit_links(later_unit_id,earlier_unit_id,root_unit_id,relation_kind,matching_method,evidence)
 values(u.id,previous.id,previous.id,u.act_type,'explicit_resolution','Proposta manual; cita literal: '||trim(p_quote))
 on conflict(later_unit_id,earlier_unit_id) do nothing returning id into lid;
 if lid is null then select id into strict lid from concert_unit_links where later_unit_id=u.id and earlier_unit_id=previous.id;else
 insert into concert_review_audit(kind,subject_id,after_value) select 'link',lid,to_jsonb(l) from concert_unit_links l where l.id=lid;end if;
 return lid;
end $$;
revoke all on function public.propose_concert_link(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.propose_concert_link(uuid,uuid,text,text) to service_role;
