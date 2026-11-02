-- Candidate first-Conveni provisioning and export contract. Closed: no application grants.
-- Do not enable the workflow until wrapper, UI, all consumers and transition are verified.

-- Candidate source: experiment.sql
-- CLOSED CANDIDATE. No approval is enabled and no application grants are given.
create schema conveni_first_candidate;
revoke all on schema conveni_first_candidate from public,anon,authenticated,service_role;
create table conveni_first_candidate.receipts (
 event_id uuid primary key, draft_id uuid not null references public.conveni_unit_economic_draft_events(id),
 snapshot jsonb not null, verified_at timestamptz not null default clock_timestamp(),
 kind text not null default 'physical-read-only-v1' check(kind='physical-read-only-v1')
);
revoke all on conveni_first_candidate.receipts from public,anon,authenticated,service_role;

-- Reuse the draft replay's full freshness/locking contract, rather than
-- certifying a draft solely because its row still exists.
create function conveni_first_candidate.snapshot(p_draft uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,storage set lock_timeout='1000ms' as $$
declare d public.conveni_unit_economic_draft_events;doc public.source_documents;
 ids uuid[];id_ uuid;path_ text;s storage.objects;c storage.objects;archives jsonb:='[]';
begin
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft for share nowait;
 perform public.prepare_conveni_unit_economic_draft(d.source_record_id,d.job_id,d.unit_id,d.id,d.previous_id,d.parent_review_id,
  d.source_hash,d.proposal_hash,d.analysis_hash,d.document_revisions,d.service_code,d.amount_cents,d.amount_literal,
  d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason);
 -- Draft held stable before replay. Record/domain locks now also remain held.
 select array_agg(distinct (x->>'document_id')::uuid order by (x->>'document_id')::uuid) into ids
 from unnest(array[d.monetary_citation,d.identity_citation,d.role_period_citation]) x;
 if coalesce(cardinality(ids),0) not between 1 and 3 then raise exception 'Invalid citation set';end if;
 -- Lock ALL selected object rows in deterministic path order. Locks fence
-- metadata writers, NOT an unproven physical backend transaction.
 perform 1 from storage.objects o join public.source_documents sd on sd.id=any(ids) and sd.source_record_id=d.source_record_id
  and o.bucket_id='cloud-documents' and o.name in (sd.storage_path,
   'cases/'||d.source_record_id||'/items/'||d.unit_id||'/documents/'||sd.id||'/'||split_part(sd.storage_path,'/',5))
 order by o.name for share of o nowait;
 foreach id_ in array ids loop
  select * into strict doc from public.source_documents where id=id_ and source_record_id=d.source_record_id;
  path_:='cases/'||d.source_record_id||'/items/'||d.unit_id||'/documents/'||id_||'/'||split_part(doc.storage_path,'/',5);
  if doc.storage_path is null or doc.storage_sha256 is null or doc.storage_sha256 !~ '^[a-f0-9]{64}$'
   or doc.storage_path !~ ('^cases/'||d.source_record_id||'/documents/'||id_||'/'||doc.storage_sha256||'[.][a-z0-9]+$')
   then raise exception 'Invalid canonical identity';end if;
  select * into strict s from storage.objects where bucket_id='cloud-documents' and name=doc.storage_path and archived_at is null;
  select * into strict c from storage.objects where bucket_id='cloud-documents' and name=path_ and archived_at is null;
  if s.id=c.id or s.version is null or c.version is null
   or s.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or c.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise exception 'Missing object version';end if;
  archives:=archives||jsonb_build_array(jsonb_build_object('documentId',id_,
   'source',jsonb_build_object('path',s.name,'sha256',doc.storage_sha256,'object_id',s.id,'version',s.version),
   'copy',jsonb_build_object('path',c.name,'sha256',doc.storage_sha256,'object_id',c.id,'version',c.version)));
 end loop;
 return jsonb_build_object('draftId',d.id,'recordId',d.source_record_id,'unitId',d.unit_id,
  'draft',to_jsonb(d),'monetaryCitation',d.monetary_citation,'identityCitation',d.identity_citation,
  'rolePeriodCitation',d.role_period_citation,'archives',archives);
end $$;

-- Only a trusted verifier may ever invoke this private boundary. SQL cannot
-- prove a caller actually streamed bytes. No role receives execution rights.
create function conveni_first_candidate.save_receipt(p_event uuid,p_draft uuid,p_snapshot jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate as $$
declare current_ jsonb;existing conveni_first_candidate.receipts;out_ jsonb;
begin
 if p_event is null then raise exception 'Event required';end if;
 current_:=conveni_first_candidate.snapshot(p_draft);
 if current_ is distinct from p_snapshot then raise exception 'ARCHIVE_RECEIPT_STALE' using errcode='PT409';end if;
 select * into existing from conveni_first_candidate.receipts where event_id=p_event for update nowait;
 if found then
  if existing.draft_id is distinct from p_draft or existing.snapshot is distinct from current_ then
   raise exception 'RECEIPT_EVENT_REUSED' using errcode='PT409';end if;
  return to_jsonb(existing);
 end if;
 insert into conveni_first_candidate.receipts(event_id,draft_id,snapshot) values(p_event,p_draft,current_) returning to_jsonb(receipts.*) into out_;
 return out_;
end $$;

create function conveni_first_candidate.find_receipt(p_event uuid,p_draft uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate as $$
declare current_ jsonb;r conveni_first_candidate.receipts;
begin
 select * into r from conveni_first_candidate.receipts where event_id=p_event;
 if not found then return null;end if;
 if r.draft_id is distinct from p_draft then raise exception 'RECEIPT_EVENT_REUSED' using errcode='PT409';end if;
 current_:=conveni_first_candidate.snapshot(p_draft);
 if r.snapshot is distinct from current_ then raise exception 'ARCHIVE_RECEIPT_STALE' using errcode='PT409';end if;
 return to_jsonb(r);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: copy-experiment.sql
-- PRIVATE SECOND INCREMENT: no production migration or grants.
create function conveni_first_candidate.copy_plan(p_draft uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,storage set lock_timeout='1000ms' as $$
declare d public.conveni_unit_economic_draft_events;doc public.source_documents;
 ids uuid[];id_ uuid;path_ text;s storage.objects;c storage.objects;archives jsonb:='[]';
begin
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft for share nowait;
 perform public.prepare_conveni_unit_economic_draft(d.source_record_id,d.job_id,d.unit_id,d.id,d.previous_id,d.parent_review_id,
  d.source_hash,d.proposal_hash,d.analysis_hash,d.document_revisions,d.service_code,d.amount_cents,d.amount_literal,
  d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason);
 -- Draft held stable before replay. Record/domain locks now also remain held.
 select array_agg(distinct (x->>'document_id')::uuid order by (x->>'document_id')::uuid) into ids
 from unnest(array[d.monetary_citation,d.identity_citation,d.role_period_citation]) x;
 if coalesce(cardinality(ids),0) not between 1 and 3 then raise exception 'Invalid citation set';end if;
 -- Lock ALL selected object rows in deterministic path order. Locks fence
-- metadata writers, NOT an unproven physical backend transaction.
 perform 1 from storage.objects o join public.source_documents sd on sd.id=any(ids) and sd.source_record_id=d.source_record_id
  and o.bucket_id='cloud-documents' and o.name in (sd.storage_path,
   'cases/'||d.source_record_id||'/items/'||d.unit_id||'/documents/'||sd.id||'/'||split_part(sd.storage_path,'/',5))
 order by o.name for share of o nowait;
 foreach id_ in array ids loop
  select * into strict doc from public.source_documents where id=id_ and source_record_id=d.source_record_id;
  path_:='cases/'||d.source_record_id||'/items/'||d.unit_id||'/documents/'||id_||'/'||split_part(doc.storage_path,'/',5);
  if doc.storage_path is null or doc.storage_sha256 is null or doc.storage_sha256 !~ '^[a-f0-9]{64}$'
   or doc.storage_path !~ ('^cases/'||d.source_record_id||'/documents/'||id_||'/'||doc.storage_sha256||'[.][a-z0-9]+$')
   then raise exception 'Invalid canonical identity';end if;
  select * into strict s from storage.objects where bucket_id='cloud-documents' and name=doc.storage_path and archived_at is null;
  select * into c from storage.objects where bucket_id='cloud-documents' and name=path_ and archived_at is null;
  if s.id=c.id or s.version is null or (c.id is not null and c.version is null)
   or s.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or c.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise exception 'Missing object version';end if;
  archives:=archives||jsonb_build_array(jsonb_build_object('documentId',id_,
   'copyPath',path_,'source',jsonb_build_object('path',s.name,'sha256',doc.storage_sha256,'object_id',s.id,'version',s.version),
   'copy',case when c.id is null then 'null'::jsonb else jsonb_build_object('path',c.name,'sha256',doc.storage_sha256,'object_id',c.id,'version',c.version) end));
 end loop;
 return jsonb_build_object('draftId',d.id,'recordId',d.source_record_id,'unitId',d.unit_id,
  'draft',to_jsonb(d),'monetaryCitation',d.monetary_citation,'identityCitation',d.identity_citation,
  'rolePeriodCitation',d.role_period_citation,'archives',archives);
end $$;

-- Copies initially missing may now exist. Existing copies and all source,
-- draft and citation identities must stay exactly as captured. No copy is
-- approved/published here. It returns a final snapshot for physical checking.
create function conveni_first_candidate.snapshot_for_copy_plan(p_draft uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate as $$
declare current_ jsonb;old_ jsonb;new_ jsonb;
begin
 current_:=conveni_first_candidate.copy_plan(p_draft);
 if jsonb_typeof(p_plan) is distinct from 'object' or (current_-'archives') is distinct from (p_plan-'archives')
  or jsonb_typeof(p_plan->'archives') is distinct from 'array'
  or jsonb_array_length(current_->'archives')<>jsonb_array_length(p_plan->'archives') then
  raise exception 'COPY_PLAN_STALE' using errcode='PT409';end if;
 for old_,new_ in select a.value,b.value from jsonb_array_elements(p_plan->'archives') with ordinality a(value,n)
  join jsonb_array_elements(current_->'archives') with ordinality b(value,n) using(n) loop
  if (old_-'copy') is distinct from (new_-'copy') or new_->'copy'='null'::jsonb
   or (old_->'copy'<>'null'::jsonb and old_->'copy' is distinct from new_->'copy') then
   raise exception 'COPY_PLAN_STALE' using errcode='PT409';end if;
 end loop;
 return conveni_first_candidate.snapshot(p_draft);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: economic-experiment.sql
-- CLOSED CANDIDATE. Shadow effects only; public approval stays blocked.
create table conveni_first_candidate.economic_decisions (
 event_id uuid primary key, receipt_id uuid not null unique references conveni_first_candidate.receipts(event_id),
 draft_id uuid not null references public.conveni_unit_economic_draft_events(id),
 unit_id uuid not null unique references public.record_units(id),
 decision jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table conveni_first_candidate.economic_manifests (
 event_id uuid not null references conveni_first_candidate.economic_decisions(event_id),
 document_id uuid not null references public.source_documents(id), artifact jsonb not null,
 primary key(event_id,document_id)
);
create table conveni_first_candidate.economic_provisions (
 event_id uuid primary key references conveni_first_candidate.economic_decisions(event_id),
 unit_id uuid not null unique references public.record_units(id), provision jsonb not null
);
revoke all on conveni_first_candidate.economic_decisions,conveni_first_candidate.economic_manifests,conveni_first_candidate.economic_provisions from public,anon,authenticated,service_role;

create function conveni_first_candidate.commit_economic(
 p_event uuid,p_receipt uuid,p_actor text,p_note text,p_social boolean,p_economic boolean
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,extensions set lock_timeout='1000ms' as $$
declare receipt_ conveni_first_candidate.receipts;d public.conveni_unit_economic_draft_events;
 current_ jsonb;unit_ jsonb;analysis_ public.conveni_analyses;r public.source_records;doc public.source_documents;
 artifact_ jsonb;manifest_ jsonb:='[]';decision_ jsonb;provision_ jsonb;prior_ conveni_first_candidate.economic_decisions;
 citation_ jsonb;count_ integer;total_ numeric;
begin
 if p_event is null or p_receipt is null or p_social is distinct from true or p_economic is distinct from true
  or length(trim(coalesce(p_actor,''))) not between 3 and 120 or length(trim(coalesce(p_note,''))) not between 10 and 2000
 then raise exception 'DOCUMENTED_HUMAN_CONFIRMATION_REQUIRED';end if;
 -- This role/actor is supplied only by a trusted test server. There is no
 -- production auth integration and no grant to any application role.
 select * into strict receipt_ from conveni_first_candidate.receipts where event_id=p_receipt for share nowait;
 if receipt_.kind is distinct from 'physical-read-only-v1' then raise exception 'INVALID_PHYSICAL_RECEIPT';end if;
 current_:=conveni_first_candidate.snapshot(receipt_.draft_id);
 if current_ is distinct from receipt_.snapshot then raise exception 'ECONOMIC_RECEIPT_STALE' using errcode='PT409';end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=receipt_.draft_id;
 select * into strict analysis_ from public.conveni_analyses where job_id=d.job_id;
 select * into strict r from public.source_records where id=d.source_record_id;
 unit_:=d.proposal_snapshot;
 -- Deliberately narrow: one simple unit, no unknown remainder or sibling
 -- attribution. More complex cases remain blocked, not generalized.
 total_:=public.conveni_public_amount(r.source_payload)*100;
 if jsonb_array_length(analysis_.payload->'units')<>1
  or (select count(*) from public.conveni_unit_proposals where job_id=d.job_id)<>1
  or not public.conveni_review_amounts_reconcile(analysis_.payload,total_)
  or analysis_.payload->'unallocated_cents' is distinct from '0'::jsonb
  or total_ is distinct from d.amount_cents::numeric
  or d.parent_review_id is not null
  or unit_->>'period' !~ '^[0-9]{4}$' or unit_->>'year' is distinct from unit_->>'period'
  or length(trim(coalesce(unit_->>'population','')))=0 or length(trim(coalesce(unit_->>'description','')))=0
 then raise exception 'SIMPLE_ATTRIBUTION_NOT_ESTABLISHED';end if;
 -- Full documentary set, not merely a conveniently selected quote.
 select count(*) into count_ from jsonb_object_keys(d.document_revisions);
 if count_<>jsonb_array_length(current_->'archives') or exists(
  select 1 from jsonb_object_keys(d.document_revisions) k where not exists(
   select 1 from jsonb_array_elements(current_->'archives') a where a->>'documentId'=k))
 then raise exception 'UNVERIFIED_DOCUMENT_SET';end if;
 for artifact_ in select value from jsonb_array_elements(current_->'archives') loop
  select * into strict doc from public.source_documents where id=(artifact_->>'documentId')::uuid and source_record_id=d.source_record_id;
  -- Provable special case: exact UTF-8 text bytes. No PDF/OCR/HTML inference.
  -- The physical receipt authenticated these source bytes; equal SHA binds
  -- exactly the text now used in review. A declared extraction ID is not proof.
  if doc.mime_type is distinct from 'text/plain' or doc.extraction_method is distinct from 'html-basic'
   or doc.extraction_partial is distinct from false
   or doc.extraction_coverage->>'policy' is distinct from 'html-text-coverage-v1'
   or doc.extraction_coverage->'complete' is distinct from 'true'::jsonb
   or doc.extracted_text is null or char_length(doc.extracted_text)>180000
   or encode(extensions.digest(convert_to(doc.extracted_text,'UTF8'),'sha256'),'hex') is distinct from artifact_->'source'->>'sha256'
   or artifact_->'source'->>'sha256' is distinct from artifact_->'copy'->>'sha256'
  then raise exception 'EXTRACTION_PROVENANCE_UNPROVEN';end if;
  manifest_:=manifest_||jsonb_build_array(artifact_||jsonb_build_object('extraction_proof',jsonb_build_object(
   'kind','exact-utf8-bytes-v1','text_sha256',doc.storage_sha256,'active_extraction_id',doc.active_extraction_id,
   'method',doc.extraction_method,'mime',doc.mime_type,'coverage',doc.extraction_coverage)));
 end loop;
 -- Literal checks supplement, never replace, the two explicit human acts.
 foreach citation_ in array array[d.monetary_citation,d.identity_citation,d.role_period_citation] loop
  if citation_->>'page' is distinct from '1' then raise exception 'EXACT_TEXT_PAGE_REQUIRED';end if;
 end loop;
 if not public.conveni_identity_quote_matches(unit_->>'recipient',unit_->>'recipient_nif',d.role_period_citation->>'quote')
  or not ((d.role_period_citation->>'quote') ~ ('(^|[^0-9])'||(unit_->>'period')||'([^0-9]|$)'))
 then raise exception 'ROLE_PERIOD_DOCUMENTATION_REQUIRED';end if;
 decision_:=jsonb_build_object('contract','private-simple-economic-v1','receipt_id',p_receipt,'snapshot',current_,
  'actor',p_actor,'note',p_note,'social_confirmed',p_social,'economic_confirmed',p_economic,
  'documented_confirmations',d.confirmations,'monetary_citation',d.monetary_citation,
  'identity_citation',d.identity_citation,'role_period_citation',d.role_period_citation);
 provision_:=jsonb_build_object('record_id',d.source_record_id,'job_id',d.job_id,'unit_id',d.unit_id,
  'recipient',unit_->>'recipient','recipient_nif',unit_->>'recipient_nif','period',unit_->>'period',
  'amount_cents',d.amount_cents,'amount_state',d.amount_state,'service_code',d.service_code,
  'catalog_version',d.catalog_version_id,'catalog_snapshot_hash',d.catalog_snapshot_hash,'classification','in_portfolio');
 perform 1 from conveni_first_candidate.economic_decisions where unit_id=d.unit_id or event_id=p_event order by event_id for update nowait;
 select * into prior_ from conveni_first_candidate.economic_decisions where event_id=p_event;
 if found then
  perform 1 from conveni_first_candidate.economic_manifests where event_id=p_event order by document_id for share nowait;
  perform 1 from conveni_first_candidate.economic_provisions where event_id=p_event for share nowait;
  if prior_.receipt_id is distinct from p_receipt or prior_.draft_id is distinct from d.id or prior_.unit_id is distinct from d.unit_id or prior_.decision is distinct from decision_
   or not exists(select 1 from conveni_first_candidate.economic_provisions where event_id=p_event and unit_id=d.unit_id and provision=provision_)
   or manifest_ is distinct from (select jsonb_agg(artifact order by document_id) from conveni_first_candidate.economic_manifests where event_id=p_event)
  then raise exception 'ECONOMIC_REPLAY_STALE' using errcode='PT409';end if;
  return jsonb_build_object('event_id',p_event,'private_only',true);
 end if;
 if exists(select 1 from conveni_first_candidate.economic_decisions where unit_id=d.unit_id or receipt_id=p_receipt)
 then raise exception 'ECONOMIC_DECISION_ALREADY_EXISTS' using errcode='PT409';end if;
 insert into conveni_first_candidate.economic_decisions(event_id,receipt_id,draft_id,unit_id,decision) values(p_event,p_receipt,d.id,d.unit_id,decision_);
 insert into conveni_first_candidate.economic_manifests(event_id,document_id,artifact)
 select p_event,(a->>'documentId')::uuid,a from jsonb_array_elements(manifest_) a;
 insert into conveni_first_candidate.economic_provisions(event_id,unit_id,provision) values(p_event,d.unit_id,provision_);
 return jsonb_build_object('event_id',p_event,'private_only',true);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: pdf-experiment.sql
-- CLOSED PDF provenance receipt; explicitly ineligible for economic approval.
create table conveni_first_candidate.pdf_policy(id boolean primary key check(id),policy jsonb not null);
create table conveni_first_candidate.pdf_extractions(
 event_id uuid primary key,document_id uuid not null references public.source_documents(id),
 input jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
revoke all on conveni_first_candidate.pdf_policy,conveni_first_candidate.pdf_extractions from public,anon,authenticated,service_role;
create function conveni_first_candidate.pdf_source(p_document uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,storage set lock_timeout='1000ms' as $$
declare d public.source_documents;o storage.objects;record_ uuid;
begin
 select source_record_id into strict record_ from source_documents where id=p_document;
 perform 1 from source_records where id=record_ for share nowait;
 select * into strict d from source_documents where id=p_document and source_record_id=record_ for share nowait;
 if d.mime_type is distinct from 'application/pdf' or d.storage_path is null or d.storage_sha256 is null
  or d.storage_sha256 !~ '^[a-f0-9]{64}$' or d.storage_path !~ ('^cases/'||record_||'/documents/'||d.id||'/'||d.storage_sha256||'[.]pdf$')
 then raise exception 'PDF_SOURCE_IDENTITY_INVALID';end if;
 select * into strict o from storage.objects where bucket_id='cloud-documents' and name=d.storage_path and archived_at is null for share nowait;
 if o.version is null or o.version !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'PDF_SOURCE_VERSION_REQUIRED';end if;
 return jsonb_build_object('documentId',d.id,'recordId',record_,'document_state',to_jsonb(d),
  'source',jsonb_build_object('path',o.name,'sha256',d.storage_sha256,'object_id',o.id,'version',o.version));
end $$;
create function conveni_first_candidate.save_pdf_extraction(p_event uuid,p_document uuid,p_input jsonb,p_result jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,extensions set lock_timeout='1000ms' as $$
declare current_ jsonb;policy_ jsonb;existing conveni_first_candidate.pdf_extractions;
 page_ jsonb;ord bigint;expected_ text;raw_pages text[];n integer;
begin
 current_:=conveni_first_candidate.pdf_source(p_document);
 if current_ is distinct from p_input then raise exception 'PDF_SOURCE_STALE' using errcode='PT409';end if;
 select policy into strict policy_ from conveni_first_candidate.pdf_policy where id for share nowait;
 if p_event is null or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>16000000
  or p_result->'policy' is distinct from policy_ or p_result->>'source_sha256' is distinct from p_input->'source'->>'sha256'
  or p_result->'economic_eligible' is distinct from 'false'::jsonb or p_result->>'visual_completeness' is distinct from 'unverified'
  or p_result->>'method' is distinct from 'pdf-text-markdown-v2' or p_result->>'extraction_version' is distinct from policy_->'normalizer'->>'version'
  or coalesce(p_result->>'extractionId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or p_result->'coverage'->'complete' is distinct from 'true'::jsonb
  or jsonb_typeof(p_result->'pages') is distinct from 'array'
  or jsonb_typeof(p_result->'coverage'->'pages') is distinct from 'array'
  or jsonb_typeof(p_result->'raw_text') is distinct from 'string' or jsonb_typeof(p_result->'text') is distinct from 'string'
  or coalesce(p_result->>'page_count','') !~ '^[1-9][0-9]?$'
 then raise exception 'PDF_EXTRACTION_CONTRACT_INVALID';end if;
 n:=(p_result->>'page_count')::integer;
 if n>20 or n<>jsonb_array_length(p_result->'pages') or n<>jsonb_array_length(p_result->'coverage'->'pages')
  or p_result->>'raw_sha256' is distinct from encode(extensions.digest(convert_to(p_result->>'raw_text','UTF8'),'sha256'),'hex')
  or p_result->>'text_sha256' is distinct from encode(extensions.digest(convert_to(p_result->>'text','UTF8'),'sha256'),'hex')
 then raise exception 'PDF_EXTRACTION_HASH_OR_COVERAGE_INVALID';end if;
 raw_pages:=string_to_array(replace(p_result->>'raw_text',chr(13),''),chr(12));
 if cardinality(raw_pages)>1 and btrim(raw_pages[cardinality(raw_pages)],E' \n\t\r')='' then raw_pages:=raw_pages[1:cardinality(raw_pages)-1];end if;
 if cardinality(raw_pages)<>n then raise exception 'PDF_RAW_PAGE_COUNT_INVALID';end if;
 for page_,ord in select value,ordinality from jsonb_array_elements(p_result->'pages') with ordinality loop
  if page_->'page' is distinct from to_jsonb(ord) or jsonb_typeof(page_->'text') is distinct from 'string'
   or length(btrim(page_->>'text'))<50 or page_->>'text' is distinct from btrim(raw_pages[ord],E' \n\t\r')
   or page_->>'sha256' is distinct from encode(extensions.digest(convert_to(page_->>'text','UTF8'),'sha256'),'hex')
   or p_result->'coverage'->'pages'->(ord::integer-1) is distinct from jsonb_build_object('page',ord,'method','text','defects','[]'::jsonb)
  then raise exception 'PDF_PAGE_PROVENANCE_INVALID';end if;
 end loop;
 select string_agg('## Pàgina '||(value->>'page')||E'\n\n'||(value->>'text'),E'\n\n' order by ordinality) into expected_
 from jsonb_array_elements(p_result->'pages') with ordinality;
 if expected_ is distinct from p_result->>'text' then raise exception 'PDF_ASSEMBLY_INVALID';end if;
 select * into existing from conveni_first_candidate.pdf_extractions where event_id=p_event for update nowait;
 if found then
  if existing.document_id is distinct from p_document or existing.input is distinct from p_input or existing.result is distinct from p_result then raise exception 'PDF_RECEIPT_EVENT_REUSED';end if;
  return;
 end if;
 insert into conveni_first_candidate.pdf_extractions(event_id,document_id,input,result) values(p_event,p_document,p_input,p_result);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: visual-experiment.sql
-- CLOSED CANDIDATE: a trusted verifier records a pinned physical read; a
-- human assertion remains an assertion, not a PDF/OCR extraction certificate.
-- No app role, public approval, provider, or production Storage access.
create table conveni_first_candidate.visual_source_reads(
 event_id uuid primary key, document_id uuid not null references public.source_documents(id),
 snapshot jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table conveni_first_candidate.visual_assertions(
 event_id uuid primary key, source_read uuid not null references conveni_first_candidate.visual_source_reads(event_id),
 document_id uuid not null references public.source_documents(id), page integer not null check(page between 1 and 10000),
 role text not null check(role in ('identity','economic','role_period','social')),
 quote text not null, reviewer text not null, rationale text not null, created_at timestamptz not null default clock_timestamp()
);
revoke all on conveni_first_candidate.visual_source_reads,conveni_first_candidate.visual_assertions from public,anon,authenticated,service_role;
create function conveni_first_candidate.visual_history_immutable() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'VISUAL_HISTORY_IMMUTABLE';end $$;
create trigger visual_reads_immutable before update or delete on conveni_first_candidate.visual_source_reads
for each row execute function conveni_first_candidate.visual_history_immutable();
create trigger visual_assertions_immutable before update or delete on conveni_first_candidate.visual_assertions
for each row execute function conveni_first_candidate.visual_history_immutable();

create function conveni_first_candidate.visual_save_source_read(p_event uuid,p_document uuid,p_snapshot jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare s jsonb;existing conveni_first_candidate.visual_source_reads;
begin
 if p_event is null then raise exception 'VISUAL_EVENT_REQUIRED';end if;
 -- Only trusted caller can invoke: it must have read and hashed exactly the
 -- source version. SQL checks metadata stability, not the physical read.
 s:=conveni_first_candidate.pdf_source(p_document);
 if s is distinct from p_snapshot then raise exception 'VISUAL_SOURCE_STALE' using errcode='PT409';end if;
 select * into existing from conveni_first_candidate.visual_source_reads where event_id=p_event for update nowait;
 if found then
  if existing.document_id is distinct from p_document or existing.snapshot is distinct from s then raise exception 'VISUAL_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into conveni_first_candidate.visual_source_reads(event_id,document_id,snapshot) values(p_event,p_document,s) returning * into existing;
 return to_jsonb(existing);
end $$;
create function conveni_first_candidate.visual_assert(p_event uuid,p_read uuid,p_document uuid,p_page integer,p_role text,p_quote text,p_reviewer text,p_rationale text,p_visual_confirmation boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare r conveni_first_candidate.visual_source_reads;existing conveni_first_candidate.visual_assertions;s jsonb;
begin
 if p_event is null or p_visual_confirmation is distinct from true or p_page is null or p_page not between 1 and 10000
  or coalesce(p_role,'') not in ('identity','economic','role_period','social')
  or length(trim(coalesce(p_quote,''))) not between 12 and 4000 or length(trim(coalesce(p_reviewer,''))) not between 3 and 120
  or length(trim(coalesce(p_rationale,''))) not between 10 and 2000 then raise exception 'VISUAL_CONFIRMATION_REQUIRED';end if;
 select * into strict r from conveni_first_candidate.visual_source_reads where event_id=p_read and document_id=p_document for share nowait;
 s:=conveni_first_candidate.pdf_source(p_document);
 if s is distinct from r.snapshot then raise exception 'VISUAL_SOURCE_STALE' using errcode='PT409';end if;
 select * into existing from conveni_first_candidate.visual_assertions where event_id=p_event for update nowait;
 if found then
  if existing.source_read is distinct from p_read or existing.document_id is distinct from p_document or existing.page is distinct from p_page
   or existing.role is distinct from p_role or existing.quote is distinct from p_quote or existing.reviewer is distinct from p_reviewer or existing.rationale is distinct from p_rationale then raise exception 'VISUAL_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into conveni_first_candidate.visual_assertions(event_id,source_read,document_id,page,role,quote,reviewer,rationale)
 values(p_event,p_read,p_document,p_page,p_role,p_quote,p_reviewer,p_rationale) returning * into existing;
 return to_jsonb(existing);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Link independent human statements to one existing economic draft and its
-- verified physical receipt. This is still not an approval or a provision.
create table conveni_first_candidate.visual_economic_links(
 event_id uuid primary key, draft_id uuid not null references public.conveni_unit_economic_draft_events(id),
 receipt_id uuid not null references conveni_first_candidate.receipts(event_id),
 monetary uuid not null references public.conveni_visual_observations(event_id),
 identity uuid not null references public.conveni_visual_observations(event_id),
 role_period uuid not null references public.conveni_visual_observations(event_id),
 reviewer text not null,note text not null,manifest_confirmed boolean not null,created_at timestamptz not null default clock_timestamp()
);
revoke all on conveni_first_candidate.visual_economic_links from public,anon,authenticated,service_role;
create trigger visual_links_immutable before update or delete on conveni_first_candidate.visual_economic_links
for each row execute function conveni_first_candidate.visual_history_immutable();
create function conveni_first_candidate.visual_link_draft(p_event uuid,p_draft uuid,p_receipt uuid,p_monetary uuid,p_identity uuid,p_role_period uuid,p_reviewer text,p_note text,p_social boolean,p_economic boolean,p_manifest boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare receipt_ conveni_first_candidate.receipts;d public.conveni_unit_economic_draft_events;v public.conveni_visual_observations;
 read_ public.conveni_visual_reads;previous conveni_first_candidate.visual_economic_links;
 expected jsonb;archive jsonb;kind text;pair record;current_ jsonb;
begin
 if p_event is null or p_social is distinct from true or p_economic is distinct from true or p_manifest is distinct from true
  or length(trim(coalesce(p_reviewer,''))) not between 3 and 120 or length(trim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'VISUAL_ECONOMIC_CONFIRMATION_REQUIRED';end if;
 select * into strict receipt_ from conveni_first_candidate.receipts where event_id=p_receipt and draft_id=p_draft for share nowait;
 current_:=conveni_first_candidate.snapshot(p_draft);
 if current_ is distinct from receipt_.snapshot then raise exception 'ECONOMIC_RECEIPT_STALE';end if;
 select * into strict d from public.conveni_unit_economic_draft_events where id=p_draft;
 for pair in select * from (values (p_monetary,'economic',d.monetary_citation),(p_identity,'identity',d.identity_citation),(p_role_period,'role_period',d.role_period_citation)) as x(id,expected_role,citation) loop
  select * into strict v from public.conveni_visual_observations where event_id=pair.id for share nowait;
  select * into strict read_ from public.conveni_visual_reads where event_id=v.read_id for share nowait;
  expected:=pair.citation;kind:=pair.expected_role;
  select value into archive from jsonb_array_elements(current_->'archives') where value->>'documentId'=expected->>'document_id';
  if v.role is distinct from kind or v.document_id::text is distinct from expected->>'document_id' or v.page::text is distinct from expected->>'page'
   or v.quote is distinct from expected->>'quote' or v.declared_reviewer is distinct from p_reviewer
   or read_.snapshot->>'recordId' is distinct from d.source_record_id::text or archive is null
   or read_.snapshot->'source' is distinct from archive->'source'
   or public.conveni_visual_source(d.source_record_id,v.document_id) is distinct from read_.snapshot
  then raise exception 'VISUAL_EVIDENCE_MISMATCH';end if;
 end loop;
 select * into previous from conveni_first_candidate.visual_economic_links where event_id=p_event for update nowait;
 if found then
  if previous.draft_id is distinct from p_draft or previous.receipt_id is distinct from p_receipt or previous.monetary is distinct from p_monetary
   or previous.identity is distinct from p_identity or previous.role_period is distinct from p_role_period or previous.reviewer is distinct from p_reviewer or previous.note is distinct from p_note or previous.manifest_confirmed is distinct from p_manifest
  then raise exception 'VISUAL_LINK_EVENT_REUSED';end if;
  return to_jsonb(previous);
 end if;
 insert into conveni_first_candidate.visual_economic_links(event_id,draft_id,receipt_id,monetary,identity,role_period,reviewer,note,manifest_confirmed)
 values(p_event,p_draft,p_receipt,p_monetary,p_identity,p_role_period,p_reviewer,p_note,p_manifest) returning * into previous;
 return to_jsonb(previous);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: historical-experiment.sql
-- CLOSED history acknowledgement; it does not approve funding, rewrite a
-- historical event, certify a legacy chain, or grant any role access.
create table conveni_first_candidate.history_acknowledgements (
 event_id uuid primary key, record_id uuid not null references public.source_records(id),
 unit_id uuid not null references public.record_units(id),job_id uuid not null references public.pipeline_jobs(id),
 previous_id uuid not null references public.conveni_review_events(id),snapshot jsonb not null,
 declared_reviewer text not null,note text not null,created_at timestamptz not null default now()
);
revoke all on conveni_first_candidate.history_acknowledgements from public,anon,authenticated,service_role;
create trigger history_acknowledgements_immutable before update or delete on conveni_first_candidate.history_acknowledgements
for each row execute function conveni_first_candidate.visual_history_immutable();
create function conveni_first_candidate.review_history_snapshot(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,extensions set lock_timeout='1000ms' as $$
declare history_ jsonb;latest uuid;
begin
 perform 1 from public.source_records where id=p_record and financing_type='conveni' for update nowait;
 if not found then raise exception 'HISTORY_RECORD_INVALID';end if;
 perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;
 if p_job is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) then raise exception 'HISTORY_JOB_STALE';end if;
 perform 1 from public.record_units where id=p_unit and source_record_id=p_record for update nowait;
 if not found then raise exception 'HISTORY_UNIT_INVALID';end if;
 perform 1 from public.conveni_review_events where unit_id=p_unit order by id for share nowait;
 if exists(select 1 from public.conveni_review_events e left join public.pipeline_jobs j on j.id=e.job_id where e.unit_id=p_unit and (e.source_record_id is distinct from p_record or j.source_record_id is distinct from p_record)) then raise exception 'HISTORY_SCOPE_INVALID';end if;
 if (select count(*) from public.conveni_review_events where unit_id=p_unit)>1000 then raise exception 'HISTORY_TOO_LARGE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'job_id',e.job_id,'outcome',e.outcome,'service_code',e.service_code,
  'reason',e.reason,'declared_actor',e.actor,'created_at',e.created_at,'previous',e.snapshot->'replay_previous',
  'snapshot_sha256',encode(extensions.digest(e.snapshot::text,'sha256'),'hex')) order by e.created_at,e.id),'[]'::jsonb)
 into history_ from public.conveni_review_events e where e.unit_id=p_unit;
 select id into latest from public.conveni_review_events where unit_id=p_unit order by created_at desc,id desc limit 1;
 if latest is null then raise exception 'HISTORY_EMPTY';end if;
 if octet_length(history_::text)>2000000 then raise exception 'HISTORY_TOO_LARGE';end if;
 return jsonb_build_object('record_id',p_record,'job_id',p_job,'unit_id',p_unit,'previous_id',latest,'events',history_);
end $$;
create function conveni_first_candidate.acknowledge_history(p_event uuid,p_record uuid,p_job uuid,p_unit uuid,p_snapshot jsonb,p_previous uuid,p_reviewer text,p_note text,p_confirmed boolean) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare current_ jsonb;existing conveni_first_candidate.history_acknowledgements;
begin
 if p_event is null or p_confirmed is distinct from true or length(trim(coalesce(p_reviewer,''))) not between 3 and 120 or length(trim(coalesce(p_note,''))) not between 10 and 2000 then raise exception 'HISTORY_CONFIRMATION_REQUIRED';end if;
 current_:=conveni_first_candidate.review_history_snapshot(p_record,p_job,p_unit);
 if current_ is distinct from p_snapshot or current_->>'previous_id' is distinct from p_previous::text then raise exception 'HISTORY_STALE';end if;
 select * into existing from conveni_first_candidate.history_acknowledgements where event_id=p_event for update nowait;
 if found then
  if existing.record_id is distinct from p_record or existing.job_id is distinct from p_job or existing.unit_id is distinct from p_unit or existing.previous_id is distinct from p_previous
   or existing.snapshot is distinct from current_ or existing.declared_reviewer is distinct from p_reviewer or existing.note is distinct from p_note then raise exception 'HISTORY_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into conveni_first_candidate.history_acknowledgements(event_id,record_id,job_id,unit_id,previous_id,snapshot,declared_reviewer,note)
 values(p_event,p_record,p_job,p_unit,p_previous,current_,p_reviewer,p_note) returning * into existing;
 return to_jsonb(existing);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Clone the existing draft validator into this private schema. Only its
-- explicit historical-parent barrier changes: it now requires the exact
-- acknowledged snapshot. Public function and grants stay untouched.
do $$
declare original text;patched text;
 name_anchor constant text:='public.prepare_conveni_unit_economic_draft(';
 argument_anchor constant text:='p_reason text)';
 barrier constant text:=$old$if parent_ is not null then raise exception 'Les revisions anteriors requereixen validació del seu historial abans de preparar l’atribució' using errcode='PT409';end if;$old$;
 replacement constant text:=$new$if parent_ is not null and not exists(select 1 from conveni_first_candidate.history_acknowledgements ack where ack.event_id=p_history_ack and ack.record_id=p_record and ack.job_id=p_job and ack.unit_id=p_unit and ack.previous_id=parent_ and ack.snapshot=conveni_first_candidate.review_history_snapshot(p_record,p_job,p_unit)) then raise exception 'HISTORY_ACK_REQUIRED' using errcode='PT409';end if;$new$;
begin
 original:=pg_get_functiondef('public.prepare_conveni_unit_economic_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,bigint,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure);
 if (length(original)-length(replace(original,name_anchor,'')))/length(name_anchor)<>1 or (length(original)-length(replace(original,argument_anchor,'')))/length(argument_anchor)<>1 or (length(original)-length(replace(original,barrier,'')))/length(barrier)<>1 then raise exception 'HISTORICAL_DRAFT_PATCH_ANCHOR';end if;
 patched:=replace(replace(replace(original,name_anchor,'conveni_first_candidate.prepare_historical_draft_inner('),argument_anchor,'p_reason text, p_history_ack uuid)'),barrier,replacement);
 execute patched;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

create table conveni_first_candidate.historical_draft_ack_links (
 draft_id uuid primary key references public.conveni_unit_economic_draft_events(id),
 acknowledgement_id uuid not null references conveni_first_candidate.history_acknowledgements(event_id)
);
revoke all on conveni_first_candidate.historical_draft_ack_links from public,anon,authenticated,service_role;
create trigger historical_draft_ack_links_immutable before update or delete on conveni_first_candidate.historical_draft_ack_links
for each row execute function conveni_first_candidate.visual_history_immutable();
create function conveni_first_candidate.prepare_historical_draft(
 p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_parent_review uuid,
 p_source_hash text,p_proposal_hash text,p_analysis_hash text,p_revisions jsonb,p_service text,
 p_amount_cents bigint,p_amount_literal text,p_monetary jsonb,p_identity jsonb,p_role_period jsonb,
 p_confirmations jsonb,p_reason text,p_history_ack uuid
) returns void language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate as $$
declare bound uuid;
begin
 perform conveni_first_candidate.prepare_historical_draft_inner(p_record,p_job,p_unit,p_event,p_previous,p_parent_review,p_source_hash,p_proposal_hash,p_analysis_hash,p_revisions,p_service,p_amount_cents,p_amount_literal,p_monetary,p_identity,p_role_period,p_confirmations,p_reason,p_history_ack);
 if p_parent_review is not null then
  select acknowledgement_id into bound from conveni_first_candidate.historical_draft_ack_links where draft_id=p_event for share nowait;
  if found then if bound is distinct from p_history_ack then raise exception 'HISTORY_DRAFT_LINK_CONFLICT';end if;
  else insert into conveni_first_candidate.historical_draft_ack_links(draft_id,acknowledgement_id) values(p_event,p_history_ack);end if;
 end if;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Historical variants reuse the existing physical-read protocol. They are
-- private: no role can invoke them and the public review remains fenced.
do $$
declare original text;patched text;anchor text;name_ text;arg_ text;
begin
 original:=pg_get_functiondef('conveni_first_candidate.snapshot(uuid)'::regprocedure);
 anchor:='d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason);';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'HISTORICAL_SNAPSHOT_PATCH_ANCHOR';end if;
 patched:=replace(original,'conveni_first_candidate.snapshot(', 'conveni_first_candidate.historical_snapshot(');
 patched:=replace(patched,'public.prepare_conveni_unit_economic_draft(', 'conveni_first_candidate.prepare_historical_draft(');
 patched:=replace(patched,anchor,'d.monetary_citation,d.identity_citation,d.role_period_citation,d.confirmations,d.reason,(select acknowledgement_id from conveni_first_candidate.historical_draft_ack_links where draft_id=d.id));');
 execute patched;
 for name_,arg_ in select * from (values ('save_receipt','uuid,uuid,jsonb'),('find_receipt','uuid,uuid'),('visual_link_draft','uuid,uuid,uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean')) as x(name_,arg_) loop
  original:=pg_get_functiondef(('conveni_first_candidate.'||name_||'('||arg_||')')::regprocedure);
  anchor:='conveni_first_candidate.snapshot(';
  if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'HISTORICAL_RECEIPT_PATCH_ANCHOR';end if;
  patched:=replace(original,'conveni_first_candidate.'||name_||'(', 'conveni_first_candidate.historical_'||name_||'(');
  patched:=replace(patched,anchor,'conveni_first_candidate.historical_snapshot(');
  execute patched;
 end loop;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- A separate shadow commit for the visually attested PDF case. It reuses the
-- existing atomic decision/manifest/provision implementation, with a pinned
-- historical receipt and explicit human visual link. No public writes/grants.
do $$
declare original text;patched text;anchor text;replacement text;
begin
 original:=pg_get_functiondef('conveni_first_candidate.commit_economic(uuid,uuid,text,text,boolean,boolean)'::regprocedure);
 anchor:='p_economic boolean)';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_SIGNATURE_ANCHOR';end if;
 patched:=replace(original,'conveni_first_candidate.commit_economic(', 'conveni_first_candidate.commit_economic_visual(');
 patched:=replace(patched,anchor,'p_economic boolean, p_visual_link uuid)');
 patched:=replace(patched,'conveni_first_candidate.snapshot(', 'conveni_first_candidate.historical_snapshot(');
 anchor:=' -- Deliberately narrow: one simple unit, no unknown remainder or sibling';
 replacement:=$new$ if not exists(select 1 from conveni_first_candidate.visual_economic_links v where v.event_id=p_visual_link and v.draft_id=d.id and v.receipt_id=p_receipt and v.reviewer=p_actor) then raise exception 'VISUAL_LINK_REQUIRED';end if;
 perform conveni_first_candidate.historical_visual_link_draft(p_visual_link,d.id,p_receipt,
  (select monetary from conveni_first_candidate.visual_economic_links where event_id=p_visual_link),
  (select identity from conveni_first_candidate.visual_economic_links where event_id=p_visual_link),
  (select role_period from conveni_first_candidate.visual_economic_links where event_id=p_visual_link),p_actor,
  (select note from conveni_first_candidate.visual_economic_links where event_id=p_visual_link),p_social,p_economic,
  (select manifest_confirmed from conveni_first_candidate.visual_economic_links where event_id=p_visual_link));
 -- Deliberately narrow: one simple unit, no unknown remainder or sibling$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_LINK_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);
 anchor:='  or d.parent_review_id is not null'||chr(10);
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_PARENT_ANCHOR';end if;
 patched:=replace(patched,anchor,'');
 anchor:=$old$  if doc.mime_type is distinct from 'text/plain' or doc.extraction_method is distinct from 'html-basic'$old$;
 replacement:=$new$  if doc.mime_type is distinct from 'application/pdf' and (doc.mime_type is distinct from 'text/plain' or doc.extraction_method is distinct from 'html-basic'$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_SOURCE_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);
 anchor:=$old$   or artifact_->'source'->>'sha256' is distinct from artifact_->'copy'->>'sha256'
  then raise exception 'EXTRACTION_PROVENANCE_UNPROVEN';end if;$old$;
 replacement:=$new$   or artifact_->'source'->>'sha256' is distinct from artifact_->'copy'->>'sha256')
  then raise exception 'EXTRACTION_PROVENANCE_UNPROVEN';end if;
  if doc.mime_type='application/pdf' and (artifact_->'source'->>'sha256' is distinct from artifact_->'copy'->>'sha256') then raise exception 'EXTRACTION_PROVENANCE_UNPROVEN';end if;$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_DIGEST_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);
 anchor:='''kind'',''exact-utf8-bytes-v1''';
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_KIND_ANCHOR';end if;
 patched:=replace(patched,anchor, '''kind'',case when doc.mime_type=''application/pdf'' then ''human-visual-declaration-v1'' else ''exact-utf8-bytes-v1'' end,''visual_link'',p_visual_link');
 anchor:=$old$  if citation_->>'page' is distinct from '1' then raise exception 'EXACT_TEXT_PAGE_REQUIRED';end if;$old$;
 replacement:=$new$  if not exists(select 1 from public.source_documents sd where sd.id=(citation_->>'document_id')::uuid and sd.mime_type='application/pdf') and citation_->>'page' is distinct from '1' then raise exception 'EXACT_TEXT_PAGE_REQUIRED';end if;$new$;
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_PAGE_ANCHOR';end if;
 patched:=replace(patched,anchor,replacement);
 anchor:='''economic_confirmed'',p_economic,';
 if (length(patched)-length(replace(patched,anchor,'')))/length(anchor)<>1 then raise exception 'VISUAL_COMMIT_CONFIRMATION_ANCHOR';end if;
 patched:=replace(patched,anchor, '''economic_confirmed'',p_economic,''visual_link'',p_visual_link,');
 execute patched;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;


-- Candidate source: first-provision-experiment.sql
-- CLOSED candidate bridge for first provision. The public review function
-- and application grants remain unchanged until separately enabled.
create table conveni_first_candidate.first_provision_receipts(
 event_id uuid primary key,review_event_id uuid not null unique references public.conveni_review_events(id),
 draft_id uuid not null references public.conveni_unit_economic_draft_events(id),
 visual_link uuid not null references conveni_first_candidate.visual_economic_links(event_id),
 provision_id uuid not null unique references public.service_provisions(id),
 request jsonb not null,proof jsonb not null,created_at timestamptz not null default now()
);
revoke all on conveni_first_candidate.first_provision_receipts from public,anon,authenticated,service_role;
create trigger first_provision_receipts_immutable before update or delete on conveni_first_candidate.first_provision_receipts
for each row execute function conveni_first_candidate.visual_history_immutable();
do $$
declare original text;patched text;anchor text;
begin
 original:=pg_get_functiondef('public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean)'::regprocedure);
 anchor:=$re$if p_outcome='select' then\s+raise exception 'Aprovació temporalment desactivada: cal una revisió documental de l’atribució econòmica al receptor i període.';\s+end if;$re$;
 if (select count(*) from regexp_matches(original,anchor,'g'))<>2 then raise exception 'FIRST_REVIEW_BARRIER_ANCHOR';end if;
 patched:=replace(original,'public.review_conveni_unit(', 'conveni_first_candidate.review_first_impl(');
 patched:=regexp_replace(patched,anchor,'','g');
 execute patched;
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Only synthetic-test proof. Comparing after-state does not certify that a
-- stored physical object remains unmodified outside the version metadata.
create function conveni_first_candidate.first_provision_proof(p_review uuid,p_provision uuid,p_link uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate,extensions,storage set lock_timeout='1000ms' as $$
declare e public.conveni_review_events;p public.service_provisions;u public.record_units;d public.conveni_unit_economic_draft_events;
 l conveni_first_candidate.visual_economic_links;receipt_ conveni_first_candidate.receipts;item jsonb;source_ jsonb;copy_ jsonb;catalog_ jsonb;history_ jsonb;ack_ conveni_first_candidate.history_acknowledgements;
begin
 select * into strict e from public.conveni_review_events where id=p_review;
 perform 1 from public.source_records where id=e.source_record_id for update nowait;
 perform 1 from public.pipeline_jobs where source_record_id=e.source_record_id order by id for share nowait;
 select * into strict u from public.record_units where id=e.unit_id and source_record_id=e.source_record_id for update nowait;
 perform 1 from public.conveni_review_events where unit_id=u.id order by id for share nowait;
 perform 1 from public.source_documents where source_record_id=e.source_record_id order by id for share nowait;
 select * into strict p from public.service_provisions where id=p_provision and unit_id=u.id and source_record_id=e.source_record_id for share nowait;
 select * into strict l from conveni_first_candidate.visual_economic_links where event_id=p_link for share nowait;
 select * into strict d from public.conveni_unit_economic_draft_events where id=l.draft_id for share nowait;
 select * into strict receipt_ from conveni_first_candidate.receipts where event_id=l.receipt_id for share nowait;
 if d.parent_review_id is not null then
  select ack.* into strict ack_ from conveni_first_candidate.historical_draft_ack_links bind
   join conveni_first_candidate.history_acknowledgements ack on ack.event_id=bind.acknowledgement_id where bind.draft_id=d.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',old.id,'job_id',old.job_id,'outcome',old.outcome,'service_code',old.service_code,
   'reason',old.reason,'declared_actor',old.actor,'created_at',old.created_at,'previous',old.snapshot->'replay_previous',
   'snapshot_sha256',encode(extensions.digest(old.snapshot::text,'sha256'),'hex')) order by old.created_at,old.id),'[]'::jsonb)
   into history_ from public.conveni_review_events old where old.unit_id=u.id and old.id<>e.id;
  if ack_.previous_id is distinct from d.parent_review_id or ack_.snapshot->'events' is distinct from history_ then raise exception 'FIRST_HISTORY_STALE';end if;
 end if;
 if e.id is distinct from (select id from public.conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1)
  or e.outcome is distinct from 'select' or e.job_id is distinct from d.job_id or u.status is distinct from 'approved'
  or p.superseded_at is not null or p.amount is distinct from d.amount_cents::numeric/100 or p.service_code is distinct from d.service_code
  or not exists(select 1 from public.conveni_reviewed_provisions visible where visible.id=p.id)
 then raise exception 'FIRST_PROVISION_STALE';end if;
 for item in select value from jsonb_array_elements(receipt_.snapshot->'archives') loop
  source_:=item->'source';copy_:=item->'copy';
  perform 1 from storage.objects where id in ((source_->>'object_id')::uuid,(copy_->>'object_id')::uuid) order by id for share nowait;
  if not exists(select 1 from storage.objects where id=(source_->>'object_id')::uuid and bucket_id='cloud-documents' and name=source_->>'path' and version=source_->>'version' and archived_at is null)
   or not exists(select 1 from storage.objects where id=(copy_->>'object_id')::uuid and bucket_id='cloud-documents' and name=copy_->>'path' and version=copy_->>'version' and archived_at is null)
  then raise exception 'FIRST_ARCHIVE_STALE';end if;
 end loop;
 perform 1 from public.catalog_versions where id=d.catalog_version_id for share nowait;
 perform 1 from public.official_services where version_id=d.catalog_version_id order by service_code for share nowait;
 select jsonb_build_object('version',(select to_jsonb(v) from public.catalog_versions v where v.id=d.catalog_version_id),
  'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from public.official_services s where s.version_id=d.catalog_version_id)) into catalog_;
 return jsonb_build_object('review',to_jsonb(e),'provision',to_jsonb(p),'unit',to_jsonb(u),'context',public.conveni_review_replay_context(e.source_record_id,e.job_id),
  'catalog',catalog_,'receipt',to_jsonb(receipt_),'visual_link',to_jsonb(l));
end $$;

create function conveni_first_candidate.commit_first_provision(p_event uuid,p_review uuid,p_receipt uuid,p_link uuid,p_actor text,p_note text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare previous conveni_first_candidate.first_provision_receipts;l conveni_first_candidate.visual_economic_links;
 d public.conveni_unit_economic_draft_events;u public.record_units;p public.service_provisions;request_ jsonb;proof_ jsonb;expected_path text;first_doc uuid;
begin
 request_:=jsonb_build_object('review',p_review,'receipt',p_receipt,'link',p_link,'actor',p_actor,'note',p_note);
 select * into previous from conveni_first_candidate.first_provision_receipts where event_id=p_event for share nowait;
 if found then
  if previous.request is distinct from request_ or previous.review_event_id is distinct from p_review or previous.visual_link is distinct from p_link then raise exception 'FIRST_EVENT_REUSED';end if;
  proof_:=conveni_first_candidate.first_provision_proof(previous.review_event_id,previous.provision_id,previous.visual_link);
  if proof_ is distinct from previous.proof then raise exception 'FIRST_REPLAY_STALE';end if;
  return jsonb_build_object('event_id',p_event,'provision_id',previous.provision_id,'synthetic_only',true);
 end if;
 select * into strict l from conveni_first_candidate.visual_economic_links where event_id=p_link and receipt_id=p_receipt for share nowait;
 select * into strict d from public.conveni_unit_economic_draft_events where id=l.draft_id;
 -- This shadow commit verifies all input, source/copy, historical and human
 -- declarations in the same transaction before any public table write.
 perform conveni_first_candidate.commit_economic_visual(p_event,p_receipt,p_actor,p_note,true,true,p_link);
 select * into strict u from public.record_units where id=d.unit_id and source_record_id=d.source_record_id for update;
 if exists(select 1 from public.service_provisions where unit_id=u.id) then raise exception 'FIRST_PROVISION_ONLY';end if;
 first_doc:=(d.proposal_snapshot->'evidence'->0->>'document_id')::uuid;
 select value->'copy'->>'path' into expected_path from jsonb_array_elements((select snapshot->'archives' from conveni_first_candidate.receipts where event_id=p_receipt)) where value->>'documentId'=first_doc::text;
 if expected_path is null or (u.storage_path is not null and u.storage_path is distinct from expected_path)
  or (u.storage_sha256 is not null and u.storage_sha256 is distinct from (select storage_sha256 from public.source_documents where id=first_doc))
 then raise exception 'FIRST_EXISTING_COPY_CONFLICT';end if;
 perform conveni_first_candidate.review_first_impl(d.source_record_id,d.job_id,d.unit_id,p_review,d.parent_review_id,'select',d.service_code,p_note,true);
 select * into strict p from public.service_provisions where unit_id=u.id;
 proof_:=conveni_first_candidate.first_provision_proof(p_review,p.id,p_link);
 insert into conveni_first_candidate.first_provision_receipts(event_id,review_event_id,draft_id,visual_link,provision_id,request,proof)
 values(p_event,p_review,d.id,p_link,p.id,request_,proof_);
 return jsonb_build_object('event_id',p_event,'provision_id',p.id,'synthetic_only',true);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Read-only candidate projection. It makes an invalidated first provision
-- disappear from this private view without touching historical provisions.
-- It does not replace product views or make exports transactionally atomic.
create function conveni_first_candidate.first_provision_current(p_provision uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public,conveni_first_candidate,extensions,storage as $$
 select exists(
  select 1 from conveni_first_candidate.first_provision_receipts f
  join public.conveni_review_events e on e.id=f.review_event_id
  join public.service_provisions p on p.id=f.provision_id
  join public.record_units u on u.id=e.unit_id
  join public.conveni_unit_economic_draft_events d on d.id=f.draft_id
  join conveni_first_candidate.visual_economic_links l on l.event_id=f.visual_link
  join conveni_first_candidate.receipts rc on rc.event_id=l.receipt_id
  left join conveni_first_candidate.historical_draft_ack_links dl on dl.draft_id=d.id
  left join conveni_first_candidate.history_acknowledgements ack on ack.event_id=dl.acknowledgement_id
  where p.id=p_provision and p.unit_id=u.id and p.source_record_id=e.source_record_id and p.superseded_at is null
   and e.outcome='select' and e.id=(select id from public.conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1)
   and f.proof->'review'=to_jsonb(e) and f.proof->'provision'=to_jsonb(p) and f.proof->'unit'=to_jsonb(u)
   and f.proof->>'context'=public.conveni_review_replay_context(e.source_record_id,e.job_id)
   and f.proof->'receipt'=to_jsonb(rc) and f.proof->'visual_link'=to_jsonb(l)
   and f.proof->'catalog'=jsonb_build_object('version',(select to_jsonb(v) from public.catalog_versions v where v.id=d.catalog_version_id),
    'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.service_code),'[]'::jsonb) from public.official_services s where s.version_id=d.catalog_version_id))
   and ((d.parent_review_id is null and dl.draft_id is null and not exists(select 1 from public.conveni_review_events old where old.unit_id=u.id and old.id<>e.id))
    or (d.parent_review_id is not null and ack.previous_id=d.parent_review_id
   and ack.snapshot->'events'=(select coalesce(jsonb_agg(jsonb_build_object('id',old.id,'job_id',old.job_id,'outcome',old.outcome,'service_code',old.service_code,
    'reason',old.reason,'declared_actor',old.actor,'created_at',old.created_at,'previous',old.snapshot->'replay_previous',
    'snapshot_sha256',encode(extensions.digest(old.snapshot::text,'sha256'),'hex')) order by old.created_at,old.id),'[]'::jsonb)
    from public.conveni_review_events old where old.unit_id=u.id and old.id<>e.id)))
   and not exists(select 1 from jsonb_array_elements(rc.snapshot->'archives') a where
    not exists(select 1 from storage.objects so where so.id=(a->'source'->>'object_id')::uuid and so.bucket_id='cloud-documents' and so.name=a->'source'->>'path' and so.version=a->'source'->>'version' and so.archived_at is null)
    or not exists(select 1 from storage.objects co where co.id=(a->'copy'->>'object_id')::uuid and co.bucket_id='cloud-documents' and co.name=a->'copy'->>'path' and co.version=a->'copy'->>'version' and co.archived_at is null))
 )
$$;
create view conveni_first_candidate.verified_provision_candidate as
 select p.* from public.conveni_reviewed_provisions p
 where not exists(select 1 from conveni_first_candidate.first_provision_receipts f where f.provision_id=p.id)
  or conveni_first_candidate.first_provision_current(p.id);
revoke all on conveni_first_candidate.verified_provision_candidate from public,anon,authenticated,service_role;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

-- Export candidate for one new provision, no network or user-facing route.
-- The XLSX is generated outside SQL from the returned row; finalize compares
-- the full proof again and saves the exact snapshot and hash atomically.
create table conveni_first_candidate.first_export_receipts(
 event_id uuid primary key, provision_id uuid not null references public.service_provisions(id),
 content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),snapshot jsonb not null,
 created_at timestamptz not null default now()
);
revoke all on conveni_first_candidate.first_export_receipts from public,anon,authenticated,service_role;
create trigger first_export_receipts_immutable before update or delete on conveni_first_candidate.first_export_receipts
for each row execute function conveni_first_candidate.visual_history_immutable();
create function conveni_first_candidate.first_export_snapshot(p_provision uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare f conveni_first_candidate.first_provision_receipts;p public.service_provisions;proof_ jsonb;
begin
 select * into strict f from conveni_first_candidate.first_provision_receipts where provision_id=p_provision for share nowait;
 proof_:=conveni_first_candidate.first_provision_proof(f.review_event_id,f.provision_id,f.visual_link);
 if proof_ is distinct from f.proof or not conveni_first_candidate.first_provision_current(p_provision) then raise exception 'FIRST_EXPORT_STALE';end if;
 select * into strict p from public.service_provisions where id=p_provision for share nowait;
 return jsonb_build_object('provision',to_jsonb(p),'proof',proof_);
end $$;
create function conveni_first_candidate.first_export_finalize(p_event uuid,p_provision uuid,p_snapshot jsonb,p_hash text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,conveni_first_candidate set lock_timeout='1000ms' as $$
declare current_ jsonb;existing conveni_first_candidate.first_export_receipts;
begin
 if p_event is null or p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception 'FIRST_EXPORT_INVALID';end if;
 current_:=conveni_first_candidate.first_export_snapshot(p_provision);
 if current_ is distinct from p_snapshot then raise exception 'FIRST_EXPORT_STALE';end if;
 select * into existing from conveni_first_candidate.first_export_receipts where event_id=p_event for update nowait;
 if found then
  if existing.provision_id is distinct from p_provision or existing.content_hash is distinct from p_hash or existing.snapshot is distinct from current_ then raise exception 'FIRST_EXPORT_EVENT_REUSED';end if;
  return to_jsonb(existing);
 end if;
 insert into conveni_first_candidate.first_export_receipts(event_id,provision_id,content_hash,snapshot) values(p_event,p_provision,p_hash,current_) returning * into existing;
 return to_jsonb(existing);
end $$;
revoke all on all functions in schema conveni_first_candidate from public,anon,authenticated,service_role;

