-- CLOSED CANDIDATE: no application grants; do not activate independently.

-- Source: assessment.sql
-- PRIVATE EXPERIMENT. This diagnostic cannot approve, persist, or export.
-- Its caller must run it in the same transaction as any future committing
-- operation and must separately verify the physical receipt, human review,
-- historical event chain and the versioned provision snapshot.
create schema conveni_independent_experiment;
revoke all on schema conveni_independent_experiment from public,anon,authenticated,service_role;
create function conveni_independent_experiment.assess(p_record uuid,p_job uuid,p_unit uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.source_records; j public.pipeline_jobs; a public.conveni_analyses; target jsonb;
 expected jsonb; actual jsonb; target_nif text; target_year text; other record;
 other_nif text; other_year text; total numeric; amount_ numeric; approved numeric; own_ numeric; known_sum numeric;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'ATTRIBUTION_ISOLATION';end if;
 select * into r from public.source_records where id=p_record and financing_type='conveni' for update nowait;
 if not found then return jsonb_build_object('status','pending','reason','INVALID_RECORD');end if;
 perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;
 select * into j from public.pipeline_jobs where id=p_job and source_record_id=p_record and not verification_only for update nowait;
 if not found or j.id is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1)
 then return jsonb_build_object('status','pending','reason','STALE_JOB');end if;
 perform 1 from public.conveni_analyses where source_record_id=p_record order by job_id for share nowait;
 -- Proposals reference conveni_analyses(job_id), not pipeline_jobs. FOR SHARE
 -- is compatible with the FK's KEY SHARE, so lock the selected analysis FOR
 -- UPDATE to fence insertion of a new proposal for an existing unit.
 select * into a from public.conveni_analyses where source_record_id=p_record and job_id=p_job for update nowait;
 if not found or a.source_hash is distinct from public.conveni_source_hash(p_record) or jsonb_typeof(a.payload->'units') is distinct from 'array'
 then return jsonb_build_object('status','pending','reason','STALE_ANALYSIS');end if;
 perform 1 from public.record_units where source_record_id=p_record order by id for share nowait;
 perform 1 from public.conveni_unit_proposals where job_id=p_job order by unit_id for share nowait;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share nowait;
 perform 1 from public.conveni_visual_reads where record_id=p_record order by event_id for share nowait;
 perform 1 from public.conveni_visual_observations o join public.conveni_visual_reads vr on vr.event_id=o.read_id where vr.record_id=p_record order by o.event_id for share of o nowait;
 perform 1 from public.service_provisions where source_record_id=p_record order by id for share nowait;
 if a.payload->'coverage_complete' is distinct from 'true'::jsonb or jsonb_typeof(a.document_revisions) is distinct from 'object'
  or exists(select 1 from public.source_documents d where d.source_record_id=p_record and d.document_type in ('agreement','annex')
   and (d.status<>'fetched' or d.extraction_partial is not false or d.storage_sha256 is null or d.storage_path is null
    or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or a.document_revisions->>d.id::text is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')))
  or exists(select 1 from jsonb_each_text(case when jsonb_typeof(a.document_revisions)='object' then a.document_revisions else '{}'::jsonb end) rev
   left join public.source_documents d on d.id::text=rev.key where d.id is null or d.source_record_id<>p_record
    or coalesce(d.document_type,'') not in ('agreement','annex') or d.status<>'fetched' or d.extraction_partial is not false
    or d.storage_sha256 is null or d.storage_path is null or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
    or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,''))
 then return jsonb_build_object('status','pending','reason','INCOMPLETE_COVERAGE');end if;
 select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) into expected from jsonb_array_elements(a.payload->'units');
 select coalesce(jsonb_agg(p.data order by p.data::text),'[]'::jsonb) into actual from public.conveni_unit_proposals p where p.job_id=p_job;
 if expected is distinct from actual or jsonb_array_length(actual) not between 1 and 500
  or exists(select 1 from public.conveni_unit_proposals p left join public.record_units u on u.id=p.unit_id where p.job_id=p_job
   and (u.id is null or u.source_record_id<>p_record or coalesce(p.data->>'key','')='' or u.unit_key is distinct from 'conveni:'||(p.data->>'key')))
 then return jsonb_build_object('status','pending','reason','PROPOSALS_CHANGED');end if;
 select data into target from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit;
 if not found or target->>'classification' is distinct from 'in_portfolio' or target->>'recipient_nature' is distinct from 'private'
  or target->'joint' is distinct from 'false'::jsonb or target->'mixed' is distinct from 'false'::jsonb
  or jsonb_typeof(target->'amount_cents') is distinct from 'number' or coalesce(target->>'amount_cents','') !~ '^[0-9]+$'
 then return jsonb_build_object('status','pending','reason','TARGET_UNRESOLVED');end if;
 amount_:=(target->>'amount_cents')::numeric;
 target_nif:=regexp_replace(upper(coalesce(target->>'recipient_nif','')),'[[:space:]-]','','g');
 target_year:=target->>'year';
 if amount_>9007199254740991 or target_nif !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$'
  or coalesce(target_year,'') !~ '^[0-9]{4}$' or (case when coalesce(target_year,'') ~ '^[0-9]{4}$' then target_year::integer not between 1900 and 2200 else true end)
  or target_year is distinct from target->>'period'
 then return jsonb_build_object('status','pending','reason','TARGET_IDENTITY_OR_PERIOD_UNRESOLVED');end if;
 -- Siblings are inspected as proposals, never interpreted as approvals. A
 -- missing amount does not block an independently identified recipient/year.
 for other in select unit_id,data from public.conveni_unit_proposals where job_id=p_job and unit_id<>p_unit order by unit_id loop
  other_nif:=regexp_replace(upper(coalesce(other.data->>'recipient_nif','')),'[[:space:]-]','','g');
  other_year:=other.data->>'year';
  if other_nif='' then
   return jsonb_build_object('status','pending','reason','SIBLING_IDENTITY_UNRESOLVED','unit_id',other.unit_id);
  elsif other_nif !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$' then
   return jsonb_build_object('status','pending','reason','SIBLING_NIF_INVALID','unit_id',other.unit_id);
  end if;
  if other_nif=target_nif and (coalesce(other_year,'') !~ '^[0-9]{4}$'
   or (case when coalesce(other_year,'') ~ '^[0-9]{4}$' then other_year::integer not between 1900 and 2200 else true end)
   or other_year is distinct from other.data->>'period' or other_year=target_year) then
   return jsonb_build_object('status','pending','reason','POSSIBLE_PERIOD_OVERLAP','unit_id',other.unit_id);
  end if;
  if other_nif=target_nif and not exists(select 1 from public.conveni_visual_observations o
   join public.conveni_visual_reads vr on vr.event_id=o.read_id and vr.document_id=o.document_id and vr.record_id=p_record
   join public.source_documents sd on sd.id=o.document_id and sd.source_record_id=p_record
   where o.role='role_period' and public.conveni_identity_quote_matches(other.data->>'recipient',other_nif,o.quote)
    and o.quote ~ ('(^|[^0-9])'||other_year||'([^0-9]|$)')
    and public.conveni_citation_on_page(sd.extracted_text,o.page,o.quote)
    and vr.snapshot=public.conveni_visual_source(p_record,o.document_id)) then
   return jsonb_build_object('status','pending','reason','SIBLING_PERIOD_UNVERIFIED','unit_id',other.unit_id);
  end if;
  -- A distinct identifier in an AI proposal alone cannot establish that the
  -- recipient is different. Require a human visual identity assertion tied to
  -- the current physical source and a matching name AND NIF on its page.
  if not exists(select 1 from public.conveni_visual_observations o
   join public.conveni_visual_reads vr on vr.event_id=o.read_id and vr.document_id=o.document_id and vr.record_id=p_record
   join public.source_documents sd on sd.id=o.document_id and sd.source_record_id=p_record
   where o.role='identity' and public.conveni_identity_quote_matches(other.data->>'recipient',other_nif,o.quote)
    and public.conveni_citation_on_page(sd.extracted_text,o.page,o.quote)
    and vr.snapshot=public.conveni_visual_source(p_record,o.document_id)) then
   return jsonb_build_object('status','pending','reason','SIBLING_IDENTITY_UNVERIFIED','unit_id',other.unit_id);
  end if;
 end loop;
 if exists(select 1 from public.service_provisions p join public.record_units u on u.id=p.unit_id where p.source_record_id=p_record and p.superseded_at is null and u.unit_key='legacy') then
  return jsonb_build_object('status','pending','reason','LEGACY_AGGREGATE_REVIEW_REQUIRED');
 end if;
 if exists(select 1 from public.service_provisions p where p.source_record_id=p_record and p.superseded_at is null and p.unit_id<>p_unit
   and not exists(select 1 from conveni_independent_experiment.revisions e where e.unit_id=p.unit_id) and (p.amount is null or p.amount<0)) then
  return jsonb_build_object('status','pending','reason','EXISTING_AMOUNT_UNRESOLVED');
 end if;
 select coalesce(sum(p.amount*100),0) into approved from public.service_provisions p where p.source_record_id=p_record and p.superseded_at is null and p.unit_id<>p_unit
  and not exists(select 1 from conveni_independent_experiment.revisions e where e.unit_id=p.unit_id);
 select coalesce(sum(v.amount_cents),0) into own_ from (select distinct on (unit_id) unit_id,amount_cents
  from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id<>p_unit order by unit_id,sequence desc) v;
 approved:=approved+own_;
 total:=public.conveni_public_amount(r.source_payload)*100;
 if total is null or total<0 or total>9007199254740991 then return jsonb_build_object('status','pending','reason','PUBLIC_TOTAL_UNRESOLVED');end if;
 known_sum:=approved+amount_;
 if known_sum>9007199254740991 or known_sum>total then return jsonb_build_object('status','pending','reason','PUBLIC_TOTAL_EXCEEDED');end if;
 return jsonb_build_object('status','independent_arithmetic_candidate','amount_cents',amount_,'other_approved_cents',approved,
  'public_total_cents',total,'unassigned_ceiling_cents',total-known_sum,'note','Diagnostic only; physical evidence, historical review and human approval remain mandatory.');
end $$;
revoke all on function conveni_independent_experiment.assess(uuid,uuid,uuid) from public,anon,authenticated,service_role;


