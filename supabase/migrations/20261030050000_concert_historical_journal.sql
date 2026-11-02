-- Historical Concerts journal and restricted server RPCs.
-- Additive, no network or automatic task creation. Explicit user authorization
-- is required by the server endpoint before calling the reservation RPC.
-- Coverage is limited to validated public pages, not source exhaustiveness.

-- Component: state.sql
create table public.experimental_concert_history_state (
 singleton boolean primary key default true check (singleton),
 state text not null check (state in ('pending','running','uncertain','completed')),
 attempt_id uuid,
 started_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 reason text,
 check ((state='pending' and attempt_id is null and started_at is null and reason is null)
     or (state='running' and attempt_id is not null and started_at is not null and reason is null)
     or (state='uncertain' and attempt_id is not null and started_at is not null and reason is not null)
     or (state='completed' and attempt_id is not null and started_at is not null))
);
insert into public.experimental_concert_history_state(singleton,state) values (true,'pending');

create function public.experimental_concert_history_terminal() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.state='completed' then raise exception 'HISTORY_ALREADY_COMPLETED';end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end $$;
create trigger experimental_concert_history_terminal before update or delete on public.experimental_concert_history_state
for each row execute function public.experimental_concert_history_terminal();

create function public.experimental_concert_history_reserve(p_attempt uuid)
returns table(acquired boolean,current_state text) language plpgsql security invoker set search_path=pg_catalog,public as $$
declare current_ public.experimental_concert_history_state;
begin
 if p_attempt is null then raise exception 'HISTORY_ATTEMPT_REQUIRED';end if;
 select * into strict current_ from public.experimental_concert_history_state where singleton for update;
 if current_.state<>'pending' then return query select false,current_.state;return;end if;
 update public.experimental_concert_history_state set state='running',attempt_id=p_attempt,
  started_at=clock_timestamp(),updated_at=clock_timestamp() where singleton;
 return query select true,'running'::text;
end $$;

