-- Preserve the exact deployed historical predicate and filter only new
-- candidate provisions whose receipt no longer matches current dependencies.
-- This does not grant the closed first-provision wrapper or enable exports.
do $$
declare definition text;
begin
 definition:=pg_get_viewdef('public.conveni_reviewed_provisions'::regclass,true);
 if definition is null then raise exception 'CONVENI_VISIBILITY_BASE_MISSING';end if;
 execute 'create view public.conveni_reviewed_provisions_base with (security_invoker=true) as '||definition;
end $$;
revoke all on public.conveni_reviewed_provisions_base from public,anon,authenticated;
grant select on public.conveni_reviewed_provisions_base to service_role;
create function public.conveni_first_candidate_visible(p_provision uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,conveni_first_candidate,storage,extensions as $$
 select not exists(select 1 from conveni_first_candidate.first_provision_receipts r where r.provision_id=p_provision)
  or conveni_first_candidate.first_provision_current(p_provision)
$$;
revoke all on function public.conveni_first_candidate_visible(uuid) from public,anon,authenticated,service_role;
grant execute on function public.conveni_first_candidate_visible(uuid) to service_role;
create or replace view public.conveni_reviewed_provisions with (security_invoker=true) as
 select p.* from public.conveni_reviewed_provisions_base p where public.conveni_first_candidate_visible(p.id);
