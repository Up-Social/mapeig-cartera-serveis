-- CLOSED LOCAL CANDIDATE. This stores a guarded manifest and its bytes; it
-- does not create a review, a provision, a Storage receipt or a ready state.
-- Activation, the durable decision and all product readers remain separate.
create schema conveni_transactional_bytes_candidate;
revoke all on schema conveni_transactional_bytes_candidate from public,anon,authenticated,service_role;

create table conveni_transactional_bytes_candidate.plans(
 attempt_id uuid primary key references conveni_preparation_guard_candidate.attempts(id) on delete restrict,
 record_id uuid not null references public.source_records(id) on delete restrict,
 job_id uuid not null references public.pipeline_jobs(id) on delete restrict,
 unit_id uuid not null references public.record_units(id) on delete restrict,
 contract_version text not null default 'conveni-bytea-manifest-v1' check(contract_version='conveni-bytea-manifest-v1'),
 plan jsonb not null check(jsonb_typeof(plan)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create table conveni_transactional_bytes_candidate.batches(
 event_id uuid primary key,
 attempt_id uuid not null unique references conveni_transactional_bytes_candidate.plans(attempt_id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create table conveni_transactional_bytes_candidate.items(
 event_id uuid not null references conveni_transactional_bytes_candidate.batches(event_id) on delete restrict,
 document_id uuid not null references public.source_documents(id) on delete restrict,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 observed_mime_type text,
 body bytea not null check(octet_length(body)>0 and octet_length(body)<=16777216),
 primary key(event_id,document_id)
);
revoke all on all tables in schema conveni_transactional_bytes_candidate from public,anon,authenticated,service_role;

create function conveni_transactional_bytes_candidate.immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'CONVENI_BYTES_RETENTION_REQUIRED';end $$;
create trigger bytes_plan_immutable before update or delete on conveni_transactional_bytes_candidate.plans for each row execute function conveni_transactional_bytes_candidate.immutable();
create trigger bytes_batch_immutable before update or delete on conveni_transactional_bytes_candidate.batches for each row execute function conveni_transactional_bytes_candidate.immutable();
create trigger bytes_item_immutable before update or delete on conveni_transactional_bytes_candidate.items for each row execute function conveni_transactional_bytes_candidate.immutable();

-- 730's historical ready step is not a bytea decision. Never release an
-- attempt after selecting this plan until decision and recovery are integrated.
create function conveni_transactional_bytes_candidate.block_legacy_completion() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if old.state='active' and new.state<>'active' and exists(select 1 from conveni_transactional_bytes_candidate.plans where attempt_id=old.id) then
  raise exception 'CONVENI_BYTES_DECISION_NOT_INTEGRATED';end if;
 return new;
end $$;
create trigger bytes_block_legacy_completion before update on conveni_preparation_guard_candidate.attempts for each row execute function conveni_transactional_bytes_candidate.block_legacy_completion();

-- A legacy unit-copy can appear or change independently. The bytea batch is
-- bound to the source, draft, citations and destination identity, not to that
-- optional copy's metadata. All other plan fields remain exact and ordered.
create function conveni_transactional_bytes_candidate.same_source_plan(p_before jsonb,p_after jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_before) is distinct from 'object' or jsonb_typeof(p_after) is distinct from 'object'
  or jsonb_typeof(p_before->'archives') is distinct from 'array' or jsonb_typeof(p_after->'archives') is distinct from 'array' then false
 else (p_before-'archives')=(p_after-'archives') and jsonb_array_length(p_before->'archives')>0
  and jsonb_array_length(p_before->'archives')=jsonb_array_length(p_after->'archives')
  and not exists(select 1 from jsonb_array_elements(p_before->'archives') with ordinality x(value,n)
   join jsonb_array_elements(p_after->'archives') with ordinality y(value,n) on y.n=x.n
   where jsonb_typeof(x.value) is distinct from 'object' or jsonb_typeof(y.value) is distinct from 'object'
    or (x.value-'copy') is distinct from (y.value-'copy')) end
$$;

-- Capture a plan from the guarded operation, never a caller-supplied plan.
create function conveni_transactional_bytes_candidate.capture_plan(p_record uuid,p_job uuid,p_unit uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a conveni_preparation_guard_candidate.attempts; v jsonb; old_ conveni_transactional_bytes_candidate.plans; enabled_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'CONVENI_BYTES_DISABLED';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit for update;
 if not found or a.state<>'active' or not exists(select 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record)
  or not exists(select 1 from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit) then raise exception 'CONVENI_BYTES_SCOPE';end if;
 v:=conveni_preparation_guard_candidate.step(p_attempt,'copy_plan',null);
 if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'archives') is distinct from 'array' or jsonb_array_length(v->'archives')=0 then raise exception 'CONVENI_BYTES_PLAN_INVALID';end if;
 select * into old_ from conveni_transactional_bytes_candidate.plans where attempt_id=p_attempt;
 if found then
  if (old_.record_id,old_.job_id,old_.unit_id) is distinct from (p_record,p_job,p_unit)
   or not conveni_transactional_bytes_candidate.same_source_plan(old_.plan,v) then raise exception 'CONVENI_BYTES_PLAN_CHANGED';end if;
  return jsonb_build_object('attemptId',p_attempt,'replay',true);
 end if;
 insert into conveni_transactional_bytes_candidate.plans(attempt_id,record_id,job_id,unit_id,plan) values(p_attempt,p_record,p_job,p_unit,v);
 return jsonb_build_object('attemptId',p_attempt,'replay',false);
end $$;

-- The entire set, including hashes and receipt identity, commits atomically.
-- A replay confirms historical bytes only; it does not assert current status.
create function conveni_transactional_bytes_candidate.commit_batch(p_record uuid,p_job uuid,p_unit uuid,p_attempt uuid,p_event uuid,p_items jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a conveni_preparation_guard_candidate.attempts; p conveni_transactional_bytes_candidate.plans; prior_ conveni_transactional_bytes_candidate.batches;
 v jsonb; x jsonb; doc uuid; expected_ text; mime_ text; b bytea; total_ bigint:=0; seen_ uuid[]:='{}'; n int:=0; enabled_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'CONVENI_BYTES_DISABLED';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit for update;
 if not found or a.state<>'active' or p_event is null or not exists(select 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record)
  or not exists(select 1 from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit) then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into p from conveni_transactional_bytes_candidate.plans where attempt_id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit;
 if not found then raise exception 'CONVENI_BYTES_PLAN_REQUIRED';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>jsonb_array_length(p.plan->'archives') then raise exception 'CONVENI_BYTES_INCOMPLETE';end if;
 select * into prior_ from conveni_transactional_bytes_candidate.batches where event_id=p_event;
 if found then
  if prior_.attempt_id is distinct from p_attempt then raise exception 'CONVENI_BYTES_REPLAY_CONFLICT';end if;
 else
  if exists(select 1 from conveni_transactional_bytes_candidate.batches where attempt_id=p_attempt) then raise exception 'CONVENI_BYTES_ATTEMPT_REUSED';end if;
  v:=conveni_preparation_guard_candidate.step(p_attempt,'copy_plan',null);
  if not conveni_transactional_bytes_candidate.same_source_plan(p.plan,v) then raise exception 'CONVENI_BYTES_PLAN_CHANGED';end if;
  insert into conveni_transactional_bytes_candidate.batches(event_id,attempt_id) values(p_event,p_attempt);
 end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'documentId') is distinct from 'string' or jsonb_typeof(x->'base64') is distinct from 'string'
   or length(x->>'base64')>22369624 or length(x->>'base64')%4<>0 or x->>'base64' !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'CONVENI_BYTES_INVALID';end if;
  begin doc:=(x->>'documentId')::uuid;exception when others then raise exception 'CONVENI_BYTES_INVALID';end;
  if doc=any(seen_) then raise exception 'CONVENI_BYTES_DUPLICATE';end if;seen_:=array_append(seen_,doc);
  select mime_type into mime_ from public.source_documents where id=doc and source_record_id=p_record for share;
  if not found or (select count(*) from jsonb_array_elements(p.plan->'archives') item where item->>'documentId'=doc::text)<>1 then raise exception 'CONVENI_BYTES_DOCUMENT';end if;
  select item->'source'->>'sha256' into expected_ from jsonb_array_elements(p.plan->'archives') item where item->>'documentId'=doc::text;
  begin b:=decode(x->>'base64','base64');exception when others then raise exception 'CONVENI_BYTES_INVALID';end;
  total_:=total_+octet_length(b);
  if octet_length(b)=0 or octet_length(b)>16777216 or total_>67108864 then raise exception 'CONVENI_BYTES_LIMIT';end if;
  if encode(extensions.digest(b,'sha256'),'hex') is distinct from expected_ then raise exception 'CONVENI_BYTES_HASH';end if;
  if prior_.event_id is null then insert into conveni_transactional_bytes_candidate.items(event_id,document_id,sha256,observed_mime_type,body) values(p_event,doc,expected_,mime_,b);
  elsif not exists(select 1 from conveni_transactional_bytes_candidate.items where event_id=p_event and document_id=doc and sha256=expected_ and body=b) then raise exception 'CONVENI_BYTES_REPLAY_CONFLICT';end if;
  n:=n+1;
 end loop;
 if prior_.event_id is not null and (select count(*) from conveni_transactional_bytes_candidate.items where event_id=p_event)<>n then raise exception 'CONVENI_BYTES_REPLAY_CONFLICT';end if;
 return jsonb_build_object('eventId',p_event,'attemptId',p_attempt,'documents',n,'historicalReplay',prior_.event_id is not null);
end $$;

-- Reconciliation is observation only. A stored batch may be historical; this
-- response never releases the reservation or declares evidence current.
create function conveni_transactional_bytes_candidate.inspect_attempt(p_record uuid,p_job uuid,p_unit uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a conveni_preparation_guard_candidate.attempts; b conveni_transactional_bytes_candidate.batches; docs_ jsonb;
begin
 perform conveni_preparation_guard_candidate.require_read_committed();
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into b from conveni_transactional_bytes_candidate.batches where attempt_id=p_attempt;
 select coalesce(jsonb_agg(jsonb_build_object('documentId',document_id,'sha256',sha256) order by document_id),'[]'::jsonb) into docs_
  from conveni_transactional_bytes_candidate.items where event_id=b.event_id;
 return jsonb_build_object('attemptId',p_attempt,'attemptState',a.state,
  'planCaptured',exists(select 1 from conveni_transactional_bytes_candidate.plans where attempt_id=p_attempt),
  'contractVersion',(select contract_version from conveni_transactional_bytes_candidate.plans where attempt_id=p_attempt),
  'eventId',b.event_id,'documents',docs_,'state','pending_reconciliation','current',false);
end $$;

-- Recheck the retained bytes and the guarded source-plan metadata in one
-- transaction. This is not a physical reread of Storage, an economic review,
-- a decision, or proof that a historic receipt is currently approvable.
create function conveni_transactional_bytes_candidate.verify_batch(p_record uuid,p_job uuid,p_unit uuid,p_attempt uuid,p_event uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare a conveni_preparation_guard_candidate.attempts; p conveni_transactional_bytes_candidate.plans;
 current_ jsonb; entry_ jsonb; doc_ uuid; expected_ text; item_ conveni_transactional_bytes_candidate.items;
 seen_ uuid[]:='{}'; n_ integer:=0; total_ bigint:=0; enabled_ boolean;
begin
 select enabled into enabled_ from conveni_preparation_guard_candidate.config where singleton for share;
 if not coalesce(enabled_,false) then raise exception 'CONVENI_BYTES_DISABLED';end if;
 perform conveni_preparation_guard_candidate.require_read_committed();
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into a from conveni_preparation_guard_candidate.attempts where id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit for update;
 if not found or a.state<>'active' or not exists(select 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record)
  or not exists(select 1 from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit) then raise exception 'CONVENI_BYTES_SCOPE';end if;
 select * into p from conveni_transactional_bytes_candidate.plans where attempt_id=p_attempt and record_id=p_record and job_id=p_job and unit_id=p_unit;
 if not found or not exists(select 1 from conveni_transactional_bytes_candidate.batches where event_id=p_event and attempt_id=p_attempt) then raise exception 'CONVENI_BYTES_BATCH_REQUIRED';end if;
 current_:=conveni_preparation_guard_candidate.step(p_attempt,'copy_plan',null);
 if jsonb_typeof(p.plan->'archives') is distinct from 'array' or jsonb_array_length(p.plan->'archives')=0 then raise exception 'CONVENI_BYTES_PLAN_INVALID';end if;
 if not conveni_transactional_bytes_candidate.same_source_plan(p.plan,current_) then raise exception 'CONVENI_BYTES_PLAN_CHANGED';end if;
 if (select count(*) from conveni_transactional_bytes_candidate.items where event_id=p_event)<>jsonb_array_length(p.plan->'archives') then raise exception 'CONVENI_BYTES_INCOMPLETE';end if;
 for entry_ in select value from jsonb_array_elements(p.plan->'archives') loop
  begin doc_:=(entry_->>'documentId')::uuid;exception when others then raise exception 'CONVENI_BYTES_DOCUMENT';end;
  if doc_ is null or doc_=any(seen_) or not exists(select 1 from public.source_documents where id=doc_ and source_record_id=p_record) then raise exception 'CONVENI_BYTES_DOCUMENT';end if;
  seen_:=array_append(seen_,doc_);expected_:=entry_->'source'->>'sha256';
  select * into item_ from conveni_transactional_bytes_candidate.items where event_id=p_event and document_id=doc_;
  if not found or item_.sha256 is distinct from expected_ or encode(extensions.digest(item_.body,'sha256'),'hex') is distinct from expected_ then raise exception 'CONVENI_BYTES_HASH';end if;
  total_:=total_+octet_length(item_.body);
  if octet_length(item_.body)=0 or octet_length(item_.body)>16777216 or total_>67108864 then raise exception 'CONVENI_BYTES_LIMIT';end if;
  n_:=n_+1;
 end loop;
 return jsonb_build_object('attemptId',p_attempt,'eventId',p_event,'documents',n_,
  'bytesVerified',true,'sourceMetadataMatches',true,'physicalSourceVerified',false,
  'state','pending_reconciliation','current',false);
end $$;

-- Closed data reader for a later viewer. Each bounded read rechecks the whole
-- retained batch under the same transaction; it grants no application access,
-- does not certify source Storage and never implies an economic decision.
create function conveni_transactional_bytes_candidate.read_chunk(p_record uuid,p_job uuid,p_unit uuid,p_attempt uuid,p_event uuid,p_document uuid,p_offset bigint,p_length integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare item_ conveni_transactional_bytes_candidate.items; size_ integer; chunk_ bytea;
begin
 if p_document is null or p_offset is null or p_offset<0 or p_length is null or p_length<1 or p_length>262144 then raise exception 'CONVENI_BYTES_RANGE_INVALID';end if;
 perform conveni_transactional_bytes_candidate.verify_batch(p_record,p_job,p_unit,p_attempt,p_event);
 select * into item_ from conveni_transactional_bytes_candidate.items where event_id=p_event and document_id=p_document;
 if not found then raise exception 'CONVENI_BYTES_DOCUMENT';end if;
 size_:=octet_length(item_.body);
 if p_offset>size_ then raise exception 'CONVENI_BYTES_RANGE_INVALID';end if;
 chunk_:=substring(item_.body from (p_offset::integer+1) for p_length);
 return jsonb_build_object('documentId',p_document,'offset',p_offset,'totalBytes',size_,
  'sha256',item_.sha256,'observedMimeType',item_.observed_mime_type,
  'base64',encode(chunk_,'base64'),'current',false,'physicalSourceVerified',false);
end $$;
revoke all on all functions in schema conveni_transactional_bytes_candidate from public,anon,authenticated,service_role;

-- Preserve a useful rejection before any purge work; 720 already locks source
-- records first and an exception rolls back the complete selected batch.
do $$
declare body_ text; anchor_ constant text:='if exists(select 1 from public.documented_corrections';
begin
 body_:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(body_)-length(replace(body_,anchor_,'')))/length(anchor_)<>1 then raise exception 'CONVENI_BYTES_DELETE_ANCHOR_INVALID';end if;
 body_:=replace(body_,anchor_,'if exists(select 1 from conveni_transactional_bytes_candidate.plans where record_id=any(history_selected_ids)) or exists(select 1 from public.documented_corrections');
 execute body_;
end $$;
