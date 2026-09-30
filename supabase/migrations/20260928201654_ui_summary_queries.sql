create extension if not exists pg_trgm with schema extensions;

create index if not exists source_records_title_trgm_idx
  on public.source_records using gin (lower(title) extensions.gin_trgm_ops);
create index if not exists source_records_external_id_trgm_idx
  on public.source_records using gin (lower(source_record_id) extensions.gin_trgm_ops);
create index if not exists source_records_provider_trgm_idx
  on public.source_records using gin (lower(provider_name) extensions.gin_trgm_ops);
create index if not exists entities_legal_name_trgm_idx
  on public.entities using gin (lower(legal_name) extensions.gin_trgm_ops);
create index if not exists entities_nif_lower_idx on public.entities (lower(nif));
create index if not exists reses_services_county_entity_idx
  on public.reses_services (county, entity_id);
create index if not exists pipeline_runs_created_at_idx
  on public.pipeline_runs (created_at desc, id desc);

create or replace function public.navigation_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'review', count(*) filter (where destination = 'review'),
    'issues', count(*) filter (where destination = 'issues'),
    'approved', count(*) filter (where destination = 'approved'),
    'discarded', count(*) filter (where destination = 'discarded')
  )
  from public.current_record_results;
$$;

revoke all on function public.navigation_counts() from public, anon, authenticated;
grant execute on function public.navigation_counts() to service_role;

create or replace function public.entity_directory_facets()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'counties', coalesce((select jsonb_agg(value order by value) from (select distinct county as value from public.reses_services where county is not null and btrim(county) <> '') facet), '[]'::jsonb),
    'qualifications', coalesce((select jsonb_agg(value order by value) from (select distinct qualification as value from public.entities where qualification is not null and btrim(qualification) <> '') facet), '[]'::jsonb)
  );
$$;

revoke all on function public.entity_directory_facets() from public, anon, authenticated;
grant execute on function public.entity_directory_facets() to service_role;

create or replace view public.pipeline_run_summaries with (security_invoker = true) as
select
  r.*,
  coalesce(j.total, 0)::integer as jobs_total,
  coalesce(j.reviewed_count, 0)::integer as derived_reviewed_count,
  coalesce(j.rejected_count, 0)::integer as derived_rejected_count,
  coalesce(j.insufficient_count, 0)::integer as derived_insufficient_count,
  coalesce(p.provision_count, 0)::integer as provision_count
from public.pipeline_runs r
left join lateral (
  select
    count(*) as total,
    count(*) filter (where status = 'needs_review') as review_count,
    count(*) filter (where status in ('approved', 'corrected', 'rejected', 'insufficient_evidence')) as reviewed_count,
    count(*) filter (where status in ('approved', 'corrected')) as approved_count,
    count(*) filter (where status = 'rejected') as rejected_count,
    count(*) filter (where status = 'insufficient_evidence') as insufficient_count,
    count(*) filter (where status = 'error') as error_count
  from public.pipeline_jobs
  where run_id = r.id
) j on true
left join lateral (
  select count(distinct sp.id) as provision_count
  from public.pipeline_jobs pj
  join public.review_decisions rd on rd.pipeline_job_id = pj.id
  join public.service_provisions sp on sp.review_decision_id = rd.id
  where pj.run_id = r.id
) p on true;

revoke all on public.pipeline_run_summaries from public, anon, authenticated;
grant select on public.pipeline_run_summaries to service_role;

comment on view public.pipeline_run_summaries is
  'Resum lleuger per llistar lots sense carregar documents, evidències, candidats ni historial.';
