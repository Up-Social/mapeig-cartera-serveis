-- Closed candidate for full document coverage. No preparation or history-page grants.
-- This prototype proves the manifest check over locked, versioned observations;
-- The manifest check does not authenticate the declared human review.
alter table public.conveni_visual_observations drop constraint conveni_visual_observations_role_check;
alter table public.conveni_visual_observations add constraint conveni_visual_observations_role_check check(role in ('identity','economic','role_period','social','coverage'));
do $$
declare original text;anchor text:=$a$not in ('identity','economic','role_period','social')$a$;
begin
 original:=pg_get_functiondef('public.conveni_visual_assert(uuid,uuid,uuid,uuid,integer,text,text,text,text,boolean)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_ROLE_ANCHOR';end if;
 execute replace(original,anchor,$a$not in ('identity','economic','role_period','social','coverage')$a$);
end $$;
create function conveni_first_candidate.coverage_check_manifest(p_record uuid,p_manifest jsonb,p_ids uuid[],p_reviewer text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare o public.conveni_visual_observations;r public.conveni_visual_reads;id_ uuid;seen uuid[]:='{}';roles text[]:='{}';citations jsonb:='[]';
begin
 if jsonb_typeof(p_manifest) is distinct from 'object' or cardinality(p_ids)<3 or length(trim(coalesce(p_reviewer,'')))<3 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'COVERAGE_INVALID';end if;
 for id_ in select x from unnest(p_ids) x order by x loop
  select * into strict o from public.conveni_visual_observations where event_id=id_ for share nowait;
  select * into strict r from public.conveni_visual_reads where event_id=o.read_id and record_id=p_record and document_id=o.document_id for share nowait;
  if o.role not in ('identity','economic','role_period','coverage') or o.declared_reviewer is distinct from p_reviewer or r.snapshot is distinct from public.conveni_visual_source(p_record,o.document_id) or not (p_manifest ? o.document_id::text) then raise exception 'COVERAGE_SOURCE_MISMATCH';end if;
  seen:=array_append(seen,o.document_id);roles:=array_append(roles,o.role);
  citations:=citations||jsonb_build_array(jsonb_build_object('eventId',o.event_id,'documentId',o.document_id,'role',o.role,'page',o.page,'quote',o.quote,'observation',to_jsonb(o),'read',to_jsonb(r)));
 end loop;
 if exists(select 1 from jsonb_object_keys(p_manifest) k where not k::uuid=any(seen)) or (select count(*) from unnest(roles) as role_list(role_name) where role_name='identity')<>1 or (select count(*) from unnest(roles) as role_list(role_name) where role_name='economic')<>1 or (select count(*) from unnest(roles) as role_list(role_name) where role_name='role_period')<>1 then raise exception 'MANIFEST_NEEDS_FULL_REVIEW';end if;
 return citations;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Closed preparation candidate; physical bytes and human declarations remain separate.
-- Depends on the ordered candidate migrations through 610.
create table conveni_first_candidate.coverage_draft_bindings(
 draft_id uuid primary key references public.conveni_unit_economic_draft_events(id) on delete cascade,
 reviewer text not null, observation_ids uuid[] not null
);
revoke all on conveni_first_candidate.coverage_draft_bindings from public,anon,authenticated,service_role;
create function conveni_first_candidate.coverage_reject_mutation() returns trigger language plpgsql as $$begin raise exception 'COVERAGE_BINDING_IMMUTABLE';end$$;
create trigger coverage_immutable before update on conveni_first_candidate.coverage_draft_bindings for each row execute function conveni_first_candidate.coverage_reject_mutation();
create function conveni_first_candidate.coverage_citations(p_draft uuid) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate as $$
declare d public.conveni_unit_economic_draft_events;b conveni_first_candidate.coverage_draft_bindings;
begin
 select * into b from conveni_first_candidate.coverage_draft_bindings where draft_id=p_draft for share nowait;
 if not found then return null;end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft for share nowait;
 return conveni_first_candidate.coverage_check_manifest(d.source_record_id,d.document_revisions,b.observation_ids,b.reviewer);
end $$;
-- Extend the snapshot and copy plan; leave unbound
-- snapshots byte-for-byte unchanged, including pre-existing receipt replays.
do $$
declare n text;original text;anchor text;replacement text;
begin
 for n in select * from unnest(array['historical_snapshot','historical_copy_plan']) loop
  original:=pg_get_functiondef(('conveni_first_candidate.'||n||'(uuid)')::regprocedure);
  anchor:=$a$ select array_agg(distinct (x->>'document_id')::uuid order by (x->>'document_id')::uuid) into ids
 from unnest(array[d.monetary_citation,d.identity_citation,d.role_period_citation]) x;
 if coalesce(cardinality(ids),0) not between 1 and 3 then raise exception 'Invalid citation set';end if;$a$;
  replacement:=$a$ select array_agg(distinct doc_id order by doc_id) into ids from (
  select (x->>'document_id')::uuid doc_id from unnest(array[d.monetary_citation,d.identity_citation,d.role_period_citation]) x
  union select (value->>'documentId')::uuid from jsonb_array_elements(coalesce(conveni_first_candidate.coverage_citations(d.id),'[]'::jsonb))) documents;
 if coalesce(cardinality(ids),0)<1 then raise exception 'Invalid citation set';end if;$a$;
  if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_SNAPSHOT_ANCHOR %',n;end if;
  original:=replace(original,anchor,replacement);
  anchor:=$a$  'rolePeriodCitation',d.role_period_citation,'archives',archives);$a$;
  replacement:=$a$  'rolePeriodCitation',d.role_period_citation,'archives',archives)||case when conveni_first_candidate.coverage_citations(d.id) is null then '{}'::jsonb else jsonb_build_object('additionalCoverage',conveni_first_candidate.coverage_citations(d.id),'additionalCitations',coalesce((select jsonb_agg(jsonb_build_object('document_id',v->>'documentId','page',v->'page','quote',v->'quote') order by v->>'eventId') from jsonb_array_elements(conveni_first_candidate.coverage_citations(d.id)) v where v->>'role'='coverage'),'[]'::jsonb)) end;$a$;
  if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_SNAPSHOT_RETURN_ANCHOR %',n;end if;
  execute replace(original,anchor,replacement);
 end loop;
