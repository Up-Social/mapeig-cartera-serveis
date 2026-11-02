-- cardinality(NULL) is NULL rather than zero, so the legacy comparison did
-- not reject it and could create an empty run with a worker task.
do $migration$
declare definition text;patched text;anchor text:=
 ' if cardinality(p_records)<1 or cardinality(p_records)>500 then raise exception ''Invalid selection'';end if;';
begin
 definition:=pg_get_functiondef('public.cloud_create_run(uuid[],boolean)'::regprocedure);
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'CREATE_RUN_NULL_GUARD_ANCHOR_INVALID';end if;
 patched:=replace(definition,anchor,' if p_records is null or cardinality(p_records)<1 or cardinality(p_records)>500 then raise exception ''Invalid selection'';end if;');
 execute patched;
end $migration$;
