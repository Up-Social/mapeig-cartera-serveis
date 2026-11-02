-- PostgREST computes the authoritative award before JSON numbers reach JS.
-- The helper returns NULL for unverified, ambiguous or imprecise inputs.
create function public.contract_verified_award(p_source public.source_records)
returns numeric language sql stable security invoker set search_path=public as $$
 select case when p_source.financing_type='contractacio' and p_source.source_dataset='contractacions'
  then public.contract_imported_award(p_source.source_payload,p_source.amount) else null end
$$;
revoke all on function public.contract_verified_award(public.source_records) from public,anon,authenticated;
grant execute on function public.contract_verified_award(public.source_records) to service_role;
notify pgrst,'reload schema';
