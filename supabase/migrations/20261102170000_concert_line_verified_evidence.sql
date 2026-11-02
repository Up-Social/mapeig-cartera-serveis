-- REVIEW DRAFT: never apply blindly. A separate production authorization,
-- complete contract tests and comparison with the live schema remain required.
-- No Vercel variables or external Storage objects are changed by this script.
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$ begin
 if exists(select 1 from public.concert_line_award_decisions) then raise exception 'LINE_LEDGER_NOT_EMPTY_REQUIRES_REVIEW';end if;
end $$;
-- PROTOTYPE ONLY. No grants, flags, production deployment or review decisions.
-- Input transport limits, full ledger integration and concurrency remain unverified.
create schema concert_line_evidence_v1;
revoke all on schema concert_line_evidence_v1 from public, anon, authenticated, service_role;

create table concert_line_evidence_v1.blobs (
 sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
 body bytea not null check (octet_length(body) between 1 and 16777216),
 created_at timestamptz not null default now()
);
create table concert_line_evidence_v1.bindings (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.source_records(id),
 job_id uuid not null references public.pipeline_jobs(id),
 unit_id uuid not null references public.record_units(id),
 document_id uuid not null references public.source_documents(id),
 sha256 text not null references concert_line_evidence_v1.blobs(sha256),
 extraction_hash text not null, snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique (record_id,job_id,unit_id,document_id,sha256,extraction_hash,snapshot)
);
alter table concert_line_evidence_v1.blobs enable row level security;
alter table concert_line_evidence_v1.bindings enable row level security;
revoke all on all tables in schema concert_line_evidence_v1 from public, anon, authenticated, service_role;
create function concert_line_evidence_v1.immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'CONCERT_BYTES_IMMUTABLE'; end $$;
create trigger immutable_blob before update or delete on concert_line_evidence_v1.blobs for each row execute function concert_line_evidence_v1.immutable();
create trigger immutable_binding before update or delete on concert_line_evidence_v1.bindings for each row execute function concert_line_evidence_v1.immutable();

