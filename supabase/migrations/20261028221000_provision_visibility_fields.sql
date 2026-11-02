-- Computed fields for existing PostgREST embeddings. They do not mutate the
-- reviewed provision, entity relation, decisions, or historical counters.
create or replace function public.provision_is_current(p public.service_provisions) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(p.superseded_at is null and exists(
  select 1 from public.conveni_reviewed_provisions current_provision
  where current_provision.id=p.id and current_provision.superseded_at is null
 ),false)
$$;

create or replace function public.entity_relation_is_current(p public.entity_catalog_relations) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(p.retired_at is null and case p.source_type
  when 'reses' then true
  when 'provision' then exists(
   select 1 from public.conveni_reviewed_provisions current_provision
   where current_provision.id::text=p.source_reference and current_provision.superseded_at is null
  )
  else false end,false)
$$;

revoke all on function public.provision_is_current(public.service_provisions) from public,anon,authenticated;
revoke all on function public.entity_relation_is_current(public.entity_catalog_relations) from public,anon,authenticated;
grant execute on function public.provision_is_current(public.service_provisions) to service_role;
grant execute on function public.entity_relation_is_current(public.entity_catalog_relations) to service_role;
