do $$
declare signature text;
begin
 foreach signature in array array[
  'public.claim_worker_task(text)',
  'public.create_automated_batch(integer)',
  'public.delete_unprocessed_concert_records(uuid[])',
  'public.sample_balanced_source_records(integer,uuid[])',
  'public.sample_financing_type_candidates(integer,uuid[])'
 ] loop
  if has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute') then
   raise exception 'RPC privilegiada expuesta: %',signature;
  end if;
  if not has_function_privilege('service_role',signature,'execute') then
   raise exception 'Servidor sin acceso a RPC: %',signature;
  end if;
 end loop;
end $$;
