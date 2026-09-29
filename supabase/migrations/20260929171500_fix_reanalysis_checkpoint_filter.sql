-- A manual production application of the reanalysis migration contained a
-- misspelled cloud_checkpoints column (item_kkey). Repair the installed
-- function without changing its behaviour or rewriting migration history.
do $$
declare
  signature regprocedure := 'public.begin_record_operation(uuid,text,text)'::regprocedure;
  definition text;
begin
  select pg_get_functiondef(signature) into definition;

  if position('item_kkey' in definition) > 0 then
    execute replace(definition, 'item_kkey', 'item_key');
  end if;

  select pg_get_functiondef(signature) into definition;
  if position('item_kkey' in definition) > 0
    or position('item_key not like ''%:discovered''' in definition) = 0 then
    raise exception 'BEGIN_RECORD_OPERATION_CHECKPOINT_FILTER_NOT_REPAIRED';
  end if;
end
$$;

comment on function public.begin_record_operation(uuid,text,text) is
  'Crea reanàlisis immutables, redescobreix documents oficials i reutilitza només checkpoints vàlids.';
