-- Supplementary sources are proposals: they never modify the awarded row or
-- authorize an economic balance. Retain the actual captured text, not just a URL.
create table public.concert_supplemental_geography (
 id bigint generated always as identity primary key,
 unit_id uuid not null references public.record_units(id),
 source_record_id uuid not null references public.source_records(id),
 document_id uuid not null references public.source_documents(id),
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 unit_fingerprint text not null check(unit_fingerprint ~ '^[a-f0-9]{32}$'),
 source_url text not null check(source_url ~ '^https://[^[:space:]]+$' and length(source_url)<=2048),
 source_captured_at timestamptz not null,
 source_bytes bytea not null check(octet_length(source_bytes) between 20 and 4000000),
 source_text text not null check(length(source_text) between 20 and 1000000),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_text_sha256 text not null check(source_text_sha256 ~ '^[a-f0-9]{64}$'),
 source_quote text not null check(length(source_quote) between 20 and 4000),
 scope_marker text not null, service_marker text not null,
 municipality text not null check(length(btrim(municipality)) between 1 and 100),
 county text, province text, reference jsonb,
 created_at timestamptz not null default clock_timestamp(),
 check((county is null and province is null and reference is null) or
       (county is not null and province is not null and jsonb_typeof(reference)='object'))
);
create index concert_supplemental_geography_unit_idx on public.concert_supplemental_geography(unit_id,id desc);
alter table public.concert_supplemental_geography enable row level security;
revoke all on public.concert_supplemental_geography from public,anon,authenticated,service_role;
grant select on public.concert_supplemental_geography to service_role;