end $$;
-- Clone the closed wrapper and validate the complete manifest before inserting
-- the draft and immutable link in one transaction. This is not an app RPC.
do $$
declare original text;anchor text;replacement text;
begin
 original:=pg_get_functiondef('public.conveni_first_prepare_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,boolean)'::regprocedure);
 original:=replace(original,'public.conveni_first_prepare_draft(', 'conveni_first_candidate.coverage_prepare_draft(');
 anchor:='p_manifest boolean)';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_SIGNATURE_ANCHOR';end if;
 original:=replace(original,anchor,'p_manifest boolean, p_coverage uuid[])');
 anchor:=$a$ if exists(select 1 from jsonb_object_keys(a.document_revisions) k where not exists(select 1 from unnest(citations) c where c->>'document_id'=k)) then raise exception 'MANIFEST_NEEDS_FULL_REVIEW';end if;$a$;
 replacement:=$a$ perform conveni_first_candidate.coverage_check_manifest(p_record,a.document_revisions,array[p_monetary,p_identity,p_role_period]||coalesce(p_coverage,'{}'::uuid[]),p_reviewer);$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_PREPARE_ANCHOR';end if;
 original:=replace(original,anchor,replacement);
 anchor:=$a$ return jsonb_build_object('draftId',p_event);$a$;
 replacement:=$a$ insert into conveni_first_candidate.coverage_draft_bindings(draft_id,reviewer,observation_ids) values(p_event,p_reviewer,array[p_monetary,p_identity,p_role_period]||coalesce(p_coverage,'{}'::uuid[])) on conflict(draft_id) do nothing;
 if not exists(select 1 from conveni_first_candidate.coverage_draft_bindings where draft_id=p_event and reviewer=p_reviewer and observation_ids=array[p_monetary,p_identity,p_role_period]||coalesce(p_coverage,'{}'::uuid[])) then raise exception 'COVERAGE_BINDING_CONFLICT';end if;
 return jsonb_build_object('draftId',p_event);$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_BIND_ANCHOR';end if;
 execute replace(original,anchor,replacement);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Re-evaluate every declared observation, including deletion of an event or
