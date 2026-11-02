-- Experimental read-only projection for one batch.  The function is STABLE:
-- all constituent reads use the snapshot of its calling SQL statement.  It
-- does not certify physical Excel bytes, create a receipt, or guarantee the
-- data is still current after the statement finishes.  It is deliberately
-- private and must not be connected to the export endpoint yet.
create function public.batch_export_snapshot_prototype(p_run uuid)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public, extensions as $$
with run_ as (
  select r.id, r.batch_number, r.status from public.pipeline_runs r where r.id = p_run
), jobs_ as (
  select j.id, j.source_record_id from public.pipeline_jobs j where j.run_id = p_run
), records_ as (
  select distinct source_record_id from jobs_
), provisions_ as (
  select p.*, o.service_name as official_name, m.service_name as master_name
  from public.conveni_reviewed_provisions p
  join records_ r on r.source_record_id=p.source_record_id
  left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code
  left join public.master_services m on m.service_code=p.historical_master_code
  where p.superseded_at is null
), pending_ as (
  select u.id, u.source_record_id from public.record_units u
  join records_ r on r.source_record_id=u.source_record_id
  where u.unit_key <> 'legacy' and u.status='draft'
), body_ as (
  select jsonb_build_object(
    'schema_version', 1,
    'run', (select to_jsonb(r) from run_ r),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from jobs_ j), '[]'::jsonb),
    'record_ids', coalesce((select jsonb_agg(r.source_record_id order by r.source_record_id) from records_ r), '[]'::jsonb),
    'pending_units', coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from pending_ u), '[]'::jsonb),
    'provisions', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'source_record_id',p.source_record_id,'source_id',p.source_id,'unit_id',p.unit_id,
      'centre',p.centre,'period',p.period,'act_type',p.act_type,'annex_reference',p.annex_reference,
      'call_url',p.call_url,'regulatory_basis_url',p.regulatory_basis_url,'provider_name',p.provider_name,
      'provider_nif',p.provider_nif,'mechanism',p.mechanism,'award_date',p.award_date,'amount',p.amount,
      'contracting_body',p.contracting_body,'target_population',p.target_population,'source_reference',p.source_reference,
      'service_code',p.service_code,
      'official_services',case when p.official_name is null then null else jsonb_build_object('service_name',p.official_name) end,
      'master_services',case when p.master_name is null then null else jsonb_build_object('service_name',p.master_name) end
    ) order by p.id) from provisions_ p), '[]'::jsonb)
  ) as body
)
select jsonb_build_object('body',body,'fingerprint','batch-export-v1:'||encode(extensions.digest(body::text,'sha256'),'hex'))
from body_
$$;
revoke all on function public.batch_export_snapshot_prototype(uuid) from public, anon, authenticated, service_role;
