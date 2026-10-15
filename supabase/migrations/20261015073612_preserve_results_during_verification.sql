-- Additive: comparative checks do not replace the effective human result.
alter table public.pipeline_jobs add column if not exists verification_only boolean not null default false;
comment on column public.pipeline_jobs.verification_only is
  'An explicit comparative verification: retained in batch history and costs, excluded from the current result.';

do $$
declare definition text; needle text := 'WHERE pipeline_jobs.source_record_id = r.id';
begin
  definition := pg_get_viewdef('public.current_record_results'::regclass, true);
  if position('NOT pipeline_jobs.verification_only' in definition) = 0 then
    if position(needle in definition) = 0 then raise exception 'Unexpected current result view; no change applied'; end if;
    definition := replace(definition, needle, needle || ' AND NOT pipeline_jobs.verification_only');
    execute 'create or replace view public.current_record_results with (security_invoker=true) as ' || definition;
  end if;
end $$;