-- Source: read-context.sql
-- PRIVATE experiment: read-only fingerprint of the state checked at commit.
-- This is evidence of DB/Storage metadata consistency, never physical bytes.
create function conveni_independent_experiment.read_context(p_draft uuid,p_link uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,storage,conveni_first_candidate as $$
 select jsonb_build_object(
 'draft',to_jsonb(d),
 'source',(select jsonb_build_object('id',r.id,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'financing_type',r.financing_type,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,'source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,'source_payload',r.source_payload,'source_payload_hash',r.source_payload_hash,'import_run_id',r.import_run_id,'storage_path',r.storage_path,'storage_sha256',r.storage_sha256,'deduplication_key',r.deduplication_key) from public.source_records r where r.id=d.source_record_id),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'run_id',j.run_id,'source_record_id',j.source_record_id,'verification_only',j.verification_only,'created_at',j.created_at) order by j.id),'[]') from public.pipeline_jobs j where j.source_record_id=d.source_record_id),
 'analyses',(select coalesce(jsonb_agg(to_jsonb(a) order by a.job_id),'[]') from public.conveni_analyses a where a.source_record_id=d.source_record_id),
 'unit',(select to_jsonb(u) from public.record_units u where u.id=d.unit_id and u.source_record_id=d.source_record_id),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'source_record_id',u.source_record_id,'unit_key',u.unit_key) order by u.id),'[]') from public.record_units u where u.source_record_id=d.source_record_id),
 'proposals',(select coalesce(jsonb_agg(to_jsonb(p) order by p.job_id,p.unit_id),'[]') from public.conveni_unit_proposals p join public.conveni_analyses a on a.job_id=p.job_id where a.source_record_id=d.source_record_id),
 'documents',(select coalesce(jsonb_agg(to_jsonb(sd) order by sd.id),'[]') from public.source_documents sd where sd.source_record_id=d.source_record_id),
 'history',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.conveni_review_events e where e.unit_id=d.unit_id),
 'decisions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.review_decisions x where x.id in (select p.review_decision_id from public.service_provisions p where p.unit_id=d.unit_id union select (e.snapshot->>'replay_decision_id')::uuid from public.conveni_review_events e where e.unit_id=d.unit_id and coalesce(e.snapshot->>'replay_decision_id','') ~ '^[0-9a-fA-F-]{36}$')),
 'provisions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.service_provisions p where p.source_record_id=d.source_record_id),
 'catalog',jsonb_build_object('version',(select to_jsonb(v) from public.catalog_versions v where v.id=d.catalog_version_id),
  'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]') from public.official_services s where s.version_id=d.catalog_version_id)),
 'link',(select to_jsonb(l) from conveni_first_candidate.visual_economic_links l where l.event_id=p_link and l.draft_id=d.id),
 'receipt',(select to_jsonb(rc) from conveni_first_candidate.receipts rc join conveni_first_candidate.visual_economic_links l on l.receipt_id=rc.event_id where l.event_id=p_link and l.draft_id=d.id),
 'objects',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'version',o.version,'archived_at',o.archived_at) order by o.name),'[]') from storage.objects o
  where o.bucket_id='cloud-documents' and (o.name in (select sd.storage_path from public.source_documents sd where sd.source_record_id=d.source_record_id)
   or o.name like ('cases/'||d.source_record_id||'/items/'||d.unit_id||'/documents/%'))),
 'visual',(select coalesce(jsonb_agg(jsonb_build_object('observation',to_jsonb(o),'read',to_jsonb(vr)) order by o.event_id),'[]')
  from public.conveni_visual_observations o join public.conveni_visual_reads vr on vr.event_id=o.read_id where vr.record_id=d.source_record_id))
 from public.conveni_unit_economic_draft_events d where d.id=p_draft
$$;
revoke all on function conveni_independent_experiment.read_context(uuid,uuid) from public,anon,authenticated,service_role;


-- Source: versioned-ledger.sql
-- PRIVATE, disconnected experiment. No application roles may call these
-- functions. It deliberately does not update record_units, legacy provisions,
-- live projections or export receipts. NOT a production migration.
create table conveni_independent_experiment.revisions (
 id uuid primary key, source_record_id uuid not null references public.source_records(id),
 job_id uuid not null references public.pipeline_jobs(id), unit_id uuid not null references public.record_units(id),
 sequence integer not null check(sequence>0), previous_id uuid references conveni_independent_experiment.revisions(id),
 draft_id uuid not null references public.conveni_unit_economic_draft_events(id),
 receipt_id uuid not null references conveni_first_candidate.receipts(event_id),
 visual_link_id uuid not null references conveni_first_candidate.visual_economic_links(event_id),
 amount_cents bigint not null check(amount_cents>=0), service_code text not null,
 entity_id uuid references public.entities(id), entity_nif text not null,
 declared_reviewer text not null, reason text not null, request jsonb not null, snapshot jsonb not null, read_proof jsonb not null,
 created_at timestamptz not null default clock_timestamp(), unique(unit_id,sequence)
);
revoke all on conveni_independent_experiment.revisions from public,anon,authenticated,service_role;
create function conveni_independent_experiment.immutable_revision() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'INDEPENDENT_REVISION_IMMUTABLE';end $$;
create trigger immutable_revision before update or delete on conveni_independent_experiment.revisions for each row execute function conveni_independent_experiment.immutable_revision();
revoke all on function conveni_independent_experiment.immutable_revision() from public,anon,authenticated,service_role;