-- its read, against the exact pinned objects in the receipt. This expression
-- is a read-time guard; commit/export still need matching locks.
do $$
declare original text;anchor text;replacement text;
begin
 original:=pg_get_functiondef('conveni_first_candidate.first_provision_current(uuid)'::regprocedure);
 anchor:=$a$   and not exists(select 1 from jsonb_array_elements(rc.snapshot->'archives') a where$a$;
 replacement:=$a$   and ((rc.snapshot ? 'additionalCoverage') = exists(select 1 from conveni_first_candidate.coverage_draft_bindings b where b.draft_id=d.id))
   and (not (rc.snapshot ? 'additionalCoverage') or (
    (select jsonb_agg(x->>'eventId' order by x->>'eventId') from jsonb_array_elements(rc.snapshot->'additionalCoverage') x) =
    (select jsonb_agg(id::text order by id::text) from conveni_first_candidate.coverage_draft_bindings b cross join unnest(b.observation_ids) id where b.draft_id=d.id)
    and not exists(select 1 from jsonb_array_elements(rc.snapshot->'additionalCoverage') x where
      not exists(select 1 from public.conveni_visual_observations ob join public.conveni_visual_reads rd on rd.event_id=ob.read_id where to_jsonb(ob)=x->'observation' and to_jsonb(rd)=x->'read'))))
   and not exists(select 1 from jsonb_array_elements(rc.snapshot->'archives') a where$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_CURRENT_ANCHOR';end if;
 execute replace(original,anchor,replacement);
end $$;
-- Application wrapper remains closed until reviewed and granted explicitly.
create function public.conveni_first_prepare_draft_coverage(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_ack uuid,p_monetary uuid,p_identity uuid,p_role_period uuid,p_literal text,p_reviewer text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean,p_coverage uuid[]) returns jsonb
language sql security definer set search_path=pg_catalog,public,conveni_first_candidate as $$
 select conveni_first_candidate.coverage_prepare_draft(p_record,p_job,p_unit,p_event,p_ack,p_monetary,p_identity,p_role_period,p_literal,p_reviewer,p_note,p_social,p_economic,p_manifest,p_coverage)
$$;
revoke all on function public.conveni_first_prepare_draft_coverage(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,boolean,boolean,uuid[]) from public,anon,authenticated,service_role;
-- Cursor-based access remains closed until explicitly granted.
create function public.conveni_visual_history_page(p_record uuid,p_before timestamptz,p_before_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if (p_before is null)<>(p_before_id is null) or not exists(select 1 from public.source_records where id=p_record and financing_type='conveni') then raise exception 'VISUAL_SCOPE';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.event_id desc),'[]'::jsonb) into result from (
  select o.event_id,o.document_id,o.page,o.role,o.quote,o.declared_reviewer,o.rationale,o.created_at,
   r.snapshot->'source'->>'sha256' source_sha256,r.snapshot->'source'->>'version' source_version
  from public.conveni_visual_observations o join public.conveni_visual_reads r on r.event_id=o.read_id
  where r.record_id=p_record and (p_before is null or (o.created_at,o.event_id)<(p_before,p_before_id))
  order by o.created_at desc,o.event_id desc limit 100
 ) x;
 return result;
end $$;
revoke all on function public.conveni_visual_history_page(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;

-- Protect the additional observations used by
-- 560 during the already-closed 520/580 export transaction.
do $$
declare original text;anchor text;replacement text;
begin
 original:=pg_get_functiondef('public.concert_line_mixed_commit(uuid,text,jsonb,boolean)'::regprocedure);
 anchor:=$a$ perform 1 from storage.objects o where o.id in(
  select (a->'source'->>'object_id')::uuid from conveni_first_candidate.first_provision_receipts$a$;
 replacement:=$a$ perform 1 from conveni_first_candidate.coverage_draft_bindings b where b.draft_id in(select f.draft_id from conveni_first_candidate.first_provision_receipts f where f.provision_id=any(ids)) order by b.draft_id for share nowait;
 perform 1 from public.conveni_visual_observations ob where ob.event_id in(select (v->>'eventId')::uuid from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link join conveni_first_candidate.receipts rc on rc.event_id=l.receipt_id cross join lateral jsonb_array_elements(coalesce(rc.snapshot->'additionalCoverage','[]'::jsonb)) v where f.provision_id=any(ids)) order by ob.event_id for share nowait;
 perform 1 from public.conveni_visual_reads rd where rd.event_id in(select (v->'read'->>'event_id')::uuid from conveni_first_candidate.first_provision_receipts f join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link join conveni_first_candidate.receipts rc on rc.event_id=l.receipt_id cross join lateral jsonb_array_elements(coalesce(rc.snapshot->'additionalCoverage','[]'::jsonb)) v where f.provision_id=any(ids)) order by rd.event_id for share nowait;
 perform 1 from storage.objects o where o.id in(
  select (a->'source'->>'object_id')::uuid from conveni_first_candidate.first_provision_receipts$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_MIXED_FENCE_ANCHOR';end if;
 execute replace(original,anchor,replacement);
 original:=pg_get_functiondef('public.concert_line_master_snapshot_commit(uuid,text,text,jsonb)'::regprocedure);
 anchor:=$a$conveni_first_candidate.history_acknowledgements,storage.objects in share mode nowait;$a$;
 replacement:=$a$conveni_first_candidate.history_acknowledgements,conveni_first_candidate.coverage_draft_bindings,public.conveni_visual_observations,public.conveni_visual_reads,storage.objects in share mode nowait;$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_MASTER_FENCE_ANCHOR';end if;
 execute replace(original,anchor,replacement);
end $$;
-- The single-provision proof also backs its export and must hold these locks
-- until the caller's transaction commits, not just check under MVCC.
do $$
declare original text;anchor text;replacement text;
begin
 original:=pg_get_functiondef('conveni_first_candidate.first_provision_proof(uuid,uuid,uuid)'::regprocedure);
 anchor:=$a$ if d.parent_review_id is not null then$a$;
 replacement:=$a$ perform 1 from conveni_first_candidate.coverage_draft_bindings b where b.draft_id=d.id for share nowait;
 perform 1 from public.conveni_visual_observations ob where ob.event_id in(select (v->>'eventId')::uuid from jsonb_array_elements(coalesce(receipt_.snapshot->'additionalCoverage','[]'::jsonb)) v) order by ob.event_id for share nowait;
 perform 1 from public.conveni_visual_reads rd where rd.event_id in(select (v->'read'->>'event_id')::uuid from jsonb_array_elements(coalesce(receipt_.snapshot->'additionalCoverage','[]'::jsonb)) v) order by rd.event_id for share nowait;
 if d.parent_review_id is not null then$a$;
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'COVERAGE_SINGLE_FENCE_ANCHOR';end if;
 execute replace(original,anchor,replacement);
end $$;