-- A manifest is untrusted input. Locks and a fresh server-side snapshot must
-- match before a byte is accepted. Metadata locks cannot freeze Storage bytes.
create function concert_line_evidence_v1.retain(p_record uuid,p_job uuid,p_unit uuid,p_snapshot jsonb,p_base64 text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare d public.source_documents; u public.record_units; current_ jsonb; b bytea; sha_ text; old_ bytea;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'CONCERT_BYTES_ISOLATION'; end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object' or p_base64 is null
  or length(p_base64)>22369624 or length(p_base64)%4<>0 or p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$'
 then raise exception 'CONCERT_BYTES_INPUT'; end if;
 perform 1 from public.source_records where id=p_record and financing_type='concert' for update;
 if not found then raise exception 'CONCERT_BYTES_SCOPE'; end if;
 -- Match the ledger's record-first fence: a different job can change which
 -- job is current even when the selected job itself is unchanged.
 perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;
 perform 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record and not verification_only for update;
 if not found then raise exception 'CONCERT_BYTES_SCOPE'; end if;
 select * into u from public.record_units where id=p_unit and source_record_id=p_record for update;
 if not found then raise exception 'CONCERT_BYTES_SCOPE'; end if;
 perform 1 from public.record_units where source_record_id=p_record order by id for share nowait;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share nowait;
 select * into d from public.source_documents where id=u.document_id and source_record_id=p_record and status='fetched' and extraction_partial=false;
 if not found or d.extracted_text is null or d.extracted_text_hash is null
  or d.extracted_text_hash is distinct from encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
 then raise exception 'CONCERT_BYTES_EXTRACTION'; end if;
 -- Pin both object versions to the manifest while refreshing the complete snapshot.
 perform 1 from storage.objects where id::text=p_snapshot->>'source_object' and archived_at is null for share nowait;
 if not found then raise exception 'CONCERT_BYTES_STALE'; end if;
 perform 1 from storage.objects where id::text=p_snapshot->>'item_object' and archived_at is null for share nowait;
 if not found then raise exception 'CONCERT_BYTES_STALE'; end if;
 current_:=public.concert_line_award_archive_snapshot(p_record,p_job,p_unit);
 if current_ is null or current_ is distinct from p_snapshot
  or current_->>'document_id' is distinct from d.id::text
  or current_->>'document_sha256' is distinct from d.storage_sha256
  or current_->>'unit_sha256' is distinct from d.storage_sha256
  or current_->>'population_event' is null
  or current_->>'source_object'=current_->>'item_object'
  or d.storage_sha256 !~ '^[a-f0-9]{64}$'
 then raise exception 'CONCERT_BYTES_STALE'; end if;
 begin b:=decode(p_base64,'base64'); exception when others then raise exception 'CONCERT_BYTES_INPUT'; end;
 if octet_length(b) not between 1 and 16777216 then raise exception 'CONCERT_BYTES_LIMIT'; end if;
 sha_:=encode(extensions.digest(b,'sha256'),'hex');
 if sha_ is distinct from d.storage_sha256 then raise exception 'CONCERT_BYTES_HASH'; end if;
 insert into concert_line_evidence_v1.blobs(sha256,body) values(sha_,b) on conflict (sha256) do nothing;
 select body into strict old_ from concert_line_evidence_v1.blobs where sha256=sha_ for share;
 if old_ is distinct from b or encode(extensions.digest(old_,'sha256'),'hex') is distinct from sha_ then raise exception 'CONCERT_BYTES_COLLISION'; end if;
 insert into concert_line_evidence_v1.bindings(record_id,job_id,unit_id,document_id,sha256,extraction_hash,snapshot)
 values(p_record,p_job,p_unit,d.id,sha_,d.extracted_text_hash,current_) on conflict do nothing;
 return sha_;
end $$;
revoke all on all functions in schema concert_line_evidence_v1 from public, anon, authenticated, service_role;

-- PostgREST needs an exposed-schema wrapper. This prototype grants no role
-- permission; authorization is a separate rollout step after full validation.
create function public.concert_line_retain_archive(p_record uuid,p_job uuid,p_unit uuid,p_snapshot jsonb,p_base64 text)
returns text language sql security definer set search_path=pg_catalog as $$
 select concert_line_evidence_v1.retain(p_record,p_job,p_unit,p_snapshot,p_base64)
$$;
revoke all on function public.concert_line_retain_archive(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

-- PROTOTYPE ONLY: requires concert-byte-retention-candidate.sql.
-- The caller must already hold the decision's record, job, unit, document and
-- Storage metadata locks. Reader projections and rollout are NOT integrated.
create function concert_line_evidence_v1.valid_for_decision(p_record uuid,p_job uuid,p_unit uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists (
  select 1 from concert_line_evidence_v1.bindings x
  join concert_line_evidence_v1.blobs b on b.sha256=x.sha256
  join public.record_units u on u.id=x.unit_id and u.source_record_id=x.record_id and u.document_id=x.document_id
  join public.source_documents d on d.id=x.document_id and d.source_record_id=x.record_id
  where x.record_id=p_record and x.job_id=p_job and x.unit_id=p_unit
   and x.sha256=d.storage_sha256 and x.sha256=u.storage_sha256
   and x.extraction_hash=d.extracted_text_hash
   and d.extracted_text_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
   -- The decision head changes after a successful write. The ledger validates
   -- that head independently, including idempotent replays after a timeout.
   and (x.snapshot-'previous_decision'-'previous_decision_parent')=
       (public.concert_line_award_archive_snapshot(p_record,p_job,p_unit)-'previous_decision'-'previous_decision_parent')
   and encode(extensions.digest(b.body,'sha256'),'hex')=x.sha256
 )
$$;
revoke all on function concert_line_evidence_v1.valid_for_decision(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- A decision references the specific retained copy, so later population
-- observations cannot silently replace its evidence or invalidate funding.
create table concert_line_evidence_v1.decision_evidence (
 decision_id uuid primary key references public.concert_line_award_decisions(id),
 binding_id uuid not null references concert_line_evidence_v1.bindings(id),
 created_at timestamptz not null default now()
);
alter table concert_line_evidence_v1.decision_evidence enable row level security;
revoke all on concert_line_evidence_v1.decision_evidence from public,anon,authenticated,service_role;
create trigger immutable_decision_evidence before update or delete on concert_line_evidence_v1.decision_evidence for each row execute function concert_line_evidence_v1.immutable();

create function concert_line_evidence_v1.link_decision(p_decision uuid,p_record uuid,p_job uuid,p_unit uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare binding_ uuid;
begin
 if not concert_line_evidence_v1.valid_for_decision(p_record,p_job,p_unit) then raise exception 'LINE_RETAINED_BYTES_REQUIRED';end if;
 select x.id into binding_ from concert_line_evidence_v1.bindings x
 join public.record_units u on u.id=x.unit_id and u.source_record_id=x.record_id and u.document_id=x.document_id
 join public.source_documents d on d.id=x.document_id and d.source_record_id=x.record_id
 where x.record_id=p_record and x.job_id=p_job and x.unit_id=p_unit and x.sha256=d.storage_sha256
  and x.extraction_hash=d.extracted_text_hash
  and (x.snapshot-'previous_decision'-'previous_decision_parent')=
      (public.concert_line_award_archive_snapshot(p_record,p_job,p_unit)-'previous_decision'-'previous_decision_parent')
 order by x.created_at,x.id limit 1;
 if binding_ is null then raise exception 'LINE_RETAINED_BYTES_REQUIRED';end if;
 insert into concert_line_evidence_v1.decision_evidence(decision_id,binding_id) values(p_decision,binding_);
end $$;
revoke all on function concert_line_evidence_v1.link_decision(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $$
declare original text; patched text;
 anchor constant text := 'if d.storage_path is null';
 replacement constant text := $patch$if not concert_line_evidence_v1.valid_for_decision(p_record,p_job,p_unit) then raise exception 'LINE_RETAINED_BYTES_REQUIRED'; end if;
 if d.storage_path is null$patch$;
 link_anchor constant text := ' update public.record_units set status=''approved'',review_note=p_note,reviewed_at=now() where id=u.id;';
 replay_anchor constant text := '  return existing.id;';
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_BYTES_ANCHOR_MISMATCH';end if;
 if (length(original)-length(replace(original,link_anchor,'')))/length(link_anchor)<>1
  or (length(original)-length(replace(original,replay_anchor,'')))/length(replay_anchor)<>1 then raise exception 'LINE_BYTES_LINK_ANCHOR_MISMATCH';end if;
 patched:=replace(original,anchor,replacement);
 patched:=replace(patched,link_anchor,' perform concert_line_evidence_v1.link_decision(p_decision,p_record,p_job,p_unit);'||E'\n'||link_anchor);
 patched:=replace(patched,replay_anchor,'  if not exists(select 1 from concert_line_evidence_v1.decision_evidence where decision_id=existing.id) then raise exception ''LINE_RETAINED_BYTES_REQUIRED'';end if;'||E'\n'||replay_anchor);
 execute patched;
end $$;

-- PROTOTYPE ONLY: normalization limited to a specific diagnostic annex
-- when used by the candidate decision patch below. No global function changes.
create function public.concert_diagnostic_page_quote(p_text text,p_page integer,p_quote text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare header_ text;tail_ text;q_ text;all_pages integer[];location_ integer;
 annex_start_ integer;annex_end_ integer;page_start_ integer;page_end_ integer;next_page_ integer;marker_ text;
begin
 if p_text is null or p_page is null or p_page<1 or p_quote is null
  or p_quote~E'[\\r\\n]' or length(p_quote)<40 or length(p_quote)>1000 then return false;end if;
 select array_agg((m[1])::integer) into all_pages from regexp_matches(p_text,E'(?n)^## Pàgina ([0-9]+)[[:blank:]]*$', 'g') m;
 if all_pages is null or array_length(all_pages,1)<>(select count(distinct a) from unnest(all_pages)a)
  or p_text !~ E'^## Pàgina [0-9]+[[:blank:]]*\\n' then return false;end if;
 if (select count(*) from regexp_matches(p_text,E'(?ni)^[[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]+Serveis[[:blank:]]+assignats[[:blank:]]*$', 'g'))<>1
  or (select count(*) from regexp_matches(p_text,E'(?ni)^[[:blank:]]*ANNEX[[:blank:]]+2\\y', 'g'))<>1 then return false;end if;
 marker_:=(regexp_match(p_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]+Serveis[[:blank:]]+assignats[[:blank:]]*)$'))[1];
 annex_start_:=position(marker_ in p_text);
 marker_:=(regexp_match(p_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+2\\y)'))[1];
 annex_end_:=position(marker_ in p_text);
 if annex_start_=0 or annex_end_<=annex_start_ then return false;end if;
 header_:='## Pàgina '||p_page::text||E'\n';
 if position(header_ in p_text)=0 then return false;end if;
 page_start_:=position(header_ in p_text)+length(header_);
 next_page_:=position(E'\n## Pàgina ' in substring(p_text from page_start_));
 page_end_:=case when next_page_=0 then length(p_text)+1 else page_start_+next_page_-1 end;
 if page_start_>=annex_end_ or page_end_<=annex_start_ then return false;end if;
 tail_:=substring(p_text from greatest(page_start_,annex_start_) for least(page_end_,annex_end_)-greatest(page_start_,annex_start_));
 if tail_ !~* E'\\yNIF\\y' or tail_ !~* E'\\yRESES\\y' or tail_ !~* 'cartera'
  or tail_ !~* 'sense IVA' or tail_ !~* 'amb IVA' or p_quote !~* E'\\yImport[[:space:]]+total\\y' then return false;end if;
 tail_:=regexp_replace(tail_,'[[:space:]]+',' ','g');
 q_:=regexp_replace(p_quote,'[[:space:]]+',' ','g');
 location_:=position(q_ in tail_);
 return location_>0 and position(q_ in substring(tail_ from location_+length(q_)))=0;
end $$;
revoke all on function public.concert_diagnostic_page_quote(text,integer,text) from public,anon,authenticated,service_role;

do $$
declare original text; patched text;
 anchor constant text := 'not public.concert_population_on_page(d.extracted_text,u.page,p_quote)';
 replacement constant text := $patch$(not public.concert_population_on_page(d.extracted_text,u.page,p_quote) and not (
 u.unit_key like ('official-annex:'||d.storage_sha256||':0:%')
 and public.concert_diagnostic_page_quote(d.extracted_text,u.page,p_quote)
 ))$patch$;
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_DIAGNOSTIC_PAGE_ANCHOR_MISMATCH';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;

-- Candidate only: keeps individual economic review disabled and grants no
-- execution permissions. The caller's page, quote, amount, code and Storage
-- checks remain unchanged. Requires separate validation before deployment.
create function public.concert_diagnostic_provider_evidence(p_text text,p_quote text,p_provider text,p_nif text,p_reses text)
returns boolean language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(
  char_length(trim(p_provider))>=6
  and p_nif ~ '^[A-Z][0-9]{7}[0-9A-Z]$'
  and p_reses ~ '^S[0-9]{5}$'
  and position(p_nif in p_quote)>0 and position(p_reses in p_quote)>0
  and (
   position('de l’entitat '||trim(p_provider)||' (CIF: '||p_nif||')' in regexp_replace(p_text,'\s+',' ','g'))>0
   or position('de l''entitat '||trim(p_provider)||' (CIF: '||p_nif||')' in regexp_replace(p_text,'\s+',' ','g'))>0
  ),false)
$$;
revoke all on function public.concert_diagnostic_provider_evidence(text,text,text,text,text) from public,anon,authenticated,service_role;

do $$
declare original text; patched text;
 anchor constant text := 'or position(coalesce(u.provider_name,u.observed_provider_name) in p_quote)=0';
 replacement constant text := $patch$or (position(coalesce(u.provider_name,u.observed_provider_name) in p_quote)=0 and not (
  u.unit_key like ('official-annex:'||d.storage_sha256||':0:%')
  and public.concert_diagnostic_provider_evidence(d.extracted_text,p_quote,coalesce(u.provider_name,u.observed_provider_name),u.provider_nif,u.reses_code)
 ))$patch$;
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_PROVIDER_ANCHOR_MISMATCH';end if;
 patched:=replace(original,anchor,replacement);
 execute patched;
end $$;

-- PROTOTYPE ONLY. Existing rows from the legacy service_provisions branch are
-- unaffected. The line branch must call this with its own decision ID.
-- Physical Storage object metadata is still checked by the existing view.
create function concert_line_evidence_v1.current_for_decision(p_decision uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists (
  select 1 from public.concert_line_award_decisions x
  join concert_line_evidence_v1.decision_evidence e on e.decision_id=x.id
  join concert_line_evidence_v1.bindings y on y.id=e.binding_id
  join concert_line_evidence_v1.blobs b on b.sha256=y.sha256
  join public.record_units u on u.id=x.unit_id and u.source_record_id=x.source_record_id and u.document_id=y.document_id
  join public.source_documents d on d.id=y.document_id and d.source_record_id=x.source_record_id
  where x.id=p_decision and y.record_id=x.source_record_id and y.job_id=x.job_id and y.unit_id=x.unit_id
   and y.sha256=d.storage_sha256 and y.sha256=u.storage_sha256
   and y.extraction_hash=d.extracted_text_hash
   and y.extraction_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
   and y.snapshot->>'source_object'=x.source_object_id::text and y.snapshot->>'source_version'=x.source_version
   and y.snapshot->>'item_object'=x.item_object_id::text and y.snapshot->>'item_version'=x.item_version
   and encode(extensions.digest(b.body,'sha256'),'hex')=y.sha256
 )
$$;
revoke all on function concert_line_evidence_v1.current_for_decision(uuid) from public,anon,authenticated,service_role;
-- A change to the latest population event is intentionally not a predicate:
-- it updates the population field without erasing a previously approved amount.
do $$
declare original text;patched text;
 anchor constant text := 'AND x.unit_fingerprint = concert_population_unit_hash(u.*)';
begin
 original:=pg_get_viewdef('public.concert_line_financing_projection'::regclass,true);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_BYTES_PROJECTION_ANCHOR_MISMATCH';end if;
 patched:=replace(original,anchor,anchor||' AND concert_line_evidence_v1.current_for_decision(x.id)');
 execute 'create or replace view public.concert_line_financing_projection as '||patched;
end $$;

-- ISOLATED GENERAL-FORMAT PROTOTYPE ONLY. Not a migration; no grants.
-- Accepts only complete diagnostic annexes with one service table per page.
-- Requires the separately reviewed candidate public.concert_diagnostic_page_quote.
-- This verifies a documentary reconciliation, not a decision, physical Storage
-- bytes, original provenance, a payment, or current economic entitlement.
create schema concert_diagnostic_reconciliation_v1;
revoke all on schema concert_diagnostic_reconciliation_v1 from public,anon,authenticated,service_role;

create table concert_diagnostic_reconciliation_v1.reports (
 record_id uuid not null references public.source_records(id),
 job_id uuid not null references public.pipeline_jobs(id),
 document_id uuid not null references public.source_documents(id),
 revision bigint not null,input_hash text not null,
 document_sha256 text not null,text_sha256 text not null,extraction_id uuid not null,
 maximum_net_cents bigint not null,calculated_net_cents bigint not null,calculated_gross_cents bigint not null,
 unit_proof jsonb not null,created_at timestamptz not null default now(),
 primary key(record_id,revision)
);
alter table concert_diagnostic_reconciliation_v1.reports enable row level security;
revoke all on concert_diagnostic_reconciliation_v1.reports from public,anon,authenticated,service_role;
create function concert_diagnostic_reconciliation_v1.immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin raise exception 'DIAGNOSTIC_REPORT_IMMUTABLE'; end $$;
create trigger immutable_report before update or delete on concert_diagnostic_reconciliation_v1.reports for each row execute function concert_diagnostic_reconciliation_v1.immutable();

-- Hash every source document and every unit; only human review state is
-- excluded, except that a transition to an ineligible review state invalidates
-- the report. The current-read function also checks the latest job.
create function concert_diagnostic_reconciliation_v1.input_hash(p_record uuid,p_job uuid,p_document uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'record',jsonb_build_object('title',r.title,'financing_type',r.financing_type),
  'job_id',p_job,'document_id',p_document,
  'documents',(select coalesce(jsonb_agg(to_jsonb(d)-'updated_at' order by d.id),'[]'::jsonb) from public.source_documents d where d.source_record_id=p_record),
  'units',(select coalesce(jsonb_agg((to_jsonb(u)-array['status','review_note','reviewed_at','updated_at'])||jsonb_build_object('reviewable_award_state',u.status in ('draft','approved')) order by u.id),'[]'::jsonb) from public.record_units u where u.source_record_id=p_record)
 )::text,'UTF8'),'sha256'),'hex') from public.source_records r where r.id=p_record
$$;

-- Read only the newest revision, checking current inputs and latest job. A
-- change reverted exactly before another reconciliation can match an older
-- report; whether that is acceptable needs explicit design. This is a document
-- observation, not an approval, Storage-byte assertion or export authorisation.
create function concert_diagnostic_reconciliation_v1.current_report(p_record uuid,p_job uuid,p_document uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('revision',report.revision,'maximum_net_cents',report.maximum_net_cents,
  'calculated_net_cents',report.calculated_net_cents,'calculated_gross_cents',report.calculated_gross_cents,'unit_proof',report.unit_proof)
 from concert_diagnostic_reconciliation_v1.reports report
 join public.source_records r on r.id=report.record_id and r.financing_type='concert'
 join public.pipeline_jobs j on j.id=report.job_id and j.source_record_id=r.id and not j.verification_only
 where report.record_id=p_record and report.job_id=p_job and report.document_id=p_document
  and report.revision=(select max(x.revision) from concert_diagnostic_reconciliation_v1.reports x where x.record_id=p_record)
  and j.id=(select x.id from public.pipeline_jobs x where x.source_record_id=p_record and not x.verification_only order by x.created_at desc,x.id desc limit 1)
  and j.status in ('needs_review','insufficient_evidence','approved','corrected')
  and report.input_hash=concert_diagnostic_reconciliation_v1.input_hash(p_record,p_job,p_document)
$$;

-- Values are bounded before converting to bigint, with no floating point.
create function concert_diagnostic_reconciliation_v1.cents(p text) returns bigint
language plpgsql immutable set search_path=pg_catalog as $$
declare n numeric;
begin
 if p is null or p !~ '^[0-9]{1,3}([.][0-9]{3})*,[0-9]{2}$' then return null;end if;
 n:=replace(replace(p,'.',''),',','.')::numeric*100;
 if n>9007199254740991 then return null;end if;
 return n::bigint;
end $$;

create function concert_diagnostic_reconciliation_v1.reconcile(p_record uuid,p_job uuid,p_document uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.source_records;j public.pipeline_jobs;d public.source_documents;u public.record_units;
 a1 text;a2 text;scope_ text;operative text;maximum_match text[];matches text[];line_ text;
 pstart integer;pend integer;next_page integer;tail_ text;normalized_quote text;
 source_rows integer;total_rows integer:=0;unit_count integer;all_source_rows integer;matched_source_rows integer:=0;net_ bigint;gross_ bigint;maximum_ bigint;
 line_net bigint;line_gross bigint;line_net_sum bigint;line_gross_sum bigint;line_amounts text[][];
 net_sum bigint:=0;gross_sum bigint:=0;proof_ jsonb:='[]'::jsonb;new_ jsonb;old_ jsonb;
 current_hash text;previous_hash text;previous_job uuid;previous_document uuid;previous_revision bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'DIAGNOSTIC_ISOLATION';end if;
 select * into strict r from public.source_records where id=p_record and financing_type='concert' for update;
 perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;
 select * into strict j from public.pipeline_jobs where id=p_job and source_record_id=p_record and not verification_only for update;
 if j.id is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1)
  or j.status not in ('needs_review','insufficient_evidence','approved','corrected') then raise exception 'DIAGNOSTIC_JOB';end if;
 perform 1 from public.record_units where source_record_id=p_record order by id for share nowait;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share nowait;
 select * into strict d from public.source_documents where id=p_document and source_record_id=p_record and status='fetched';
 -- Require content-addressed source metadata and an independently checked
 -- extraction hash. Physical Storage bytes remain a separate obligation.
 if d.storage_sha256 is null or d.storage_sha256 !~ '^[a-f0-9]{64}$'
  or d.extracted_text is null or d.extracted_text_hash is null or d.extracted_text_hash !~ '^[a-f0-9]{64}$'
  or d.extracted_text_hash is distinct from encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
  or d.active_extraction_id is null or d.extraction_partial is distinct from false
  or d.extraction_method is distinct from 'pdf-text-markdown-v2'
  or d.extraction_coverage->>'complete' is distinct from 'true' or d.mime_type is distinct from 'application/pdf'
  or d.storage_path is distinct from ('cases/'||p_record||'/documents/'||d.id||'/'||d.storage_sha256||'.pdf')
  or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
 then raise exception 'DIAGNOSTIC_SOURCE';end if;
 if (select count(*) from public.source_documents where source_record_id=p_record and status='fetched' and mime_type like '%pdf%')<>1 then raise exception 'DIAGNOSTIC_DOCUMENT_COUNT';end if;
 if (select count(*) from regexp_matches(d.extracted_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]+Serveis[[:blank:]]+assignats[[:blank:]]*)$','g'))<>1
  or (select count(*) from regexp_matches(d.extracted_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+2\\y)','g'))<>1
  or (select count(*) from regexp_matches(d.extracted_text,E'\\yRESOLC[[:space:]]*:','gi'))<>1 then raise exception 'DIAGNOSTIC_MARKERS';end if;
 a1:=(regexp_match(d.extracted_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]+Serveis[[:blank:]]+assignats[[:blank:]]*)$'))[1];
 a2:=(regexp_match(d.extracted_text,E'(?ni)^([[:blank:]]*ANNEX[[:blank:]]+2\\y)'))[1];
 if position(a1 in d.extracted_text)=0 or position(a2 in d.extracted_text)<=position(a1 in d.extracted_text) then raise exception 'DIAGNOSTIC_MARKERS';end if;
 scope_:=substring(d.extracted_text from position(a1 in d.extracted_text) for position(a2 in d.extracted_text)-position(a1 in d.extracted_text));
 operative:=regexp_replace(substring(d.extracted_text from position('RESOLC' in d.extracted_text) for position(a1 in d.extracted_text)-position('RESOLC' in d.extracted_text)),'[[:space:]]+',' ','g');
 if position('RESOLC' in d.extracted_text)=0 or position('RESOLC' in d.extracted_text)>=position(a1 in d.extracted_text) then raise exception 'DIAGNOSTIC_RESOLC';end if;
 -- A proposal, correction or other subsequent act cannot become an award
 -- merely because an older award is quoted in its text.
 if r.title is null or r.title ~* E'\\y(proposta|esmena|rectificaci|cessi[oó]|cessament|convalidaci|recurs|pr[oò]rrog|modificaci|ampliaci)'
  or operative !~* E'^RESOLC[[:space:]]*:[[:space:]]*([0-9]+[.)][[:space:]]*)?(assignar|adjudicar|atorgar|aprovar[[:space:]]+la[[:space:]]+provisi[oó])\\y'
 then raise exception 'DIAGNOSTIC_ACT';end if;
 if (select count(*) from regexp_matches(operative,E'\\yimport[[:space:]]+total[[:space:]]+m[aà]xim[[:space:]]+de[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]*€[[:space:]]*,?[[:space:]]+sense[[:space:]]+IVA\\y','gi'))<>1 then raise exception 'DIAGNOSTIC_MAXIMUM';end if;
 maximum_match:=regexp_match(operative,E'\\yimport[[:space:]]+total[[:space:]]+m[aà]xim[[:space:]]+de[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]*€[[:space:]]*,?[[:space:]]+sense[[:space:]]+IVA\\y','i');
 maximum_:=concert_diagnostic_reconciliation_v1.cents(maximum_match[1]);
 if maximum_ is null then raise exception 'DIAGNOSTIC_MAXIMUM';end if;
 -- All subtotal labels, including malformed ones, must correspond to the two
 -- monetary pairs; an ignored, additional subtotal fails closed.
 select count(*)::integer into unit_count from public.record_units where source_record_id=p_record and unit_key<>'legacy';
 if unit_count<1 or unit_count>1000 then raise exception 'DIAGNOSTIC_UNIT_COUNT';end if;
 if (select count(*) from regexp_matches(scope_,E'\\yImport[[:space:]]+total\\y','gi'))<>unit_count
  or (select count(*) from regexp_matches(scope_,E'\\yImport[[:space:]]+total[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros','gi'))<>unit_count
 then raise exception 'DIAGNOSTIC_TOTAL_COUNT';end if;
 -- Distinct pages are a prerequisite: a page with two independent tables is
 -- ambiguous for this narrow parser and must remain pending.
 if (select count(distinct page) from public.record_units where source_record_id=p_record and unit_key<>'legacy')<>unit_count then raise exception 'DIAGNOSTIC_PAGE_COUNT';end if;
 if (select count(distinct (provider_nif,reses_code)) from public.record_units where source_record_id=p_record and unit_key<>'legacy')<>unit_count then raise exception 'DIAGNOSTIC_DUPLICATE_IDENTITY';end if;
 -- A line mentioning an NIF, a RESES or a budget entry is a candidate row;
 -- extra rows without a recognisable complete identity must fail closed.
 select count(*)::integer into all_source_rows from regexp_split_to_table(scope_,E'\n') as parts(line_text)
 where parts.line_text~E'\\y[A-Z][0-9]{7}[A-Z0-9]\\y' or parts.line_text~E'\\yS[0-9]{5}\\y' or parts.line_text~E'\\yD/[A-Z0-9/]+'
  or (parts.line_text !~* E'\\yImport[[:space:]]+total\\y' and parts.line_text~*E'[0-9.]+,[0-9]{2}[[:space:]]+euros.*[0-9.]+,[0-9]{2}[[:space:]]+euros');
 for u in select * from public.record_units where source_record_id=p_record and unit_key<>'legacy' order by page,id loop
  total_rows:=total_rows+1;
  if u.page is null or u.page<1
   or u.document_id is distinct from d.id or u.act_type is distinct from 'award' or u.status not in ('draft','approved')
   or u.unit_key is distinct from ('official-annex:'||d.storage_sha256||':0:'||total_rows)
   or u.storage_sha256 is distinct from d.storage_sha256
   or u.storage_path is distinct from ('cases/'||p_record||'/items/'||u.id||'/documents/'||d.id||'/'||d.storage_sha256||'.pdf')
   or u.provider_nif is null or u.reses_code is null or u.observed_service_code is null or u.amount is null
   or not public.concert_diagnostic_page_quote(d.extracted_text,u.page,u.evidence_quote)
  then raise exception 'DIAGNOSTIC_UNIT';end if;
  if position(u.provider_nif in u.evidence_quote)=0 or position(u.reses_code in u.evidence_quote)=0
   or position(u.observed_service_code in u.evidence_quote)=0 then raise exception 'DIAGNOSTIC_IDENTITY';end if;
  pstart:=position('## Pàgina '||u.page||E'\n' in d.extracted_text)+length('## Pàgina '||u.page||E'\n');
  next_page:=position(E'\n## Pàgina ' in substring(d.extracted_text from pstart));
  pend:=case when next_page=0 then length(d.extracted_text)+1 else pstart+next_page-1 end;
  tail_:=substring(d.extracted_text from greatest(pstart,position(a1 in d.extracted_text)) for least(pend,position(a2 in d.extracted_text))-greatest(pstart,position(a1 in d.extracted_text)));
  if (select count(*) from regexp_matches(tail_,E'\\yImport[[:space:]]+total\\y','gi'))<>1
   or (select count(*) from regexp_matches(u.evidence_quote,E'\\yImport[[:space:]]+total[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros','gi'))<>1 then raise exception 'DIAGNOSTIC_PAGE_TOTAL';end if;
  matches:=regexp_match(u.evidence_quote,E'\\yImport[[:space:]]+total[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros[[:space:]]+([0-9.]+,[0-9]{2})[[:space:]]+euros','i');
  net_:=concert_diagnostic_reconciliation_v1.cents(matches[1]);gross_:=concert_diagnostic_reconciliation_v1.cents(matches[2]);
  if net_ is null or gross_ is null or u.amount*100 is distinct from gross_ then raise exception 'DIAGNOSTIC_AMOUNT';end if;
  normalized_quote:=regexp_replace(u.evidence_quote,'[[:space:]]+',' ','g');source_rows:=0;line_net_sum:=0;line_gross_sum:=0;
  for line_ in select x from regexp_split_to_table(tail_,E'\n') x where x~E'\\y[A-Z][0-9]{7}[A-Z0-9]\\y' or x~E'\\yS[0-9]{5}\\y' or x~E'\\yD/[A-Z0-9/]+'
   or (x !~* E'\\yImport[[:space:]]+total\\y' and x~* E'[0-9.]+,[0-9]{2}[[:space:]]+euros.*[0-9.]+,[0-9]{2}[[:space:]]+euros') loop
   source_rows:=source_rows+1;
   if position(u.provider_nif in line_)=0 or position(u.reses_code in line_)=0 or position(u.observed_service_code in line_)=0
    or position(trim(regexp_replace(line_,'[[:space:]]+',' ','g')) in normalized_quote)=0 then raise exception 'DIAGNOSTIC_UNPARSED_ROW';end if;
   select array_agg(m) into line_amounts from regexp_matches(line_,E'([0-9.]+,[0-9]{2})[[:space:]]+euros','gi') m;
   if coalesce(array_length(line_amounts,1),0)<>2 then raise exception 'DIAGNOSTIC_ROW_AMOUNT';end if;
   line_net:=concert_diagnostic_reconciliation_v1.cents(line_amounts[1][1]);
   line_gross:=concert_diagnostic_reconciliation_v1.cents(line_amounts[2][1]);
   if line_net is null or line_gross is null or round(line_net::numeric*11/10)<>line_gross then raise exception 'DIAGNOSTIC_ROW_AMOUNT';end if;
   line_net_sum:=line_net_sum+line_net;line_gross_sum:=line_gross_sum+line_gross;
  end loop;
  if line_net_sum<>net_ or line_gross_sum<>gross_ then raise exception 'DIAGNOSTIC_ROW_TOTAL';end if;
  -- The second table contains exactly one documented paediatric component;
  -- do not infer that repeated RESES values in other documents are one line.
  if source_rows<>1 and (source_rows<>2 or tail_ !~* 'Equip T[eè]cnic de Centre'
   or tail_ !~* '15h/setmanals[[:space:]]+Llicenciat' or regexp_replace(tail_,'[[:space:]]+',' ','g') !~* 'Medicina.{0,255}especialitat[[:space:]]+en[[:space:]]+Pediatria') then raise exception 'DIAGNOSTIC_COMPONENTS';end if;
  matched_source_rows:=matched_source_rows+source_rows;
  net_sum:=net_sum+net_;gross_sum:=gross_sum+gross_;
  proof_:=proof_||jsonb_build_array(jsonb_build_object('unit_id',u.id,'page',u.page,'net_cents',net_,'gross_cents',gross_,'reses',u.reses_code,'code',u.observed_service_code));
 end loop;
 if total_rows<>unit_count or matched_source_rows<>all_source_rows or net_sum<>maximum_ or gross_sum>9007199254740991 then raise exception 'DIAGNOSTIC_RECONCILIATION';end if;
 new_:=jsonb_build_object('maximum_net_cents',maximum_,'calculated_net_cents',net_sum,'calculated_gross_cents',gross_sum,'unit_proof',proof_);
 current_hash:=concert_diagnostic_reconciliation_v1.input_hash(p_record,p_job,p_document);
 if current_hash is null then raise exception 'DIAGNOSTIC_SCOPE';end if;
 select revision,input_hash,job_id,document_id,jsonb_build_object('maximum_net_cents',maximum_net_cents,'calculated_net_cents',calculated_net_cents,'calculated_gross_cents',calculated_gross_cents,'unit_proof',unit_proof)
 into previous_revision,previous_hash,previous_job,previous_document,old_
 from concert_diagnostic_reconciliation_v1.reports where record_id=p_record order by revision desc limit 1;
 if previous_hash=current_hash and previous_job=p_job and previous_document=p_document then
  if old_ is distinct from new_ then raise exception 'DIAGNOSTIC_REPLAY_CONFLICT';end if;
  return new_;
 end if;
 -- The source record is held FOR UPDATE: concurrent revisions serialize.
 insert into concert_diagnostic_reconciliation_v1.reports(record_id,job_id,document_id,revision,input_hash,document_sha256,text_sha256,extraction_id,maximum_net_cents,calculated_net_cents,calculated_gross_cents,unit_proof)
 values(p_record,p_job,p_document,coalesce(previous_revision,0)+1,current_hash,d.storage_sha256,d.extracted_text_hash,d.active_extraction_id,maximum_,net_sum,gross_sum,proof_);
 return new_;
end $$;
revoke all on all functions in schema concert_diagnostic_reconciliation_v1 from public,anon,authenticated,service_role;

-- PROTOTYPE ONLY. Recognition is scoped to the diagnostic annex format;
-- it persists even if text, unit quotes or flags later change. No API grants.
create schema concert_diagnostic_guard_v1;
revoke all on schema concert_diagnostic_guard_v1 from public,anon,authenticated,service_role;
create table concert_diagnostic_guard_v1.recognitions (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.source_records(id),
 document_id uuid not null references public.source_documents(id),
 document_sha256 text check(document_sha256 is null or document_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 unique nulls not distinct(record_id,document_id,document_sha256)
);
alter table concert_diagnostic_guard_v1.recognitions enable row level security;
revoke all on concert_diagnostic_guard_v1.recognitions from public,anon,authenticated,service_role;
create function concert_diagnostic_guard_v1.immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'DIAGNOSTIC_RECOGNITION_IMMUTABLE';end $$;
create trigger immutable_diagnostic_recognition before update or delete on concert_diagnostic_guard_v1.recognitions for each row execute function concert_diagnostic_guard_v1.immutable();

-- The marker is never based on an absent field. Both patterns identify the
-- printed annex structure; neither is itself an award approval.
create function concert_diagnostic_guard_v1.is_format(t text,q text) returns boolean
language sql immutable set search_path=pg_catalog as $$
 select coalesce(t ~* E'(?n)^[[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]+Serveis[[:blank:]]+assignats[[:blank:]]*$',false)
  or coalesce(q ~* E'\\yImport[[:space:]]+total[[:space:]]+[0-9.]+,[0-9]{2}[[:space:]]+euros[[:space:]]+[0-9.]+,[0-9]{2}[[:space:]]+euros\\y',false)
$$;
-- Includes an already recognised source even when its current text degrades.
create function concert_diagnostic_guard_v1.is_recognized(p_record uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.source_records r where r.id=p_record and r.financing_type='concert') and (
  exists(select 1 from concert_diagnostic_guard_v1.recognitions x where x.record_id=p_record)
  or exists(select 1 from public.source_documents d where d.source_record_id=p_record and concert_diagnostic_guard_v1.is_format(d.extracted_text,null))
  or exists(select 1 from public.record_units u join public.source_documents d on d.id=u.document_id and d.source_record_id=u.source_record_id
   join public.source_records r on r.id=u.source_record_id and r.financing_type='concert'
   where u.source_record_id=p_record and u.act_type='award' and split_part(u.unit_key,':',2) ~ '^[a-f0-9]{64}$'
    and u.unit_key like ('official-annex:'||split_part(u.unit_key,':',2)||':0:%')
    and (concert_diagnostic_guard_v1.is_format(null,u.evidence_quote)
     or (d.storage_sha256=split_part(u.unit_key,':',2) and concert_diagnostic_guard_v1.is_format(d.extracted_text,null)))))
$$;
create function concert_diagnostic_guard_v1.remember_fields(p_record uuid,p_document uuid,p_key text,p_act text,p_quote text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.source_documents;sha_ text;
begin
 if p_act is distinct from 'award' or p_document is null then return;end if;
 sha_:=split_part(p_key,':',2);
 select * into d from public.source_documents where id=p_document and source_record_id=p_record;
 if found and sha_ ~ '^[a-f0-9]{64}$' and p_key like ('official-annex:'||sha_||':0:%')
  and (concert_diagnostic_guard_v1.is_format(null,p_quote) or (d.storage_sha256=sha_ and concert_diagnostic_guard_v1.is_format(d.extracted_text,null))) then
  perform 1 from public.source_records r where r.id=p_record and r.financing_type='concert' for key share nowait;
  if not found then return;end if;
  insert into concert_diagnostic_guard_v1.recognitions(record_id,document_id,document_sha256)
  values(p_record,d.id,sha_) on conflict do nothing;
 end if;
end $$;
create function concert_diagnostic_guard_v1.remember_unit() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' then perform concert_diagnostic_guard_v1.remember_fields(old.source_record_id,old.document_id,old.unit_key,old.act_type,old.evidence_quote);end if;
 perform concert_diagnostic_guard_v1.remember_fields(new.source_record_id,new.document_id,new.unit_key,new.act_type,new.evidence_quote);
 return new;
end $$;
create trigger recognize_diagnostic_unit after insert or update of document_id,unit_key,evidence_quote,act_type on public.record_units
for each row execute function concert_diagnostic_guard_v1.remember_unit();
-- Preserve old and new document formats even before any units exist.
create function concert_diagnostic_guard_v1.remember_document_fields(p_record uuid,p_document uuid,p_sha text,p_text text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not concert_diagnostic_guard_v1.is_format(p_text,null) then return;end if;
 -- An unknown or malformed hash is recorded as unknown, not invented.
 if p_sha is not null and p_sha !~ '^[a-f0-9]{64}$' then p_sha:=null;end if;
 perform 1 from public.source_records r where r.id=p_record and r.financing_type='concert' for key share nowait;
 if not found then return;end if;
 insert into concert_diagnostic_guard_v1.recognitions(record_id,document_id,document_sha256)
 values(p_record,p_document,p_sha) on conflict do nothing;
end $$;
create function concert_diagnostic_guard_v1.remember_document() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' then perform concert_diagnostic_guard_v1.remember_document_fields(old.source_record_id,old.id,old.storage_sha256,old.extracted_text);end if;
 perform concert_diagnostic_guard_v1.remember_document_fields(new.source_record_id,new.id,new.storage_sha256,new.extracted_text);
 return new;
end $$;
create trigger preserve_diagnostic_document after insert or update of source_record_id,extracted_text,storage_sha256 on public.source_documents
for each row execute function concert_diagnostic_guard_v1.remember_document();
-- Existing recognised units need the same persistent guard; this is an
-- additive marker only. Recheck the expected scope at the production boundary.
insert into concert_diagnostic_guard_v1.recognitions(record_id,document_id,document_sha256)
select distinct u.source_record_id,d.id,d.storage_sha256 from public.record_units u
join public.source_records r on r.id=u.source_record_id and r.financing_type='concert'
join public.source_documents d on d.id=u.document_id and d.source_record_id=r.id
where u.act_type='award' and d.storage_sha256 ~ '^[a-f0-9]{64}$'
 and u.unit_key like ('official-annex:'||d.storage_sha256||':0:%')
 and concert_diagnostic_guard_v1.is_format(d.extracted_text,u.evidence_quote)
on conflict do nothing;
insert into concert_diagnostic_guard_v1.recognitions(record_id,document_id,document_sha256)
select d.source_record_id,d.id,case when d.storage_sha256 ~ '^[a-f0-9]{64}$' then d.storage_sha256 else null end from public.source_documents d
join public.source_records r on r.id=d.source_record_id and r.financing_type='concert'
where concert_diagnostic_guard_v1.is_format(d.extracted_text,null) on conflict do nothing;
create function concert_diagnostic_guard_v1.block_global() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare kind_ text;
begin
 if new.decision not in ('approved','corrected') then return new;end if;
 select r.financing_type into kind_ from public.source_records r where r.id=new.source_record_id for update nowait;
 if kind_='concert' and concert_diagnostic_guard_v1.is_recognized(new.source_record_id) then
  raise exception 'DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED';
 end if;
 return new;
end $$;
create function concert_diagnostic_guard_v1.block_legacy_provision() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare kind_ text;
begin
 select r.financing_type into kind_ from public.source_records r where r.id=new.source_record_id for update nowait;
 if kind_='concert' and concert_diagnostic_guard_v1.is_recognized(new.source_record_id) then
  raise exception 'DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED';
 end if;
 return new;
end $$;
create trigger diagnostic_no_global_approval before insert on public.review_decisions
for each row execute function concert_diagnostic_guard_v1.block_global();
create trigger diagnostic_no_legacy_provision before insert on public.service_provisions
for each row execute function concert_diagnostic_guard_v1.block_legacy_provision();
revoke all on all functions in schema concert_diagnostic_guard_v1 from public,anon,authenticated,service_role;

-- DEPLOYMENT_SCOPE_GUARD: replaced by one-off transactional wrapper.


-- PROTOTYPE ONLY. Requires the byte-retention, line decision, projection,
-- diagnostic page and general reconciliation candidates. No production grants.
-- The source snapshot and bytes are retained, and the report is computed, in
-- the same transaction. A failed reconciliation rolls back that transaction.
create or replace function public.concert_line_retain_archive(p_record uuid,p_job uuid,p_unit uuid,p_snapshot jsonb,p_base64 text)
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare sha_ text;d public.source_documents;
begin
 sha_:=concert_line_evidence_v1.retain(p_record,p_job,p_unit,p_snapshot,p_base64);
 select * into strict d from public.source_documents where id=(p_snapshot->>'document_id')::uuid and source_record_id=p_record;
 if concert_diagnostic_guard_v1.is_recognized(p_record) then
  perform concert_diagnostic_reconciliation_v1.reconcile(p_record,p_job,d.id);
 end if;
 return sha_;
end $$;
revoke all on function public.concert_line_retain_archive(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

-- Read-only access to the latest report; NULL means absent or stale, not zero.
create function public.concert_diagnostic_current_report(p_record uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select concert_diagnostic_reconciliation_v1.current_report(p_record,report.job_id,report.document_id)
 from concert_diagnostic_reconciliation_v1.reports report where report.record_id=p_record
 order by report.revision desc limit 1
$$;
revoke all on function public.concert_diagnostic_current_report(uuid) from public,anon,authenticated,service_role;
create function public.concert_diagnostic_reconciliation_status(p_record uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('recognized',concert_diagnostic_guard_v1.is_recognized(p_record),'report',public.concert_diagnostic_current_report(p_record))
$$;
revoke all on function public.concert_diagnostic_reconciliation_status(uuid) from public,anon,authenticated,service_role;

-- Recheck the report under the existing ledger locks, at decision time.
do $$
declare original text;patched text;
 anchor constant text := 'if d.storage_path is null';
 addition constant text := $patch$if concert_diagnostic_guard_v1.is_recognized(p_record)
  and concert_diagnostic_reconciliation_v1.current_report(p_record,p_job,d.id) is null then raise exception 'LINE_DIAGNOSTIC_UNRECONCILED';end if;
 if d.storage_path is null$patch$;
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_DIAGNOSTIC_RECONCILIATION_ANCHOR';end if;
 patched:=replace(original,anchor,addition);execute patched;
end $$;

-- The same receipt must remain current in every reader of a new line award.
do $$
declare original text;patched text;
 anchor constant text := 'and encode(extensions.digest(b.body,''sha256''),''hex'')=y.sha256';
 addition constant text := $patch$and encode(extensions.digest(b.body,'sha256'),'hex')=y.sha256
   and (not concert_diagnostic_guard_v1.is_recognized(x.source_record_id)
    or concert_diagnostic_reconciliation_v1.current_report(x.source_record_id,x.job_id,d.id) is not null)$patch$;
begin
 original:=pg_get_functiondef('concert_line_evidence_v1.current_for_decision(uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_DIAGNOSTIC_PROJECTION_ANCHOR';end if;
 patched:=replace(original,anchor,addition);execute patched;
end $$;

-- PROTOTYPE ONLY. Requires the retained-byte and documentary-report schemas.
-- Selected source rows are already locked by delete_discarded_records. Keep
-- the existing all-or-nothing deletion and provide a human-readable reason.
do $$
declare original text;patched text;
 anchor constant text := 'if exists(select 1 from public.concert_population_events where source_record_id=any(ids)) then raise exception ''POPULATION_HISTORY_EXISTS'';end if;';
 addition constant text := $patch$
 if exists(select 1 from concert_line_evidence_v1.bindings where record_id=any(ids))
  or exists(select 1 from concert_diagnostic_reconciliation_v1.reports where record_id=any(ids))
  or exists(select 1 from concert_diagnostic_guard_v1.recognitions where record_id=any(ids))
 then raise exception 'CONCERT_EVIDENCE_RETAINED';end if;
 $patch$;
begin
 original:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_EVIDENCE_DELETE_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||addition);execute patched;
end $$;

-- PROTOTYPE ONLY. Preserve the existing batch/approved export name fallback.
-- Master export still reads official_services separately and remains unchanged.
do $$
declare original text;patched text;
 old_name constant text := 'coalesce(o.service_name,p.service_code)';
 new_name constant text := 'coalesce(o.service_name,m.service_name,''Servei no informat'')';
 old_join constant text := ' left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code';
 new_join constant text := E' left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code\n left join public.master_services m on m.service_code=p.historical_master_code';
begin
 original:=pg_get_functiondef('public.concert_line_mixed_snapshot(uuid[],boolean)'::regprocedure);
 if (length(original)-length(replace(original,old_name,'')))/length(old_name)<>1
  or (length(original)-length(replace(original,old_join,'')))/length(old_join)<>1 then raise exception 'LINE_MIXED_NAME_ANCHOR';end if;
 patched:=replace(replace(original,old_name,new_name),old_join,new_join);execute patched;
end $$;
-- Recheck the same historical names under lock in the receipt transaction.
do $$
declare original text;patched text;
 anchor constant text := ' perform 1 from storage.objects o where o.id in(select x.source_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids) union select x.item_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids)) order by o.id for share nowait;';
 addition constant text := E' perform 1 from public.master_services m where m.service_code in(select e->''snapshot''->>''historical_master_code'' from jsonb_array_elements(p_expected) e) order by m.service_code for share nowait;\n';
begin
 original:=pg_get_functiondef('public.concert_line_mixed_commit(uuid,text,jsonb,boolean)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_MIXED_MASTER_LOCK_ANCHOR';end if;
 patched:=replace(original,anchor,addition||anchor);execute patched;
end $$;
-- Master export rechecks the complete snapshot under table locks; include the
-- newly referenced catalogue so inserts/changes cannot race that recheck.
do $$
declare original text;patched text;
 anchor constant text := 'public.catalog_versions,public.official_services,public.concert_line_awards';
 replacement constant text := 'public.catalog_versions,public.official_services,public.master_services,public.concert_line_awards';
begin
 original:=pg_get_functiondef('public.concert_line_master_snapshot_commit(uuid,text,text,jsonb)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_MASTER_NAME_LOCK_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
end $$;

-- ISOLATED TEST ONLY. Captured production view definition; not a migration.
-- Both helpers are security invoker; no grants. Output includes decision_id as an internal join key.
-- The seven remaining columns and all native line_experiment predicates are
-- taken literally from the real pg_get_viewdef result captured 2026-11-02.
-- A grouped evidence check is an ADDITIONAL predicate, reflecting the draft.
create schema concert_scoped_projection_v1;
revoke all on schema concert_scoped_projection_v1 from public,anon,authenticated,service_role;
create function concert_scoped_projection_v1.checked_decisions(ids uuid[]) returns table(id uuid)
language sql stable security invoker set search_path=pg_catalog as $$
 with base as materialized (
  select x.id,x.source_record_id,x.job_id,d.id document_id,d.extracted_text_hash,d.extracted_text,
   y.sha256,y.snapshot,x.source_object_id,x.source_version,x.item_object_id,x.item_version
  from public.concert_line_award_decisions x
  join concert_line_evidence_v1.decision_evidence e on e.decision_id=x.id
  join concert_line_evidence_v1.bindings y on y.id=e.binding_id
  join public.record_units u on u.id=x.unit_id and u.source_record_id=x.source_record_id and u.document_id=y.document_id
  join public.source_documents d on d.id=y.document_id and d.source_record_id=x.source_record_id
  where x.id=any(ids) and y.record_id=x.source_record_id and y.job_id=x.job_id and y.unit_id=x.unit_id
   and y.sha256=d.storage_sha256 and y.sha256=u.storage_sha256 and y.extraction_hash=d.extracted_text_hash
   and y.snapshot->>'source_object'=x.source_object_id::text and y.snapshot->>'source_version'=x.source_version
   and y.snapshot->>'item_object'=x.item_object_id::text and y.snapshot->>'item_version'=x.item_version
 ), blobs as materialized (
  select b.sha256,encode(extensions.digest(b.body,'sha256'),'hex')=b.sha256 ok
  from concert_line_evidence_v1.blobs b join (select distinct sha256 from base) needed using(sha256)
 ), docs as materialized (
  select distinct source_record_id,job_id,document_id,extracted_text_hash,extracted_text from base
 ), checks as materialized (
  select docs.source_record_id,docs.job_id,docs.document_id,
   docs.extracted_text_hash=encode(extensions.digest(convert_to(docs.extracted_text,'UTF8'),'sha256'),'hex')
   and (not concert_diagnostic_guard_v1.is_recognized(docs.source_record_id)
    or concert_diagnostic_reconciliation_v1.current_report(docs.source_record_id,docs.job_id,docs.document_id) is not null) ok
  from docs
 )
 select base.id from base join blobs using(sha256) join checks using(source_record_id,job_id,document_id)
 where blobs.ok and checks.ok
$$;

create function concert_scoped_projection_v1.lines(p_ids uuid[])
returns table(decision_id uuid,source_record_id uuid,unit_id uuid,finance_id uuid,amount numeric,target_population text,service_code text,provenance text)
language sql stable security invoker set search_path=pg_catalog as $$
 with valid_branch as materialized (
SELECT x.id AS decision_id, x.source_record_id,
    x.unit_id,
    p.id AS finance_id,
    x.amount,
        CASE
            WHEN pop.decision = 'confirmed'::text AND pop.document_id = d.id AND pop.revision = ((d.storage_sha256 || ':'::text) || COALESCE(d.active_extraction_id::text, ''::text)) AND pop.unit_fingerprint = public.concert_population_unit_hash(u.*) AND pop.document_fingerprint = public.concert_population_document_hash(d.*) AND public.concert_population_on_page(d.extracted_text, pop.page, pop.quote) AND NOT (EXISTS ( SELECT 1
               FROM public.record_units other
              WHERE other.source_record_id = x.source_record_id AND other.id <> u.id AND other.document_id = u.document_id AND other.page = u.page AND other.evidence_quote IS NOT NULL AND length(other.evidence_quote) > 0 AND (POSITION((other.evidence_quote) IN (pop.quote)) > 0 OR POSITION((u.evidence_quote) IN (other.evidence_quote)) > 0))) THEN pop.value
            ELSE NULL::text
        END AS target_population,
    x.service_code,
    'line_experiment'::text AS provenance
   FROM public.concert_line_award_decisions x
     JOIN public.source_records r ON r.id = x.source_record_id AND r.financing_type = 'concert'::text
     JOIN public.record_units u ON u.id = x.unit_id AND u.source_record_id = x.source_record_id AND u.act_type = 'award'::text AND u.status = 'approved'::text
     JOIN public.source_documents d ON d.id = u.document_id AND d.source_record_id = x.source_record_id
     JOIN public.concert_population_events e ON e.id = x.population_event_id AND e.unit_id = x.unit_id AND e.job_id = x.job_id AND e.source_record_id = x.source_record_id
     LEFT JOIN LATERAL ( SELECT latest.id,
            latest.source_record_id,
            latest.unit_id,
            latest.job_id,
            latest.previous_id,
            latest.sequence,
            latest.decision,
            latest.value,
            latest.document_id,
            latest.revision,
            latest.page,
            latest.quote,
            latest.document_fingerprint,
            latest.unit_fingerprint,
            latest.reviewer,
            latest.reason,
            latest.created_at
           FROM public.concert_population_events latest
          WHERE latest.unit_id = x.unit_id AND latest.job_id = x.job_id
          ORDER BY latest.sequence DESC
         LIMIT 1) pop ON true
     JOIN public.concert_line_awards p ON p.id = x.provision_id AND p.unit_id = x.unit_id AND p.source_record_id = x.source_record_id AND p.superseded_at IS NULL
  WHERE x.id = ANY(p_ids) AND x.id = (( SELECT latest.id
           FROM public.concert_line_award_decisions latest
          WHERE latest.unit_id = x.unit_id AND latest.job_id = x.job_id
          ORDER BY latest.sequence DESC
         LIMIT 1)) AND x.job_id = (( SELECT j.id
           FROM public.pipeline_jobs j
          WHERE j.source_record_id = x.source_record_id AND NOT j.verification_only
          ORDER BY j.created_at DESC, j.id DESC
         LIMIT 1)) AND x.unit_fingerprint = public.concert_population_unit_hash(u.*) AND e.unit_fingerprint = x.unit_fingerprint AND x.document_fingerprint = public.concert_population_document_hash(d.*) AND e.document_fingerprint = x.document_fingerprint AND x.amount = u.amount AND p.amount = x.amount AND p.service_code = x.service_code AND x.service_code = COALESCE(( SELECT c.value
           FROM public.current_documented_corrections c
          WHERE c.unit_id = u.id AND c.source_record_id = x.source_record_id AND c.field = 'service_code'::text AND c.valid AND c.document_id = u.document_id AND (c.visual_check OR public.concert_population_on_page(d.extracted_text, c.page, c.evidence))), u.service_code, u.observed_service_code) AND (u.service_code IS NULL OR u.service_code = x.service_code) AND NOT (EXISTS ( SELECT 1
           FROM public.documented_corrections bad
          WHERE bad.unit_id = u.id AND bad.source_record_id IS DISTINCT FROM x.source_record_id)) AND (x.service_correction_id IS NULL OR (EXISTS ( SELECT 1
           FROM public.current_documented_corrections c
          WHERE c.id = x.service_correction_id AND c.unit_id = u.id AND c.source_record_id = x.source_record_id AND c.document_id = u.document_id AND c.field = 'service_code'::text AND c.valid AND (c.visual_check OR public.concert_population_on_page(d.extracted_text, c.page, c.evidence)) AND c.value = x.service_code))) AND (u.catalog_version_id IS NULL OR p.catalog_version_id = u.catalog_version_id) AND (EXISTS ( SELECT 1
           FROM public.eligible_official_services service
          WHERE service.service_code = x.service_code AND service.version_id = p.catalog_version_id)) AND (EXISTS ( SELECT 1
           FROM storage.objects so
          WHERE so.id = x.source_object_id AND so.archived_at IS NULL AND so.bucket_id = 'cloud-documents'::text AND so.name = d.storage_path AND so.version = x.source_version)) AND (EXISTS ( SELECT 1
           FROM storage.objects io
          WHERE io.id = x.item_object_id AND io.archived_at IS NULL AND io.bucket_id = 'cloud-documents'::text AND io.name = u.storage_path AND io.version = x.item_version)) AND NOT (EXISTS ( SELECT 1
           FROM public.service_provisions p_1
             JOIN public.record_units legacy ON legacy.id = p_1.unit_id
          WHERE p_1.source_record_id = x.source_record_id AND p_1.superseded_at IS NULL AND (legacy.unit_key = 'legacy'::text OR legacy.id = x.unit_id)))
 ), evidence as materialized (
  select id from concert_scoped_projection_v1.checked_decisions(array(select v.decision_id from valid_branch v))
 )
 select v.decision_id,v.source_record_id,v.unit_id,v.finance_id,v.amount,v.target_population,v.service_code,v.provenance
 from valid_branch v join evidence e on e.id=v.decision_id
$$;
revoke all on all functions in schema concert_scoped_projection_v1 from public,anon,authenticated,service_role;

-- REVIEW AND SYNTHETIC TEST ONLY. Not a migration and not production-ready.
-- Requires concert_scoped_projection_v1.lines(uuid[]) and its private
-- dependencies in the SAME database. The helper's security model and owners
-- must be reviewed before any integration. No grants are made here.
--
-- Patch the existing functions rather than replacing their full bodies, so all
-- existing receipt checks, revisions, locks, JSON, and grants remain intact.
-- Fail closed if the function text has changed from the reviewed anchors.
do $$
declare sig text;original text;patched text;ids_expr text;
 anchor constant text := 'join public.concert_line_financing_projection v on v.finance_id=p.id and v.provenance=''line_experiment''';
 replacement text;
begin
 foreach sig in array array['public.concert_line_export_snapshot(uuid[])','public.concert_line_export_commit(uuid,text,jsonb)'] loop
  original:=pg_get_functiondef(sig::regprocedure);
  ids_expr:=case when sig like '%export_snapshot%' then 'p_ids' else 'ids' end;
  if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1
   or position('where x.id=any('||ids_expr||')' in original)=0
  then raise exception 'SCOPED_EXPORT_ANCHOR %',sig;end if;
  -- provision_id is UNIQUE on concert_line_award_decisions: joining on
  -- both keys preserves the original result and makes the scope explicit.
  replacement:='join concert_scoped_projection_v1.lines('||ids_expr||') v on v.finance_id=p.id and v.decision_id=x.id';
  patched:=replace(original,anchor,replacement);execute patched;
 end loop;
end $$;

-- The mixed consumer previously read combined_provisions() and then filtered
-- by provision ID. Check its complete body before reproducing its union, to
-- avoid silently overlooking future changes to Convenis or other types.
do $$
declare original text;patched text;combined text;expected text;
 anchor constant text := 'from public.concert_line_combined_provisions() p join public.source_records r on r.id=p.source_record_id';
 replacement constant text := $body$
from (
 select legacy.* from public.conveni_reviewed_provisions legacy where legacy.id=any(p_ids)
 union all
 select (jsonb_populate_record(null::public.service_provisions,to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
 from public.concert_line_awards a
 join concert_scoped_projection_v1.lines(array(select x.id from public.concert_line_award_decisions x where x.provision_id=any(p_ids))) v
  on v.finance_id=a.id
 where a.id=any(p_ids)
) p join public.source_records r on r.id=p.source_record_id$body$;
begin
 select prosrc into strict combined from pg_proc where oid='public.concert_line_combined_provisions()'::regprocedure;
 expected:=$body$
 select p.* from public.conveni_reviewed_provisions p
 union all
 select (jsonb_populate_record(null::public.service_provisions,to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
 from public.concert_line_awards a
 join public.concert_line_financing_projection v on v.finance_id=a.id and v.provenance='line_experiment'
$body$;
 if regexp_replace(trim(combined),'\s+',' ','g') is distinct from regexp_replace(trim(expected),'\s+',' ','g') then
  raise exception 'SCOPED_COMBINED_BODY_CHANGED';
 end if;
 original:=pg_get_functiondef('public.concert_line_mixed_snapshot(uuid[],boolean)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'SCOPED_MIXED_ANCHOR';end if;
 patched:=replace(original,anchor,replacement);execute patched;
 -- mixed_commit is deliberately not patched: it locks the same dependencies
 -- and re-runs mixed_snapshot(ids, p_legacy_visible) before persisting receipt.
 original:=pg_get_functiondef('public.concert_line_mixed_commit(uuid,text,jsonb,boolean)'::regprocedure);
 if position('actual:=public.concert_line_mixed_snapshot(ids,p_legacy_visible);' in original)=0 then
  raise exception 'SCOPED_MIXED_COMMIT_ANCHOR';
 end if;
end $$;

-- ISOLATED CANDIDATE ONLY. Requires scoped-line-projection-agent.sql.
-- Patches exact function bodies or aborts. No grants or production changes.
-- Preserve the legacy branch verbatim in meaning and validate scoped line
-- candidates BEFORE membership is passed to mixed_snapshot. Existing commit
-- functions and their snapshot rechecks and locks remain untouched.
do $patch$
declare original text; patched text;
 old_batch constant text := ' select coalesce(array_agg(p.id order by p.id),''{}''::uuid[]) into ids from public.concert_line_combined_provisions() p where p.source_record_id=any(sources) and p.superseded_at is null;';
 new_batch constant text := $sql$ select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from (
  select p.id from public.conveni_reviewed_provisions p where p.source_record_id=any(sources) and p.superseded_at is null
  union all
  select v.finance_id as id from concert_scoped_projection_v1.lines(array(
   select x.id from public.concert_line_award_decisions x where x.source_record_id=any(sources)
  )) v join public.concert_line_awards a on a.id=v.finance_id where a.superseded_at is null
 ) p;$sql$;
 old_master constant text := ' select coalesce(array_agg(p.id order by p.id),''{}''::uuid[]) into ids from public.concert_line_combined_provisions() p where p.superseded_at is null;';
 new_master constant text := $sql$ select coalesce(array_agg(p.id order by p.id),'{}'::uuid[]) into ids from (
  select p.id from public.conveni_reviewed_provisions p where p.superseded_at is null
  union all
  select v.finance_id as id from concert_scoped_projection_v1.lines(array(
   select x.id from public.concert_line_award_decisions x
  )) v join public.concert_line_awards a on a.id=v.finance_id where a.superseded_at is null
 ) p;$sql$;
 old_evolution constant text := $sql$ select coalesce(jsonb_agg(jsonb_build_object('unit_id',latest.unit_id,'state',case when exists(select 1 from public.concert_line_financing_projection v where v.finance_id=latest.provision_id and v.provenance='line_experiment') then 'current' else 'stale' end) order by latest.unit_id),'[]')
 from (select distinct on(x.unit_id) x.unit_id,x.provision_id from public.concert_line_award_decisions x join public.pipeline_jobs j on j.id=x.job_id where x.unit_id=any(p_units) order by x.unit_id,j.created_at desc,j.id desc,x.sequence desc) latest$sql$;
 new_evolution constant text := $sql$ with latest as materialized (
  select distinct on(x.unit_id) x.id,x.unit_id,x.provision_id from public.concert_line_award_decisions x
  join public.pipeline_jobs j on j.id=x.job_id where x.unit_id=any(p_units)
  order by x.unit_id,j.created_at desc,j.id desc,x.sequence desc
 ), valid as materialized (
  select v.decision_id,v.finance_id from concert_scoped_projection_v1.lines(array(select id from latest)) v
 )
 select coalesce(jsonb_agg(jsonb_build_object('unit_id',latest.unit_id,'state',case when exists(
  select 1 from valid v where v.decision_id=latest.id and v.finance_id=latest.provision_id
 ) then 'current' else 'stale' end) order by latest.unit_id),'[]') from latest$sql$;
begin
 original:=pg_get_functiondef('public.concert_line_batch_snapshot(uuid)'::regprocedure);
 if (length(original)-length(replace(original,old_batch,'')))/length(old_batch)<>1 then raise exception 'SCOPED_BATCH_ANCHOR';end if;
 patched:=replace(original,old_batch,new_batch);execute patched;
 original:=pg_get_functiondef('public.concert_line_master_snapshot()'::regprocedure);
 if (length(original)-length(replace(original,old_master,'')))/length(old_master)<>1 then raise exception 'SCOPED_MASTER_ANCHOR';end if;
 patched:=replace(original,old_master,new_master);execute patched;
 original:=pg_get_functiondef('public.concert_line_evolution_states(uuid[])'::regprocedure);
 if (length(original)-length(replace(original,old_evolution,'')))/length(old_evolution)<>1 then raise exception 'SCOPED_EVOLUTION_ANCHOR';end if;
 patched:=replace(original,old_evolution,new_evolution);execute patched;
end $patch$;

-- REVIEW-ONLY CANDIDATE. Depends on concert_scoped_projection_v1.lines(uuid[]).
-- Not a migration; do not execute in production. The containing release must
-- assert exact original function definitions and review ownership/search_path.
-- Preserve the setof service_provisions type and the historical UNION ALL bag.
create or replace function public.concert_line_combined_provisions()
returns setof public.service_provisions
language sql stable security definer set search_path=pg_catalog as $$
 with eligible as materialized (
  select * from concert_scoped_projection_v1.lines(
   array(select x.id from public.concert_line_award_decisions x))
 )
 select p.* from public.conveni_reviewed_provisions p
 union all
 select (jsonb_populate_record(null::public.service_provisions,
          to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
 from public.concert_line_awards a join eligible v on v.finance_id=a.id
$$;

-- Compute eligibility once, then preserve both legacy list criteria and the
-- additional valid line clause. Do not deduplicate: the old function does not.
create or replace function public.concert_line_combined_approved()
returns setof public.service_provisions
language sql stable security definer set search_path=pg_catalog as $$
 with eligible as materialized (
  select * from concert_scoped_projection_v1.lines(
   array(select x.id from public.concert_line_award_decisions x))
 ), combined as (
  select p.* from public.conveni_reviewed_provisions p
  union all
  select (jsonb_populate_record(null::public.service_provisions,
           to_jsonb(a)||jsonb_build_object('target_population',v.target_population))).*
  from public.concert_line_awards a join eligible v on v.finance_id=a.id
 )
 select p.* from combined p join public.source_records r on r.id=p.source_record_id
 where r.processing_status='completat' or r.financing_type='conveni'
  or exists(select 1 from eligible v where v.finance_id=p.id)
$$;

-- PostgREST's computed field can run once per row. Resolve only decisions for
-- that finance ID, rather than hashing all archived documents on every call.
create or replace function public.concert_line_approved(p public.service_provisions)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from concert_scoped_projection_v1.lines(
  array(select x.id from public.concert_line_award_decisions x where x.provision_id=p.id)) v
  where v.finance_id=p.id)
$$;

-- REVIEW-ONLY. Not a migration; never execute without complete release review.
-- Scope: NEW calls to concert_line_award_decide only. Does not freeze Storage,
-- population, evidence retention, reprocessing, corrections, or other writers.
-- Locks: control row FOR SHARE comes BEFORE record -> jobs -> unit -> document
-- -> Storage in the award decision. Control changes lock only control + history.
create schema concert_line_write_pause_v1;
revoke all on schema concert_line_write_pause_v1 from public,anon,authenticated,service_role;

create table concert_line_write_pause_v1.control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 reason text,
 revision bigint not null default 1 check(revision>0),
 changed_at timestamptz not null default clock_timestamp(),
 check(reason is null or char_length(reason) between 1 and 240)
);
create table concert_line_write_pause_v1.history (
 revision bigint primary key, enabled boolean not null, reason text,
 changed_at timestamptz not null, changed_by name not null
);
alter table concert_line_write_pause_v1.control enable row level security;
alter table concert_line_write_pause_v1.history enable row level security;
revoke all on all tables in schema concert_line_write_pause_v1 from public,anon,authenticated,service_role;
insert into concert_line_write_pause_v1.control(singleton,enabled,reason)
values(true,false,'La revisió econòmica individual encara no està habilitada.');
insert into concert_line_write_pause_v1.history
select revision,enabled,reason,changed_at,current_user from concert_line_write_pause_v1.control where singleton;
create function concert_line_write_pause_v1.reject_history_change() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'LINE_PAUSE_HISTORY_IMMUTABLE';end $$;
create trigger line_pause_history_immutable before update or delete on concert_line_write_pause_v1.history
for each row execute function concert_line_write_pause_v1.reject_history_change();

create function concert_line_write_pause_v1.assert_enabled() returns void
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare allowed boolean;
begin
 -- FOR SHARE conflicts with UPDATE and is held until the award transaction ends.
 select c.enabled into allowed from concert_line_write_pause_v1.control c where c.singleton for share;
 if not found or allowed is distinct from true then raise exception 'LINE_WRITES_PAUSED';end if;
end $$;

-- Explicit administration by the schema owner / controlled SQL only. This is
-- not exposed to service_role. CAS prevents accidentally resuming after a
-- newer pause. The setter touches no records or other application tables.
create function concert_line_write_pause_v1.set_enabled(p_enabled boolean,p_expected_revision bigint,p_reason text)
returns bigint language plpgsql volatile security definer set search_path=pg_catalog as $$
declare next_revision bigint; now_ timestamptz:=clock_timestamp();
begin
 if p_enabled is null or p_expected_revision is null or nullif(btrim(coalesce(p_reason,'')),'') is null
    or char_length(btrim(p_reason))>240 then raise exception 'LINE_PAUSE_INVALID';end if;
 update concert_line_write_pause_v1.control c
 set enabled=p_enabled,reason=btrim(p_reason),revision=c.revision+1,changed_at=now_
 where c.singleton and c.revision=p_expected_revision returning revision into next_revision;
 if not found then raise exception 'LINE_PAUSE_STATE_CHANGED';end if;
 insert into concert_line_write_pause_v1.history(revision,enabled,reason,changed_at,changed_by)
 values(next_revision,p_enabled,btrim(p_reason),now_,session_user);
 return next_revision;
end $$;

-- Reading this status is advisory for UX; enforcement occurs inside the same
-- transaction as the decision. No direct privileges on private tables.
create function public.concert_line_write_status() returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select coalesce((select jsonb_build_object('enabled',c.enabled,'reason',c.reason,'revision',c.revision,'changed_at',c.changed_at)
  from concert_line_write_pause_v1.control c where c.singleton),
  jsonb_build_object('enabled',false,'reason','No es pot comprovar si la revisió està disponible.','revision',null,'changed_at',null))
$$;
revoke all on all functions in schema concert_line_write_pause_v1 from public,anon,authenticated,service_role;
revoke all on function public.concert_line_write_status() from public,anon,authenticated,service_role;
grant execute on function public.concert_line_write_status() to service_role;

-- Insert the guard before the first record lock. The captured function checks
-- isolation first; require a unique exact anchor so drift aborts the patch.
do $$
declare original text; patched text;
 anchor constant text := ' if current_setting(''transaction_isolation'')<>''read committed'' then raise exception ''LINE_ISOLATION'';end if;';
begin
 original:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'LINE_PAUSE_ANCHOR_MISMATCH';end if;
 patched:=replace(original,anchor,anchor||E'\n perform concert_line_write_pause_v1.assert_enabled();');
 execute patched;
end $$;

-- Suggested handler mapping for PostgreSQL P0001/LINE_WRITES_PAUSED:
-- "La revisió econòmica està aturada temporalment. No s'ha desat aquesta
-- sol·licitud. Si una sol·licitud anterior no es va poder confirmar, consulta
-- la línia abans de repetir-la." An ordinary timeout remains outcome unknown.

-- Public server entry points only; internal schemas remain closed.
grant execute on function public.concert_line_retain_archive(uuid,uuid,uuid,jsonb,text),public.concert_diagnostic_current_report(uuid),public.concert_diagnostic_reconciliation_status(uuid),public.concert_line_award_archive_snapshot(uuid,uuid,uuid),public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid),public.concert_line_combined_approved(),public.concert_line_approved(public.service_provisions),public.concert_line_export_snapshot(uuid[]),public.concert_line_export_commit(uuid,text,jsonb),public.concert_line_mixed_snapshot(uuid[],boolean),public.concert_line_mixed_commit(uuid,text,jsonb,boolean),public.concert_line_batch_snapshot(uuid),public.concert_line_batch_snapshot_commit(uuid,uuid,text,text,jsonb),public.concert_line_master_snapshot(),public.concert_line_master_snapshot_commit(uuid,text,text,jsonb),public.concert_line_evolution_states(uuid[]) to service_role;
