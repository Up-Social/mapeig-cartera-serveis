-- Closed preparation candidate. The application role receives no grants.
-- It records human declarations and verifies physical evidence; it does not
-- itself approve funding or infer missing information.
do $$
declare original text;patched text;anchor text;
begin
 original:=pg_get_functiondef('conveni_first_candidate.copy_plan(uuid)'::regprocedure);
 anchor:='d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason);';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'HISTORICAL_COPY_PLAN_ANCHOR';end if;
 patched:=replace(original,'conveni_first_candidate.copy_plan(', 'conveni_first_candidate.historical_copy_plan(');
 patched:=replace(patched,'public.prepare_conveni_unit_economic_draft(', 'conveni_first_candidate.prepare_historical_draft(');
 patched:=replace(patched,anchor,'d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason,(select acknowledgement_id from conveni_first_candidate.historical_draft_ack_links where draft_id=d.id));');
 execute patched;
 original:=pg_get_functiondef('conveni_first_candidate.snapshot_for_copy_plan(uuid,jsonb)'::regprocedure);
 patched:=replace(original,'conveni_first_candidate.snapshot_for_copy_plan(', 'conveni_first_candidate.historical_snapshot_for_copy_plan(');
 if (length(patched)-length(replace(patched,'conveni_first_candidate.copy_plan(','')))/length('conveni_first_candidate.copy_plan(')<>1
  or (length(patched)-length(replace(patched,'conveni_first_candidate.snapshot(','')))/length('conveni_first_candidate.snapshot(')<>1 then raise exception 'HISTORICAL_COPY_FINISH_ANCHOR';end if;
 patched:=replace(replace(patched,'conveni_first_candidate.copy_plan(', 'conveni_first_candidate.historical_copy_plan('),'conveni_first_candidate.snapshot(', 'conveni_first_candidate.historical_snapshot(');
 execute patched;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

create function public.conveni_first_history_candidate(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin
 if not exists(select 1 from public.conveni_review_events where unit_id=p_unit) then
  if not exists(select 1 from public.record_units where id=p_unit and source_record_id=p_record) or p_job is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) then raise exception 'HISTORY_SCOPE';end if;
  return jsonb_build_object('hasHistory',false);
 end if;
 return jsonb_build_object('hasHistory',true,'snapshot',conveni_first_candidate.review_history_snapshot(p_record,p_job,p_unit));
end $$;
create function public.conveni_first_ack_history(p_event uuid,p_record uuid,p_job uuid,p_unit uuid,p_snapshot jsonb,p_previous uuid,p_reviewer text,p_note text,p_confirmed boolean) returns jsonb
language sql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
 select conveni_first_candidate.acknowledge_history(p_event,p_record,p_job,p_unit,p_snapshot,p_previous,p_reviewer,p_note,p_confirmed)
