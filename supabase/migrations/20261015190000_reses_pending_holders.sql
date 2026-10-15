-- Additive support for valid services whose official source omits their holder.
-- Data repair is a separate, manifest-guarded RPC; this migration changes no assignments.
alter table public.reses_services alter column entity_id drop not null;
alter table public.entity_catalog_relations add column retired_at timestamptz;
alter table public.entity_catalog_relations add column retirement_reason text;

create table public.reses_identity_operations (
 operation_key text primary key,
 kind text not null check(kind in ('repair','rollback')),
 entity_id uuid not null references public.entities(id) on delete restrict,
 reverses text unique references public.reses_identity_operations(operation_key) on delete restrict,
 actor text not null check(length(btrim(actor))>=3),
 before_state jsonb not null,
 after_state jsonb not null,
 created_at timestamptz not null default now()
);
create table public.reses_holder_history (
 id uuid primary key default gen_random_uuid(),
 registry_number text not null references public.reses_services(registry_number) on delete restrict,
 operation_key text references public.reses_identity_operations(operation_key) deferrable initially deferred,
 actor text not null,
 reason text not null,
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default now()
);
create index reses_holder_history_registry_idx on public.reses_holder_history(registry_number,created_at);
create table public.reses_catalog_observations (
 id uuid primary key default gen_random_uuid(),
 registry_number text not null references public.reses_services(registry_number) on delete restrict,
 service_code text not null references public.master_services(service_code) on update cascade on delete restrict,
 source_relation_id uuid unique references public.entity_catalog_relations(id) on delete restrict,
 source_payload_hash text not null,
 evidence text,
 retired_at timestamptz,
 retirement_reason text,
 created_at timestamptz not null default now(),
 unique(registry_number,service_code)
);
alter table public.reses_identity_operations enable row level security;
alter table public.reses_holder_history enable row level security;
alter table public.reses_catalog_observations enable row level security;
revoke all on public.reses_identity_operations,public.reses_holder_history,public.reses_catalog_observations from public,anon,authenticated,service_role;
grant select on public.reses_identity_operations,public.reses_holder_history to service_role;
grant select,insert,update on public.reses_catalog_observations to service_role;

create function public.track_reses_holder() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' or old.entity_id is distinct from new.entity_id or old.source_payload_hash is distinct from new.source_payload_hash then
  insert into reses_holder_history(registry_number,operation_key,actor,reason,before_state,after_state)
  values(new.registry_number,nullif(current_setting('app.reses_operation',true),''),
    coalesce(nullif(current_setting('app.reses_actor',true),''),'Sincronització RESES'),
    coalesce(nullif(current_setting('app.reses_reason',true),''),'Canvi de titularitat o de font RESES'),
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
 end if;
 return new;
end $$;
create trigger reses_holder_audit after insert or update on public.reses_services for each row execute function public.track_reses_holder();
revoke all on function public.track_reses_holder() from public,anon,authenticated;

create function public.ensure_reses_entity(p_nif text,p_name text,p_qualification text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid; n text:=upper(regexp_replace(btrim(coalesce(p_nif,'')),'[\s.-]','','g'));
begin
 if n !~ '^([0-9]{8}[A-Z]|[A-Z][0-9]{7}[A-Z0-9])$' or btrim(coalesce(p_name,''))='' or lower(btrim(p_name)) in ('null','undefined') then
  raise exception 'Identitat RESES absent o amb format invàlid';
 end if;
 -- Same NIF cannot be created twice by concurrent imports. Retired entities are not reactivated.
 perform pg_advisory_xact_lock(hashtextextended(n,719));
 select id into result from entities where nif=n and active;
 if result is not null then return result; end if;
 if exists(select 1 from entities where nif=n) then return null; end if;
 insert into entities(nif,legal_name,normalized_name,qualification,validation_status,active)
 values(n,btrim(p_name),lower(btrim(p_name)),p_qualification,'reses_verified',true)
 on conflict(nif) where nif is not null do nothing returning id into result;
 if result is null then select id into result from entities where nif=n and active; end if;
 return result;
end $$;
revoke all on function public.ensure_reses_entity(text,text,text) from public,anon,authenticated;
grant execute on function public.ensure_reses_entity(text,text,text) to service_role;

-- One snapshot format for repair, guarded rollback and private evidence exports.
create function public.reses_identity_snapshot(p_entity uuid,p_manifest jsonb) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'manifest',p_manifest,
  'entity',(select to_jsonb(e) from entities e where id=p_entity),
  'aliases',coalesce((select jsonb_agg(to_jsonb(a) order by id) from entity_aliases a where entity_id=p_entity),'[]'::jsonb),
  'services',coalesce((select jsonb_agg(to_jsonb(s) order by registry_number) from reses_services s where registry_number in (select x->>'registry_number' from jsonb_array_elements(p_manifest) x)),'[]'::jsonb),
  'relations',coalesce((select jsonb_agg(to_jsonb(r) order by id) from entity_catalog_relations r where entity_id=p_entity),'[]'::jsonb),
  'observations',coalesce((select jsonb_agg(to_jsonb(o) order by id) from reses_catalog_observations o where registry_number in (select x->>'registry_number' from jsonb_array_elements(p_manifest) x)),'[]'::jsonb),
  'total_services',(select count(*) from reses_services),
  'unaffected_hash',(select md5(coalesce(jsonb_agg(to_jsonb(s) order by registry_number)::text,'')) from reses_services s where registry_number not in (select x->>'registry_number' from jsonb_array_elements(p_manifest) x)),
  'provisions_hash',(select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) from service_provisions p)
 )
