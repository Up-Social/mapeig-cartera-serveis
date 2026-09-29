-- Reusing a durable provider response must not add its already-settled cost to
-- every recovery task. Keep a zero-valued reservation so providerRequest can
-- safely reuse the receipt without reserving or settling it again.
do $$
declare
  signature regprocedure := 'public.begin_record_operation(uuid,text,text)'::regprocedure;
  definition text;
  previous_copy text := 'select task,item_key,reserved_usd,actual_usd from cloud_budget_reservations';
  safe_copy text := 'select task,item_key,0,0 from cloud_budget_reservations';
begin
  select pg_get_functiondef(signature) into definition;

  if position(previous_copy in definition) > 0 then
    execute replace(definition, previous_copy, safe_copy);
  end if;

  select pg_get_functiondef(signature) into definition;
  if position(previous_copy in definition) > 0
    or position(safe_copy in definition) = 0 then
    raise exception 'BEGIN_RECORD_OPERATION_BUDGET_REUSE_NOT_REPAIRED';
  end if;
end
$$;

comment on function public.begin_record_operation(uuid,text,text) is
  'Crea reanàlisis immutables, reutilitza checkpoints vàlids i no torna a imputar respostes ja cobrades.';
