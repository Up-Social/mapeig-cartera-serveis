-- An event ID is not sufficient to prove that its decision is still current.
-- New events retain a compact fingerprint and the exact decision ID. Historical
-- events without this evidence remain in history and cannot claim replay success.
create function public.conveni_review_replay_context(p_record uuid,p_job uuid) returns text
language sql stable security invoker set search_path=pg_catalog,public,extensions as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'source',(select jsonb_build_object('id',r.id,'source_record_id',r.source_record_id,'financing_type',r.financing_type,'title',r.title,'source_payload',r.source_payload) from public.source_records r where r.id=p_record),
  'analysis',(select jsonb_build_object('job_id',a.job_id,'source_record_id',a.source_record_id,'source_hash',a.source_hash,'catalog_version_id',a.catalog_version_id,'payload',a.payload,'document_revisions',a.document_revisions) from public.conveni_analyses a where a.job_id=p_job and a.source_record_id=p_record),
  'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'run_id',j.run_id,'source_record_id',j.source_record_id,'verification_only',j.verification_only,'created_at',j.created_at) order by j.id),'[]'::jsonb) from public.pipeline_jobs j where j.source_record_id=p_record),
  'proposals',(select coalesce(jsonb_agg(jsonb_build_object('unit_id',cp.unit_id,'data',cp.data,'unit_source',ru.source_record_id,'unit_key',ru.unit_key) order by cp.unit_id),'[]'::jsonb) from public.conveni_unit_proposals cp left join public.record_units ru on ru.id=cp.unit_id where cp.job_id=p_job),
  'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',sd.id,'url',sd.url,'document_type',sd.document_type,'status',sd.status,'extraction_partial',sd.extraction_partial,'storage_path',sd.storage_path,'storage_sha256',sd.storage_sha256,'active_extraction_id',sd.active_extraction_id,'quality_flags',sd.quality_flags,'text_sha256',case when sd.extracted_text is null then null else encode(extensions.digest(convert_to(sd.extracted_text,'UTF8'),'sha256'),'hex') end) order by sd.id),'[]'::jsonb) from public.source_documents sd where sd.source_record_id=p_record)
 )::text,'UTF8'),'sha256'),'hex')
$$;
revoke all on function public.conveni_review_replay_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.conveni_review_replay_context(uuid,uuid) to service_role;

