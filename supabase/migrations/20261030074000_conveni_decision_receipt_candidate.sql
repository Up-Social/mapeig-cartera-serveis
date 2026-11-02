-- Closed candidate. Physical byte verification remains outside PostgreSQL.
create schema conveni_decision_physical_candidate;
revoke all on schema conveni_decision_physical_candidate from public,anon,authenticated,service_role;
create table conveni_decision_physical_candidate.requests(event_id uuid primary key,request jsonb not null);
revoke all on conveni_decision_physical_candidate.requests from public,anon,authenticated,service_role;
create trigger requests_immutable before update or delete on conveni_decision_physical_candidate.requests
 for each row execute function conveni_first_candidate.visual_history_immutable();

create function conveni_decision_physical_candidate.request_json(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_review uuid,p_previous uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text,p_independent boolean) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('record',p_record,'job',p_job,'unit',p_unit,'event',p_event,'review',p_review,'previous',p_previous,'receipt',p_receipt,'link',p_link,'actor',p_actor,'note',p_note,'independent',p_independent)
$$;
revoke all on function conveni_decision_physical_candidate.request_json(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;

-- Historical bytes may be read for an exact committed replay, but do not
-- establish that the historical decision is currently effective.
create function public.conveni_decision_receipt_candidate(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_review uuid,p_previous uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text,p_independent boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment,conveni_decision_physical_candidate set lock_timeout='1000ms' as $$
declare draft_ uuid;receipt_ jsonb;request_ jsonb;bound_ jsonb;replay_ boolean:=false;
begin
 if p_record is null or p_job is null or p_unit is null or p_event is null or p_review is null or p_link is null or p_receipt is null or p_independent is null then raise exception 'ECONOMIC_RECEIPT_SCOPE';end if;
 select d.id into draft_ from conveni_first_candidate.visual_economic_links l join public.conveni_unit_economic_draft_events d on d.id=l.draft_id
 where l.event_id=p_link and l.receipt_id=p_receipt and d.source_record_id=p_record and d.job_id=p_job and d.unit_id=p_unit;
 if draft_ is null then raise exception 'ECONOMIC_RECEIPT_SCOPE';end if;
 request_:=conveni_decision_physical_candidate.request_json(p_record,p_job,p_unit,p_event,p_review,p_previous,p_receipt,p_link,p_actor,p_note,p_independent);
 select request into bound_ from conveni_decision_physical_candidate.requests where event_id=p_event;
 if found then
  if bound_ is distinct from request_ then raise exception 'ECONOMIC_DECISION_EVENT_REUSED';end if;
  if (p_independent and not exists(select 1 from conveni_independent_experiment.revisions where id=p_event and source_record_id=p_record and job_id=p_job and unit_id=p_unit and draft_id=draft_ and receipt_id=p_receipt and visual_link_id=p_link))
   or (not p_independent and not exists(select 1 from conveni_first_candidate.first_provision_receipts where event_id=p_event and draft_id=draft_ and visual_link=p_link)) then raise exception 'ECONOMIC_DECISION_BINDING_INCOMPLETE';end if;
  replay_:=true;
 elsif exists(select 1 from conveni_first_candidate.first_provision_receipts where event_id=p_event) then
  if p_independent or p_previous is not null or not exists(select 1 from conveni_first_candidate.first_provision_receipts f where f.event_id=p_event and f.draft_id=draft_ and f.visual_link=p_link and f.request=jsonb_build_object('review',p_review,'receipt',p_receipt,'link',p_link,'actor',p_actor,'note',p_note)) then raise exception 'ECONOMIC_DECISION_EVENT_REUSED';end if;
  replay_:=true;
 elsif exists(select 1 from conveni_independent_experiment.revisions where id=p_event) then
  -- Old independent events did not retain reviewId. Never invent it.
  raise exception 'ECONOMIC_HISTORICAL_REQUEST_UNVERIFIABLE';
 end if;
 if replay_ then
  select to_jsonb(r) into receipt_ from conveni_first_candidate.receipts r where r.event_id=p_receipt and r.draft_id=draft_;
 else
  receipt_:=conveni_first_candidate.historical_find_receipt(p_receipt,draft_);
 end if;
 if receipt_ is null then raise exception 'ECONOMIC_RECEIPT_UNAVAILABLE';end if;
 return receipt_;
end $$;
revoke all on function public.conveni_decision_receipt_candidate(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;

-- Binding is committed atomically with the decision. It does not assert
-- that a client actually read Storage; only the closed application route does.
create function public.conveni_decision_commit_candidate(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_review uuid,p_previous uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text,p_independent boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment,conveni_decision_physical_candidate set lock_timeout='1000ms' as $$
declare request_ jsonb;bound_ jsonb;result_ jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 request_:=conveni_decision_physical_candidate.request_json(p_record,p_job,p_unit,p_event,p_review,p_previous,p_receipt,p_link,p_actor,p_note,p_independent);
 select request into bound_ from conveni_decision_physical_candidate.requests where event_id=p_event;
 if found and bound_ is distinct from request_ then raise exception 'ECONOMIC_DECISION_EVENT_REUSED';end if;
 -- Recheck exact scope and historical-event binding inside the write transaction.
 perform public.conveni_decision_receipt_candidate(p_record,p_job,p_unit,p_event,p_review,p_previous,p_receipt,p_link,p_actor,p_note,p_independent);
 if p_independent then
  result_:=public.conveni_independent_decision_commit(p_record,p_job,p_unit,p_event,p_previous,p_receipt,p_link,p_actor,p_note,true,true,true);
 else
  if p_previous is not null then raise exception 'ECONOMIC_DECISION_SCOPE';end if;
  result_:=public.commit_conveni_first_candidate(p_record,p_job,p_unit,p_event,p_review,p_receipt,p_link,p_actor,p_note,true,true,true);
 end if;
 insert into conveni_decision_physical_candidate.requests(event_id,request) values(p_event,request_) on conflict(event_id) do nothing;
 return result_;
end $$;
revoke all on function public.conveni_decision_commit_candidate(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
