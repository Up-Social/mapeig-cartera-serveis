-- Inventory selected SQL-level access relevant to the future local matching
-- fence. Choose the target database deliberately and use a read-only role.
-- No application rows, SQL bodies, credentials or role membership lists are
-- returned. Role and routine names are operational metadata.
--
-- This is NOT proof that there are no other writers: it cannot inventory
-- external consumers, SECURITY DEFINER code paths, dynamic SQL, owner access,
-- application routing, or whether RLS policies permit a specific mutation.
-- Role inheritance is reflected by has_*_privilege. These are object grants:
-- they do not include schema USAGE, which must be checked separately. Explicitly
-- inspect role flags, schema permissions and RLS policies before any change.
begin read only;
set local statement_timeout = '15s';

-- Keep missing application roles and tables visible rather than treating them
-- as having zero access; the test target may not have the production schema.
with wanted_roles(name) as (values ('anon'), ('authenticated'), ('service_role')),
wanted_tables(name) as (values
 ('source_records'), ('pipeline_runs'), ('pipeline_jobs'), ('analysis_results'),
 ('matching_candidates'), ('review_decisions'), ('provider_calls'),
 ('local_matching_group_reservations')
), scopes as (
 select wr.name as role_name,r.oid as role_oid,r.rolsuper,r.rolbypassrls,
   wt.name as table_name,c.oid as table_oid,c.relrowsecurity,c.relforcerowsecurity
 from wanted_roles wr cross join wanted_tables wt
 left join pg_catalog.pg_roles r on r.rolname=wr.name
 left join pg_catalog.pg_namespace n on n.nspname='public'
 left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=wt.name and c.relkind in ('r','p')
)
select role_name, role_oid is not null as role_present, rolsuper, rolbypassrls,
 table_name, table_oid is not null as table_present, relrowsecurity, relforcerowsecurity,
 pg_catalog.has_table_privilege(role_oid,table_oid,'SELECT') as can_select,
 pg_catalog.has_table_privilege(role_oid,table_oid,'INSERT') as can_insert,
 pg_catalog.has_table_privilege(role_oid,table_oid,'UPDATE') as can_update,
 pg_catalog.has_table_privilege(role_oid,table_oid,'DELETE') as can_delete,
 pg_catalog.has_table_privilege(role_oid,table_oid,'TRUNCATE') as can_truncate,
 pg_catalog.has_table_privilege(role_oid,table_oid,'TRIGGER') as can_trigger
from scopes order by role_name,table_name;

-- List all overloads of selected historical and experimental entry points.
-- The absence of an entry means only that that exact name was not found.
with wanted_roles(name) as (values ('anon'), ('authenticated'), ('service_role')),
wanted_routines(name) as (values
 ('claim_provider_call'), ('persist_analysis'), ('cloud_commit_v1'),
 ('local_claim_matching_request'), ('local_verify_matching_input'),
 ('local_verify_unique_matching_group'), ('local_reserve_matching_group'),
 ('local_commit_matching')
), scopes as (
 select wr.name as role_name,r.oid as role_oid,wn.name as routine_name,p.oid as routine_oid,
  p.prosecdef,pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
 from wanted_roles wr cross join wanted_routines wn
 left join pg_catalog.pg_roles r on r.rolname=wr.name
 left join pg_catalog.pg_namespace n on n.nspname='public'
 left join pg_catalog.pg_proc p on p.pronamespace=n.oid and p.proname=wn.name and p.prokind in ('f','p')
)
select role_name,role_oid is not null as role_present,routine_name,
 routine_oid is not null as routine_present,arguments,prosecdef as security_definer,
 pg_catalog.has_function_privilege(role_oid,routine_oid,'EXECUTE') as can_execute
from scopes order by role_name,routine_name,arguments;

commit;