$$;
create function public.conveni_first_prepare_draft(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_ack uuid,p_monetary uuid,p_identity uuid,p_role_period uuid,p_literal text,p_reviewer text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate,extensions set lock_timeout='1000ms' as $$
declare r public.source_records;a public.conveni_analyses;u public.record_units;proposal jsonb;last_ uuid;parent_ uuid;existing public.conveni_unit_economic_draft_events;
 v public.conveni_visual_observations;read_ public.conveni_visual_reads;citations jsonb[]:='{}';pair record;
begin
 if p_social is distinct from true or p_economic is distinct from true or p_manifest is distinct from true or length(trim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'PREPARATION_CONFIRMATION_REQUIRED';end if;
 select * into strict r from public.source_records where id=p_record for update;
 select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=p_record for update;
 select * into strict u from public.record_units where id=p_unit and source_record_id=p_record for update;
 select data into strict proposal from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit;
 for pair in select * from (values(p_monetary,'economic'),(p_identity,'identity'),(p_role_period,'role_period')) as x(id,role) loop
  select * into strict v from public.conveni_visual_observations where event_id=pair.id for share nowait;
  select * into strict read_ from public.conveni_visual_reads where event_id=v.read_id and record_id=p_record for share nowait;
  if v.role is distinct from pair.role or v.declared_reviewer is distinct from p_reviewer or read_.snapshot is distinct from public.conveni_visual_source(p_record,v.document_id) then raise exception 'VISUAL_EVIDENCE_MISMATCH';end if;
  citations:=array_append(citations,jsonb_build_object('document_id',v.document_id,'page',v.page,'quote',v.quote));
 end loop;
 if exists(select 1 from jsonb_object_keys(a.document_revisions) k where not exists(select 1 from unnest(citations) c where c->>'document_id'=k)) then raise exception 'MANIFEST_NEEDS_FULL_REVIEW';end if;
 select * into existing from public.conveni_unit_economic_draft_events where id=p_event;
 if found then last_:=existing.previous_id;else select id into last_ from public.conveni_unit_economic_draft_events where job_id=p_job and unit_id=p_unit order by sequence desc limit 1;end if;
 select id into parent_ from public.conveni_review_events where unit_id=p_unit order by created_at desc,id desc limit 1;
 if coalesce(proposal->>'amount_cents','') !~ '^[0-9]+$' or proposal->>'service_code' is null then raise exception 'PREPARATION_FIELD_PENDING';end if;
 perform conveni_first_candidate.prepare_historical_draft(p_record,p_job,p_unit,p_event,last_,parent_,public.conveni_source_hash(p_record),
  encode(extensions.digest(proposal::text,'sha256'),'hex'),encode(extensions.digest(a.payload::text,'sha256'),'hex'),a.document_revisions,proposal->>'service_code',
  (proposal->>'amount_cents')::bigint,p_literal,citations[1],citations[2],citations[3],
  '{"public_contribution":true,"recipient_role":true,"period":true,"not_shared_or_maximum":true,"conditions_preserved":true,"not_payment":true}'::jsonb,p_note,p_ack);
 return jsonb_build_object('draftId',p_event);
end $$;
create function public.conveni_first_copy_plan(p_record uuid,p_draft uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin if not exists(select 1 from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;return conveni_first_candidate.historical_copy_plan(p_draft);end $$;
create function public.conveni_first_copy_finish(p_record uuid,p_draft uuid,p_plan jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin if not exists(select 1 from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;return conveni_first_candidate.historical_snapshot_for_copy_plan(p_draft,p_plan);end $$;
create function public.conveni_first_receipt_find(p_record uuid,p_event uuid,p_draft uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin if not exists(select 1 from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;return conveni_first_candidate.historical_find_receipt(p_event,p_draft);end $$;
create function public.conveni_first_receipt_save(p_record uuid,p_event uuid,p_draft uuid,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin if not exists(select 1 from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;return conveni_first_candidate.historical_save_receipt(p_event,p_draft,p_snapshot);end $$;
create function public.conveni_first_link_draft(p_record uuid,p_event uuid,p_draft uuid,p_receipt uuid,p_monetary uuid,p_identity uuid,p_role_period uuid,p_reviewer text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
begin if not exists(select 1 from public.conveni_unit_economic_draft_events where id=p_draft and source_record_id=p_record) then raise exception 'PREPARATION_SCOPE';end if;return conveni_first_candidate.historical_visual_link_draft(p_event,p_draft,p_receipt,p_monetary,p_identity,p_role_period,p_reviewer,p_note,p_social,p_economic,p_manifest);end $$;
revoke all on function public.conveni_first_history_candidate(uuid,uuid,uuid),public.conveni_first_ack_history(uuid,uuid,uuid,uuid,jsonb,uuid,text,text,boolean),public.conveni_first_prepare_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,boolean),public.conveni_first_copy_plan(uuid,uuid),public.conveni_first_copy_finish(uuid,uuid,jsonb),public.conveni_first_receipt_find(uuid,uuid,uuid),public.conveni_first_receipt_save(uuid,uuid,uuid,jsonb),public.conveni_first_link_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;
