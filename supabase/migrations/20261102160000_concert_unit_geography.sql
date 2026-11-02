-- Documentary geography is supplemental. Do not add columns to record_units:
-- its complete row is already fingerprinted by economic and population reviews.
create table public.concert_unit_geography (
 unit_id uuid primary key references public.record_units(id),
 source_record_id uuid not null references public.source_records(id),
 document_id uuid not null references public.source_documents(id),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 extracted_text_hash text not null check(extracted_text_hash ~ '^[a-f0-9]{64}$'),
 unit_source_fingerprint text not null check(unit_source_fingerprint ~ '^[a-f0-9]{32}$'),
 page integer not null check(page>0),
 municipality text, county text, province text,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 updated_at timestamptz not null default clock_timestamp()
);
create index concert_unit_geography_record_idx on public.concert_unit_geography(source_record_id);
comment on column public.concert_unit_geography.unit_source_fingerprint is
 'Hash of documentary row anchors only: review status, reviewed_at and prepared service_code are excluded so normal human review does not invalidate unchanged geography.';
alter table public.concert_unit_geography enable row level security;
revoke all on public.concert_unit_geography from public,anon,authenticated,service_role;
grant select,insert,update on public.concert_unit_geography to service_role;

create function public.cloud_store_concert_geography(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_unit uuid,p_geography jsonb
) returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.pipeline_jobs;u public.record_units;d public.source_documents;
 page_ integer;start_ integer;end_ integer;page_text text;page_header text;at_ integer;
 raw_ text;header_ text;quote_ text;municipality_ text;county_ text;province_ text;
 cell_ text;reference_ jsonb;fingerprint_ text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task
  and (t.run_id=j.run_id or t.source_record_id=j.source_record_id))
  or not exists(select 1 from public.source_records where id=j.source_record_id and financing_type='concert') then
  raise exception 'CONCERT_GEOGRAPHY_SCOPE';
 end if;
 select * into strict u from public.record_units where id=p_unit and source_record_id=j.source_record_id for update;
 if u.unit_key='legacy' or u.document_id is null then raise exception 'CONCERT_GEOGRAPHY_UNIT';end if;
 select * into strict d from public.source_documents where id=u.document_id and source_record_id=j.source_record_id for update;
 if jsonb_typeof(p_geography) is distinct from 'object'
  or d.status is distinct from 'fetched' or d.mime_type is distinct from 'application/pdf'
  or d.extraction_partial is distinct from false or d.extraction_coverage->>'complete' is distinct from 'true'
  or d.storage_path is null or d.active_extraction_id is null
  or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
  or d.storage_sha256 is distinct from u.storage_sha256
  or d.storage_sha256 is distinct from p_geography->>'document_sha256'
  or d.extracted_text_hash is distinct from p_geography->>'extracted_text_hash'
  or d.extracted_text is null or d.extracted_text_hash is null
  or d.extracted_text_hash is distinct from encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex') then
  raise exception 'CONCERT_GEOGRAPHY_SOURCE_CHANGED';
 end if;
 if jsonb_typeof(p_geography->'page') is distinct from 'number'
  or jsonb_typeof(p_geography->'columnStart') is distinct from 'number'
  or jsonb_typeof(p_geography->'columnEnd') is distinct from 'number'
  or (p_geography->>'page') !~ '^[0-9]+$'
  or (p_geography->>'columnStart') !~ '^[0-9]+$'
  or (p_geography->>'columnEnd') !~ '^[0-9]+$' then raise exception 'CONCERT_GEOGRAPHY_OFFSETS';end if;
 page_:=(p_geography->>'page')::integer;start_:=(p_geography->>'columnStart')::integer;end_:=(p_geography->>'columnEnd')::integer;
 raw_:=p_geography->>'rawLine';header_:=p_geography->>'headerQuote';quote_:=p_geography->>'rowQuote';
 municipality_:=nullif(btrim(regexp_replace(p_geography->>'municipality','\s+',' ','g')),'');
 county_:=nullif(btrim(p_geography->>'county'),'');province_:=nullif(btrim(p_geography->>'province'),'');
 if page_<1 or page_ is distinct from u.page or start_<1 or end_<=start_ or end_-start_>150
  or raw_ is null or header_ is null or quote_ is null or municipality_ is null
  or raw_ ~ E'[\r\n\t]' or header_ ~ E'[\r\n\t]'
  or length(raw_)>4000 or length(header_)>4000 or end_>length(raw_) or end_+3>length(header_)
  or exists(select 1 from regexp_split_to_table(raw_||header_,'') ch where ascii(ch)>65535)
  or btrim(regexp_replace(raw_,'\s+',' ','g')) is distinct from btrim(regexp_replace(u.evidence_quote,'\s+',' ','g'))
  or btrim(regexp_replace(quote_,'\s+',' ','g')) is distinct from btrim(regexp_replace(u.evidence_quote,'\s+',' ','g')) then
  raise exception 'CONCERT_GEOGRAPHY_ROW_MISMATCH';
 end if;
 -- The column ends at the first IVA after Municipi. A later cost heading may
 -- also say "IVA inclòs si escau"; it is not a second municipality boundary.
 -- Neither boundary may cut a printed word.
 if substring(header_ from start_+1 for 8)<>'Municipi'
  or substring(header_ from end_+1 for 3)<>'IVA'
  or (select count(*) from regexp_matches(header_,'\mMunicipi\M','g'))<>1
  or position('IVA' in substring(header_ from start_+1))<>end_-start_+1
  or substring(header_ from end_ for 1)!~ '\s'
  or (end_+3<length(header_) and substring(header_ from end_+4 for 1)!~ '\s')
  or (substring(raw_ from start_ for 1)!~ '\s' and substring(raw_ from start_+1 for 1)!~ '\s')
  or (substring(raw_ from end_ for 1)!~ '\s' and substring(raw_ from end_+1 for 1)!~ '\s') then
  raise exception 'CONCERT_GEOGRAPHY_COLUMN_MISMATCH';
 end if;
 cell_:=btrim(regexp_replace(substring(raw_ from start_+1 for end_-start_),'\s+',' ','g'));
 if cell_ is distinct from municipality_ then raise exception 'CONCERT_GEOGRAPHY_MUNICIPALITY_MISMATCH';end if;
 -- Physical page, exact complete header/row lines, and a header preceding the
 -- row. Searching the municipality anywhere in the PDF would be insufficient.
 page_header:='## Pàgina '||page_::text||E'\n';
 at_:=position(page_header in d.extracted_text);
 if at_=0 or (at_>1 and substring(d.extracted_text from at_-1 for 1)<>E'\n')
  or position(page_header in substring(d.extracted_text from at_+length(page_header)))>0 then
  raise exception 'CONCERT_GEOGRAPHY_PAGE_MISMATCH';
 end if;
 page_text:=split_part(substring(d.extracted_text from at_+length(page_header)),E'\n## Pàgina ',1);
 if (select count(*) from regexp_split_to_table(page_text,E'\n') line where line=raw_)<>1
  or (select count(*) from regexp_split_to_table(page_text,E'\n') line where line=header_)<>1
  or position(header_ in page_text)>=position(raw_ in page_text) then
  raise exception 'CONCERT_GEOGRAPHY_PAGE_MISMATCH';
 end if;
 -- The service supplies the pinned official reference dataset. These checks
 -- bind its values and provenance; SQL does not fetch or independently certify
 -- the remote CSV. County/province are reference data, not literal PDF claims.
 reference_:=p_geography->'reference';
 if reference_ is null or reference_='null'::jsonb then
  if county_ is not null or province_ is not null then raise exception 'CONCERT_GEOGRAPHY_REFERENCE_REQUIRED';end if;
 else
  if jsonb_typeof(reference_) is distinct from 'object'
   or coalesce(reference_->>'municipalityCode','') !~ '^[0-9]{6}$'
   or coalesce(reference_->>'sha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(reference_->>'sourceUrl','') !~ '^https://www[.]idescat[.]cat/codis([/?#]|$)'
   or lower(btrim(regexp_replace(reference_->>'municipality','\s+',' ','g'))) is distinct from lower(municipality_)
   or county_ is distinct from nullif(btrim(reference_->>'county'),'')
   or province_ is distinct from nullif(btrim(reference_->>'province'),'') then
   raise exception 'CONCERT_GEOGRAPHY_REFERENCE_MISMATCH';
  end if;
 end if;
 -- Bind the documentary row, not its later human-review state. This does not
 -- change the separate fingerprints used by economic or population reviews.
 fingerprint_:=md5(jsonb_build_array(u.unit_key,u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.amount,u.quantity_delta,u.evidence_quote)::text);
 insert into public.concert_unit_geography as stored(unit_id,source_record_id,document_id,document_sha256,extracted_text_hash,
  unit_source_fingerprint,page,municipality,county,province,evidence)
 values(u.id,j.source_record_id,d.id,d.storage_sha256,d.extracted_text_hash,fingerprint_,page_,municipality_,county_,province_,p_geography)
 on conflict(unit_id) do update set source_record_id=excluded.source_record_id,document_id=excluded.document_id,
  document_sha256=excluded.document_sha256,extracted_text_hash=excluded.extracted_text_hash,unit_source_fingerprint=excluded.unit_source_fingerprint,
  page=excluded.page,municipality=excluded.municipality,county=excluded.county,province=excluded.province,evidence=excluded.evidence,updated_at=clock_timestamp()
 where (stored.source_record_id,stored.document_id,stored.document_sha256,stored.extracted_text_hash,stored.unit_source_fingerprint,stored.page,stored.municipality,stored.county,stored.province,stored.evidence)
  is distinct from (excluded.source_record_id,excluded.document_id,excluded.document_sha256,excluded.extracted_text_hash,excluded.unit_source_fingerprint,excluded.page,excluded.municipality,excluded.county,excluded.province,excluded.evidence);
 return u.id;
end $$;
revoke all on function public.cloud_store_concert_geography(uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_store_concert_geography(uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;

create view public.current_concert_unit_geography with(security_invoker=true) as
select g.* from public.concert_unit_geography g
join public.source_records r on r.id=g.source_record_id and r.financing_type='concert'
join public.record_units u on u.id=g.unit_id and u.source_record_id=g.source_record_id
 and u.document_id=g.document_id and u.storage_sha256=g.document_sha256 and u.page=g.page
 and md5(jsonb_build_array(u.unit_key,u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.amount,u.quantity_delta,u.evidence_quote)::text)=g.unit_source_fingerprint
join public.source_documents d on d.id=g.document_id and d.source_record_id=g.source_record_id
 and d.storage_sha256=g.document_sha256 and d.extracted_text_hash=g.extracted_text_hash
where d.status='fetched' and d.mime_type='application/pdf' and d.extraction_partial=false
 and d.extraction_coverage->>'complete'='true' and d.storage_path is not null and d.active_extraction_id is not null
 and not(coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'])
 and d.extracted_text_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex');
revoke all on public.current_concert_unit_geography from public,anon,authenticated;
grant select on public.current_concert_unit_geography to service_role;
