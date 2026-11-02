-- Candidate wrapper only. It is deliberately not executable by any application
-- role. Do not grant access until the UI, physical verifier, all currentness
-- consumers, export and recovery protocols have passed independent review.
create function public.commit_conveni_first_candidate(
 p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_review uuid,p_receipt uuid,p_link uuid,
 p_declared_reviewer text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare l conveni_first_candidate.visual_economic_links;d public.conveni_unit_economic_draft_events;result jsonb;
begin
 if p_event is null or p_review is null or p_social is distinct from true or p_economic is distinct from true or p_manifest is distinct from true
  or length(trim(coalesce(p_declared_reviewer,''))) not between 3 and 120 or length(trim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'FIRST_CONFIRMATION_REQUIRED';end if;
 select * into l from conveni_first_candidate.visual_economic_links where event_id=p_link and receipt_id=p_receipt for share nowait;
 if not found or l.reviewer is distinct from p_declared_reviewer or l.manifest_confirmed is distinct from true then raise exception 'FIRST_LINK_REQUIRED';end if;
 select * into d from public.conveni_unit_economic_draft_events where id=l.draft_id;
 if not found or d.source_record_id is distinct from p_record or d.job_id is distinct from p_job or d.unit_id is distinct from p_unit then raise exception 'FIRST_SCOPE';end if;
 result:=conveni_first_candidate.commit_first_provision(p_event,p_review,p_receipt,p_link,p_declared_reviewer,p_note);
 return jsonb_build_object('event_id',result->'event_id','provision_id',result->'provision_id');
end $$;
revoke all on function public.commit_conveni_first_candidate(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;

-- Preview only a fully linked candidate. Closed until role grants and
-- preparation/consumer review are deliberately completed.
create function public.conveni_first_candidate_ready(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare l conveni_first_candidate.visual_economic_links;d public.conveni_unit_economic_draft_events;
begin
 if exists(select 1 from public.service_provisions where unit_id=p_unit) then return null;end if;
 select v.* into l from conveni_first_candidate.visual_economic_links v join public.conveni_unit_economic_draft_events draft on draft.id=v.draft_id
 where draft.source_record_id=p_record and draft.job_id=p_job and draft.unit_id=p_unit
 order by v.created_at desc,v.event_id desc limit 1;
 if not found then return null;end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=l.draft_id;
 perform conveni_first_candidate.historical_visual_link_draft(l.event_id,d.id,l.receipt_id,l.monetary,l.identity,l.role_period,l.reviewer,l.note,true,true,l.manifest_confirmed);
 return jsonb_build_object('jobId',d.job_id,'unitId',d.unit_id,'receiptId',l.receipt_id,'linkId',l.event_id,'reviewer',l.reviewer);
end $$;
revoke all on function public.conveni_first_candidate_ready(uuid,uuid,uuid) from public,anon,authenticated,service_role;
