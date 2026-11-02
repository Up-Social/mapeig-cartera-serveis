-- Read-only recovery after a lost response. A missing row does not prove that
-- an earlier transaction has finished or failed. No application role grants.
create function public.conveni_first_recovery_status(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
 select jsonb_build_object('eventId',f.event_id,'provisionId',f.provision_id,'reviewId',f.review_event_id,
  'reviewer',f.request->>'actor','note',f.request->>'note','createdAt',f.created_at,
  'exports',coalesce((select jsonb_agg(jsonb_build_object('eventId',x.event_id,'createdAt',x.created_at,'sha256',x.content_hash) order by x.created_at desc,x.event_id desc)
   from (select e.event_id,e.created_at,e.content_hash from conveni_first_candidate.first_export_receipts e where e.provision_id=f.provision_id order by e.created_at desc,e.event_id desc limit 20) x),'[]'::jsonb))
 from conveni_first_candidate.first_provision_receipts f
 join public.conveni_unit_economic_draft_events d on d.id=f.draft_id
 join public.service_provisions p on p.id=f.provision_id and p.source_record_id=p_record and p.unit_id=p_unit
 where d.source_record_id=p_record and d.job_id=p_job and d.unit_id=p_unit
 order by f.created_at desc,f.event_id desc limit 1
$$;
revoke all on function public.conveni_first_recovery_status(uuid,uuid,uuid) from public,anon,authenticated,service_role;
