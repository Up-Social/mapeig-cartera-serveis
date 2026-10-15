-- Documentary proposals never assign a current holder or create canonical entities.
create function public.reses_proposal_fingerprint(p jsonb) returns text language sql immutable strict set search_path=public as $$
 select md5(((p-'evidence') || jsonb_build_object('evidence',
  (select jsonb_agg(e-'storage_path' order by (e-'storage_path')::text) from jsonb_array_elements(p->'evidence') e)))::text)
$$;
revoke all on function public.reses_proposal_fingerprint(jsonb) from public,anon,authenticated;
create table public.reses_identity_proposals (
 id uuid primary key default gen_random_uuid(),
 operation_key text not null,
 registry_number text not null references public.reses_services(registry_number) on delete restrict,
 payload jsonb not null,
 fingerprint text generated always as (public.reses_proposal_fingerprint(payload)) stored,
 recorded_by text not null,
 created_at timestamptz not null default now(),
 unique(operation_key,registry_number),
 unique(registry_number,fingerprint)
);
create table public.reses_identity_proposal_events (
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.reses_identity_proposals(id) on delete restrict,
 kind text not null check(kind in ('recorded','withdrawn')),
 actor text not null,
 reason text not null,
 created_at timestamptz not null default now(),
 unique(proposal_id,kind)
);
alter table public.reses_identity_proposals enable row level security;
alter table public.reses_identity_proposal_events enable row level security;
revoke all on public.reses_identity_proposals,public.reses_identity_proposal_events from public,anon,authenticated,service_role;
grant select on public.reses_identity_proposals,public.reses_identity_proposal_events to service_role;
create view public.reses_identity_proposal_overview with(security_invoker=true) as
 select p.*, exists(select 1 from public.reses_identity_proposal_events e where e.proposal_id=p.id and e.kind='withdrawn') as withdrawn
 from public.reses_identity_proposals p;
revoke all on public.reses_identity_proposal_overview from public,anon,authenticated;
grant select on public.reses_identity_proposal_overview to service_role;

create function public.record_reses_identity_proposals(p_operation text,p_manifest jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item jsonb; evidence jsonb; prior jsonb; current_service reses_services; new_id uuid; n integer;
begin
 if coalesce(p_operation,'') !~ '^[a-z0-9-]{8,100}$' or length(btrim(coalesce(p_actor,'')))<3
  or jsonb_typeof(p_manifest) is distinct from 'array' then raise exception 'Operació, manifest i persona executora obligatoris';end if;
 n:=jsonb_array_length(p_manifest);
 if n<1 or n>100 or n<>(select count(distinct x->>'registry_number') from jsonb_array_elements(p_manifest) x) then raise exception 'Manifest buit, duplicat o massa gran';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation,720));
 select jsonb_agg(payload order by registry_number) into prior from reses_identity_proposals where operation_key=p_operation;
 if prior is not null then
  if prior<>(select jsonb_agg(x order by x->>'registry_number') from jsonb_array_elements(p_manifest) x) then raise exception 'Operació reutilitzada amb dades diferents';end if;
  if exists(select 1 from reses_identity_proposal_events e join reses_identity_proposals p on p.id=e.proposal_id where p.operation_key=p_operation and e.kind='withdrawn') then raise exception 'Propostes retirades; no es poden reactivar amb un reintent';end if;
  return jsonb_build_object('status','already_applied','proposals',n);
 end if;
 -- Lock in a stable order. An official synchronization cannot change the source mid-operation.
 perform 1 from reses_services where registry_number in (select x->>'registry_number' from jsonb_array_elements(p_manifest) x) order by registry_number for update;
 for item in select value from jsonb_array_elements(p_manifest) loop
  select * into current_service from reses_services where registry_number=item->>'registry_number';
  if not found or current_service.entity_id is not null or current_service.source_payload_hash is distinct from item->>'source_payload_hash' then raise exception 'Servei, titular o font diferents de l’inventari';end if;
  if coalesce(item->>'role','') not in ('documented_provider','public_responsibility')
   or length(btrim(coalesce(item->>'proposed_name','')))<3
   or coalesce(item->>'proposed_nif','') !~ '^[A-Z][0-9]{7}[A-Z0-9]$'
   or length(btrim(coalesce(item->>'limitations','')))<20
   or jsonb_typeof(item->'evidence') is distinct from 'array' then raise exception 'Proposta sense rol, identitat, limitacions o evidències';end if;
  if jsonb_array_length(item->'evidence')<1 or jsonb_array_length(item->'evidence')>10 then raise exception 'Evidències obligatòries';end if;
  if nullif(item->>'supported_from','')::date > nullif(item->>'supported_to','')::date then raise exception 'Període invàlid';end if;
  for evidence in select value from jsonb_array_elements(item->'evidence') loop
   if coalesce(evidence->>'url','') !~ '^https://[^/ ]+/' or length(btrim(coalesce(evidence->>'description','')))<10
    or coalesce(evidence->>'sha256','') !~ '^[a-f0-9]{64}$'
    or evidence->>'storage_path' is distinct from 'references/reses/'||(item->>'registry_number')||'/proposals/'||p_operation||'/'||(evidence->>'sha256')||'.'||(evidence->>'format')
    or coalesce(evidence->>'format','') not in ('pdf','html')
    or (evidence->>'format'='pdf' and coalesce(evidence->>'page','') !~ '^[1-9][0-9]*$')
    or nullif(evidence->>'consulted_at','')::date is null then raise exception 'Evidència sense font, pàgina, data o còpia traçable';end if;
  end loop;
  insert into reses_identity_proposals(operation_key,registry_number,payload,recorded_by)
  values(p_operation,current_service.registry_number,item,p_actor) returning id into new_id;
  insert into reses_identity_proposal_events(proposal_id,kind,actor,reason)
  values(new_id,'recorded',p_actor,'Proposta documental incorporada. Titularitat actual no confirmada.');
 end loop;
 return jsonb_build_object('status','applied','proposals',n);
end $$;
revoke all on function public.record_reses_identity_proposals(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_reses_identity_proposals(text,jsonb,text) to service_role;

create function public.withdraw_reses_identity_proposals(p_operation text,p_actor text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if length(btrim(coalesce(p_actor,'')))<3 or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Persona i motiu de retirada obligatoris';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation,720));
 if not exists(select 1 from reses_identity_proposals where operation_key=p_operation) then raise exception 'Operació inexistent';end if;
 insert into reses_identity_proposal_events(proposal_id,kind,actor,reason)
 select id,'withdrawn',p_actor,p_reason from reses_identity_proposals where operation_key=p_operation
 on conflict(proposal_id,kind) do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('status',case when n=0 then 'already_withdrawn' else 'withdrawn' end,'proposals',n);
end $$;
revoke all on function public.withdraw_reses_identity_proposals(text,text,text) from public,anon,authenticated;
grant execute on function public.withdraw_reses_identity_proposals(text,text,text) to service_role;
notify pgrst,'reload schema';
