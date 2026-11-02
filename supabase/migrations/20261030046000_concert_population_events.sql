-- Append-only population observations for Concert lines.
-- This additive contract does not modify approvals or existing provisions.
create table public.concert_population_events (
 id uuid primary key, source_record_id uuid not null references public.source_records(id), unit_id uuid not null references public.record_units(id),
 job_id uuid not null references public.pipeline_jobs(id), previous_id uuid references public.concert_population_events(id), sequence integer not null check(sequence>0),
 decision text not null check(decision in ('confirmed','unknown')),value text,document_id uuid references public.source_documents(id),revision text,
 page integer,quote text,document_fingerprint text,unit_fingerprint text not null,reviewer text not null,reason text not null,created_at timestamptz not null default clock_timestamp(), unique(unit_id,job_id,sequence),
 check((decision='unknown' and value is null and document_id is not null and revision is not null and page is null and quote is null and document_fingerprint is not null)
 or (decision='confirmed' and value is not null and document_id is not null and revision is not null and page>0 and quote is not null and document_fingerprint is not null))
);
alter table public.concert_population_events enable row level security;
revoke all on public.concert_population_events from public,anon,authenticated,service_role;
create function public.concert_population_on_page(t text,p integer,q text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare header text;tail text;all_pages integer[];begin
 if t is null or p is null or q is null or q~E'[\\r\\n]' or length(q)<12 or length(q)>1000 then return false;end if;
 select array_agg((m[1])::integer) into all_pages from regexp_matches(t,E'(?n)^## Pàgina ([0-9]+)[[:blank:]]*$', 'g') m;
 if all_pages is null or array_length(all_pages,1)<>(select count(distinct a) from unnest(all_pages)a) or t !~ E'^## Pàgina [0-9]+[[:blank:]]*\\n' then return false;end if;
 header:='## Pàgina '||p::text||E'\n';if position(header in t)=0 then return false;end if;
 tail:=substring(t from position(header in t)+length(header));tail:=split_part(tail,E'\n## Pàgina ',1);
 return position(q in tail)>0 and position(q in substring(tail from position(q in tail)+length(q)))=0;
end $$;
create function public.concert_population_document_hash(d public.source_documents) returns text
language sql immutable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('id',d.id,'source_record_id',d.source_record_id,'extracted_text',d.extracted_text,'mime_type',d.mime_type,'status',d.status,'extraction_partial',d.extraction_partial,'extraction_coverage',d.extraction_coverage,'extraction_method',d.extraction_method,'quality_flags',d.quality_flags,'storage_path',d.storage_path,'storage_sha256',d.storage_sha256,'active_extraction_id',d.active_extraction_id)::text,'UTF8'),'sha256'),'hex')
$$;
-- Bind every current line field except review state, which changes on approval.
-- Preparation changes identity fields too and therefore makes observations
-- stale; callers must prepare first or explicitly record a new observation.
create function public.concert_population_unit_hash(u public.record_units) returns text
language sql stable set search_path=pg_catalog as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('line',to_jsonb(u)-array['status','review_note','reviewed_at'],'corrections',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.current_documented_corrections c where c.unit_id=u.id))::text,'UTF8'),'sha256'),'hex')
$$;
create function public.concert_population_decide(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_decision text,p_value text,p_doc uuid,p_revision text,p_page integer,p_quote text,p_reason text,p_reviewer text,p_expected_document_hash text,p_expected_unit_hash text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.source_records;u public.record_units;d public.source_documents;prior public.concert_population_events;saved public.concert_population_events;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'POP_ISOLATION';end if;
 select * into strict r from public.source_records where id=p_record for update;
 if r.financing_type is distinct from 'concert' then raise exception 'POP_SCOPE';end if;
 perform 1 from public.pipeline_jobs where id=p_job and source_record_id=p_record and not verification_only and status in ('needs_review','approved','corrected','insufficient_evidence') for update;
 if not found or p_job is distinct from (select id from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1) then raise exception 'POP_JOB';end if;
 select * into strict u from public.record_units where id=p_unit and source_record_id=p_record for update;
 if u.unit_key='legacy' or u.act_type<>'award' then raise exception 'POP_SCOPE';end if;
 -- Include all existing rows; the source lock fences FK insertions and NOWAIT
 -- fails closed if another legitimate writer holds a line during review.
 perform 1 from public.record_units where source_record_id=p_record order by id for share nowait;
 -- A correction can refer to another document. Its validity is part of the
 -- line hash, so hold all current documents while comparing and inserting.
 perform 1 from public.source_documents where source_record_id=p_record order by id for share nowait;
 select * into saved from public.concert_population_events where id=p_event;
 if found then
  if saved.source_record_id is distinct from p_record or saved.unit_id is distinct from p_unit or saved.job_id is distinct from p_job or saved.previous_id is distinct from p_previous or saved.decision is distinct from p_decision or saved.value is distinct from p_value or saved.document_id is distinct from p_doc or saved.revision is distinct from p_revision or saved.page is distinct from p_page or saved.quote is distinct from p_quote or saved.reason is distinct from p_reason or saved.reviewer is distinct from p_reviewer or saved.document_fingerprint is distinct from p_expected_document_hash or saved.unit_fingerprint is distinct from p_expected_unit_hash then raise exception 'POP_EVENT_CONFLICT';end if;
  if public.concert_population_unit_hash(u) is distinct from saved.unit_fingerprint then raise exception 'POP_UNIT_STALE';end if;
  if exists(select 1 from public.concert_population_events where previous_id=saved.id) then raise exception 'POP_SUPERSEDED';end if;
  if not exists(select 1 from public.source_documents d0 where d0.id=saved.document_id and d0.source_record_id=p_record and d0.status='fetched' and d0.storage_path is not null and (d0.storage_sha256||':'||coalesce(d0.active_extraction_id::text,''))=saved.revision and public.concert_population_document_hash(d0)=saved.document_fingerprint and (saved.decision='unknown' or public.concert_population_on_page(d0.extracted_text,saved.page,saved.quote))) then raise exception 'POP_STALE';end if;
  return saved.id;
 end if;
 if public.concert_population_unit_hash(u) is distinct from p_expected_unit_hash then raise exception 'POP_UNIT_STALE';end if;
 if u.status<>'draft' or u.reviewed_at is not null or (u.pipeline_job_id is not null and u.pipeline_job_id<>p_job) then raise exception 'POP_REVIEWED';end if;
 select * into prior from public.concert_population_events where unit_id=p_unit and job_id=p_job order by sequence desc limit 1;
 if prior.id is distinct from p_previous then raise exception 'POP_PREVIOUS';end if;
 if p_decision is null or p_decision not in ('confirmed','unknown') or length(trim(coalesce(p_reason,'')))<10 or length(trim(coalesce(p_reviewer,'')))<3 then raise exception 'POP_INVALID';end if;
 if p_doc is distinct from u.document_id then raise exception 'POP_INVALID';end if;
 select * into strict d from public.source_documents where id=p_doc and source_record_id=p_record and status='fetched' and storage_path is not null for share;
 if p_revision is distinct from (d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')) or p_expected_document_hash is distinct from public.concert_population_document_hash(d) then raise exception 'POP_STALE';end if;
 if p_decision='unknown' then
  if p_value is not null or p_page is not null or p_quote is not null then raise exception 'POP_INVALID';end if;
 else
  if length(trim(coalesce(p_value,'')))<3 or p_value is distinct from trim(p_value) or p_doc is distinct from u.document_id then raise exception 'POP_INVALID';end if;
  if p_page is distinct from u.page or not public.concert_population_on_page(d.extracted_text,p_page,p_quote) or position(p_value in p_quote)=0 or u.evidence_quote is null or position(u.evidence_quote in p_quote)=0 or exists(select 1 from public.record_units other where other.source_record_id=p_record and other.id<>u.id and other.document_id=u.document_id and other.page=u.page and other.evidence_quote is not null and length(other.evidence_quote)>0 and (position(other.evidence_quote in p_quote)>0 or position(u.evidence_quote in other.evidence_quote)>0)) then raise exception 'POP_CITATION';end if;
 end if;
 insert into public.concert_population_events(id,source_record_id,unit_id,job_id,previous_id,sequence,decision,value,document_id,revision,page,quote,document_fingerprint,unit_fingerprint,reviewer,reason) values(p_event,p_record,p_unit,p_job,p_previous,coalesce(prior.sequence,0)+1,p_decision,p_value,p_doc,p_revision,p_page,p_quote,public.concert_population_document_hash(d),p_expected_unit_hash,p_reviewer,p_reason);
 return p_event;
end $$;
create function public.concert_population_for_review(p_unit uuid,p_job uuid) returns text
language plpgsql security invoker set search_path=pg_catalog as $$
declare e public.concert_population_events;d public.source_documents;u public.record_units;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'POP_ISOLATION';end if;
 select * into e from public.concert_population_events where unit_id=p_unit and job_id=p_job order by sequence desc limit 1 for share;
 if not found then raise exception 'POP_REVIEW_REQUIRED';end if;
 select * into strict u from public.record_units where id=p_unit and source_record_id=e.source_record_id for share;
 if public.concert_population_unit_hash(u) is distinct from e.unit_fingerprint then raise exception 'POP_UNIT_STALE';end if;
 perform 1 from public.record_units where source_record_id=e.source_record_id order by id for share nowait;
 select * into d from public.source_documents where id=e.document_id and source_record_id=e.source_record_id and status='fetched' and storage_path is not null for share;
 if not found or e.revision is distinct from (d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')) or public.concert_population_document_hash(d) is distinct from e.document_fingerprint then raise exception 'POP_STALE';end if;
 if e.decision='unknown' then return null;end if;
 if exists(select 1 from public.record_units other where other.source_record_id=e.source_record_id and other.id<>u.id and other.document_id=u.document_id and other.page=u.page and other.evidence_quote is not null and length(other.evidence_quote)>0 and (position(other.evidence_quote in e.quote)>0 or position(u.evidence_quote in other.evidence_quote)>0)) then raise exception 'POP_CITATION';end if;
 if not public.concert_population_on_page(d.extracted_text,e.page,e.quote) then raise exception 'POP_STALE';end if;
 return e.value;
end $$;

create function public.concert_population_snapshot(p_record uuid,p_job uuid,p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare r public.source_records;j public.pipeline_jobs;u public.record_units;d public.source_documents;e public.concert_population_events;begin
 select * into r from public.source_records where id=p_record and financing_type='concert';
 if not found then raise exception 'POP_SCOPE';end if;
 select * into j from public.pipeline_jobs where source_record_id=p_record and not verification_only order by created_at desc,id desc limit 1;
 if j.id is distinct from p_job or j.status not in ('needs_review','approved','corrected','insufficient_evidence') then raise exception 'POP_JOB';end if;
 select * into u from public.record_units where id=p_unit and source_record_id=p_record and unit_key<>'legacy' and act_type='award';
 if not found or (u.pipeline_job_id is not null and u.pipeline_job_id<>p_job) then raise exception 'POP_SCOPE';end if;
 select * into d from public.source_documents where id=u.document_id and source_record_id=p_record and status='fetched' and storage_path is not null;
 if not found or d.storage_sha256 is null then raise exception 'POP_SOURCE';end if;
 select * into e from public.concert_population_events where unit_id=p_unit and job_id=p_job order by sequence desc limit 1;
 return jsonb_build_object('unit_id',u.id,'job_id',j.id,'document_id',d.id,
  'revision',d.storage_sha256||':'||coalesce(d.active_extraction_id::text,''),
  'document_hash',public.concert_population_document_hash(d),'unit_hash',public.concert_population_unit_hash(u),
  'event',case when e.id is null then null else jsonb_build_object('id',e.id,'decision',e.decision,'value',e.value,
   'page',e.page,'quote',e.quote,'reason',e.reason,'reviewer',e.reviewer,'revision',e.revision,
   'matches_recorded_fingerprints',e.document_fingerprint=public.concert_population_document_hash(d) and e.unit_fingerprint=public.concert_population_unit_hash(u)) end);
end $$;
revoke all on function public.concert_population_document_hash(public.source_documents),public.concert_population_unit_hash(public.record_units),public.concert_population_on_page(text,integer,text),public.concert_population_decide(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,text,text,text,text),public.concert_population_for_review(uuid,uuid),public.concert_population_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.concert_population_decide(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,text,text,text,text),public.concert_population_snapshot(uuid,uuid,uuid) to service_role;

-- Retention policy for these review observations has not been decided. Keep
-- the existing all-or-nothing deletion flow and fail before deleting anything.
do $$
declare original text;patched text;
 anchor constant text := 'select coalesce(array_agg(id),''{}'') into docs from source_documents where source_record_id=any(ids);';
begin
 original:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'POP_DELETE_ANCHOR_NOT_UNIQUE';end if;
 patched:=replace(original,anchor,'if exists(select 1 from public.concert_population_events where source_record_id=any(ids)) then raise exception ''POPULATION_HISTORY_EXISTS'';end if;'||E'\n '||anchor);
 execute patched;
end $$;
