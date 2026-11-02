-- PRIVATE: table-returning function to test PostgREST's real FK embeddings.
-- This candidate is not granted to production roles and does not alter legacy.
create function public.experimental_combined_provisions() returns setof public.service_provisions
language sql stable security definer set search_path=pg_catalog,public as $$
 select p.* from public.conveni_reviewed_provisions p
 union all
 select (jsonb_populate_record(null::public.service_provisions,to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
 from public.concert_line_awards a
 join public.concert_line_financing_projection v on v.finance_id=a.id and v.provenance='line_experiment'
$$;
revoke all on function public.experimental_combined_provisions() from public,anon,authenticated,service_role;