$$;
revoke all on function public.reses_identity_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reses_identity_snapshot(uuid,jsonb) to service_role;

create function public.repair_reses_missing_holder(p_entity uuid,p_manifest jsonb,p_operation text,p_actor text,p_total integer,p_relations integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare before_doc jsonb; after_doc jsonb; previous reses_identity_operations; n integer;
begin
 if length(btrim(coalesce(p_operation,'')))<8 or length(btrim(coalesce(p_actor,'')))<3 or jsonb_typeof(p_manifest)<>'array' or jsonb_array_length(p_manifest)=0 then raise exception 'Manifest, operació i persona executora obligatoris';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation,719));
 select * into previous from reses_identity_operations where operation_key=p_operation;
 if found then
  if previous.kind<>'repair' or previous.entity_id<>p_entity or previous.before_state->'manifest'<>p_manifest then raise exception 'Clau d’operació reutilitzada amb un abast diferent';end if;
  if exists(select 1 from reses_identity_operations where reverses=p_operation) then raise exception 'Operació revertida; cal un nou inventari';end if;
  return jsonb_build_object('status','already_applied','services',jsonb_array_length(p_manifest));
 end if;
 lock table reses_services,entities,entity_catalog_relations in share row exclusive mode;
 select count(distinct x->>'registry_number') into n from jsonb_array_elements(p_manifest) x;
 if n<>jsonb_array_length(p_manifest) then raise exception 'Manifest duplicat';end if;
 before_doc:=reses_identity_snapshot(p_entity,p_manifest);
 if (before_doc->>'total_services')::integer<>p_total or jsonb_array_length(before_doc->'services')<>n
  or (select count(*) from reses_services where entity_id=p_entity)<>n then raise exception 'Han canviat els recomptes RESES';end if;
 if not exists(select 1 from entities where id=p_entity and lower(btrim(legal_name)) in ('null','undefined') and lower(btrim(nif)) in ('null','undefined') and active) then raise exception 'L’entitat ja no és el marcador buit inventariat';end if;
 if exists(select 1 from jsonb_array_elements(p_manifest) x left join reses_services s on s.registry_number=x->>'registry_number'
  where s.entity_id is distinct from p_entity or s.source_payload_hash is distinct from x->>'source_payload_hash'
   or coalesce(lower(btrim(s.source_payload->>'nif')),'')<>'null' or coalesce(lower(btrim(s.source_payload->>'entitat_titular')),'')<>'null') then raise exception 'Identitat o font diferent del manifest';end if;
 if exists(select 1 from service_provisions where entity_id=p_entity) or exists(select 1 from source_record_entities where entity_id=p_entity) or exists(select 1 from entity_mentions where entity_id=p_entity) then raise exception 'L’entitat té noves dependències; revisar abans de corregir';end if;
 if jsonb_array_length(before_doc->'relations')<>p_relations or exists(select 1 from entity_catalog_relations where entity_id=p_entity and (relation_type<>'auxiliary' or source_type<>'reses' or retired_at is not null or source_reference not in (select x->>'registry_number' from jsonb_array_elements(p_manifest) x))) then raise exception 'Relacions diferents de les auxiliars inventariades';end if;
 if jsonb_array_length(before_doc->'observations')<>0 then raise exception 'Ja hi ha observacions per aquests serveis; cal conciliar-les';end if;
 perform set_config('app.reses_operation',p_operation,true);
 perform set_config('app.reses_actor',p_actor,true);
 perform set_config('app.reses_reason','La font oficial no identifica el titular; es conserva el servei RESES',true);
 insert into reses_catalog_observations(registry_number,service_code,source_relation_id,source_payload_hash,evidence)
 select r.source_reference,r.service_code,r.id,s.source_payload_hash,r.evidence from entity_catalog_relations r join reses_services s on s.registry_number=r.source_reference where r.entity_id=p_entity;
 update reses_services set entity_id=null,updated_at=now() where entity_id=p_entity;
 update entity_catalog_relations set retired_at=now(),retirement_reason='Atribució a un titular no identificat; observació conservada per RESES',updated_at=now() where entity_id=p_entity;
 update entities set nif=null,active=false,validation_status='unverified',updated_at=now() where id=p_entity;
 after_doc:=reses_identity_snapshot(p_entity,p_manifest);
 if after_doc->'unaffected_hash'<>before_doc->'unaffected_hash' or after_doc->'provisions_hash'<>before_doc->'provisions_hash' or after_doc->'total_services'<>before_doc->'total_services' or jsonb_array_length(after_doc->'observations')<>p_relations then raise exception 'No es conserven les invariants';end if;
 insert into reses_identity_operations(operation_key,kind,entity_id,actor,before_state,after_state) values(p_operation,'repair',p_entity,p_actor,before_doc,after_doc);
 perform set_config('app.reses_operation','',true);
 perform set_config('app.reses_actor','',true);
 perform set_config('app.reses_reason','',true);
 return jsonb_build_object('status','applied','services',n,'observations',p_relations,'total_services',p_total);