create function public.propose_concert_supplemental_geography(
 p_unit uuid,p_fingerprint text,p_document_sha256 text,p_url text,p_captured_at timestamptz,
 p_source_bytes bytea,p_source_text text,p_source_sha256 text,p_source_text_sha256 text,p_quote text,p_scope_marker text,p_service_marker text,
 p_municipality text,p_county text,p_province text,p_reference jsonb
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare u public.record_units; d public.source_documents; id_ bigint;
begin
 select * into strict u from public.record_units where id=p_unit for share;
 if u.unit_key='legacy' or not exists(select 1 from public.source_records r where r.id=u.source_record_id and r.financing_type='concert')
  or md5(jsonb_build_array(u.unit_key,u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.amount,u.quantity_delta,u.evidence_quote)::text) is distinct from p_fingerprint then raise exception 'SUPPLEMENTAL_GEOGRAPHY_UNIT_CHANGED'; end if;
 select * into strict d from public.source_documents where id=u.document_id and source_record_id=u.source_record_id for share;
 if d.status is distinct from 'fetched' or d.storage_sha256 is distinct from p_document_sha256
  or u.storage_sha256 is distinct from p_document_sha256 or d.storage_path is null
  or d.extraction_partial is distinct from false or d.extraction_coverage->>'complete' is distinct from 'true'
  or d.active_extraction_id is null or coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
  or d.extracted_text is null or d.extracted_text_hash is null
  or d.extracted_text_hash is distinct from encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex') then raise exception 'SUPPLEMENTAL_GEOGRAPHY_DOCUMENT_CHANGED'; end if;
 if p_source_bytes is null or p_source_sha256 is distinct from encode(extensions.digest(p_source_bytes,'sha256'),'hex')
  or p_source_text is null or p_source_text_sha256 is distinct from encode(extensions.digest(convert_to(p_source_text,'UTF8'),'sha256'),'hex')
  or p_quote is null or length(btrim(p_quote))<20
  or position(regexp_replace(btrim(p_quote),'\s+',' ','g') in regexp_replace(p_source_text,'\s+',' ','g'))=0
  or p_municipality is null or length(btrim(p_municipality))=0
  or position(lower(btrim(p_municipality)) in lower(p_quote))=0
  or length(btrim(coalesce(p_scope_marker,'')))<4 or length(btrim(coalesce(p_service_marker,'')))<4
  or position(lower(btrim(p_scope_marker)) in lower(p_source_text))=0
  or position(lower(btrim(p_scope_marker)) in lower(d.extracted_text))=0
  or position(lower(btrim(p_service_marker)) in lower(p_quote))=0
  or position(lower(btrim(p_service_marker)) in lower(coalesce(u.observed_service_name,'')||' '||coalesce(u.evidence_quote,'')))=0
  or p_captured_at is null or p_captured_at>clock_timestamp() then raise exception 'SUPPLEMENTAL_GEOGRAPHY_EVIDENCE'; end if;
 if p_reference is not null and (p_reference->>'municipality' is distinct from p_municipality
  or p_reference->>'county' is distinct from p_county or p_reference->>'province' is distinct from p_province
  or coalesce(p_reference->>'municipalityCode','') !~ '^[0-9]{6}$'
  or coalesce(p_reference->>'sha256','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_reference->>'sourceUrl','') !~ '^https://www[.]idescat[.]cat/codis([/?#]|$)') then
  raise exception 'SUPPLEMENTAL_GEOGRAPHY_REFERENCE'; end if;
 perform pg_advisory_xact_lock(hashtextextended('supplemental-geography:'||p_unit::text,0));
 select id into id_ from public.concert_supplemental_geography where unit_id=p_unit and unit_fingerprint=p_fingerprint
  and document_sha256=p_document_sha256 and source_sha256=p_source_sha256 and source_text_sha256=p_source_text_sha256 and source_url=p_url
  and source_quote=p_quote and municipality=p_municipality and county is not distinct from p_county
  and scope_marker=p_scope_marker and service_marker=p_service_marker
  and province is not distinct from p_province and reference is not distinct from p_reference order by id desc limit 1;
 if id_ is not null then return id_; end if;
 insert into public.concert_supplemental_geography(unit_id,source_record_id,document_id,document_sha256,unit_fingerprint,
  source_url,source_captured_at,source_bytes,source_text,source_sha256,source_text_sha256,source_quote,scope_marker,service_marker,municipality,county,province,reference)
 values(u.id,u.source_record_id,d.id,p_document_sha256,p_fingerprint,p_url,p_captured_at,p_source_bytes,p_source_text,p_source_sha256,p_source_text_sha256,p_quote,p_scope_marker,p_service_marker,
  p_municipality,p_county,p_province,p_reference) returning id into id_;
 return id_;
end $$;
revoke all on function public.propose_concert_supplemental_geography(uuid,text,text,text,timestamptz,bytea,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.propose_concert_supplemental_geography(uuid,text,text,text,timestamptz,bytea,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

create view public.current_concert_supplemental_geography with(security_invoker=true) as
 select distinct on(g.unit_id) g.id,g.unit_id,g.source_record_id,g.municipality,g.county,g.province,
  g.source_url,g.source_quote,g.source_captured_at,g.source_sha256,g.reference
 from public.concert_supplemental_geography g
 join public.record_units u on u.id=g.unit_id and u.source_record_id=g.source_record_id and u.document_id=g.document_id
  and u.storage_sha256=g.document_sha256 and md5(jsonb_build_array(u.unit_key,u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.amount,u.quantity_delta,u.evidence_quote)::text)=g.unit_fingerprint
 join public.source_documents d on d.id=g.document_id and d.source_record_id=g.source_record_id
  and d.storage_sha256=g.document_sha256 and d.status='fetched' and d.storage_path is not null
 where g.source_sha256=encode(extensions.digest(g.source_bytes,'sha256'),'hex')
  and g.source_text_sha256=encode(extensions.digest(convert_to(g.source_text,'UTF8'),'sha256'),'hex')
  and d.extraction_partial=false and d.extraction_coverage->>'complete'='true' and d.active_extraction_id is not null
  and not(coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'])
  and d.extracted_text_hash=encode(extensions.digest(convert_to(d.extracted_text,'UTF8'),'sha256'),'hex')
  and position(lower(g.scope_marker) in lower(d.extracted_text))>0
 order by g.unit_id,g.id desc;
revoke all on public.current_concert_supplemental_geography from public,anon,authenticated;
grant select on public.current_concert_supplemental_geography to service_role;