do $$
declare original text; patched text;
begin
 original:=pg_get_functiondef('public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure);
 -- Existing event handling must run under the same parent/unit/document locks
 -- as a new review. NOWAIT makes incompatible writer order fail closed.
 patched:=replace(original,
  $old$if exists(select 1 from conveni_review_events where id=p_event and source_record_id=r.id and job_id=p_job and unit_id=p_unit and outcome=p_outcome and service_code is not distinct from p_code and reason=p_note and coalesce((snapshot->'semantic_confirmation'->>'confirmed')::boolean,false)=coalesce(p_social_confirmed,false)) then return;end if;$old$,
  $new$if exists(select 1 from conveni_review_events where id=p_event) then
  if p_outcome='select' then
   raise exception 'Aprovació temporalment desactivada: cal una revisió documental de l’atribució econòmica al receptor i període.';
  end if;
  perform 1 from pipeline_jobs pj where pj.source_record_id=r.id order by pj.id for share nowait;
  perform 1 from record_units ru where ru.source_record_id=r.id order by ru.id for update nowait;
  select * into strict u from record_units where id=p_unit and source_record_id=r.id for update;
  perform 1 from conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id for share nowait;
  if exists(select 1 from conveni_unit_proposals cp left join record_units ru on ru.id=cp.unit_id
    where cp.job_id=p_job and ru.source_record_id is distinct from r.id) then
   raise exception 'CONVENI_REVIEW_REPLAY_STALE' using errcode='40001';
  end if;
  perform 1 from source_documents sd where sd.source_record_id=r.id order by sd.id for share nowait;
  perform 1 from conveni_review_events e where e.unit_id=u.id order by e.id for share nowait;
  perform 1 from review_decisions rd where rd.source_record_id=r.id and rd.pipeline_job_id=p_job order by rd.id for share nowait;
  perform 1 from service_provisions sp where sp.unit_id=u.id order by sp.id for share nowait;
  select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;
  if p_job is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1)
   or a.source_hash is distinct from conveni_source_hash(r.id)
   or p_event is distinct from (select id from conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1)
   or u.review_note is distinct from p_note
   or exists(select 1 from conveni_review_events successor where successor.unit_id=u.id and successor.id<>p_event
     and successor.snapshot->>'replay_previous'=p_event::text)
   or not exists(select 1 from conveni_review_events e join review_decisions rd on rd.id::text=e.snapshot->>'replay_decision_id'
     where e.id=p_event and e.source_record_id=r.id and e.job_id=p_job and e.unit_id=u.id and e.outcome=p_outcome
      and e.service_code is not distinct from p_code and e.reason=p_note
      and e.snapshot->'semantic_confirmation'->'confirmed' is not distinct from to_jsonb(coalesce(p_social_confirmed,false))
      and e.snapshot->'replay_version'='1'::jsonb and e.snapshot->'replay_previous' is not distinct from coalesce(to_jsonb(p_previous),'null'::jsonb)
      and e.snapshot->>'replay_context'=public.conveni_review_replay_context(r.id,p_job)
      and e.snapshot->'proposal'=d
      and rd.source_record_id=r.id and rd.pipeline_job_id=p_job and rd.reason=p_note and rd.final_code is not distinct from p_code
      and rd.classification=case p_outcome when 'select' then 'in_portfolio' when 'reject' then 'discarded' when 'outside' then 'out_of_portfolio' when 'insufficient' then 'insufficient_evidence' end
      and rd.decision=case p_outcome when 'select' then 'approved' when 'insufficient' then 'insufficient_evidence' else 'rejected' end
      and ((p_outcome='select' and u.status='approved' and exists(select 1 from service_provisions sp where sp.unit_id=u.id and sp.source_record_id=r.id and sp.review_decision_id=rd.id and sp.superseded_at is null and sp.service_code=p_code and sp.amount=(d->>'amount_cents')::numeric/100))
       or (p_outcome in ('reject','outside') and u.status='rejected' and not exists(select 1 from service_provisions sp where sp.unit_id=u.id and sp.superseded_at is null))
       or (p_outcome='insufficient' and u.status='draft' and not exists(select 1 from service_provisions sp where sp.unit_id=u.id and sp.superseded_at is null))))
  then raise exception 'CONVENI_REVIEW_REPLAY_STALE' using errcode='40001';end if;
  return;
 end if;$new$);
 if patched=original then raise exception 'Expected conveni review replay point not found';end if;
 original:=patched;
 -- The parent/child locks in migration 150 cover units belonging to this
 -- record. Never fingerprint a foreign unit that those locks do not protect.
 patched:=replace(original,
  $old$perform 1 from conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id for share;$old$,
  $new$perform 1 from conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id for share;
 if exists(select 1 from conveni_unit_proposals cp left join record_units ru on ru.id=cp.unit_id
  where cp.job_id=p_job and ru.source_record_id is distinct from r.id) then
  raise exception 'CONVENI_REVIEW_UNIT_SCOPE_INVALID' using errcode='40001';end if;$new$);
 if patched=original then raise exception 'Expected conveni proposal lock point not found';end if;
 original:=patched;
 -- Place the event after its decision so it can store the exact decision ID.
 -- The complete review remains one transaction and rolls back together.
 patched:=replace(original,
  $old$insert into conveni_review_events(id,source_record_id,job_id,unit_id,outcome,service_code,reason,actor,snapshot)
 values(p_event,r.id,p_job,u.id,p_outcome,p_code,p_note,'local_user',jsonb_build_object('proposal',d,'previous_unit',to_jsonb(u),'semantic_confirmation',jsonb_build_object('confirmed',coalesce(p_social_confirmed,false),'classification',chosen_classification,'service_code',p_code,'service_name',s.service_name,'catalog_version',a.catalog_version_id,'document_revisions',a.document_revisions,'reason',p_note)));
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer,final_code)
 values(r.id,p_job,chosen_classification,case when p_outcome='reject' then array[coalesce(d->>'reason','manual_scope')] else '{}' end,case when p_outcome='select' then 'approved' when p_outcome='insufficient' then 'insufficient_evidence' else 'rejected' end,p_note,'local_user',s.service_code) returning id into rid;$old$,
  $new$-- Lock all inputs included in the fingerprint before recording it. The
 -- source and units are already locked; missing rows cannot be inserted past
 -- their FK parent locks while this transaction is active.
 perform 1 from pipeline_jobs pj where pj.source_record_id=r.id order by pj.id for share nowait;
 perform 1 from source_documents sd where sd.source_record_id=r.id order by sd.id for share nowait;
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer,final_code)
 values(r.id,p_job,chosen_classification,case when p_outcome='reject' then array[coalesce(d->>'reason','manual_scope')] else '{}' end,case when p_outcome='select' then 'approved' when p_outcome='insufficient' then 'insufficient_evidence' else 'rejected' end,p_note,'local_user',s.service_code) returning id into rid;
 insert into conveni_review_events(id,source_record_id,job_id,unit_id,outcome,service_code,reason,actor,snapshot)
 values(p_event,r.id,p_job,u.id,p_outcome,p_code,p_note,'local_user',jsonb_build_object('proposal',d,'previous_unit',to_jsonb(u),'replay_version',1,'replay_previous',p_previous,'replay_decision_id',rid,'replay_context',public.conveni_review_replay_context(r.id,p_job),'semantic_confirmation',jsonb_build_object('confirmed',coalesce(p_social_confirmed,false),'classification',chosen_classification,'service_code',p_code,'service_name',s.service_name,'catalog_version',a.catalog_version_id,'document_revisions',a.document_revisions,'reason',p_note)));$new$);
 if patched=original then raise exception 'Expected conveni review event insert point not found';end if;
 execute patched;
end $$;