end $$;
revoke all on function public.repair_reses_missing_holder(uuid,jsonb,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.repair_reses_missing_holder(uuid,jsonb,text,text,integer,integer) to service_role;

create function public.rollback_reses_holder_repair(p_operation text,p_actor text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare op reses_identity_operations; current_doc jsonb; v jsonb; rollback_key text:=p_operation||':rollback';
begin
 if length(btrim(coalesce(p_actor,'')))<3 then raise exception 'Persona executora obligatòria';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation,719));
 select * into op from reses_identity_operations where operation_key=p_operation and kind='repair';
 if not found then raise exception 'Operació de correcció inexistent';end if;
 if exists(select 1 from reses_identity_operations where reverses=p_operation) then return jsonb_build_object('status','already_reverted');end if;
 lock table reses_services,entities,entity_catalog_relations in share row exclusive mode;
 current_doc:=reses_identity_snapshot(op.entity_id,op.before_state->'manifest');
 -- Compare the affected rows only. Independent updates to other services/provisions are preserved.
 if current_doc->'services'<>op.after_state->'services' or current_doc->'entity'<>op.after_state->'entity' or current_doc->'relations'<>op.after_state->'relations' or current_doc->'aliases'<>op.after_state->'aliases' or current_doc->'observations'<>op.after_state->'observations' then raise exception 'Canvis posteriors detectats; reversió aturada per preservar-los';end if;
 perform set_config('app.reses_operation',rollback_key,true);
 perform set_config('app.reses_actor',p_actor,true);
 perform set_config('app.reses_reason','Reversió explícita de la correcció de titularitat; historial conservat',true);
 v:=op.before_state->'entity';
 update entities set nif=v->>'nif',active=(v->>'active')::boolean,validation_status=v->>'validation_status',updated_at=(v->>'updated_at')::timestamptz where id=op.entity_id;
 for v in select value from jsonb_array_elements(op.before_state->'services') loop
  update reses_services set entity_id=(v->>'entity_id')::uuid,updated_at=(v->>'updated_at')::timestamptz where registry_number=v->>'registry_number';
 end loop;
 for v in select value from jsonb_array_elements(op.before_state->'relations') loop
  update entity_catalog_relations set retired_at=(v->>'retired_at')::timestamptz,retirement_reason=v->>'retirement_reason',updated_at=(v->>'updated_at')::timestamptz where id=(v->>'id')::uuid;
 end loop;
 update reses_catalog_observations set retired_at=now(),retirement_reason='Reversió '||p_operation where source_relation_id in (select (x->>'id')::uuid from jsonb_array_elements(op.before_state->'relations') x);
 insert into reses_identity_operations(operation_key,kind,entity_id,reverses,actor,before_state,after_state)
 values(rollback_key,'rollback',op.entity_id,p_operation,p_actor,current_doc,reses_identity_snapshot(op.entity_id,op.before_state->'manifest'));
 perform set_config('app.reses_operation','',true);perform set_config('app.reses_actor','',true);perform set_config('app.reses_reason','',true);
 return jsonb_build_object('status','reverted','services',jsonb_array_length(op.before_state->'services'));
end $$;
revoke all on function public.rollback_reses_holder_repair(text,text) from public,anon,authenticated;
grant execute on function public.rollback_reses_holder_repair(text,text) to service_role;
notify pgrst,'reload schema';
