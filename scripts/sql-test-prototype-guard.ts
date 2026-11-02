/** Refuse a persistent test schema polluted by the quarantined prototypes.
 * This is diagnostic only: it never removes schema objects or history. */
export const requireCleanPrototypeSchema = `
do $$
declare recorded boolean:=false;
begin
 if to_regclass('public.workflow_test_migrations') is not null then
  execute 'select exists(select 1 from public.workflow_test_migrations where left(name,14) in (''20261029031000'',''20261029032000'',''20261029033000'',''20261029034000''))' into recorded;
 end if;
 if not recorded and to_regclass('supabase_migrations.schema_migrations') is not null then
  execute 'select exists(select 1 from supabase_migrations.schema_migrations where version in (''20261029031000'',''20261029032000'',''20261029033000'',''20261029034000''))' into recorded;
 end if;
 if recorded or to_regclass('public.local_matching_group_reservations') is not null
  or to_regprocedure('public.local_verify_unique_matching_group(uuid,jsonb,text)') is not null
  or to_regprocedure('public.local_reserve_matching_group(uuid,jsonb)') is not null
  or to_regprocedure('public.batch_export_snapshot_prototype(uuid)') is not null
  or to_regprocedure('public.record_batch_export_snapshot_prototype(uuid,text,text,text)') is not null then
  raise exception 'TEST_SCHEMA_CONTAINS_QUARANTINED_PROTOTYPES: use a new isolated test database; existing data and history were not changed';
 end if;
end $$;`;
