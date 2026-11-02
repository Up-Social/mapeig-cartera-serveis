-- Keep this experimental RPC private. A result already received must not be
-- persisted while processing is globally paused, even if the run remains in
-- matching. Acquire the switch first, like the experimental journal claim.
do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.local_commit_matching(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 patched:=replace(original,
  $old$begin
 if p_job is null or jsonb_typeof(p_expected) is distinct from 'object'$old$,
  $new$begin
 perform 1 from app_settings where key='processing_enabled' and enabled is true for share nowait;
 if not found then return false;end if;
 if p_job is null or jsonb_typeof(p_expected) is distinct from 'object'$new$);
 if patched=original then raise exception 'Expected local matching commit guard not found';end if;
 execute patched;
end $$;
revoke all on function public.local_commit_matching(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
