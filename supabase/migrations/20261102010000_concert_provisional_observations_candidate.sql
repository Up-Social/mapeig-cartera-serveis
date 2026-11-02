-- CLOSED LOCAL CANDIDATE. No application grants, product route or activation.
-- This parses and versions observations; it does not establish physical bytes,
-- a link to a later decision, a record_unit, financing or a reviewed service.
create schema concert_provisional_complete_candidate;
revoke all on schema concert_provisional_complete_candidate from public,anon,authenticated,service_role;

create table concert_provisional_complete_candidate.sets(
 id uuid primary key,
 record_id uuid not null references public.source_records(id) on delete restrict,
 document_id uuid not null references public.source_documents(id) on delete restrict,
 fingerprint text not null,
 title text not null,
 supersedes uuid references concert_provisional_complete_candidate.sets(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create index provisional_sets_record_idx on concert_provisional_complete_candidate.sets(record_id);
create table concert_provisional_complete_candidate.items(
 set_id uuid not null references concert_provisional_complete_candidate.sets(id) on delete restrict,
 ordinal integer not null check(ordinal>0), page integer not null check(page>0),
 heading text not null check(length(heading) between 10 and 400),
 primary key(set_id,ordinal)
);
create table concert_provisional_complete_candidate.heads(
 record_id uuid primary key references public.source_records(id) on delete restrict,
 set_id uuid not null unique references concert_provisional_complete_candidate.sets(id) on delete restrict
);
create function concert_provisional_complete_candidate.immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'PROVISIONAL_HISTORY_IMMUTABLE';end $$;
create trigger immutable_set before update or delete on concert_provisional_complete_candidate.sets for each row execute function concert_provisional_complete_candidate.immutable();
create trigger immutable_item before update or delete on concert_provisional_complete_candidate.items for each row execute function concert_provisional_complete_candidate.immutable();

create function concert_provisional_complete_candidate.normalize(s text) returns text language sql immutable strict set search_path=pg_catalog as $$
 select trim(regexp_replace(translate(lower(s),'àáâäãåèéêëìíîïòóôöõùúûüçñ','aaaaaaeeeeiiiiooooouuuucn'),'[^a-z0-9]+',' ','g'))
$$;

-- Only the DB derives the full set; there is no caller-supplied item list.
-- Unknown layouts, missing page markers and ambiguous numbered rows fail closed.
create function concert_provisional_complete_candidate.parse(p_title text,p_text text) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare line_ text; num_ integer; page_ integer; pages_ integer[]:='{}'; header_ text[]; parsed_ text[]; numbers_ integer[]:='{}'; result_ jsonb:='[]';
 proposal_ integer:=0; annex_ integer:=0; ending_ integer:=0; state_ integer:=0; prefix_ text; norm_ text;
begin
 if p_title is null or p_text is null or length(p_text)>200000 then raise exception 'PROVISIONAL_SOURCE_INVALID'; end if;
 norm_:=concert_provisional_complete_candidate.normalize(p_title);
 if norm_ !~ '^(acord proposta|proposta de resolucio|resolucio de proposta)\y' then raise exception 'PROVISIONAL_NOT_PROPOSAL';end if;
 prefix_:=left(norm_,80);
 if length(prefix_)<40 or position(prefix_ in concert_provisional_complete_candidate.normalize(left(p_text,5000)))=0 then raise exception 'PROVISIONAL_TITLE_MISMATCH';end if;
 if p_text ~* E'(?n)^[\\t ]*RESOLC([[:space:]:]|$)' then raise exception 'PROVISIONAL_HAS_RESOLC';end if;
 for line_ in select value from regexp_split_to_table(p_text,E'\n') with ordinality a(value,position) order by position loop
  header_:=regexp_match(line_,'^##[[:blank:]]+Pàgina[[:blank:]]+([0-9]+)[[:blank:]]*$','i');
  if header_ is not null then page_:=header_[1]::integer;if page_<1 or page_>2000 or page_=any(pages_) then raise exception 'PROVISIONAL_PAGE_INVALID';end if;pages_:=array_append(pages_,page_);end if;
  if line_ ~* '^[[:blank:]]*PROPOSA[[:blank:]]*$' then proposal_:=proposal_+1;if state_<>0 then raise exception 'PROVISIONAL_STRUCTURE';end if;state_:=1;continue;end if;
  if line_ ~* '^[[:blank:]]*ANNEX[[:blank:]]+1[[:blank:]]*\.[[:blank:]]*SERVEIS[[:blank:]]+ASSIGNATS[[:blank:]]*$' then annex_:=annex_+1;if state_<>1 then raise exception 'PROVISIONAL_STRUCTURE';end if;state_:=2;continue;end if;
  if line_ ~* '^[[:blank:]]*ANNEX[[:blank:]]+2([[:space:].]|$)' then ending_:=ending_+1;if state_<>2 then raise exception 'PROVISIONAL_STRUCTURE';end if;state_:=3;continue;end if;
  if state_<>2 then continue;end if;
  if line_ !~ '^[[:blank:]]*[0-9]{1,2}([[:blank:]]*\.[[:blank:]]*-|[[:blank:]]*[.):-]|[[:blank:]]*º)([[:blank:]]|$)' then continue;end if;
  parsed_:=regexp_match(line_,'^[[:blank:]]*([0-9]{1,2})\.-[[:blank:]]+(.+en[[:blank:]]+règim[[:blank:]]+de[[:blank:]]+(concert[[:blank:]]+social|gestió[[:blank:]]+delegada))[[:blank:]]*$','i');
  if parsed_ is null or page_ is null or length(trim(parsed_[2])) not between 10 and 400 then raise exception 'PROVISIONAL_UNREADABLE_HEADING';end if;
  num_:=parsed_[1]::integer;if num_=any(numbers_) then raise exception 'PROVISIONAL_DUPLICATE_HEADING';end if;
  numbers_:=array_append(numbers_,num_);if cardinality(numbers_)>20 then raise exception 'PROVISIONAL_TOO_MANY_HEADINGS';end if;
  result_:=result_||jsonb_build_array(jsonb_build_object('page',page_,'heading',trim(regexp_replace(parsed_[2],'[[:space:]]+',' ','g'))));
 end loop;
 if proposal_<>1 or annex_<>1 or ending_<>1 or state_<>3 or cardinality(numbers_)=0 then raise exception 'PROVISIONAL_STRUCTURE';end if;
 return result_;
end $$;

create function concert_provisional_complete_candidate.capture(p_set uuid,p_record uuid,p_document uuid,p_expected_fingerprint text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.source_records;d public.source_documents;head_ uuid;existing_ concert_provisional_complete_candidate.sets;items_ jsonb;it_ jsonb;ord_ integer:=0;fingerprint_ text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'PROVISIONAL_ISOLATION';end if;
 if p_set is null or p_record is null or p_document is null or p_expected_fingerprint is null then raise exception 'PROVISIONAL_INPUT';end if;
 select * into strict r from public.source_records where id=p_record for update;
 if r.financing_type is distinct from 'concert' then raise exception 'PROVISIONAL_NOT_CONCERT';end if;
 perform 1 from public.source_documents where source_record_id=p_record order by id for share;
 if (select count(*) from public.source_documents where source_record_id=p_record and document_type='publication')<>1 then raise exception 'PROVISIONAL_PUBLICATION_AMBIGUOUS';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=p_record for share;
 if d.document_type is distinct from 'publication' or d.status is distinct from 'fetched' or d.mime_type is distinct from 'application/pdf'
  or d.storage_sha256 !~ '^[0-9a-f]{64}$' or d.storage_sha256 is null
  or d.storage_path is distinct from 'cases/'||p_record::text||'/documents/'||p_document::text||'/'||d.storage_sha256||'.pdf'
  or d.extraction_method is null or d.extraction_method !~ '^(pdf-(text|ocr)-markdown-v2|pdftotext(-layout)?|pdf-text)$'
  or d.active_extraction_id is null or d.extraction_partial is distinct from false or d.extraction_coverage->'complete' is distinct from 'true'::jsonb
  or d.quality_flags is null or d.quality_flags && array['corrupt_text','incomplete_extraction']
  or d.extracted_text is null or d.extracted_text_hash is null
  or d.extracted_text_hash is distinct from encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex') then raise exception 'PROVISIONAL_SOURCE_UNVERIFIED';end if;
 fingerprint_:=public.concert_population_document_hash(d);
 if p_expected_fingerprint is distinct from fingerprint_ then raise exception 'PROVISIONAL_SOURCE_CHANGED';end if;
 items_:=concert_provisional_complete_candidate.parse(r.title,d.extracted_text);
 select set_id into head_ from concert_provisional_complete_candidate.heads where record_id=p_record;
 select * into existing_ from concert_provisional_complete_candidate.sets where id=p_set;
 if found then
  if existing_.record_id is distinct from p_record or existing_.document_id is distinct from p_document or existing_.fingerprint is distinct from fingerprint_ or existing_.title is distinct from r.title then raise exception 'PROVISIONAL_REPLAY_CONFLICT';end if;
  if head_ is distinct from p_set then raise exception 'PROVISIONAL_REPLAY_STALE';end if;
  return jsonb_build_object('status','already_saved','setId',p_set,'sumable',false);
 end if;
 if head_ is not null and exists(select 1 from concert_provisional_complete_candidate.sets where id=head_ and document_id=p_document and fingerprint=fingerprint_ and title=r.title) then
  return jsonb_build_object('status','already_current','setId',head_,'sumable',false);
 end if;
 insert into concert_provisional_complete_candidate.sets(id,record_id,document_id,fingerprint,title,supersedes) values(p_set,p_record,p_document,fingerprint_,r.title,head_);
 for it_ in select value from jsonb_array_elements(items_) loop
  ord_:=ord_+1;insert into concert_provisional_complete_candidate.items values(p_set,ord_,(it_->>'page')::integer,it_->>'heading');
 end loop;
 insert into concert_provisional_complete_candidate.heads values(p_record,p_set) on conflict(record_id) do update set set_id=excluded.set_id;
 return jsonb_build_object('status','saved','setId',p_set,'sumable',false);
end $$;

create function concert_provisional_complete_candidate.read_current(p_record uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('state',case when r.financing_type='concert' and r.title=s.title and d.status='fetched' and d.extracted_text_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
   and s.fingerprint=public.concert_population_document_hash(d)
   and (select count(*) from public.source_documents p where p.source_record_id=r.id and p.document_type='publication')=1
   then 'provisional' else 'source_changed' end,
  'setId',s.id,'documentId',s.document_id,'sumable',false,'physicalSourceVerified',false,'textProvenanceVerified',false,
  'observations',case when r.financing_type='concert' and r.title=s.title and d.status='fetched' and d.extracted_text_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex') and s.fingerprint=public.concert_population_document_hash(d)
   and (select count(*) from public.source_documents p where p.source_record_id=r.id and p.document_type='publication')=1
   then (select jsonb_agg(jsonb_build_object('page',i.page,'heading',i.heading) order by i.ordinal) from concert_provisional_complete_candidate.items i where i.set_id=s.id) else null end)
 from concert_provisional_complete_candidate.heads h join concert_provisional_complete_candidate.sets s on s.id=h.set_id
 join public.source_records r on r.id=s.record_id join public.source_documents d on d.id=s.document_id and d.source_record_id=r.id where h.record_id=p_record
$$;
revoke all on all tables in schema concert_provisional_complete_candidate from public,anon,authenticated,service_role;
revoke all on all functions in schema concert_provisional_complete_candidate from public,anon,authenticated,service_role;

-- The history must be protected before any purge work. Migration 720 locks
-- selected source rows first; capture takes the same record lock. The existing
-- API maps PRESERVED_HISTORY_EXISTS to a visible all-or-nothing explanation.
do $$
declare body_ text; anchor_ constant text:='exists(select 1 from public.documented_corrections where source_record_id=any(history_selected_ids))';
begin
 body_:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 if (length(body_)-length(replace(body_,anchor_,'')))/length(anchor_)<>1 then raise exception 'PROVISIONAL_DELETE_ANCHOR_INVALID';end if;
 body_:=replace(body_,anchor_,'exists(select 1 from concert_provisional_complete_candidate.sets where record_id=any(history_selected_ids)) or '||anchor_);
 execute body_;
end $$;
