-- Business/version conflicts are final HTTP 409 responses, not retryable
-- serialization failures. Some production PostgREST versions retry 40001
-- indefinitely; the same business decision can never succeed on a retry.
do $$
declare signature text; definition text;
begin
 foreach signature in array array[
  'public.screen_conveni(uuid)',
  'public.persist_conveni(uuid,text,jsonb,jsonb,text)',
  'public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)',
  'public.reopen_conveni(uuid,uuid,uuid,text)',
  'public.confirm_conveni_exclusion(uuid,uuid,uuid,uuid,text)',
  'public.migrate_conveni_amount(uuid,uuid,text,numeric)',
  'public.set_conveni_identity()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('''40001''' in definition)=0 then raise exception 'Expected conflict guard missing in %',signature;end if;
  execute replace(definition,'''40001''','''PT409''');
 end loop;
end $$;