create function public.experimental_concert_history_uncertain(p_attempt uuid,p_reason text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare current_ public.experimental_concert_history_state;
begin
 if p_reason is null or p_reason not in ('discovery_unknown','import_unknown','interrupted') then raise exception 'HISTORY_REASON_INVALID';end if;
 select * into strict current_ from public.experimental_concert_history_state where singleton for update;
 if current_.attempt_id is distinct from p_attempt then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 if current_.state='uncertain' and current_.reason=p_reason then return;end if;
 if current_.state<>'running' then raise exception 'HISTORY_NOT_RUNNING';end if;
 update public.experimental_concert_history_state set state='uncertain',reason=p_reason,updated_at=clock_timestamp() where singleton;
end $$;

revoke all on table public.experimental_concert_history_state from public,anon,authenticated,service_role;
revoke all on function public.experimental_concert_history_terminal(),public.experimental_concert_history_reserve(uuid),public.experimental_concert_history_uncertain(uuid,text) from public,anon,authenticated,service_role;


-- Component: canonical.sql
create function public.experimental_history_canonical(p_value jsonb)
returns bytea language plpgsql immutable strict security invoker set search_path=pg_catalog,public as $$
declare kind text; result bytea; item jsonb; key_ text; text_ text; number_ numeric; size_ integer;
begin
 if current_setting('server_encoding')<>'UTF8' then raise exception 'HISTORY_CANONICAL_ENCODING';end if;
 kind:=jsonb_typeof(p_value);
 if kind='null' then return convert_to('n','UTF8');
 elsif kind='boolean' then return convert_to(case when p_value='true'::jsonb then 't' else 'f' end,'UTF8');
 elsif kind='number' then
  number_:=(p_value::text)::numeric;
  if number_<>trunc(number_) or abs(number_)>9007199254740991 then raise exception 'HISTORY_CANONICAL_NUMBER';end if;
  return convert_to('i'||trunc(number_)::text||';','UTF8');
 elsif kind='string' then
  text_:=p_value#>>'{}';result:=convert_to(text_,'UTF8');
  return convert_to('s'||octet_length(result)::text||':','UTF8')||result;
 elsif kind='array' then
  result:=convert_to('a'||jsonb_array_length(p_value)::text||':','UTF8');
  for item in select value from jsonb_array_elements(p_value) loop result:=result||public.experimental_history_canonical(item);end loop;
  return result;
 elsif kind='object' then
  select count(*) into size_ from jsonb_object_keys(p_value);
  result:=convert_to('o'||size_::text||':','UTF8');
  for key_,item in select key,value from jsonb_each(p_value) order by convert_to(key,'UTF8') loop
   result:=result||public.experimental_history_canonical(to_jsonb(key_))||public.experimental_history_canonical(item);
  end loop;
  return result;
 end if;
 raise exception 'HISTORY_CANONICAL_VALUE';
end $$;

create function public.experimental_history_canonical_hash(p_value jsonb)
returns text language sql immutable strict security invoker set search_path=pg_catalog,public as $$
 select encode(extensions.digest(convert_to('mapeig-history-v1|','UTF8')||public.experimental_history_canonical(p_value),'sha256'),'hex')
$$;
revoke all on function public.experimental_history_canonical(jsonb),public.experimental_history_canonical_hash(jsonb) from public,anon,authenticated,service_role;


-- Component: execution.sql
alter table public.experimental_concert_history_state
 add column lease_owner uuid, add column lease_generation bigint not null default 0,
 add column lease_until timestamptz;
create table public.experimental_concert_history_pages (
 attempt_id uuid not null, term text not null check(term in ('concert social','gestió delegada social')),
 page integer not null check(page>=0 and page<5000), payload jsonb not null, canonical_hash text,
 updated_at timestamptz not null default clock_timestamp(), primary key(attempt_id,term,page)
);

create function public.experimental_concert_history_claim(p_attempt uuid,p_owner uuid)
returns bigint language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; generation bigint;
begin
 if p_attempt is null or p_owner is null then raise exception 'HISTORY_INVALID_LEASE';end if;
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' then return null;end if;
 if st.lease_until is not null and st.lease_until>clock_timestamp() then return null;end if;
 update public.experimental_concert_history_state set lease_owner=p_owner,lease_generation=lease_generation+1,
  lease_until=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where singleton returning lease_generation into generation;
 return generation;
end $$;

create function public.experimental_concert_history_page(p_attempt uuid,p_owner uuid,p_generation bigint,p_term text,p_page integer,p_payload jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; previous jsonb;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner
  or st.lease_generation is distinct from p_generation or st.lease_until<=clock_timestamp() or st.lease_until is null
  then raise exception 'HISTORY_LEASE_LOST';end if;
 if p_term is null or p_term not in ('concert social','gestió delegada social') or p_page is null or p_page<0 or p_page>=5000
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'HISTORY_PAGE_INVALID';end if;
 select payload into previous from public.experimental_concert_history_pages where attempt_id=p_attempt and term=p_term and page=p_page;
 if found then
  if previous is distinct from p_payload then raise exception 'HISTORY_PAGE_CHANGED';end if;
 else
  insert into public.experimental_concert_history_pages(attempt_id,term,page,payload) values(p_attempt,p_term,p_page,p_payload);
 end if;
 update public.experimental_concert_history_state set lease_until=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where singleton;
end $$;

revoke all on table public.experimental_concert_history_pages from public,anon,authenticated,service_role;
revoke all on function public.experimental_concert_history_claim(uuid,uuid),public.experimental_concert_history_page(uuid,uuid,bigint,text,integer,jsonb) from public,anon,authenticated,service_role;


-- Component: insert-only.sql
create table public.experimental_concert_history_receipts (
 attempt_id uuid not null, batch_id uuid not null, payload jsonb not null,
 inserted_count integer not null, present_count integer not null,
 outcomes jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(attempt_id,batch_id)
);

-- Compare semantic source content while ignoring retrieval time and the legacy
-- serialization-order-dependent hash. Preserve human and processing fields.
create function public.experimental_history_source_matches(p_source public.source_records,p_row jsonb)
returns boolean language sql immutable security invoker set search_path=pg_catalog,public as $$
 select coalesce(p_source.source_dataset='concerts'
  and p_source.source_record_id=p_row->>'source_record_id'
  and coalesce(p_source.source_payload_hash,'') ~ '^[a-f0-9]{64}$'
  and p_source.source_payload->>'source_payload_hash'=p_source.source_payload_hash
  and p_row->'source_payload'->>'source_payload_hash'=p_row->>'source_payload_hash'
  and p_source.title=p_row->>'title'
  and jsonb_typeof(p_source.source_payload)='object'
  and (p_source.source_payload-'retrieved_at'-'source_payload_hash')=((p_row->'source_payload')-'retrieved_at'-'source_payload_hash'),false)
$$;
revoke all on function public.experimental_history_source_matches(public.source_records,jsonb) from public,anon,authenticated,service_role;

create function public.experimental_concert_history_insert(p_attempt uuid,p_owner uuid,p_generation bigint,p_batch uuid,p_rows jsonb)
returns table(inserted_count integer,present_count integer)
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; receipt public.experimental_concert_history_receipts;
 item jsonb; existing public.source_records; inserted integer:=0; present integer:=0; n integer; d date; outcomes_ jsonb:='{}';
begin
 if p_attempt is null or p_batch is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'HISTORY_INVALID_BATCH'; end if;
 n:=jsonb_array_length(p_rows);
 if n<1 or n>50 then raise exception 'HISTORY_INVALID_BATCH_SIZE';end if;
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner
  or st.lease_generation is distinct from p_generation or st.lease_until is null or st.lease_until<=clock_timestamp()
  then raise exception 'HISTORY_LEASE_LOST';end if;
 select * into receipt from public.experimental_concert_history_receipts where attempt_id=p_attempt and batch_id=p_batch;
 if found then
  if receipt.payload is distinct from p_rows then raise exception 'HISTORY_BATCH_CHANGED';end if;
  return query select receipt.inserted_count,receipt.present_count;return;
 end if;
 if (select count(distinct value->>'source_record_id') from jsonb_array_elements(p_rows))<>n then raise exception 'HISTORY_DUPLICATE_IDS';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item)<>'object' or item->>'source_dataset' is distinct from 'concerts'
   or coalesce(item->>'source_record_id','') !~ '^etauler:1:[0-9]+$'
   or item#>>'{source_payload,id_edicte}' is distinct from substring(item->>'source_record_id' from '^etauler:1:([0-9]+)$')
   or item#>>'{source_payload,connector}' is distinct from 'etauler'
   or item#>>'{source_payload,period_from}' is distinct from '2020-01-01'
   or item#>>'{source_payload,period_to}' is distinct from '2023-12-31'
   or item->>'source_file' is distinct from 'https://tauler.seu-e.cat/api/edictes'
   or item->>'source_sheet' is distinct from 'edictes'
   or item->>'mechanism' is distinct from 'Concert social / gestió delegada'
   or item->>'processing_status' is distinct from 'pendent'
   or coalesce(item->>'title','')='' or coalesce(item->>'source_payload_hash','') !~ '^[a-f0-9]{64}$'
   or item#>>'{source_payload,source_payload_hash}' is distinct from item->>'source_payload_hash'
   or coalesce(item#>>'{source_payload,data_publicacio}','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}($|T)'
   then raise exception 'HISTORY_INVALID_RECORD';end if;
  begin d:=substring(item#>>'{source_payload,data_publicacio}' from 1 for 10)::date;
  exception when others then raise exception 'HISTORY_INVALID_DATE';end;
  if d<date '2020-01-01' or d>date '2023-12-31' then raise exception 'HISTORY_OUTSIDE_WINDOW';end if;
  insert into public.source_records(source_dataset,source_record_id,mechanism,title,processing_status,source_file,source_sheet,source_row,source_payload,source_payload_hash)
  values ('concerts',item->>'source_record_id',item->>'mechanism',item->>'title','pendent',item->>'source_file',item->>'source_sheet',
   (item->>'source_row')::integer,item->'source_payload',item->>'source_payload_hash')
  on conflict(source_dataset,source_record_id) do nothing;
  if found then inserted:=inserted+1;outcomes_:=jsonb_set(outcomes_,array[item->>'source_record_id'],'"inserted"'::jsonb,true);
  else
   select * into strict existing from public.source_records where source_dataset='concerts' and source_record_id=item->>'source_record_id' for share;
   if not public.experimental_history_source_matches(existing,item) then raise exception 'HISTORY_EXISTING_RECORD_CONFLICT';end if;
   present:=present+1;outcomes_:=jsonb_set(outcomes_,array[item->>'source_record_id'],'"already_present"'::jsonb,true);
  end if;
 end loop;
 insert into public.experimental_concert_history_receipts(attempt_id,batch_id,payload,inserted_count,present_count,outcomes) values(p_attempt,p_batch,p_rows,inserted,present,outcomes_);
 return query select inserted,present;
end $$;
revoke all on table public.experimental_concert_history_receipts from public,anon,authenticated,service_role;
revoke all on function public.experimental_concert_history_insert(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;


-- Component: complete-normalization-v2.sql
create function public.experimental_history_search_text(p_text text)
returns text language sql immutable strict parallel safe set search_path=pg_catalog as $$
 select lower(regexp_replace(normalize(p_text,NFD), U&'[\0300-\036F]', '', 'g') collate "C")
$$;
create function public.experimental_history_js_trim(p_text text)
returns text language sql immutable strict parallel safe set search_path=pg_catalog as $$
 select btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create table public.experimental_concert_history_completion (
 attempt_id uuid primary key, manifest jsonb not null, pages jsonb not null,
 coverage text not null check(coverage='pages_validated_not_source_exhaustive'),
 completed_at timestamptz not null default clock_timestamp()
);

create function public.experimental_concert_validate_manifest(p_attempt uuid,p_manifest jsonb)
returns integer language plpgsql security invoker set search_path=pg_catalog,public as $$
declare term_ text; first_page jsonb; current_page jsonb; entry jsonb; row_ jsonb;
 prior jsonb; expected jsonb:='{}'; matched jsonb:='{}'; observed jsonb:='{}'; seen jsonb; id_ text; day_ date; raw_text text; event_ text;
 total integer; page_count integer; page_index integer; expected_count integer;
begin
 if p_attempt is null or jsonb_typeof(p_manifest) is distinct from 'array' then raise exception 'HISTORY_MANIFEST_INVALID';end if;
 for term_ in select unnest(array['concert social','gestió delegada social']) loop
  select payload into first_page from public.experimental_concert_history_pages where attempt_id=p_attempt and term=term_ and page=0;
  if not found then raise exception 'HISTORY_PAGES_INCOMPLETE';end if;
  if jsonb_typeof(first_page->'totalEdictes') is distinct from 'number' or jsonb_typeof(first_page->'totalPages') is distinct from 'number' then raise exception 'HISTORY_PAGINATION_INVALID';end if;
  total:=(first_page->>'totalEdictes')::integer;
  if total<0 or total>125000 then raise exception 'HISTORY_PAGINATION_INVALID';end if;
  page_count:=greatest(1,(total+24)/25);
  if (first_page->>'totalPages')::integer<>page_count and not(total=0 and (first_page->>'totalPages')::integer=0) then raise exception 'HISTORY_PAGINATION_INVALID';end if;
  if (select count(*) from public.experimental_concert_history_pages where attempt_id=p_attempt and term=term_)<>page_count then raise exception 'HISTORY_PAGES_INCOMPLETE';end if;
  seen:='{}';
  for page_index in 0..page_count-1 loop
   select payload into current_page from public.experimental_concert_history_pages where attempt_id=p_attempt and term=term_ and page=page_index;
   if not found then raise exception 'HISTORY_PAGES_INCOMPLETE';end if;
   if jsonb_typeof(current_page->'currentPage') is distinct from 'number' or (current_page->>'currentPage')::integer<>page_index
    or current_page->'totalEdictes' is distinct from first_page->'totalEdictes' or current_page->'totalPages' is distinct from first_page->'totalPages'
    or jsonb_typeof(current_page->'edictes') is distinct from 'array' then raise exception 'HISTORY_PAGINATION_CHANGED';end if;
   if jsonb_array_length(current_page->'edictes')<>least(25,greatest(0,total-page_index*25)) then raise exception 'HISTORY_PAGINATION_CHANGED';end if;
   for entry in select value from jsonb_array_elements(current_page->'edictes') loop
    id_:=entry->>'id_edicte';
    if jsonb_typeof(entry->'id_edicte') is distinct from 'string' or coalesce(id_,'') !~ '^[0-9]+$'
     or jsonb_typeof(entry->'titol') is distinct from 'string' or jsonb_typeof(entry->'descripcio') is distinct from 'string'
     then raise exception 'HISTORY_EDICT_INVALID';end if;
    if seen ? id_ then raise exception 'HISTORY_EDICT_DUPLICATE';end if;
    seen:=jsonb_set(seen,array[id_],'true'::jsonb,true);
    prior:=jsonb_build_array(entry->'titol',entry->'descripcio',entry->'data_publicacio');
    if observed ? id_ and observed->id_ is distinct from prior then raise exception 'HISTORY_EDICT_CHANGED';end if;
    observed:=jsonb_set(observed,array[id_],prior,true);
    if position(public.experimental_history_search_text(term_) in public.experimental_history_search_text((entry->>'titol')||' '||(entry->>'descripcio')))=0 then continue;end if;
    if coalesce(entry->>'data_publicacio','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)' then raise exception 'HISTORY_DATE_INVALID';end if;
    begin day_:=substring(entry->>'data_publicacio' from 1 for 10)::date; exception when others then raise exception 'HISTORY_DATE_INVALID';end;
    if day_<date '2020-01-01' or day_>date '2023-12-31' then continue;end if;
    if expected ? id_ and expected->id_ is distinct from entry then raise exception 'HISTORY_EDICT_CHANGED';end if;
    expected:=jsonb_set(expected,array[id_],entry,true);
    matched:=jsonb_set(matched,array[id_],coalesce(matched->id_,'[]'::jsonb)||jsonb_build_array(term_),true);
   end loop;
  end loop;
 end loop;
 select count(*) into expected_count from jsonb_object_keys(expected);
 if jsonb_array_length(p_manifest)<>expected_count then raise exception 'HISTORY_MANIFEST_INCOMPLETE';end if;
 seen:='{}';
 for row_ in select value from jsonb_array_elements(p_manifest) loop
  id_:=substring(row_->>'source_record_id' from '^etauler:1:([0-9]+)$');
  if id_ is null or seen ? id_ or not(expected ? id_) or row_->>'source_dataset' is distinct from 'concerts'
   or row_->>'title' is distinct from public.experimental_history_js_trim(expected->id_->>'titol') or coalesce((row_->'source_payload') @> (expected->id_),false)=false
   or row_->>'source_file' is distinct from 'https://tauler.seu-e.cat/api/edictes' or row_->>'source_sheet' is distinct from 'edictes'
   or row_->>'mechanism' is distinct from 'Concert social / gestió delegada' or row_->>'processing_status' is distinct from 'pendent'
   or row_->'source_payload'->>'source_record_id' is distinct from row_->>'source_record_id'
   or row_->'source_payload'->>'source_dataset' is distinct from 'concerts'
   or row_->'source_payload'->>'financing_type' is distinct from 'concert'
   or row_->'source_payload'->>'connector' is distinct from 'etauler'
   or row_->'source_payload'->>'period_from' is distinct from '2020-01-01' or row_->'source_payload'->>'period_to' is distinct from '2023-12-31'
   or row_->'source_payload'->>'record_url' is distinct from 'https://tauler.seu-e.cat/detall?idEns=1&idEdicte='||id_
   or row_->'source_payload'->'matched_terms' is distinct from matched->id_
   or coalesce(row_->>'source_payload_hash','') !~ '^[a-f0-9]{64}$'
   or row_->'source_payload'->>'source_payload_hash' is distinct from row_->>'source_payload_hash'
   then raise exception 'HISTORY_MANIFEST_MISMATCH';end if;
  if coalesce(row_->>'historical_validation_hash','') !~ '^[a-f0-9]{64}$'
   or row_->>'historical_validation_hash' is distinct from public.experimental_history_canonical_hash(row_-'historical_validation_hash')
   then raise exception 'HISTORY_ROW_HASH_MISMATCH';end if;
  if jsonb_typeof(row_->'historical_legacy_hash_material') is distinct from 'string'
   or (row_->>'historical_legacy_hash_material')::jsonb is distinct from (expected->id_)||jsonb_build_object('matched_terms',matched->id_)
   or encode(extensions.digest(convert_to(row_->>'historical_legacy_hash_material','UTF8'),'sha256'),'hex') is distinct from row_->>'source_payload_hash'
   then raise exception 'HISTORY_LEGACY_HASH_MISMATCH';end if;
  raw_text:=public.experimental_history_search_text((expected->id_->>'titol')||' '||(expected->id_->>'descripcio'));
  event_:=case when raw_text ~ 'resolucio anticipada|extincio|baixa|retirada|finalitzacio' then 'resolucio_anticipada_o_baixa'
   when raw_text ~ 'prorroga' then 'prorroga' when raw_text ~ 'modificacio|modifica ' then 'modificacio'
   when raw_text ~ 'esmena|correccio' then 'esmena' when raw_text ~ 'cessio' then 'cessio'
   when raw_text ~ 'autoritzacio de la despesa' then 'autoritzacio_despesa'
   when raw_text ~ 'provisio de places|provisio de serveis|provisio directa|convocatoria.*provisio|assignacio de places' then 'nova_provisio_o_ampliacio' else 'altres' end;
  if row_->'source_payload'->>'event_type' is distinct from event_ or row_->'source_payload'->'counts_as_new_financing' is distinct from to_jsonb(event_='nova_provisio_o_ampliacio')
   then raise exception 'HISTORY_CLASSIFICATION_MISMATCH';end if;
  seen:=jsonb_set(seen,array[id_],'true'::jsonb,true);
 end loop;
 return expected_count;
end $$;

create function public.experimental_concert_history_complete(p_attempt uuid,p_owner uuid,p_generation bigint,p_manifest jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; term_ text; first_page jsonb; current_page jsonb; entry jsonb; row_ jsonb;
 prior jsonb; expected jsonb:='{}'; matched jsonb:='{}'; observed jsonb:='{}'; seen jsonb; id_ text; day_ date; raw_text text; event_ text;
 total integer; page_count integer; page_index integer; expected_count integer; receipts_count integer; pages_snapshot jsonb;
begin
 if p_attempt is null or jsonb_typeof(p_manifest) is distinct from 'array' then raise exception 'HISTORY_MANIFEST_INVALID';end if;
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 if st.state='completed' then
  if not exists(select 1 from public.experimental_concert_history_completion where attempt_id=p_attempt and manifest=p_manifest)
   then raise exception 'HISTORY_COMPLETION_CHANGED';end if;
  return true;
 end if;
 if st.state<>'running' or st.lease_owner is distinct from p_owner or st.lease_generation is distinct from p_generation
  or st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'HISTORY_LEASE_LOST';end if;
 expected_count:=public.experimental_concert_validate_manifest(p_attempt,p_manifest);
 for row_ in select value from jsonb_array_elements(p_manifest) loop
  -- Fences concurrent changes to each imported or pre-existing source row.
  perform 1 from public.source_records r where r.source_dataset='concerts' and r.source_record_id=row_->>'source_record_id'
   and public.experimental_history_source_matches(r,row_) for share;
  if not found then raise exception 'HISTORY_SOURCE_MISMATCH';end if;
 end loop;
 select count(*) into receipts_count from public.experimental_concert_history_receipts r cross join lateral jsonb_array_elements(r.payload) e where r.attempt_id=p_attempt;
 if receipts_count<>expected_count then raise exception 'HISTORY_RECEIPTS_INCOMPLETE';end if;
 for row_ in select value from jsonb_array_elements(p_manifest) loop
  if (select count(*) from public.experimental_concert_history_receipts r cross join lateral jsonb_array_elements(r.payload) e
      where r.attempt_id=p_attempt and e.value=row_)<>1 then raise exception 'HISTORY_RECEIPT_MISMATCH';end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('term',term,'page',page,'payload',payload) order by term,page),'[]') into pages_snapshot
  from public.experimental_concert_history_pages where attempt_id=p_attempt;
 insert into public.experimental_concert_history_completion(attempt_id,manifest,pages,coverage)
 values(p_attempt,p_manifest,pages_snapshot,'pages_validated_not_source_exhaustive');
 update public.experimental_concert_history_state set state='completed',lease_owner=null,lease_until=null,updated_at=clock_timestamp() where singleton;
 return true;
end $$;
revoke all on function public.experimental_concert_validate_manifest(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.experimental_history_search_text(text) from public,anon,authenticated,service_role;
revoke all on function public.experimental_history_js_trim(text) from public,anon,authenticated,service_role;
revoke all on table public.experimental_concert_history_completion from public,anon,authenticated,service_role;
revoke all on function public.experimental_concert_history_complete(uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;


-- Component: adapter.sql
alter table public.experimental_concert_history_state
 add column revision bigint not null default 0,
 add column dispatch text not null default 'unknown' check(dispatch in ('unknown','confirmed')),
 add column source_contract text not null default 'unverified' check(source_contract in ('unverified','verified','user_requested')),
 add column retrieved_at text, add column operation jsonb, add column manifest jsonb,
 add column manifest_hash text, add column progress jsonb;
create table public.experimental_concert_history_terminal_lease(attempt_id uuid primary key,owner uuid not null,generation bigint not null);

create function public.experimental_history_check_page_hashes(p_attempt uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.experimental_concert_history_pages where attempt_id=p_attempt
  and (canonical_hash is null or canonical_hash is distinct from public.experimental_history_canonical_hash(payload)))
  then raise exception 'HISTORY_PAGE_HASH_MISMATCH';end if;
end $$;

create function public.experimental_history_read(p_attempt uuid,p_owner uuid,p_generation bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; queries jsonb; receipts jsonb; bytes_ bigint; inflight jsonb;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for share;
 if st.attempt_id is distinct from p_attempt then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 if st.state='completed' then
  if not exists(select 1 from public.experimental_concert_history_terminal_lease where attempt_id=p_attempt and owner=p_owner and generation=p_generation) then raise exception 'HISTORY_LEASE_LOST';end if;
 elsif st.state<>'running' or st.lease_owner is distinct from p_owner or st.lease_generation is distinct from p_generation
  or st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'HISTORY_LEASE_LOST';end if;
 select coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_pages where attempt_id=p_attempt),0)
  +coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_receipts where attempt_id=p_attempt),0)
  +coalesce(octet_length(st.manifest::text),0)+coalesce(octet_length(st.operation::text),0) into bytes_;
 if bytes_>20000000 then raise exception 'HISTORY_SNAPSHOT_TOO_LARGE';end if;
 select jsonb_agg(jsonb_build_object('term',term_,'pages',coalesce((select jsonb_agg(p.payload order by p.page) from public.experimental_concert_history_pages p where p.attempt_id=p_attempt and p.term=term_),'[]'::jsonb)) order by ord)
  into queries from unnest(array['concert social','gestió delegada social']) with ordinality t(term_,ord);
 select coalesce(jsonb_agg(jsonb_build_object('sourceRecordId',e.value->>'source_record_id','payloadHash',e.value->>'source_payload_hash',
  'outcome',r.outcomes->>(e.value->>'source_record_id')) order by r.created_at,r.batch_id,e.ord),'[]'::jsonb) into receipts
  from public.experimental_concert_history_receipts r cross join lateral jsonb_array_elements(r.payload) with ordinality e(value,ord) where r.attempt_id=p_attempt;
 inflight:=case when st.operation is null then null else jsonb_build_object('id',st.operation->>'id','kind',case st.operation#>>'{action,kind}' when 'fetch_page' then 'page' when 'persist_manifest' then 'manifest' when 'import_batch' then 'import' when 'verify_and_complete' then 'completion' end) end;
 return jsonb_build_object('revision',st.revision::text,'snapshot',jsonb_build_object('state',st.state,'dispatch',st.dispatch,
  'historicalSourceContract',st.source_contract,'inFlight',inflight,'queries',queries,'retrievedAt',st.retrieved_at,'manifestHash',st.manifest_hash,'receipts',receipts));
end $$;

create function public.experimental_history_begin(p_attempt uuid,p_owner uuid,p_generation bigint,p_revision text,p_reservation jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; kind_ text; bytes_ bigint;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner or st.lease_generation is distinct from p_generation
  or st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'HISTORY_LEASE_LOST';end if;
 if st.dispatch<>'confirmed' or st.source_contract not in ('verified','user_requested') then raise exception 'HISTORY_NOT_READY';end if;
 if st.revision::text is distinct from p_revision or st.operation is not null then return false;end if;
 kind_:=p_reservation#>>'{action,kind}';
 if coalesce(p_reservation->>'id','') !~ '^[a-f0-9]{64}$' or coalesce(kind_,'') not in ('fetch_page','persist_manifest','import_batch','verify_and_complete')
  or jsonb_typeof(p_reservation->'progress') is distinct from 'object' then raise exception 'HISTORY_INTENT_INVALID';end if;
 select coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_pages where attempt_id=p_attempt),0)
  +coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_receipts where attempt_id=p_attempt),0)
  +coalesce(octet_length(st.manifest::text),0)+octet_length(p_reservation::text) into bytes_;
 if bytes_>20000000 then raise exception 'HISTORY_TOTAL_SIZE_LIMIT';end if;
 update public.experimental_concert_history_state set operation=p_reservation||jsonb_build_object('generation',p_generation),progress=p_reservation->'progress',revision=revision+1,lease_until=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() where singleton;
 return true;
end $$;

create function public.experimental_history_apply(p_attempt uuid,p_owner uuid,p_generation bigint,p_reservation jsonb,p_result jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state; action_ jsonb; kind_ text; row_ jsonb; batch_key text; batch_id uuid; bytes_ bigint; incoming_ bigint;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner or st.lease_generation is distinct from p_generation
  or st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'HISTORY_LEASE_LOST';end if;
 if st.operation is distinct from p_reservation||jsonb_build_object('generation',p_generation) then raise exception 'HISTORY_INTENT_MISMATCH';end if;
 action_:=p_reservation->'action';kind_:=action_->>'kind';
 select coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_pages where attempt_id=p_attempt),0)
  +coalesce((select sum(octet_length(payload::text)) from public.experimental_concert_history_receipts where attempt_id=p_attempt),0)
  +coalesce(octet_length(st.manifest::text),0)+coalesce(octet_length(st.operation::text),0) into bytes_;
 incoming_:=case kind_ when 'fetch_page' then octet_length((p_result->'page')::text) when 'persist_manifest' then octet_length((action_->'rows')::text)
  when 'import_batch' then octet_length((action_->'rows')::text) else 0 end;
 if incoming_ is null or bytes_+incoming_>20000000 then raise exception 'HISTORY_TOTAL_SIZE_LIMIT';end if;
 if kind_='fetch_page' then
  if st.manifest is not null then raise exception 'HISTORY_PAGES_SEALED';end if;
  if jsonb_typeof(p_result->'page') is distinct from 'object' then raise exception 'HISTORY_PAGE_INVALID';end if;
  if incoming_>2000000 or (select count(*) from public.experimental_concert_history_pages where attempt_id=p_attempt)>=2000 then raise exception 'HISTORY_PAGE_LIMIT';end if;
  if coalesce(p_result->>'pageHash','') !~ '^[a-f0-9]{64}$' or p_result->>'pageHash' is distinct from public.experimental_history_canonical_hash(p_result->'page')
   then raise exception 'HISTORY_PAGE_HASH_MISMATCH';end if;
  if exists(select 1 from public.experimental_concert_history_pages where attempt_id=p_attempt and term=action_->>'term'
   and page=(action_->>'page')::integer and canonical_hash is distinct from p_result->>'pageHash') then raise exception 'HISTORY_PAGE_HASH_MISMATCH';end if;
  perform public.experimental_concert_history_page(p_attempt,p_owner,p_generation,action_->>'term',(action_->>'page')::integer,p_result->'page');
  update public.experimental_concert_history_pages set canonical_hash=p_result->>'pageHash'
   where attempt_id=p_attempt and term=action_->>'term' and page=(action_->>'page')::integer;
 elsif kind_='persist_manifest' then
  if st.manifest is not null or jsonb_typeof(action_->'rows') is distinct from 'array' or coalesce(action_->>'manifestHash','') !~ '^[a-f0-9]{64}$' then raise exception 'HISTORY_MANIFEST_INVALID';end if;
  perform public.experimental_history_check_page_hashes(p_attempt);
  perform public.experimental_concert_validate_manifest(p_attempt,action_->'rows');
  update public.experimental_concert_history_state set manifest=action_->'rows',manifest_hash=action_->>'manifestHash' where singleton;
 elsif kind_='import_batch' then
  if st.manifest is null or jsonb_typeof(action_->'rows') is distinct from 'array' or coalesce(action_->>'batchKey','') !~ '^[a-f0-9]{64}$' then raise exception 'HISTORY_BATCH_INVALID';end if;
  perform public.experimental_history_check_page_hashes(p_attempt);
  perform public.experimental_concert_validate_manifest(p_attempt,st.manifest);
  for row_ in select value from jsonb_array_elements(action_->'rows') loop
   if not exists(select 1 from jsonb_array_elements(st.manifest) m where m.value=row_) then raise exception 'HISTORY_BATCH_NOT_IN_MANIFEST';end if;
  end loop;
  batch_key:=action_->>'batchKey';batch_id:=(substr(batch_key,1,8)||'-'||substr(batch_key,9,4)||'-'||substr(batch_key,13,4)||'-'||substr(batch_key,17,4)||'-'||substr(batch_key,21,12))::uuid;
  perform public.experimental_concert_history_insert(p_attempt,p_owner,p_generation,batch_id,action_->'rows');
 elsif kind_='verify_and_complete' then
  if st.manifest is null or action_->>'manifestHash' is distinct from st.manifest_hash then raise exception 'HISTORY_MANIFEST_INVALID';end if;
  perform public.experimental_history_check_page_hashes(p_attempt);
  insert into public.experimental_concert_history_terminal_lease values(p_attempt,p_owner,p_generation);
  update public.experimental_concert_history_state set operation=null,revision=revision+1,progress=jsonb_set(p_reservation->'progress','{phase}','"completed"'::jsonb,true) where singleton;
  perform public.experimental_concert_history_complete(p_attempt,p_owner,p_generation,st.manifest);
  return true;
 else raise exception 'HISTORY_INTENT_INVALID';end if;
 update public.experimental_concert_history_state set operation=null,revision=revision+1,
  updated_at=clock_timestamp(),progress=(p_reservation->'progress')||jsonb_build_object('pagesRead',(select count(*) from public.experimental_concert_history_pages where attempt_id=p_attempt),
   'recordsSaved',(select coalesce(sum(jsonb_array_length(payload)),0) from public.experimental_concert_history_receipts where attempt_id=p_attempt)) where singleton;
 return true;