-- Assessment result is only arithmetic, not a source/economic attestation.
-- A positive revision also needs the existing linked human declarations and
-- an exact current source/copy snapshot checked by that workflow.
create function conveni_independent_experiment.commit_revision(p_event uuid,p_previous uuid,p_draft uuid,p_receipt uuid,p_link uuid,p_actor text,p_reason text,p_confirm boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare d public.conveni_unit_economic_draft_events; l conveni_first_candidate.visual_economic_links; rc conveni_first_candidate.receipts;
 previous conveni_independent_experiment.revisions; prior conveni_independent_experiment.revisions; sibling record;
 proof jsonb; check_ jsonb; request_ jsonb; active_ numeric; own_ numeric; total_ numeric; stale_siblings integer:=0; bound_entity uuid; bound_nif text;
begin
 if p_event is null or p_confirm is distinct from true or length(trim(coalesce(p_actor,''))) not between 3 and 120 or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'INDEPENDENT_CONFIRMATION_REQUIRED';end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft;
 -- This diagnostic takes locks on the source, job, analysis, units, documents,
 -- proposals and existing shared provisions and checks their scope/multiset.
 check_:=conveni_independent_experiment.assess(d.source_record_id,d.job_id,d.unit_id);
 if check_->>'status'<>'independent_arithmetic_candidate' then raise exception 'INDEPENDENT_ARITHMETIC_PENDING: %',check_->>'reason';end if;
 perform 1 from conveni_independent_experiment.revisions where source_record_id=d.source_record_id order by id for share nowait;
 select * into strict l from conveni_first_candidate.visual_economic_links where event_id=p_link and draft_id=p_draft and receipt_id=p_receipt for share nowait;
 select * into strict rc from conveni_first_candidate.receipts where event_id=p_receipt and draft_id=p_draft for share nowait;
 if l.reviewer is distinct from p_actor or l.manifest_confirmed is distinct from true then raise exception 'INDEPENDENT_VISUAL_REVIEW_REQUIRED';end if;
 -- Reuse the complete historical/documentary validation. The link exists, so
-- this is an exact replay, not a second human declaration.
 perform conveni_first_candidate.historical_visual_link_draft(l.event_id,l.draft_id,l.receipt_id,l.monetary,l.identity,l.role_period,l.reviewer,l.note,true,true,l.manifest_confirmed);
 proof:=conveni_first_candidate.historical_snapshot(d.id);
 -- Fence the catalog used by the read proof; version parent lock also
 -- prevents FK-backed service insertion during capture.
 perform 1 from public.catalog_versions where id=d.catalog_version_id for update nowait;
 perform 1 from public.official_services where version_id=d.catalog_version_id order by service_code for share nowait;
 if rc.kind is distinct from 'physical-read-only-v1' or rc.snapshot is distinct from proof then raise exception 'INDEPENDENT_RECEIPT_STALE';end if;
 select * into previous from conveni_independent_experiment.revisions where unit_id=d.unit_id order by sequence desc limit 1;
 request_:=jsonb_build_object('previous',p_previous,'draft',p_draft,'receipt',p_receipt,'link',p_link,'actor',p_actor,'reason',p_reason,'confirm',p_confirm);
 select * into prior from conveni_independent_experiment.revisions where id=p_event;
 if found then
  if prior.request is distinct from request_ or prior.snapshot is distinct from proof or prior.id is distinct from previous.id then raise exception 'INDEPENDENT_REPLAY_CONFLICT';end if;
  return jsonb_build_object('event_id',prior.id,'sequence',prior.sequence,'private_only',true);
 end if;
 if previous.id is distinct from p_previous then raise exception 'INDEPENDENT_PREVIOUS_STALE';end if;
 -- Count old/stale sibling revisions as a conservative reservation against
 -- the ceiling. They are not current funding; the display/export layer must
 -- suppress them and show their pending review. This avoids a circular block
 -- after a new job, when neither sibling could otherwise be reviewed first.
 for sibling in select distinct on (unit_id) * from conveni_independent_experiment.revisions where source_record_id=d.source_record_id and unit_id<>d.unit_id order by unit_id,sequence desc loop
  if sibling.job_id is distinct from d.job_id then stale_siblings:=stale_siblings+1;
  else
   begin
    if sibling.snapshot is distinct from conveni_first_candidate.historical_snapshot(sibling.draft_id) then stale_siblings:=stale_siblings+1;end if;
   exception when lock_not_available then raise;
    when others then stale_siblings:=stale_siblings+1;
   end;
  end if;
 end loop;
 -- Count a legacy provision only while it has not been shadowed by a newer
 -- independent revision of that same unit. Neither row is changed here.
 select coalesce(sum(p.amount*100),0) into active_ from public.service_provisions p
 where p.source_record_id=d.source_record_id and p.superseded_at is null and p.unit_id<>d.unit_id
 and not exists(select 1 from conveni_independent_experiment.revisions e where e.unit_id=p.unit_id);
 select coalesce(sum(v.amount_cents),0) into own_ from (
  select distinct on (unit_id) unit_id,amount_cents from conveni_independent_experiment.revisions
  where source_record_id=d.source_record_id and unit_id<>d.unit_id order by unit_id,sequence desc
 ) v;
 total_:=public.conveni_public_amount((select source_payload from public.source_records where id=d.source_record_id))*100;
 if total_ is null or active_+own_+d.amount_cents>total_ then raise exception 'INDEPENDENT_TOTAL_EXCEEDED';end if;
 if d.amount_cents is distinct from (check_->>'amount_cents')::bigint or d.service_code is distinct from (select data->>'service_code' from public.conveni_unit_proposals where job_id=d.job_id and unit_id=d.unit_id)
 then raise exception 'INDEPENDENT_DRAFT_CHANGED';end if;
 -- Follow the existing provision trigger: exact normalized NIF only. Never
 -- invent a registry entity or bind a name-only match. If it changes later,
 -- the association is suppressed independently of the financing decision.
 bound_nif:=regexp_replace(upper(coalesce(d.proposal_snapshot->>'recipient_nif','')),'[^A-Z0-9]','','g');
 select id into bound_entity from public.entities where nif=bound_nif for share nowait;
 insert into conveni_independent_experiment.revisions(id,source_record_id,job_id,unit_id,sequence,previous_id,draft_id,receipt_id,visual_link_id,amount_cents,service_code,entity_id,entity_nif,declared_reviewer,reason,request,snapshot,read_proof)
 values(p_event,d.source_record_id,d.job_id,d.unit_id,coalesce(previous.sequence,0)+1,p_previous,p_draft,p_receipt,p_link,d.amount_cents,d.service_code,bound_entity,bound_nif,p_actor,p_reason,request_,proof,conveni_independent_experiment.read_context(p_draft,p_link));
 return jsonb_build_object('event_id',p_event,'sequence',coalesce(previous.sequence,0)+1,'reserved_stale_siblings',stale_siblings,'private_only',true);
end $$;
revoke all on function conveni_independent_experiment.commit_revision(uuid,uuid,uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;

-- Read-only projection proof; exact immutable dependencies must match. New
-- visual observations may be appended without invalidating previous units.
create function conveni_independent_experiment.revision_is_current_readonly(p_event uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select coalesce((select e.job_id=(select id from public.pipeline_jobs where source_record_id=e.source_record_id and not verification_only order by created_at desc,id desc limit 1)
  and e.id=(select id from conveni_independent_experiment.revisions where unit_id=e.unit_id order by sequence desc limit 1)
  and c.ctx is not null and c.ctx-'visual'=e.read_proof-'visual'
  and (c.ctx->'visual') @> (e.read_proof->'visual')
 from conveni_independent_experiment.revisions e cross join lateral (select conveni_independent_experiment.read_context(e.draft_id,e.visual_link_id) ctx) c where e.id=p_event),false)
$$;
revoke all on function conveni_independent_experiment.revision_is_current_readonly(uuid) from public,anon,authenticated,service_role;

-- A stale current revision never falls back to an older/legacy amount. Errors
-- are represented as pending, not silently counted as current financing.
create function conveni_independent_experiment.revision_is_current(p_event uuid) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare e conveni_independent_experiment.revisions; l conveni_first_candidate.visual_economic_links; rc conveni_first_candidate.receipts;
begin
 select * into e from conveni_independent_experiment.revisions where id=p_event;
 if not found or e.id is distinct from (select id from conveni_independent_experiment.revisions where unit_id=e.unit_id order by sequence desc limit 1)
  or e.job_id is distinct from (select id from public.pipeline_jobs where source_record_id=e.source_record_id and not verification_only order by created_at desc,id desc limit 1) then return false;end if;
 if conveni_independent_experiment.assess(e.source_record_id,e.job_id,e.unit_id)->>'status' is distinct from 'independent_arithmetic_candidate' then return false;end if;
 -- The committed decision keeps its own verified proof while a later draft is
 -- being prepared. Fence its dependencies, not the mutable draft head.
 perform 1 from public.conveni_review_events where unit_id=e.unit_id order by id for share nowait;
 perform 1 from public.conveni_unit_economic_draft_events where id=e.draft_id for share nowait;
 select * into strict l from conveni_first_candidate.visual_economic_links where event_id=e.visual_link_id and draft_id=e.draft_id and receipt_id=e.receipt_id for share nowait;
 select * into strict rc from conveni_first_candidate.receipts where event_id=e.receipt_id and draft_id=e.draft_id for share nowait;
 perform 1 from public.catalog_versions v where v.id=(select catalog_version_id from public.conveni_unit_economic_draft_events where id=e.draft_id) for update nowait;
 perform 1 from public.official_services s where s.version_id=(select catalog_version_id from public.conveni_unit_economic_draft_events where id=e.draft_id) order by s.service_code for share nowait;
 perform 1 from storage.objects o where o.bucket_id='cloud-documents' and (o.name in(select storage_path from public.source_documents where source_record_id=e.source_record_id) or o.name like ('cases/'||e.source_record_id||'/items/'||e.unit_id||'/documents/%')) order by o.name for share nowait;
 if rc.snapshot is distinct from e.snapshot or rc.kind is distinct from 'physical-read-only-v1' then return false;end if;
 return conveni_independent_experiment.revision_is_current_readonly(e.id);
exception when lock_not_available then raise; when others then return false;
end $$;
revoke all on function conveni_independent_experiment.revision_is_current(uuid) from public,anon,authenticated,service_role;

create function conveni_independent_experiment.capture(p_record uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment,storage as $$
declare rows_ jsonb;total_ numeric;
begin
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update nowait;
 if not found then raise exception 'INDEPENDENT_RECORD_INVALID';end if;
 perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;
 perform 1 from public.conveni_analyses where source_record_id=p_record order by job_id for share nowait;
 perform 1 from public.record_units where source_record_id=p_record order by id for share nowait;
 perform 1 from public.conveni_review_events where source_record_id=p_record order by id for share nowait;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share nowait;
 perform 1 from public.service_provisions where source_record_id=p_record order by id for share nowait;
 perform 1 from conveni_independent_experiment.revisions where source_record_id=p_record order by id for share nowait;
 -- The projection checks the currently pinned entity's NIF. Fence those
 -- rows through snapshot comparison and receipt insertion. A NULL pinned id
 -- remains NULL even if a matching entity is inserted later.
 perform 1 from public.entities where id in (select entity_id from conveni_independent_experiment.revisions where source_record_id=p_record and entity_id is not null) order by id for share nowait;
 with latest as (
  select distinct on (unit_id) * from conveni_independent_experiment.revisions where source_record_id=p_record order by unit_id,sequence desc
 ), validated as materialized (
  select x.*,conveni_independent_experiment.revision_is_current(x.id) as current_ from latest x
 ), lines as (
  select p.unit_id,p.id,case when p.amount is not null and exists(select 1 from public.conveni_reviewed_provisions visible where visible.id=p.id) then 'current' else 'pending' end as state,
   'legacy'::text as source,case when p.amount is not null and exists(select 1 from public.conveni_reviewed_provisions visible where visible.id=p.id) then p.amount*100 else null end as amount_cents,
   p.provider_name as recipient,p.service_code,p.period,p.target_population
  from public.service_provisions p where p.source_record_id=p_record and p.superseded_at is null and not exists(select 1 from latest x where x.unit_id=p.unit_id)
  union all
  select x.unit_id,x.id,case when x.current_ then 'current' else 'pending' end,
   'versioned'::text,case when x.current_ then x.amount_cents::numeric else null end,
   d.proposal_snapshot->>'recipient',x.service_code,d.proposal_snapshot->>'period',d.proposal_snapshot->>'population'
  from validated x join public.conveni_unit_economic_draft_events d on d.id=x.draft_id
 )
 select coalesce(jsonb_agg(to_jsonb(lines) order by unit_id,id),'[]'::jsonb),coalesce(sum(amount_cents),0) into rows_,total_ from lines;
 return jsonb_build_object('record_id',p_record,'lines',rows_,'current_total_cents',total_,'scope','PRIVATE_EXPERIMENT');
end $$;
revoke all on function conveni_independent_experiment.capture(uuid) from public,anon,authenticated,service_role;

create table conveni_independent_experiment.export_receipts (
 event_id uuid primary key,source_record_id uuid not null references public.source_records(id),
 snapshot jsonb not null,content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),created_at timestamptz not null default clock_timestamp()
);
revoke all on conveni_independent_experiment.export_receipts from public,anon,authenticated,service_role;
create trigger immutable_export before update or delete on conveni_independent_experiment.export_receipts for each row execute function conveni_independent_experiment.immutable_revision();
create function conveni_independent_experiment.finalize_export(p_event uuid,p_record uuid,p_snapshot jsonb,p_content_sha256 text) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare current_ jsonb;prior conveni_independent_experiment.export_receipts;
begin
 if p_event is null or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'INDEPENDENT_EXPORT_INVALID';end if;
 select * into prior from conveni_independent_experiment.export_receipts where event_id=p_event;
 if found then
  if prior.source_record_id is distinct from p_record or prior.snapshot is distinct from p_snapshot or prior.content_sha256 is distinct from p_content_sha256 then raise exception 'INDEPENDENT_EXPORT_CONFLICT';end if;
  return prior.event_id;
 end if;
 current_:=conveni_independent_experiment.capture(p_record);
 if current_ is distinct from p_snapshot then raise exception 'INDEPENDENT_EXPORT_STALE';end if;
 insert into conveni_independent_experiment.export_receipts(event_id,source_record_id,snapshot,content_sha256) values(p_event,p_record,current_,p_content_sha256);
 return p_event;
end $$;
revoke all on function conveni_independent_experiment.finalize_export(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;


-- Source: readonly-projection.sql
-- PRIVATE candidate only. App roles have no execute privilege. Neither SQL
-- projection checks physical bytes or turns unreviewed proposals into awards.
create function conveni_independent_experiment.combined_provisions() returns setof public.service_provisions
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select p.* from public.concert_line_combined_provisions() p
 where not exists(select 1 from conveni_independent_experiment.revisions e where e.unit_id=p.unit_id)
 union all
 select (jsonb_populate_record(null::public.service_provisions,jsonb_build_object(
  'id',e.id,'source_record_id',e.source_record_id,'source_id',r.source_record_id,'unit_id',e.unit_id,
  'provider_name',d.proposal_snapshot->>'recipient','provider_nif',d.proposal_snapshot->>'recipient_nif',
  'entity_id',(select x.id from public.entities x where x.id=e.entity_id and x.nif=e.entity_nif),
  'mechanism','Conveni','amount',e.amount_cents::numeric/100,'target_population',d.proposal_snapshot->>'population',
  'period',d.proposal_snapshot->>'period','source_reference',r.source_dataset||':'||r.source_record_id,
  'catalog_version_id',d.catalog_version_id,'service_code',e.service_code,'created_at',e.created_at,'approved_at',e.created_at))).*
 from conveni_independent_experiment.revisions e join public.conveni_unit_economic_draft_events d on d.id=e.draft_id
 join public.source_records r on r.id=e.source_record_id
 where conveni_independent_experiment.revision_is_current_readonly(e.id)
$$;
revoke all on function conveni_independent_experiment.combined_provisions() from public,anon,authenticated,service_role;

create function conveni_independent_experiment.combined_units() returns setof public.conveni_current_units
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select (jsonb_populate_record(null::public.conveni_current_units,to_jsonb(c)||case when last_.id is null then '{}'::jsonb
  when conveni_independent_experiment.revision_is_current_readonly(last_.id) then jsonb_build_object('review_id',last_.id,'outcome','select','reviewed_code',last_.service_code,'review_note',last_.reason,'reviewed_job',last_.job_id,'reviewed_at',last_.created_at)
  else jsonb_build_object('review_id',last_.id,'outcome',null,'reviewed_code',null,'review_note','Revisió pendent: les evidències o el context han canviat.','reviewed_job',null,'reviewed_at',last_.created_at) end)).*
 from public.conveni_current_units c
 left join lateral(select * from conveni_independent_experiment.revisions e where e.unit_id=c.unit_id order by e.sequence desc limit 1) last_ on true
$$;
revoke all on function conveni_independent_experiment.combined_units() from public,anon,authenticated,service_role;


-- Source: entity-projection.sql
-- PRIVATE: preserve existing relations, hide legacy relations shadowed by a
-- versioned unit and project at most one exact-NIF relation per current event.
create function conveni_independent_experiment.combined_entity_relations() returns setof public.entity_catalog_relations
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select r.* from public.entity_catalog_relations r
 where not (r.source_type='provision' and exists(select 1 from public.service_provisions p join conveni_independent_experiment.revisions x on x.unit_id=p.unit_id where p.id::text=r.source_reference))
 union all
 select (jsonb_populate_record(null::public.entity_catalog_relations,jsonb_build_object('id',e.id,'entity_id',e.entity_id,'service_code',e.service_code,
  'catalog_version_id',d.catalog_version_id,'relation_type','confirmed','source_type','provision','source_reference',e.id::text,
  'evidence','Provisió revisada; NIF exacte','created_at',e.created_at,'updated_at',e.created_at))).*
 from conveni_independent_experiment.revisions e join public.conveni_unit_economic_draft_events d on d.id=e.draft_id
 join public.entities entity on entity.id=e.entity_id and entity.nif=e.entity_nif
 where conveni_independent_experiment.revision_is_current_readonly(e.id)
$$;
revoke all on function conveni_independent_experiment.combined_entity_relations() from public,anon,authenticated,service_role;


-- Source: record-export.sql
-- PRIVATE candidate: one record only. No role grants, no claim that SQL read
-- XLSX or source bytes. The caller hashes its generated bytes.
create function conveni_independent_experiment.record_export_snapshot(p_record uuid,p_year integer default null) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select jsonb_build_object('record_id',p_record,'year',p_year,'source_payload',(select r.source_payload from public.source_records r where r.id=p_record and r.financing_type='conveni'),
  'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.unit_id),'[]') from conveni_independent_experiment.combined_units() u where u.source_record_id=p_record),
  'provisions',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('service_name',s.service_name) order by p.id),'[]')
    from conveni_independent_experiment.combined_provisions() p
    join conveni_independent_experiment.combined_units() u on u.unit_id=p.unit_id and u.source_record_id=p_record and u.outcome='select' and u.reviewed_job=u.job_id
    left join public.official_services s on s.version_id=p.catalog_version_id and s.service_code=p.service_code
    where p.source_record_id=p_record and (p_year is null or u.data->>'year'=p_year::text)),
  'analyses',(select coalesce(jsonb_agg(to_jsonb(a) order by a.source_record_id),'[]') from public.conveni_current_analyses a where a.source_record_id=p_record))
$$;
revoke all on function conveni_independent_experiment.record_export_snapshot(uuid,integer) from public,anon,authenticated,service_role;
create table conveni_independent_experiment.record_export_receipts(event_id uuid primary key,record_id uuid not null references public.source_records(id),snapshot jsonb not null,content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'));
revoke all on conveni_independent_experiment.record_export_receipts from public,anon,authenticated,service_role;
create trigger immutable_record_export before update or delete on conveni_independent_experiment.record_export_receipts for each row execute function conveni_independent_experiment.immutable_revision();
create function conveni_independent_experiment.finalize_record_export(p_event uuid,p_record uuid,p_year integer,p_snapshot jsonb,p_hash text) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,storage,conveni_independent_experiment as $$
declare prior conveni_independent_experiment.record_export_receipts; current_ jsonb;
begin
 if p_event is null or p_record is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->>'record_id' is distinct from p_record::text or p_snapshot->'year' is distinct from coalesce(to_jsonb(p_year),'null'::jsonb) then raise exception 'RECORD_EXPORT_INVALID';end if;
 select * into prior from conveni_independent_experiment.record_export_receipts where event_id=p_event;
 if found then
  if prior.record_id is distinct from p_record or prior.snapshot is distinct from p_snapshot or prior.content_sha256 is distinct from p_hash then raise exception 'RECORD_EXPORT_CONFLICT';end if;
  return prior.event_id;
 end if;
 -- Fence source, jobs, units, proposals, reviews, documents and revisions;
 -- reused proof validation separately fences the exact source/copy objects.
 perform conveni_independent_experiment.capture(p_record);
 perform 1 from public.catalog_versions v where v.id in(select d.catalog_version_id from conveni_independent_experiment.revisions e join public.conveni_unit_economic_draft_events d on d.id=e.draft_id where e.source_record_id=p_record) order by v.id for update nowait;
 perform 1 from public.official_services s where s.version_id in(select d.catalog_version_id from conveni_independent_experiment.revisions e join public.conveni_unit_economic_draft_events d on d.id=e.draft_id where e.source_record_id=p_record) order by s.version_id,s.service_code for share nowait;
 perform 1 from storage.objects o where o.bucket_id='cloud-documents' and o.name like ('cases/'||p_record||'/%') order by o.name for share nowait;
 current_:=conveni_independent_experiment.record_export_snapshot(p_record,p_year);
 if current_ is distinct from p_snapshot then raise exception 'RECORD_EXPORT_STALE' using errcode='40001';end if;
 insert into conveni_independent_experiment.record_export_receipts values(p_event,p_record,p_snapshot,p_hash);return p_event;
end $$;
revoke all on function conveni_independent_experiment.finalize_record_export(uuid,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;


-- Source: writer-fence.sql
-- PRIVATE candidate. Guard installed only in disposable tests until all
-- legacy writers and lock ordering have been reviewed. No role grants.
create function conveni_independent_experiment.fence_legacy_write() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare rec uuid; old_record uuid;new_record uuid;
begin
 if tg_op<>'INSERT' then old_record:=old.source_record_id;end if;
 if tg_op<>'DELETE' then new_record:=new.source_record_id;end if;
 for rec in select distinct x from unnest(array[old_record,new_record]) x where x is not null order by x loop
  perform 1 from public.source_records where id=rec for update nowait;
  if not found then raise exception 'LEGACY_FENCE_SOURCE_MISSING';end if;
  if exists(select 1 from conveni_independent_experiment.revisions where source_record_id=rec) then
   raise exception 'LEGACY_REVIEW_REQUIRES_VERSIONED_WORKFLOW' using errcode='40001';
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function conveni_independent_experiment.fence_legacy_write() from public,anon,authenticated,service_role;


-- Source: mixed-export.sql
-- PRIVATE mixed receipt. The caller generates and hashes bytes. Legacy rows
-- reuse the Concerts receipt contract inside the same SQL transaction.
create table conveni_independent_experiment.mixed_receipts(event_id uuid primary key,content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),snapshot jsonb not null);
revoke all on conveni_independent_experiment.mixed_receipts from public,anon,authenticated,service_role;
create trigger immutable_mixed before update or delete on conveni_independent_experiment.mixed_receipts for each row execute function conveni_independent_experiment.immutable_revision();
create function conveni_independent_experiment.mixed_snapshot(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') from (
  select e x from jsonb_array_elements(public.concert_line_mixed_snapshot(p_ids)) e
  where not exists(select 1 from conveni_independent_experiment.revisions r where r.unit_id=(e->'snapshot'->>'unit_id')::uuid)
  union all
  select jsonb_build_object('id',p.id,'snapshot',to_jsonb(p)||jsonb_build_object('service_name',coalesce(o.service_name,p.service_code),
   'official_services',case when o.service_code is null then null else jsonb_build_object('service_name',o.service_name) end,
   'source_records',jsonb_build_object('financing_type',s.financing_type)))
  from conveni_independent_experiment.combined_provisions() p join conveni_independent_experiment.revisions e on e.id=p.id
  join public.source_records s on s.id=p.source_record_id left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code
  where p.id=any(p_ids)
 ) q
$$;
revoke all on function conveni_independent_experiment.mixed_snapshot(uuid[]) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.mixed_commit(p_event uuid,p_hash text,p_expected jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare ids uuid[];sources uuid[];rec uuid;actual jsonb;old_ conveni_independent_experiment.mixed_receipts;legacy_ jsonb;
begin
 if p_event is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_expected) is distinct from 'array' or jsonb_array_length(p_expected)=0 or jsonb_array_length(p_expected)>5000 then raise exception 'MIXED_PRIVATE_INVALID';end if;
 select array_agg((e->>'id')::uuid order by e->>'id'),array_agg(distinct (e->'snapshot'->>'source_record_id')::uuid order by (e->'snapshot'->>'source_record_id')::uuid) into ids,sources from jsonb_array_elements(p_expected) e;
 if array_position(ids,null) is not null or array_position(sources,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'MIXED_PRIVATE_INVALID';end if;
 select * into old_ from conveni_independent_experiment.mixed_receipts where event_id=p_event;
 if found then if old_.content_sha256 is distinct from p_hash or old_.snapshot is distinct from p_expected then raise exception 'MIXED_PRIVATE_CONFLICT';end if;return p_event;end if;
 perform 1 from public.source_records where id=any(sources) order by id for update nowait;
 for rec in select distinct source_record_id from conveni_independent_experiment.revisions where id=any(ids) order by source_record_id loop
  perform conveni_independent_experiment.capture(rec);
 end loop;
 select coalesce(jsonb_agg(e order by e->>'id'),'[]') into legacy_ from jsonb_array_elements(p_expected) e where not exists(select 1 from conveni_independent_experiment.revisions r where r.id=(e->>'id')::uuid);
 if jsonb_array_length(legacy_)>0 then perform public.concert_line_mixed_commit(p_event,p_hash,legacy_);end if;
 actual:=conveni_independent_experiment.mixed_snapshot(ids);
 if actual is distinct from p_expected then raise exception 'MIXED_PRIVATE_STALE' using errcode='40001';end if;
 insert into conveni_independent_experiment.mixed_receipts values(p_event,p_hash,p_expected);return p_event;
end $$;
revoke all on function conveni_independent_experiment.mixed_commit(uuid,text,jsonb) from public,anon,authenticated,service_role;


-- Source: aggregate-export.sql
-- PRIVATE candidate for mixed batch/Master snapshots; no role grants.
create function conveni_independent_experiment.aggregate_snapshot(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select coalesce(jsonb_agg(x order by x->>'id'),'[]') from (
  select e x from jsonb_array_elements(public.concert_line_mixed_snapshot(p_ids,true)) e
   where not exists(select 1 from conveni_independent_experiment.revisions r where r.unit_id=(e->'snapshot'->>'unit_id')::uuid)
  union all
  select e from jsonb_array_elements(conveni_independent_experiment.mixed_snapshot(p_ids)) e
   where exists(select 1 from conveni_independent_experiment.revisions r where r.id=(e->>'id')::uuid)
 ) q
$$;
revoke all on function conveni_independent_experiment.aggregate_snapshot(uuid[]) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.aggregate_commit(p_event uuid,p_run uuid,p_filename text,p_hash text,p_rows jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare ids uuid[];sources uuid[];rec uuid;legacy_ jsonb;prior conveni_independent_experiment.mixed_receipts;existing public.excel_exports;
begin
 if p_event is null or length(trim(coalesce(p_filename,'')))=0 or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 then raise exception 'AGGREGATE_INVALID';end if;
 select array_agg((e->>'id')::uuid order by e->>'id'),array_agg(distinct (e->'snapshot'->>'source_record_id')::uuid order by (e->'snapshot'->>'source_record_id')::uuid) into ids,sources from jsonb_array_elements(p_rows) e;
 if array_position(ids,null) is not null or array_position(sources,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'AGGREGATE_INVALID';end if;
 select * into prior from conveni_independent_experiment.mixed_receipts where event_id=p_event;
 select * into existing from public.excel_exports where id=p_event;
 if prior.event_id is not null then
  if prior.content_sha256 is distinct from p_hash or prior.snapshot is distinct from p_rows or existing.id is null or existing.pipeline_run_id is distinct from p_run or existing.filename is distinct from p_filename or existing.content_hash is distinct from p_hash or existing.provision_count is distinct from jsonb_array_length(p_rows) then raise exception 'AGGREGATE_REPLAY_CONFLICT';end if;
  return p_event;
 end if;
 perform 1 from public.source_records where id=any(sources) order by id for update nowait;
 for rec in select distinct source_record_id from conveni_independent_experiment.revisions where id=any(ids) order by source_record_id loop perform conveni_independent_experiment.capture(rec);end loop;
 select coalesce(jsonb_agg(e order by e->>'id'),'[]') into legacy_ from jsonb_array_elements(p_rows) e where not exists(select 1 from conveni_independent_experiment.revisions r where r.id=(e->>'id')::uuid);
 if jsonb_array_length(legacy_)>0 then perform public.concert_line_mixed_commit(p_event,p_hash,legacy_,true);end if;
 if conveni_independent_experiment.aggregate_snapshot(ids) is distinct from p_rows then raise exception 'AGGREGATE_STALE' using errcode='40001';end if;
 insert into conveni_independent_experiment.mixed_receipts values(p_event,p_hash,p_rows);
 insert into public.excel_exports(id,pipeline_run_id,filename,content_hash,provision_count) values(p_event,p_run,p_filename,p_hash,jsonb_array_length(p_rows));
 insert into public.excel_export_items(export_id,provision_id) select p_event,p.id from public.service_provisions p where p.id=any(ids);
 return p_event;
end $$;
revoke all on function conveni_independent_experiment.aggregate_commit(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.batch_snapshot(p_run uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare sources uuid[];ids uuid[];rows_ jsonb;pending jsonb;jobs jsonb;
begin
 if not exists(select 1 from public.pipeline_runs where id=p_run) then raise exception 'BATCH_NOT_FOUND';end if;
 select coalesce(array_agg(distinct j.source_record_id order by j.source_record_id),'{}'::uuid[]) into sources from public.pipeline_jobs j where j.run_id=p_run;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'source_record_id',j.source_record_id) order by j.id),'[]') into jobs from public.pipeline_jobs j where j.run_id=p_run;
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from conveni_independent_experiment.combined_provisions() p where p.source_record_id=any(sources) and p.superseded_at is null;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'BATCH_DUPLICATE';end if;
 rows_:=conveni_independent_experiment.aggregate_snapshot(ids);if jsonb_array_length(rows_)<>cardinality(ids) then raise exception 'BATCH_REVIEW_REQUIRED' using errcode='40001';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'source_record_id',u.source_record_id) order by u.source_record_id,u.id),'[]') into pending
 from public.record_units u join public.source_records s on s.id=u.source_record_id left join conveni_independent_experiment.combined_units() c on c.unit_id=u.id
 where u.source_record_id=any(sources) and u.unit_key<>'legacy' and (case when s.financing_type='conveni' and c.unit_id is not null then c.outcome is distinct from 'select' or c.reviewed_job is distinct from c.job_id else u.status='draft' end);
 return jsonb_build_object('run_id',p_run,'sources',to_jsonb(sources),'jobs',jobs,'provisions',rows_,'pending',pending);
end $$;
revoke all on function conveni_independent_experiment.batch_snapshot(uuid) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.batch_commit(p_event uuid,p_run uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare sources uuid[];
begin
 if jsonb_typeof(p_expected) is distinct from 'object' or p_expected->>'run_id' is distinct from p_run::text or jsonb_typeof(p_expected->'sources') is distinct from 'array' then raise exception 'BATCH_INVALID';end if;
 select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into sources from jsonb_array_elements_text(p_expected->'sources');
 perform 1 from public.pipeline_runs where id=p_run for update nowait;if not found then raise exception 'BATCH_NOT_FOUND';end if;
 perform 1 from public.source_records where id=any(sources) order by id for update nowait;
 perform 1 from public.pipeline_jobs where run_id=p_run or source_record_id=any(sources) order by id for update nowait;
 perform 1 from public.record_units where source_record_id=any(sources) order by id for update nowait;
 if conveni_independent_experiment.batch_snapshot(p_run) is distinct from p_expected then raise exception 'BATCH_STALE' using errcode='40001';end if;
 return conveni_independent_experiment.aggregate_commit(p_event,p_run,p_filename,p_hash,p_expected->'provisions');
end $$;
revoke all on function conveni_independent_experiment.batch_commit(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.master_snapshot() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare ids uuid[];rows_ jsonb;
begin
 select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from conveni_independent_experiment.combined_provisions() p where p.superseded_at is null;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'MASTER_DUPLICATE';end if;
 rows_:=conveni_independent_experiment.aggregate_snapshot(ids);if jsonb_array_length(rows_)<>cardinality(ids) then raise exception 'MASTER_REVIEW_REQUIRED' using errcode='40001';end if;
 return jsonb_build_object('provisions',rows_);
end $$;
revoke all on function conveni_independent_experiment.master_snapshot() from public,anon,authenticated,service_role;
create function conveni_independent_experiment.master_commit(p_event uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,storage,conveni_independent_experiment as $$
begin
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_expected->'provisions') is distinct from 'array' then raise exception 'MASTER_INVALID';end if;
 -- Same broad phantom fence as the closed Concerts candidate, extended to the
 -- new immutable dependencies. Requires operational benchmarking before use.
 lock table public.source_records,public.entities,public.pipeline_jobs,public.record_units,public.source_documents,public.documented_corrections,public.review_decisions,public.service_provisions,public.conveni_analyses,public.conveni_unit_proposals,public.conveni_review_events,public.conveni_unit_economic_draft_events,public.conveni_visual_reads,public.conveni_visual_observations,public.catalog_versions,public.official_services,public.concert_line_awards,public.concert_line_award_decisions,public.concert_population_events,storage.objects,conveni_independent_experiment.revisions in share mode nowait;
 if conveni_independent_experiment.master_snapshot() is distinct from p_expected then raise exception 'MASTER_STALE' using errcode='40001';end if;
 return conveni_independent_experiment.aggregate_commit(p_event,null,p_filename,p_hash,p_expected->'provisions');
end $$;
revoke all on function conveni_independent_experiment.master_commit(uuid,text,text,jsonb) from public,anon,authenticated,service_role;


-- Source: history-projection.sql
-- PRIVATE experimental history projection; does not mutate review events.
create function conveni_independent_experiment.combined_history() returns setof public.conveni_review_events
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select e.* from public.conveni_review_events e
 union all
 select (jsonb_populate_record(null::public.conveni_review_events,jsonb_build_object(
  'id',e.id,'source_record_id',e.source_record_id,'job_id',e.job_id,'unit_id',e.unit_id,'outcome','select',
  'service_code',e.service_code,'reason',e.reason,'actor',e.declared_reviewer,'created_at',e.created_at,
  'snapshot',jsonb_build_object('replay_previous',coalesce(e.previous_id,d.parent_review_id),'origin','private-versioned-conveni-v1')))).*
 from conveni_independent_experiment.revisions e join public.conveni_unit_economic_draft_events d on d.id=e.draft_id
$$;
revoke all on function conveni_independent_experiment.combined_history() from public,anon,authenticated,service_role;


-- Source: export-history.sql
-- PRIVATE versioned export history. excel_exports.provision_count is the total
-- rendered rows; excel_export_items can contain only physical provisions.
-- The immutable mixed receipt is the authoritative detail for this contract.
create function conveni_independent_experiment.export_history(p_event uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select jsonb_build_object('contract','mixed-export-history-v1','header',to_jsonb(h),'sha256',r.content_sha256,
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','origin',case when x.id is null then 'physical' else 'conveni_versioned' end,
   'snapshot',e->'snapshot','physical_link',i.provision_id is not null) order by e->>'id'),'[]')
  from jsonb_array_elements(r.snapshot) e left join conveni_independent_experiment.revisions x on x.id=(e->>'id')::uuid
  left join public.excel_export_items i on i.export_id=h.id and i.provision_id=(e->>'id')::uuid))
 from public.excel_exports h join conveni_independent_experiment.mixed_receipts r on r.event_id=h.id where h.id=p_event
$$;
revoke all on function conveni_independent_experiment.export_history(uuid) from public,anon,authenticated,service_role;


-- Source: ledger-marker.sql
-- Candidate monotonic compatibility marker. Existing service_role access to
-- app_settings is reused; no new grants are introduced.
alter table public.app_settings drop constraint app_settings_known_key;
alter table public.app_settings add constraint app_settings_known_key check(key in ('automatic_ocr','processing_enabled','conveni_independent_ledger'));
insert into public.app_settings(key,enabled,reason) values('conveni_independent_ledger',false,'schema_present_no_versioned_reviews');
create function conveni_independent_experiment.guard_ledger_marker() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.key='conveni_independent_ledger' then
  if tg_op='DELETE' or new.key is distinct from old.key or (old.enabled is true and new.enabled is distinct from true) then raise exception 'INDEPENDENT_MARKER_MONOTONIC';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function conveni_independent_experiment.guard_ledger_marker() from public,anon,authenticated,service_role;
create trigger guard_independent_marker before update or delete on public.app_settings for each row execute function conveni_independent_experiment.guard_ledger_marker();
create function conveni_independent_experiment.mark_ledger_exists() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare enabled_ boolean;
begin
 select enabled into enabled_ from public.app_settings where key='conveni_independent_ledger';
 if not found then raise exception 'INDEPENDENT_MARKER_MISSING';end if;
 if enabled_ is distinct from true then
  perform 1 from public.app_settings where key='conveni_independent_ledger' for update nowait;
  update public.app_settings set enabled=true,reason='versioned_reviews_exist' where key='conveni_independent_ledger' and enabled is distinct from true;
 end if;
 return new;
end $$;
revoke all on function conveni_independent_experiment.mark_ledger_exists() from public,anon,authenticated,service_role;
create trigger mark_independent_ledger after insert on conveni_independent_experiment.revisions for each row execute function conveni_independent_experiment.mark_ledger_exists();


-- The legacy write fence is inert until an independent revision exists. It
-- serializes native writes by source and fails closed on conflicting writers.
create trigger conveni_independent_fence_reviews before insert or update or delete on public.conveni_review_events for each row execute function conveni_independent_experiment.fence_legacy_write();
create trigger conveni_independent_fence_provisions before insert or update or delete on public.service_provisions for each row execute function conveni_independent_experiment.fence_legacy_write();

-- Public PostgREST contracts are intentionally closed pending full integration.
create function public.conveni_independent_provisions() returns setof public.service_provisions language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.combined_provisions()$$;
create function public.conveni_independent_units() returns setof public.conveni_current_units language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.combined_units()$$;
create function public.conveni_independent_history() returns setof public.conveni_review_events language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.combined_history()$$;
create function public.conveni_independent_mixed_snapshot(p_ids uuid[]) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.mixed_snapshot(p_ids)$$;
create function public.conveni_independent_mixed_commit(p_receipt uuid,p_hash text,p_expected jsonb) returns uuid language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.mixed_commit(p_receipt,p_hash,p_expected)$$;
create function public.conveni_independent_batch_snapshot(p_run uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.batch_snapshot(p_run)$$;
create function public.conveni_independent_batch_commit(p_receipt uuid,p_run uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.batch_commit(p_receipt,p_run,p_filename,p_hash,p_expected)$$;
create function public.conveni_independent_master_snapshot() returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.master_snapshot()$$;
create function public.conveni_independent_master_commit(p_receipt uuid,p_filename text,p_hash text,p_expected jsonb) returns uuid language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.master_commit(p_receipt,p_filename,p_hash,p_expected)$$;
create function public.conveni_independent_record_snapshot(p_record uuid,p_year integer default null) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.record_export_snapshot(p_record,p_year)$$;
create function public.conveni_independent_record_commit(p_event uuid,p_record uuid,p_year integer,p_snapshot jsonb,p_hash text) returns uuid language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.finalize_record_export(p_event,p_record,p_year,p_snapshot,p_hash)$$;
create function public.conveni_independent_export_history(p_event uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.export_history(p_event)$$;
revoke all on function public.conveni_independent_provisions(),public.conveni_independent_units(),public.conveni_independent_history(),public.conveni_independent_mixed_snapshot(uuid[]),public.conveni_independent_mixed_commit(uuid,text,jsonb),public.conveni_independent_batch_snapshot(uuid),public.conveni_independent_batch_commit(uuid,uuid,text,text,jsonb),public.conveni_independent_master_snapshot(),public.conveni_independent_master_commit(uuid,text,text,jsonb),public.conveni_independent_record_snapshot(uuid,integer),public.conveni_independent_record_commit(uuid,uuid,integer,jsonb,text),public.conveni_independent_export_history(uuid) from public,anon,authenticated,service_role;

create function public.conveni_independent_entity_relations() returns setof public.entity_catalog_relations language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.combined_entity_relations()$$;
create function public.conveni_independent_relation_current(p public.entity_catalog_relations) returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(exists(select 1 from conveni_independent_experiment.combined_entity_relations() r where r.id=p.id and r.source_type=p.source_type and r.source_reference=p.source_reference and (exists(select 1 from conveni_independent_experiment.revisions e where e.id::text=r.source_reference) or public.entity_relation_is_current(r))),false)
$$;
create function public.conveni_independent_virtual(p public.service_provisions) returns boolean language sql stable security definer set search_path=pg_catalog as $$select exists(select 1 from conveni_independent_experiment.revisions e where e.id=p.id)$$;
revoke all on function public.conveni_independent_entity_relations(),public.conveni_independent_relation_current(public.entity_catalog_relations),public.conveni_independent_virtual(public.service_provisions) from public,anon,authenticated,service_role;
create function public.conveni_independent_approved() returns setof public.service_provisions language sql stable security definer set search_path=pg_catalog as $$
 select p.* from conveni_independent_experiment.combined_provisions() p join public.source_records r on r.id=p.source_record_id
 where r.processing_status='completat' or r.financing_type='conveni' or public.concert_line_approved(p)
$$;
revoke all on function public.conveni_independent_approved() from public,anon,authenticated,service_role;

-- Source: versioned-preparation.sql
-- PRIVATE versioned preparation state and explicit history acknowledgement.
create table conveni_independent_experiment.preparation_operations(
 id uuid primary key,record_id uuid not null references public.source_records(id),job_id uuid not null references public.pipeline_jobs(id),unit_id uuid not null references public.record_units(id),
 previous_id uuid not null references conveni_independent_experiment.revisions(id),payload jsonb not null,ids jsonb not null,state text not null default 'pending' check(state in ('pending','ready','superseded')),created_at timestamptz not null default clock_timestamp(),ready_at timestamptz,superseded_at timestamptz,supersession_reason text
);
revoke all on conveni_independent_experiment.preparation_operations from public,anon,authenticated,service_role;
create unique index independent_one_live_preparation on conveni_independent_experiment.preparation_operations(unit_id,previous_id) where state in ('pending','ready');
create function conveni_independent_experiment.guard_preparation_mutation() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if (to_jsonb(new)-'state'-'ready_at'-'superseded_at'-'supersession_reason') is distinct from (to_jsonb(old)-'state'-'ready_at'-'superseded_at'-'supersession_reason') or old.state<>'pending'
  or not ((new.state='ready' and new.ready_at is not null and new.superseded_at is null and new.supersession_reason is null) or (new.state='superseded' and new.ready_at is null and new.superseded_at is not null and length(trim(coalesce(new.supersession_reason,''))) between 10 and 2000)) then raise exception 'VERSIONED_OPERATION_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function conveni_independent_experiment.guard_preparation_mutation() from public,anon,authenticated,service_role;
create trigger immutable_versioned_operation before update on conveni_independent_experiment.preparation_operations for each row execute function conveni_independent_experiment.guard_preparation_mutation();
create trigger no_delete_versioned_operation before delete on conveni_independent_experiment.preparation_operations for each row execute function conveni_independent_experiment.immutable_revision();

create function conveni_independent_experiment.versioned_history(p_record uuid,p_unit uuid,p_exclude uuid default null) returns jsonb
language sql stable security invoker set search_path=pg_catalog,conveni_independent_experiment as $$
 select jsonb_build_object('record_id',p_record,'unit_id',p_unit,'previous_id',(select id from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit and id is distinct from p_exclude order by sequence desc limit 1),
 'events',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'job_id',e.job_id,'outcome','select','reason',e.reason,'created_at',e.created_at,'declared_actor',e.declared_reviewer,'previous',e.previous_id,'amount_cents',e.amount_cents,'service_code',e.service_code) order by e.sequence),'[]'))
 from conveni_independent_experiment.revisions e where e.source_record_id=p_record and e.unit_id=p_unit and e.id is distinct from p_exclude
$$;
revoke all on function conveni_independent_experiment.versioned_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create table conveni_independent_experiment.versioned_acknowledgements(id uuid primary key,record_id uuid not null references public.source_records(id),unit_id uuid not null references public.record_units(id),previous_id uuid not null references conveni_independent_experiment.revisions(id),snapshot jsonb not null,reviewer text not null,note text not null,created_at timestamptz not null default clock_timestamp());
create table conveni_independent_experiment.versioned_ack_links(draft_id uuid primary key references public.conveni_unit_economic_draft_events(id),ack_id uuid not null references conveni_independent_experiment.versioned_acknowledgements(id));
revoke all on conveni_independent_experiment.versioned_acknowledgements,conveni_independent_experiment.versioned_ack_links from public,anon,authenticated,service_role;
create trigger immutable_versioned_ack before update or delete on conveni_independent_experiment.versioned_acknowledgements for each row execute function conveni_independent_experiment.immutable_revision();
create trigger immutable_versioned_ack_link before update or delete on conveni_independent_experiment.versioned_ack_links for each row execute function conveni_independent_experiment.immutable_revision();
create function conveni_independent_experiment.preparation_get(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,conveni_independent_experiment as $$
 select to_jsonb(o) from conveni_independent_experiment.preparation_operations o where o.record_id=p_record and o.job_id=p_job and o.unit_id=p_unit and o.state in ('pending','ready') and o.previous_id=(select id from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit order by sequence desc limit 1)
$$;
create function conveni_independent_experiment.preparation_begin(p_record uuid,p_job uuid,p_unit uuid,p_previous uuid,p_operation uuid,p_payload jsonb,p_ids jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare old_ conveni_independent_experiment.preparation_operations;
begin
 if p_operation is null or p_previous is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2100000 or jsonb_typeof(p_ids) is distinct from 'object' or octet_length(p_ids::text)>1000 then raise exception 'VERSIONED_OPERATION_INVALID';end if;
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update nowait;
 if not found or not exists(select 1 from public.record_units where id=p_unit and source_record_id=p_record) or p_job is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) or p_previous is distinct from (select id from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit order by sequence desc limit 1) then raise exception 'VERSIONED_OPERATION_STALE' using errcode='40001';end if;
 select * into old_ from conveni_independent_experiment.preparation_operations where unit_id=p_unit and previous_id=p_previous and state in ('pending','ready') for update nowait;
 if found then if old_.record_id is distinct from p_record or old_.job_id is distinct from p_job or old_.payload is distinct from p_payload then raise exception 'VERSIONED_PREPARATION_RECONCILIATION_REQUIRED';end if;return to_jsonb(old_);end if;
 insert into conveni_independent_experiment.preparation_operations(id,record_id,job_id,unit_id,previous_id,payload,ids) values(p_operation,p_record,p_job,p_unit,p_previous,p_payload,p_ids) returning * into old_;
 return to_jsonb(old_);
end $$;
create function conveni_independent_experiment.acknowledge_versioned(p_event uuid,p_record uuid,p_unit uuid,p_previous uuid,p_snapshot jsonb,p_reviewer text,p_note text,p_confirm boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare old_ conveni_independent_experiment.versioned_acknowledgements;current_ jsonb;
begin
 if p_event is null or p_previous is null or p_confirm is distinct from true or length(trim(coalesce(p_reviewer,''))) not between 3 and 120 or length(trim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'VERSIONED_ACK_REQUIRED';end if;
 perform 1 from public.source_records where id=p_record for update nowait;perform 1 from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit order by id for share nowait;
 current_:=conveni_independent_experiment.versioned_history(p_record,p_unit);
 if current_->>'previous_id' is distinct from p_previous::text or current_ is distinct from p_snapshot then raise exception 'VERSIONED_HISTORY_STALE' using errcode='40001';end if;
 select * into old_ from conveni_independent_experiment.versioned_acknowledgements where id=p_event;
 if found then if old_.record_id is distinct from p_record or old_.unit_id is distinct from p_unit or old_.previous_id is distinct from p_previous or old_.snapshot is distinct from p_snapshot or old_.reviewer is distinct from p_reviewer or old_.note is distinct from p_note then raise exception 'VERSIONED_ACK_CONFLICT';end if;return to_jsonb(old_);end if;
 insert into conveni_independent_experiment.versioned_acknowledgements values(p_event,p_record,p_unit,p_previous,p_snapshot,p_reviewer,p_note,clock_timestamp()) returning * into old_;return to_jsonb(old_);
end $$;
create function conveni_independent_experiment.bind_versioned_ack(p_draft uuid,p_ack uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare d public.conveni_unit_economic_draft_events;a conveni_independent_experiment.versioned_acknowledgements;old_ uuid;
begin
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft;perform 1 from public.source_records where id=d.source_record_id for update nowait;
 select * into strict a from conveni_independent_experiment.versioned_acknowledgements where id=p_ack for share nowait;
 if a.record_id is distinct from d.source_record_id or a.unit_id is distinct from d.unit_id or a.snapshot is distinct from conveni_independent_experiment.versioned_history(d.source_record_id,d.unit_id) then raise exception 'VERSIONED_ACK_STALE' using errcode='40001';end if;
 select ack_id into old_ from conveni_independent_experiment.versioned_ack_links where draft_id=p_draft;
 if found then if old_ is distinct from p_ack then raise exception 'VERSIONED_ACK_LINK_CONFLICT';end if;return;end if;
 insert into conveni_independent_experiment.versioned_ack_links values(p_draft,p_ack);
end $$;
create function conveni_independent_experiment.preparation_ready(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;
begin
 perform 1 from public.source_records where id=p_record for update nowait;
 select * into strict o from conveni_independent_experiment.preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for update nowait;
 if not exists(select 1 from conveni_first_candidate.visual_economic_links l join conveni_independent_experiment.versioned_ack_links x on x.draft_id=l.draft_id join conveni_independent_experiment.versioned_acknowledgements a on a.id=x.ack_id where l.event_id::text=o.ids->>'linkId' and l.draft_id::text=o.ids->>'draftId' and l.receipt_id::text=o.ids->>'receiptId' and a.previous_id=o.previous_id and a.reviewer=l.reviewer and a.note=l.note and a.snapshot=conveni_independent_experiment.versioned_history(p_record,p_unit)) then raise exception 'VERSIONED_PREPARATION_NOT_READY';end if;
 if o.state='pending' then update conveni_independent_experiment.preparation_operations set state='ready',ready_at=clock_timestamp() where id=o.id returning * into o;end if;return to_jsonb(o);
end $$;
revoke all on function conveni_independent_experiment.preparation_get(uuid,uuid,uuid),conveni_independent_experiment.preparation_begin(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb),conveni_independent_experiment.acknowledge_versioned(uuid,uuid,uuid,uuid,jsonb,text,text,boolean),conveni_independent_experiment.bind_versioned_ack(uuid,uuid),conveni_independent_experiment.preparation_ready(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Each stage reads immutable operation payload under the same source fence;
-- the caller cannot substitute IDs or confirmations between steps.
create function conveni_independent_experiment.guard_versioned_operation(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns conveni_independent_experiment.preparation_operations
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;
begin
 perform 1 from public.source_records where id=p_record for update nowait;
 select * into o from conveni_independent_experiment.preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for share nowait;
 if not found or o.state<>'pending' or o.previous_id is distinct from (select id from conveni_independent_experiment.revisions where source_record_id=p_record and unit_id=p_unit order by sequence desc limit 1) then raise exception 'VERSIONED_OPERATION_SUPERSEDED';end if;return o;
end $$;
create function conveni_independent_experiment.guarded_versioned_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;
begin
 o:=conveni_independent_experiment.guard_versioned_operation(p_record,p_job,p_unit,p_operation);
 if o.payload->'versionedHistoryConfirmed' is distinct from 'true'::jsonb or jsonb_typeof(o.payload->'versionedHistorySnapshot') is distinct from 'object' then raise exception 'VERSIONED_ACK_REQUIRED';end if;
 return conveni_independent_experiment.acknowledge_versioned((o.ids->>'ackId')::uuid,p_record,p_unit,o.previous_id,o.payload->'versionedHistorySnapshot',o.payload->>'reviewer',o.payload->>'note',true);
end $$;
create function conveni_independent_experiment.guarded_native_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;
begin
 o:=conveni_independent_experiment.guard_versioned_operation(p_record,p_job,p_unit,p_operation);
 if o.payload->'historyConfirmed' is distinct from 'true'::jsonb or jsonb_typeof(o.payload->'historySnapshot') is distinct from 'object' then raise exception 'HISTORY_CONFIRMATION_REQUIRED';end if;
 return public.conveni_first_ack_history((o.ids->>'ackId')::uuid,p_record,p_job,p_unit,o.payload->'historySnapshot',(o.payload->'historySnapshot'->>'previous_id')::uuid,o.payload->>'reviewer',o.payload->>'note',true);
end $$;
create function conveni_independent_experiment.guarded_versioned_prepare(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;coverage uuid[];
begin
 o:=conveni_independent_experiment.guard_versioned_operation(p_record,p_job,p_unit,p_operation);
 if o.payload->'social' is distinct from 'true'::jsonb or o.payload->'economic' is distinct from 'true'::jsonb or o.payload->'manifest' is distinct from 'true'::jsonb then raise exception 'PREPARATION_CONFIRMATION_REQUIRED';end if;
 select coalesce(array_agg(v::uuid order by ord),'{}'::uuid[]) into coverage from jsonb_array_elements_text(coalesce(o.payload->'coverageIds','[]'::jsonb)) with ordinality x(v,ord);
 return public.conveni_first_prepare_draft_coverage(p_record,p_job,p_unit,(o.ids->>'draftId')::uuid,case when o.payload->'historySnapshot'='null'::jsonb then null else (o.ids->>'ackId')::uuid end,(o.payload->>'monetaryId')::uuid,(o.payload->>'identityId')::uuid,(o.payload->>'rolePeriodId')::uuid,o.payload->>'literal',o.payload->>'reviewer',o.payload->>'note',true,true,true,coverage);
end $$;
create function conveni_independent_experiment.guarded_bind_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;
begin o:=conveni_independent_experiment.guard_versioned_operation(p_record,p_job,p_unit,p_operation);perform conveni_independent_experiment.bind_versioned_ack((o.ids->>'draftId')::uuid,(o.ids->>'ackId')::uuid);end $$;
revoke all on function conveni_independent_experiment.guard_versioned_operation(uuid,uuid,uuid,uuid),conveni_independent_experiment.guarded_versioned_ack(uuid,uuid,uuid,uuid),conveni_independent_experiment.guarded_native_ack(uuid,uuid,uuid,uuid),conveni_independent_experiment.guarded_versioned_prepare(uuid,uuid,uuid,uuid),conveni_independent_experiment.guarded_bind_ack(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.supersede_versioned_prewrite(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare o conveni_independent_experiment.preparation_operations;revisions jsonb;ids uuid[];missing boolean:=false;
begin
 if length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'RECONCILIATION_REASON_REQUIRED';end if;
 perform 1 from public.source_records where id=p_record for update nowait;
 select * into o from conveni_independent_experiment.preparation_operations where id=p_operation and record_id=p_record and job_id=p_job and unit_id=p_unit for update nowait;
 if not found or o.state<>'pending' then raise exception 'RECONCILIATION_UNAVAILABLE';end if;
 if exists(select 1 from public.conveni_unit_economic_draft_events where id=(o.ids->>'draftId')::uuid) or exists(select 1 from conveni_first_candidate.history_acknowledgements where event_id=(o.ids->>'ackId')::uuid) or exists(select 1 from conveni_first_candidate.receipts where event_id=(o.ids->>'receiptId')::uuid) or exists(select 1 from conveni_first_candidate.visual_economic_links where event_id=(o.ids->>'linkId')::uuid) then raise exception 'RECONCILIATION_HAS_EFFECTS';end if;
 select document_revisions into strict revisions from public.conveni_analyses where job_id=p_job and source_record_id=p_record for share nowait;
 ids:=array[(o.payload->>'monetaryId')::uuid,(o.payload->>'identityId')::uuid,(o.payload->>'rolePeriodId')::uuid]||coalesce((select array_agg(v::uuid order by ord) from jsonb_array_elements_text(coalesce(o.payload->'coverageIds','[]'::jsonb)) with ordinality x(v,ord)),'{}'::uuid[]);
 begin perform conveni_first_candidate.coverage_check_manifest(p_record,revisions,ids,o.payload->>'reviewer');
 exception when others then if sqlerrm='MANIFEST_NEEDS_FULL_REVIEW' then missing:=true;else raise;end if;end;
 if not missing then raise exception 'RECONCILIATION_NOT_DETERMINISTIC';end if;
 update conveni_independent_experiment.preparation_operations set state='superseded',superseded_at=clock_timestamp(),supersession_reason=p_reason where id=o.id returning * into o;return to_jsonb(o);
end $$;
create function conveni_independent_experiment.preparation_history(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,conveni_independent_experiment as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') from (select id,state,created_at,ready_at,superseded_at,supersession_reason from conveni_independent_experiment.preparation_operations where record_id=p_record and job_id=p_job and unit_id=p_unit order by created_at desc,id desc limit 100) x
$$;
revoke all on function conveni_independent_experiment.supersede_versioned_prewrite(uuid,uuid,uuid,uuid,text),conveni_independent_experiment.preparation_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;


-- Source: independent-decision.sql
-- PRIVATE closed review entry points; the caller must explicitly preserve the
-- predecessor. These functions neither copy bytes nor claim they verified them.
create function conveni_independent_experiment.decision_candidate(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare l conveni_first_candidate.visual_economic_links;d public.conveni_unit_economic_draft_events;previous conveni_independent_experiment.revisions;assessment jsonb;
begin
 select * into previous from conveni_independent_experiment.revisions where unit_id=p_unit and source_record_id=p_record order by sequence desc limit 1;
 assessment:=conveni_independent_experiment.assess(p_record,p_job,p_unit);
 if assessment->>'status' is distinct from 'independent_arithmetic_candidate' then return jsonb_build_object('candidate',null,'previousId',previous.id,'pendingReason',assessment->>'reason');end if;
 select v.* into l from conveni_first_candidate.visual_economic_links v join public.conveni_unit_economic_draft_events draft on draft.id=v.draft_id
 where draft.source_record_id=p_record and draft.job_id=p_job and draft.unit_id=p_unit order by v.created_at desc,v.event_id desc limit 1;
 if not found then return jsonb_build_object('candidate',null,'previousId',previous.id);end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=l.draft_id;
 if previous.draft_id=l.draft_id then return jsonb_build_object('candidate',null,'previousId',previous.id);end if;
 if previous.id is not null and not exists(select 1 from conveni_independent_experiment.versioned_ack_links x join conveni_independent_experiment.versioned_acknowledgements a on a.id=x.ack_id where x.draft_id=d.id and a.previous_id=previous.id and a.reviewer=l.reviewer and a.note=l.note and a.snapshot=conveni_independent_experiment.versioned_history(p_record,p_unit)) then return jsonb_build_object('candidate',null,'previousId',previous.id,'pendingReason','HISTORY_VERSIONED_UNCONFIRMED');end if;
 perform conveni_first_candidate.historical_visual_link_draft(l.event_id,d.id,l.receipt_id,l.monetary,l.identity,l.role_period,l.reviewer,l.note,true,true,l.manifest_confirmed);
 return jsonb_build_object('candidate',jsonb_build_object('jobId',d.job_id,'unitId',d.unit_id,'receiptId',l.receipt_id,'linkId',l.event_id,'reviewer',l.reviewer,'previousId',previous.id),'previousId',previous.id);
end $$;
revoke all on function conveni_independent_experiment.decision_candidate(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.decision_commit(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,conveni_independent_experiment as $$
declare d uuid;result jsonb;
begin
 if p_social is distinct from true or p_economic is distinct from true or p_manifest is distinct from true then raise exception 'INDEPENDENT_CONFIRMATION_REQUIRED';end if;
 select l.draft_id into d from conveni_first_candidate.visual_economic_links l join public.conveni_unit_economic_draft_events draft on draft.id=l.draft_id where l.event_id=p_link and l.receipt_id=p_receipt and draft.source_record_id=p_record and draft.job_id=p_job and draft.unit_id=p_unit;
 if d is null then raise exception 'INDEPENDENT_PREPARATION_SCOPE';end if;
 if p_previous is not null and not exists(select 1 from conveni_independent_experiment.versioned_ack_links x join conveni_independent_experiment.versioned_acknowledgements a on a.id=x.ack_id join conveni_first_candidate.visual_economic_links l on l.draft_id=x.draft_id where x.draft_id=d and l.event_id=p_link and a.previous_id=p_previous and a.reviewer=l.reviewer and a.note=l.note and a.snapshot=conveni_independent_experiment.versioned_history(p_record,p_unit,case when exists(select 1 from conveni_independent_experiment.revisions e where e.id=p_event and e.source_record_id=p_record and e.unit_id=p_unit) then p_event else null end)) then raise exception 'VERSIONED_HISTORY_UNCONFIRMED';end if;
 result:=conveni_independent_experiment.commit_revision(p_event,p_previous,d,p_receipt,p_link,p_actor,p_note,true);
 return jsonb_build_object('event_id',p_event,'provision_id',p_event,'private_only',true);
end $$;
revoke all on function conveni_independent_experiment.decision_commit(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.decision_recovery(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,conveni_independent_experiment as $$
 select jsonb_build_object('provisionId',e.id,'reviewer',e.declared_reviewer,'note',e.reason,'exports','[]'::jsonb,'current',conveni_independent_experiment.revision_is_current_readonly(e.id))
 from conveni_independent_experiment.revisions e where e.source_record_id=p_record and e.job_id=p_job and e.unit_id=p_unit order by e.sequence desc limit 1
$$;
revoke all on function conveni_independent_experiment.decision_recovery(uuid,uuid,uuid) from public,anon,authenticated,service_role;


create function public.conveni_independent_decision_candidate(p_record uuid,p_job uuid,p_unit uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.decision_candidate(p_record,p_job,p_unit)$$;
create function public.conveni_independent_decision_recovery(p_record uuid,p_job uuid,p_unit uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.decision_recovery(p_record,p_job,p_unit)$$;
create function public.conveni_independent_decision_commit(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.decision_commit(p_record,p_job,p_unit,p_event,p_previous,p_receipt,p_link,p_actor,p_note,p_social,p_economic,p_manifest)$$;
revoke all on function public.conveni_independent_decision_candidate(uuid,uuid,uuid),public.conveni_independent_decision_recovery(uuid,uuid,uuid),public.conveni_independent_decision_commit(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) from public,anon,authenticated,service_role;

-- Source: batch-states.sql
-- PRIVATE read-only presentation projection; persisted statuses are unchanged.
create function conveni_independent_experiment.record_states(p_records uuid[])
returns table(source_record_id uuid,approved_units bigint,pending_units bigint)
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select r.id,
  (select count(distinct p.unit_id) from conveni_independent_experiment.combined_provisions() p where p.source_record_id=r.id and p.unit_id is not null),
  (select count(*) from conveni_independent_experiment.combined_units() u where u.source_record_id=r.id and (u.reviewed_job is distinct from u.job_id or u.outcome is null or u.outcome='insufficient'))
 from public.source_records r where r.id=any(p_records) and r.financing_type='conveni'
$$;
revoke all on function conveni_independent_experiment.record_states(uuid[]) from public,anon,authenticated,service_role;
create function conveni_independent_experiment.batch_provision_counts(p_runs uuid[])
returns table(run_id uuid,provision_count bigint)
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 select j.run_id,count(distinct p.id) from public.pipeline_jobs j left join conveni_independent_experiment.combined_provisions() p on p.source_record_id=j.source_record_id and p.superseded_at is null where j.run_id=any(p_runs) group by j.run_id
$$;
revoke all on function conveni_independent_experiment.batch_provision_counts(uuid[]) from public,anon,authenticated,service_role;


create function public.conveni_independent_record_states(p_records uuid[]) returns table(source_record_id uuid,approved_units bigint,pending_units bigint) language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.record_states(p_records)$$;
create function public.conveni_independent_batch_counts(p_runs uuid[]) returns table(run_id uuid,provision_count bigint) language sql stable security definer set search_path=pg_catalog as $$select * from conveni_independent_experiment.batch_provision_counts(p_runs)$$;
revoke all on function public.conveni_independent_record_states(uuid[]),public.conveni_independent_batch_counts(uuid[]) from public,anon,authenticated,service_role;

-- Source: global-export.sql
-- PRIVATE candidate; the broad NOWAIT fence must be measured before use.
create function conveni_independent_experiment.global_export_snapshot(p_year integer default null) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public,conveni_independent_experiment as $$
 with analyses as materialized (select * from public.conveni_current_analyses),
 units as materialized (select * from conveni_independent_experiment.combined_units()),
 provisions as materialized (select * from conveni_independent_experiment.combined_provisions()),
 records as (
  select a.source_record_id,jsonb_build_object('record_id',a.source_record_id,'year',p_year,
   'source_payload',(select r.source_payload from public.source_records r where r.id=a.source_record_id and r.financing_type='conveni'),
   'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.unit_id),'[]') from units u where u.source_record_id=a.source_record_id),
   'provisions',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('service_name',s.service_name) order by p.id),'[]') from provisions p
    join units u on u.unit_id=p.unit_id and u.source_record_id=a.source_record_id and u.outcome='select' and u.reviewed_job=u.job_id
    left join public.official_services s on s.version_id=p.catalog_version_id and s.service_code=p.service_code
    where p.source_record_id=a.source_record_id and (p_year is null or u.data->>'year'=p_year::text)),
   'analyses',(select coalesce(jsonb_agg(to_jsonb(ax) order by ax.source_record_id),'[]') from analyses ax where ax.source_record_id=a.source_record_id)) snapshot
  from analyses a
 )
 select jsonb_build_object('year',p_year,'records',coalesce(jsonb_agg(snapshot order by source_record_id),'[]')) from records
$$;
revoke all on function conveni_independent_experiment.global_export_snapshot(integer) from public,anon,authenticated,service_role;
create table conveni_independent_experiment.global_export_receipts(event_id uuid primary key,snapshot jsonb not null,content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'));
revoke all on conveni_independent_experiment.global_export_receipts from public,anon,authenticated,service_role;
create trigger immutable_global_export before update or delete on conveni_independent_experiment.global_export_receipts for each row execute function conveni_independent_experiment.immutable_revision();
create function conveni_independent_experiment.finalize_global_export(p_event uuid,p_year integer,p_snapshot jsonb,p_hash text) returns uuid
language plpgsql security invoker set search_path=pg_catalog,public,storage,conveni_first_candidate,conveni_independent_experiment as $$
declare old_ conveni_independent_experiment.global_export_receipts;
begin
 if p_event is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot->'year' is distinct from coalesce(to_jsonb(p_year),'null'::jsonb) then raise exception 'GLOBAL_EXPORT_INVALID';end if;
 select * into old_ from conveni_independent_experiment.global_export_receipts where event_id=p_event;
 if found then if old_.snapshot is distinct from p_snapshot or old_.content_sha256 is distinct from p_hash then raise exception 'GLOBAL_EXPORT_CONFLICT';end if;return p_event;end if;
 lock table public.source_records,public.entities,public.pipeline_jobs,public.record_units,public.source_documents,public.review_decisions,public.service_provisions,public.conveni_analyses,public.conveni_unit_proposals,public.conveni_review_events,public.conveni_unit_economic_draft_events,public.conveni_visual_reads,public.conveni_visual_observations,public.catalog_versions,public.official_services,public.concert_line_awards,public.concert_line_award_decisions,public.concert_population_events,storage.objects,conveni_independent_experiment.revisions,conveni_first_candidate.receipts,conveni_first_candidate.visual_economic_links in share mode nowait;
 if conveni_independent_experiment.global_export_snapshot(p_year) is distinct from p_snapshot then raise exception 'GLOBAL_EXPORT_STALE' using errcode='40001';end if;
 insert into conveni_independent_experiment.global_export_receipts values(p_event,p_snapshot,p_hash);return p_event;
end $$;
revoke all on function conveni_independent_experiment.finalize_global_export(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
create function public.conveni_independent_global_snapshot(p_year integer default null) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.global_export_snapshot(p_year)$$;
create function public.conveni_independent_global_commit(p_event uuid,p_year integer,p_snapshot jsonb,p_hash text) returns uuid language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.finalize_global_export(p_event,p_year,p_snapshot,p_hash)$$;
revoke all on function public.conveni_independent_global_snapshot(integer),public.conveni_independent_global_commit(uuid,integer,jsonb,text) from public,anon,authenticated,service_role;

create function public.conveni_independent_versioned_history(p_record uuid,p_unit uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.versioned_history(p_record,p_unit)$$;
create function public.conveni_independent_preparation_get(p_record uuid,p_job uuid,p_unit uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.preparation_get(p_record,p_job,p_unit)$$;
create function public.conveni_independent_preparation_begin(p_record uuid,p_job uuid,p_unit uuid,p_previous uuid,p_operation uuid,p_payload jsonb,p_ids jsonb) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.preparation_begin(p_record,p_job,p_unit,p_previous,p_operation,p_payload,p_ids)$$;
create function public.conveni_independent_preparation_ready(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.preparation_ready(p_record,p_job,p_unit,p_operation)$$;
revoke all on function public.conveni_independent_versioned_history(uuid,uuid),public.conveni_independent_preparation_get(uuid,uuid,uuid),public.conveni_independent_preparation_begin(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb),public.conveni_independent_preparation_ready(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.conveni_independent_guarded_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.guarded_versioned_ack(p_record,p_job,p_unit,p_operation)$$;
create function public.conveni_independent_guarded_native_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.guarded_native_ack(p_record,p_job,p_unit,p_operation)$$;
create function public.conveni_independent_guarded_prepare(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.guarded_versioned_prepare(p_record,p_job,p_unit,p_operation)$$;
create function public.conveni_independent_guarded_bind_ack(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid) returns void language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.guarded_bind_ack(p_record,p_job,p_unit,p_operation)$$;
create function public.conveni_independent_supersede_prewrite(p_record uuid,p_job uuid,p_unit uuid,p_operation uuid,p_reason text) returns jsonb language sql volatile security definer set search_path=pg_catalog as $$select conveni_independent_experiment.supersede_versioned_prewrite(p_record,p_job,p_unit,p_operation,p_reason)$$;
create function public.conveni_independent_preparation_history(p_record uuid,p_job uuid,p_unit uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select conveni_independent_experiment.preparation_history(p_record,p_job,p_unit)$$;
revoke all on function public.conveni_independent_guarded_ack(uuid,uuid,uuid,uuid),public.conveni_independent_guarded_native_ack(uuid,uuid,uuid,uuid),public.conveni_independent_guarded_prepare(uuid,uuid,uuid,uuid),public.conveni_independent_guarded_bind_ack(uuid,uuid,uuid,uuid),public.conveni_independent_supersede_prewrite(uuid,uuid,uuid,uuid,text),public.conveni_independent_preparation_history(uuid,uuid,uuid) from public,anon,authenticated,service_role;
