revoke execute on function public.claim_worker_task(text) from public,anon,authenticated;
revoke execute on function public.create_automated_batch(integer) from public,anon,authenticated;
revoke execute on function public.delete_unprocessed_concert_records(uuid[]) from public,anon,authenticated;
revoke execute on function public.sample_balanced_source_records(integer,uuid[]) from public,anon,authenticated;
revoke execute on function public.sample_financing_type_candidates(integer,uuid[]) from public,anon,authenticated;

grant execute on function public.claim_worker_task(text) to service_role;
grant execute on function public.create_automated_batch(integer) to service_role;
grant execute on function public.delete_unprocessed_concert_records(uuid[]) to service_role;
grant execute on function public.sample_balanced_source_records(integer,uuid[]) to service_role;
grant execute on function public.sample_financing_type_candidates(integer,uuid[]) to service_role;