end $$;

create function public.experimental_history_reconcile_db(p_attempt uuid,p_owner uuid,p_generation bigint,p_operation text)
returns text language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner or st.lease_generation is distinct from p_generation
  or st.lease_until is null or st.lease_until<=clock_timestamp() then raise exception 'HISTORY_LEASE_LOST';end if;
 -- Absence of a pending intent alone does not prove which operation committed.
 if st.operation is null then return 'no_pending_intent';end if;
 if st.operation->>'id' is distinct from p_operation then raise exception 'HISTORY_INTENT_MISMATCH';end if;
 if (st.operation->>'generation')::bigint>=p_generation then raise exception 'HISTORY_GENERATION_NOT_FENCED';end if;
 if st.operation#>>'{action,kind}'='fetch_page' then return 'external_reconciliation_required';end if;
 update public.experimental_concert_history_state set operation=null,revision=revision+1 where singleton;
 return 'no_commit_confirmed';
end $$;

revoke all on table public.experimental_concert_history_terminal_lease from public,anon,authenticated,service_role;
revoke all on function public.experimental_history_check_page_hashes(uuid) from public,anon,authenticated,service_role;
revoke all on function public.experimental_history_read(uuid,uuid,bigint),public.experimental_history_begin(uuid,uuid,bigint,text,jsonb),public.experimental_history_apply(uuid,uuid,bigint,jsonb,jsonb),public.experimental_history_reconcile_db(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;


-- Component: dispatch.sql
create table public.experimental_history_dispatch (
 attempt_id uuid primary key,
 dispatch_token uuid not null unique,
 status text not null check (status in ('reserved','unknown','confirmed')),
 workflow_id text,
 created_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz,
 check ((status in ('reserved','unknown') and workflow_id is null and confirmed_at is null)
     or (status='confirmed' and workflow_id is not null and length(workflow_id) between 1 and 256 and confirmed_at is not null))
);

create function public.experimental_history_reserve_dispatch(p_attempt uuid,p_token uuid)
returns table(acquired boolean,current_state text) language plpgsql security invoker set search_path=pg_catalog,public as $$
declare s public.experimental_concert_history_state;
begin
 if p_attempt is null or p_token is null then raise exception 'HISTORY_DISPATCH_INVALID'; end if;
 select * into strict s from public.experimental_concert_history_state where singleton for update;
 if s.state <> 'pending' then return query select false,s.state; return; end if;
 update public.experimental_concert_history_state set state='running',attempt_id=p_attempt,
  started_at=clock_timestamp(),updated_at=clock_timestamp() where singleton;
 insert into public.experimental_history_dispatch(attempt_id,dispatch_token,status) values(p_attempt,p_token,'reserved');
 return query select true,'running'::text;
end $$;

create function public.experimental_history_dispatch_unknown(p_attempt uuid,p_token uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare s public.experimental_concert_history_state; d public.experimental_history_dispatch;
begin
 if p_attempt is null or p_token is null then raise exception 'HISTORY_DISPATCH_INVALID';end if;
 select * into strict s from public.experimental_concert_history_state where singleton for update;
 if s.attempt_id is distinct from p_attempt or s.state not in ('running','uncertain') then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 select * into strict d from public.experimental_history_dispatch where attempt_id=p_attempt for update;
 if d.dispatch_token is distinct from p_token then raise exception 'HISTORY_DISPATCH_TOKEN_MISMATCH';end if;
 if d.status='confirmed' then raise exception 'HISTORY_DISPATCH_ALREADY_CONFIRMED';end if;
 if s.state='uncertain' and s.reason is distinct from 'dispatch_unknown' then raise exception 'HISTORY_OTHER_UNCERTAINTY';end if;
 update public.experimental_history_dispatch set status='unknown' where attempt_id=p_attempt;
 update public.experimental_concert_history_state set state='uncertain',reason='dispatch_unknown',updated_at=clock_timestamp() where singleton;
end $$;

create function public.experimental_history_confirm_dispatch(p_attempt uuid,p_token uuid,p_workflow text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare d public.experimental_history_dispatch; s public.experimental_concert_history_state;
begin
 if p_attempt is null or p_token is null or p_workflow is null or length(p_workflow) not between 1 and 256 then raise exception 'HISTORY_DISPATCH_INVALID';end if;
 select * into strict s from public.experimental_concert_history_state where singleton for update;
 if s.attempt_id is distinct from p_attempt or s.state not in ('running','uncertain') then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 select * into strict d from public.experimental_history_dispatch where attempt_id=p_attempt for update;
 if d.dispatch_token is distinct from p_token then raise exception 'HISTORY_DISPATCH_TOKEN_MISMATCH';end if;
 if d.status='confirmed' then
  if d.workflow_id is distinct from p_workflow then raise exception 'HISTORY_DISPATCH_RECEIPT_CHANGED';end if;
  return;
 end if;
 update public.experimental_history_dispatch set status='confirmed',workflow_id=p_workflow,confirmed_at=clock_timestamp() where attempt_id=p_attempt;
end $$;

revoke all on table public.experimental_history_dispatch from public,anon,authenticated,service_role;
revoke all on function public.experimental_history_reserve_dispatch(uuid,uuid),public.experimental_history_confirm_dispatch(uuid,uuid,text),public.experimental_history_dispatch_unknown(uuid,uuid) from public,anon,authenticated,service_role;


-- Component: dispatch-journal.sql
alter function public.experimental_history_confirm_dispatch(uuid,uuid,text) rename to experimental_history_confirm_dispatch_unchecked;
create function public.experimental_history_confirm_dispatch(p_attempt uuid,p_token uuid,p_workflow text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 perform public.experimental_history_confirm_dispatch_unchecked(p_attempt,p_token,p_workflow);
 -- A late receipt is evidence, not permission to resume an uncertain attempt.
 if st.state='running' then
  update public.experimental_concert_history_state set dispatch='confirmed',updated_at=clock_timestamp() where singleton;
 end if;
end $$;
revoke all on function public.experimental_history_confirm_dispatch(uuid,uuid,text) from public,anon,authenticated,service_role;


-- Component: worker-inert.sql
alter table public.worker_tasks drop constraint worker_tasks_task_type_check;
alter table public.worker_tasks add constraint worker_tasks_task_type_check
 check (task_type in ('prepare_run','enrich_record','match_run','process_run','historical_concerts'));
alter table public.worker_tasks drop constraint worker_tasks_target_check;
alter table public.worker_tasks add constraint worker_tasks_target_check check (
 (task_type in ('prepare_run','match_run','process_run') and run_id is not null and source_record_id is null)
 or (task_type='enrich_record' and source_record_id is not null and (run_id is null or executor='vercel_workflow'))
 or (task_type='historical_concerts' and run_id is null and source_record_id is null and pipeline_job_id is null and executor='vercel_workflow')
);

create function public.experimental_guard_history_worker() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then
  if old.task_type='historical_concerts' then raise exception 'HISTORY_TASK_INERT';end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.task_type='historical_concerts' or new.task_type='historical_concerts') then raise exception 'HISTORY_TASK_INERT';end if;
 if new.task_type='historical_concerts' and (new.status<>'failed' or new.execution_state<>'paused' or new.lease_owner is not null or new.lease_generation<>0 or new.lease_until is not null or new.workflow_id is not null or new.dispatch_at is not null) then
  raise exception 'HISTORY_TASK_INERT';
 end if;
 return new;
end $$;
create trigger experimental_guard_history_worker before insert or update or delete on public.worker_tasks
for each row execute function public.experimental_guard_history_worker();

create table public.experimental_history_worker_link (
 attempt_id uuid primary key references public.experimental_history_dispatch(attempt_id),
 task_id uuid not null unique references public.worker_tasks(id)
);

create function public.experimental_history_park_task(p_attempt uuid,p_token uuid,p_task uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r record;
begin
 if p_task is null then raise exception 'HISTORY_TASK_INVALID';end if;
 select * into strict r from public.experimental_history_reserve_dispatch(p_attempt,p_token);
 if not r.acquired then return false;end if;
 insert into public.worker_tasks(id,task_type,executor,status,execution_state,failure_kind,error_message,completed_at)
 values(p_task,'historical_concerts','vercel_workflow','failed','paused','history_not_activated','Recuperació històrica pendent d’activació segura',clock_timestamp());
 insert into public.experimental_history_worker_link(attempt_id,task_id) values(p_attempt,p_task);
 return true;
end $$;
revoke all on table public.experimental_history_worker_link from public,anon,authenticated,service_role;
revoke all on function public.experimental_guard_history_worker(),public.experimental_history_park_task(uuid,uuid,uuid) from public,anon,authenticated,service_role;


-- Component: dispatch-authorization.sql
alter function public.experimental_history_park_task(uuid,uuid,uuid) rename to experimental_history_park_task_unchecked;
create function public.experimental_history_park_task(p_attempt uuid,p_token uuid,p_task uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare acquired boolean;
begin
 acquired:=public.experimental_history_park_task_unchecked(p_attempt,p_token,p_task);
 if acquired then
  update public.experimental_concert_history_state set source_contract='user_requested',
   retrieved_at=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where singleton;
 end if;
 return acquired;
end $$;
revoke all on function public.experimental_history_park_task(uuid,uuid,uuid) from public,anon,authenticated,service_role;


-- Component: worker-cancel.sql
alter table public.experimental_concert_history_state add column cancel_requested boolean not null default false;
create function public.experimental_history_request_stop(p_attempt uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 if p_attempt is null then raise exception 'HISTORY_ATTEMPT_REQUIRED';end if;
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt then raise exception 'HISTORY_ATTEMPT_STALE';end if;
 if st.state='completed' then return false;end if;
 if st.state not in ('running','uncertain') then raise exception 'HISTORY_NOT_RUNNING';end if;
 if not st.cancel_requested then
  update public.experimental_concert_history_state set cancel_requested=true,updated_at=clock_timestamp() where singleton;
 end if;
 return true;
end $$;
revoke all on function public.experimental_history_request_stop(uuid) from public,anon,authenticated,service_role;


-- Component: status.sql
create function public.experimental_history_status()
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 select jsonb_build_object(
  'state',case
   when s.state='completed' then 'completed'
   when s.cancel_requested and s.lease_until>statement_timestamp() then 'stopping'
   when s.cancel_requested then 'review_required'
   when s.state='uncertain' then 'review_required'
   when s.state='pending' then 'not_started'
   when d.status='unknown' then 'review_required'
   when s.state='running' and d.status='reserved' and s.updated_at<statement_timestamp()-interval '1 minute' then 'review_required'
   when s.state='running' and d.status='reserved' then 'starting'
   when s.state='running' and d.status='confirmed' and s.lease_until>statement_timestamp() then 'running'
   when s.state='running' and d.status='confirmed' and s.lease_generation=0 and s.updated_at>=statement_timestamp()-interval '1 minute' then 'starting'
   when s.state='running' and d.status='confirmed' then 'review_required'
   when w.execution_state='paused' then 'disabled'
   else 'review_required' end,
  'reason',case
   when s.cancel_requested then 'stop_requested'
   when s.state='uncertain' and s.reason='dispatch_unknown' then 'dispatch_unconfirmed'
   when s.state='uncertain' then 'operation_unconfirmed'
   when d.status='unknown' then 'dispatch_unconfirmed'
   when s.state='running' and d.status='reserved' and s.updated_at<statement_timestamp()-interval '1 minute' then 'dispatch_unconfirmed'
   when s.state='running' and d.status='reserved' then 'dispatch_pending'
   when s.state='running' and d.status='confirmed' and s.lease_until>statement_timestamp() then null
   when s.state='running' and d.status='confirmed' and s.lease_generation=0 and s.updated_at>=statement_timestamp()-interval '1 minute' then 'dispatch_pending'
   when s.state='running' and d.status='confirmed' then 'execution_interrupted'
   when s.state='running' and w.execution_state='paused' then 'executor_unavailable'
   when s.state='running' then 'state_unconfirmed'
   else null end,
  'button_enabled',false,
  'pages_saved',coalesce((select count(*) from public.experimental_concert_history_pages p where p.attempt_id=s.attempt_id),0),
  'pages_total',s.progress->'pagesTotal',
  'records_saved',s.progress->'recordsSaved',
  'records_total',s.progress->'recordsTotal',
  'phase',s.progress->'phase',
  'updated_at',s.updated_at
 ) from public.experimental_concert_history_state s
 left join public.experimental_history_dispatch d on d.attempt_id=s.attempt_id
 left join public.experimental_history_worker_link l on l.attempt_id=s.attempt_id
 left join public.worker_tasks w on w.id=l.task_id where s.singleton;
$$;
revoke all on function public.experimental_history_status() from public,anon,authenticated,service_role;


-- Component: worker-claim.sql
create function public.experimental_history_worker_claim(p_attempt uuid,p_task uuid,p_workflow text,p_owner uuid)
returns bigint language plpgsql security invoker set search_path=pg_catalog,public as $$
declare s public.experimental_concert_history_state; d public.experimental_history_dispatch;
 t public.worker_tasks; linked uuid;
begin
 if p_attempt is null or p_task is null or p_owner is null or p_workflow is null or length(p_workflow) not between 1 and 256 then raise exception 'HISTORY_WORKER_INVALID';end if;
 if not public.processing_is_enabled() then return null;end if;
 -- A stable order: switch, state, dispatch, worker. Must stay compatible with the
 -- reservation and confirmation transaction lock order.
 select * into strict s from public.experimental_concert_history_state where singleton for update;
 if s.attempt_id is distinct from p_attempt or s.state<>'running' or s.cancel_requested then return null;end if;
 select * into strict d from public.experimental_history_dispatch where attempt_id=p_attempt for update;
 if d.status<>'confirmed' or d.workflow_id is distinct from p_workflow then return null;end if;
 select task_id into linked from public.experimental_history_worker_link where attempt_id=p_attempt;
 if linked is distinct from p_task then return null;end if;
 select * into strict t from public.worker_tasks where id=p_task for update;
 if t.task_type<>'historical_concerts' or t.executor<>'vercel_workflow' or t.status<>'failed' or t.execution_state<>'paused' then return null;end if;
 return public.experimental_concert_history_claim(p_attempt,p_owner);
end $$;
revoke all on function public.experimental_history_worker_claim(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;


-- Component: worker-adapter-guard.sql
alter function public.experimental_history_begin(uuid,uuid,bigint,text,jsonb) rename to experimental_history_begin_unchecked;
alter function public.experimental_history_apply(uuid,uuid,bigint,jsonb,jsonb) rename to experimental_history_apply_unchecked;
create function public.experimental_history_begin(p_attempt uuid,p_owner uuid,p_generation bigint,p_revision text,p_reservation jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not public.processing_is_enabled() then raise exception 'PROCESSING_DISABLED';end if;
 perform 1 from public.experimental_concert_history_state where singleton and not cancel_requested for update;
 if not found then raise exception 'HISTORY_STOP_REQUESTED';end if;
 return public.experimental_history_begin_unchecked(p_attempt,p_owner,p_generation,p_revision,p_reservation);
end $$;
create function public.experimental_history_apply(p_attempt uuid,p_owner uuid,p_generation bigint,p_reservation jsonb,p_result jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 -- Preserve an already returned external response even when paused. All other
 -- effects, including import and completion, stay pending until reconciliation.
 if p_reservation#>>'{action,kind}' is distinct from 'fetch_page' then
  if not public.processing_is_enabled() then raise exception 'PROCESSING_DISABLED';end if;
  perform 1 from public.experimental_concert_history_state where singleton and not cancel_requested for update;
  if not found then raise exception 'HISTORY_STOP_REQUESTED';end if;
 end if;
 return public.experimental_history_apply_unchecked(p_attempt,p_owner,p_generation,p_reservation,p_result);
end $$;
create function public.experimental_history_page_permitted(p_attempt uuid,p_owner uuid,p_generation bigint)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 if not public.processing_is_enabled() then return false;end if;
 select * into strict st from public.experimental_concert_history_state where singleton for share;
 return not st.cancel_requested and st.attempt_id=p_attempt and st.state='running' and st.lease_owner=p_owner and st.lease_generation=p_generation
  and st.lease_until>clock_timestamp() and st.operation#>>'{action,kind}'='fetch_page' and st.dispatch='confirmed' and st.source_contract in ('verified','user_requested');
end $$;
revoke all on function public.experimental_history_begin(uuid,uuid,bigint,text,jsonb),public.experimental_history_apply(uuid,uuid,bigint,jsonb,jsonb),public.experimental_history_page_permitted(uuid,uuid,bigint) from public,anon,authenticated,service_role;
create function public.experimental_history_worker_resume(p_attempt uuid,p_task uuid,p_workflow text,p_owner uuid,p_generation bigint)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 if not public.processing_is_enabled() then return false;end if;
 select * into strict st from public.experimental_concert_history_state where singleton for share;
 return coalesce(not st.cancel_requested and st.attempt_id=p_attempt and st.state='running' and st.lease_owner=p_owner and st.lease_generation=p_generation
  and st.lease_until>clock_timestamp() and exists(select 1 from public.experimental_history_dispatch d
   join public.experimental_history_worker_link l on l.attempt_id=d.attempt_id
   join public.worker_tasks w on w.id=l.task_id
   where d.attempt_id=p_attempt and d.status='confirmed' and d.workflow_id=p_workflow and l.task_id=p_task
   and w.task_type='historical_concerts' and w.executor='vercel_workflow' and w.status='failed' and w.execution_state='paused'),false);
end $$;
revoke all on function public.experimental_history_worker_resume(uuid,uuid,text,uuid,bigint) from public,anon,authenticated,service_role;
create function public.experimental_history_worker_terminal(p_attempt uuid,p_task uuid,p_workflow text,p_owner uuid,p_generation bigint)
returns boolean language sql stable security invoker set search_path=pg_catalog,public as $$
 select exists(select 1 from public.experimental_concert_history_state s
  join public.experimental_history_dispatch d on d.attempt_id=s.attempt_id
  join public.experimental_history_worker_link l on l.attempt_id=s.attempt_id
  join public.experimental_concert_history_terminal_lease t on t.attempt_id=s.attempt_id
  where s.singleton and s.state='completed' and s.attempt_id=p_attempt
   and d.status='confirmed' and d.workflow_id=p_workflow and l.task_id=p_task
   and t.owner=p_owner and t.generation=p_generation);
$$;
revoke all on function public.experimental_history_worker_terminal(uuid,uuid,text,uuid,bigint) from public,anon,authenticated,service_role;


-- Component: dispatch-wait.sql
create function public.experimental_history_dispatch_state(p_attempt uuid,p_task uuid,p_workflow text)
returns text language sql stable security invoker set search_path=pg_catalog,public as $$
 select case
  when s.attempt_id is distinct from p_attempt or l.task_id is distinct from p_task then 'blocked'
  when s.cancel_requested or s.state<>'running' then 'review_required'
  when d.status='reserved' then 'waiting'
  when d.status='confirmed' and d.workflow_id=p_workflow and s.dispatch='confirmed' then 'confirmed'
  else 'review_required' end
 from public.experimental_concert_history_state s
 left join public.experimental_history_dispatch d on d.attempt_id=s.attempt_id
 left join public.experimental_history_worker_link l on l.attempt_id=s.attempt_id
 where s.singleton;
$$;
revoke all on function public.experimental_history_dispatch_state(uuid,uuid,text) from public,anon,authenticated,service_role;


-- Component: service-grants.sql
do $$ declare signature text; begin
 foreach signature in array array[
  'experimental_history_park_task(uuid,uuid,uuid)',
  'experimental_history_confirm_dispatch(uuid,uuid,text)',
  'experimental_history_dispatch_unknown(uuid,uuid)',
  'experimental_history_request_stop(uuid)',
  'experimental_history_dispatch_state(uuid,uuid,text)',
  'experimental_history_worker_claim(uuid,uuid,text,uuid)',
  'experimental_history_worker_resume(uuid,uuid,text,uuid,bigint)',
  'experimental_history_worker_terminal(uuid,uuid,text,uuid,bigint)',
  'experimental_history_page_permitted(uuid,uuid,bigint)',
  'experimental_history_read(uuid,uuid,bigint)',
  'experimental_history_begin(uuid,uuid,bigint,text,jsonb)',
  'experimental_history_apply(uuid,uuid,bigint,jsonb,jsonb)',
  'experimental_history_reconcile_db(uuid,uuid,bigint,text)',
  'experimental_history_status()'
 ] loop
  execute format('alter function public.%s security definer',signature);
  execute format('revoke all on function public.%s from public,anon,authenticated,service_role',signature);
  execute format('grant execute on function public.%s to service_role',signature);
 end loop;
end $$;


-- A bounded workflow must never look completed when its step budget is reached.
create function public.experimental_history_limit_exceeded(p_attempt uuid,p_task uuid,p_workflow text,p_owner uuid,p_generation bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare st public.experimental_concert_history_state;
begin
 select * into strict st from public.experimental_concert_history_state where singleton for update;
 if st.attempt_id is distinct from p_attempt or st.state<>'running' or st.lease_owner is distinct from p_owner
  or st.lease_generation is distinct from p_generation or st.lease_until is null or st.lease_until<=clock_timestamp()
  or not exists(select 1 from public.experimental_history_dispatch d join public.experimental_history_worker_link l on l.attempt_id=d.attempt_id
    where d.attempt_id=p_attempt and d.status='confirmed' and d.workflow_id=p_workflow and l.task_id=p_task)
  then return false;end if;
 update public.experimental_concert_history_state set state='uncertain',reason='step_limit',lease_owner=null,lease_until=null,updated_at=clock_timestamp() where singleton;
 return true;
end $$;
revoke all on function public.experimental_history_limit_exceeded(uuid,uuid,text,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.experimental_history_limit_exceeded(uuid,uuid,text,uuid,bigint) to service_role;
