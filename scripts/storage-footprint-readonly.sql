-- Physical PostgreSQL footprint of the relations involved in snapshot growth.
-- Run only against a deliberately selected database with a read-only role.
-- The output contains aggregate metadata, never payloads or record identifiers.
-- It does not measure Vercel Sandbox snapshots or Supabase Storage objects.
begin read only;
set local statement_timeout = '15s';

with wanted(name) as (values
  ('cloud_checkpoints'),
  ('job_snapshots'),
  ('document_versions'),
  ('job_document_versions'),
  ('comparison_members'),
  ('provider_calls')
), relations as (
  select w.name, c.oid, c.reltoastrelid, s.n_live_tup, s.last_analyze, s.last_autoanalyze
  from wanted w
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = w.name
    and c.relkind = 'r'
  left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
)
select name as relation, oid is not null as present,
  pg_catalog.pg_relation_size(oid) as main_bytes,
  pg_catalog.pg_indexes_size(oid) as index_bytes,
  case when oid is null then null when reltoastrelid <> 0 then pg_catalog.pg_total_relation_size(reltoastrelid) else 0 end as toast_total_bytes,
  pg_catalog.pg_total_relation_size(oid) as total_bytes,
  n_live_tup as estimated_live_rows, last_analyze, last_autoanalyze
from relations
order by name;

commit;
