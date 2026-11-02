-- Closed single-provision export candidate. It records the exact snapshot and
-- file hash in one transaction; existing exports are not switched to this RPC.
create function public.capture_conveni_first_export(p_record uuid,p_provision uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare s jsonb;
begin
 if not exists(select 1 from public.service_provisions where id=p_provision and source_record_id=p_record) then raise exception 'FIRST_EXPORT_SCOPE';end if;
 s:=conveni_first_candidate.first_export_snapshot(p_provision);
 return s;
end $$;
create function public.finalize_conveni_first_export(p_record uuid,p_event uuid,p_provision uuid,p_snapshot jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.service_provisions where id=p_provision and source_record_id=p_record) then raise exception 'FIRST_EXPORT_SCOPE';end if;
 result:=conveni_first_candidate.first_export_finalize(p_event,p_provision,p_snapshot,p_hash);
 return jsonb_build_object('event_id',result->'event_id','provision_id',result->'provision_id');
end $$;
revoke all on function public.capture_conveni_first_export(uuid,uuid),public.finalize_conveni_first_export(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
