-- Each explicitly awarded operative clause becomes a documentary draft. It is
-- never assigned an amount or a catalog code from a tariff or entity name.
create function public.cloud_stage_concert_resolc_line(
 p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_document uuid,p_line jsonb
) returns uuid language plpgsql security invoker set search_path=public as $$
declare j public.pipeline_jobs;d public.source_documents;r public.source_records;u public.record_units;uid uuid;identity text;quote text;nif text;reses text;name text;service text;centre_name text;territory_name text;quantity_value integer;row_number integer;page_header text;page_start integer;next_page integer;page_text text;
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 select * into strict j from public.pipeline_jobs where id=p_job;
 if not exists(select 1 from public.worker_tasks t where t.id=p_task and (t.run_id=j.run_id or t.source_record_id=j.source_record_id)) then raise exception 'CLOUD_SCOPE';end if;
 select * into strict r from public.source_records where id=j.source_record_id;
 if r.financing_type<>'concert' then raise exception 'CONCERT_SCOPE';end if;
 select * into strict d from public.source_documents where id=p_document and source_record_id=r.id and status='fetched'
  and mime_type like '%pdf%' and not coalesce(extraction_partial,false) and storage_path is not null and storage_sha256 is not null;
 if coalesce(d.quality_flags,'{}') && array['corrupt_text','incomplete_extraction'] then raise exception 'CONCERT_DOCUMENT_QUALITY';end if;
 quote:=trim(p_line->>'quote');nif:=nullif(trim(p_line->>'nif'),'');reses:=nullif(trim(p_line->>'resesCode'),'');
 name:=trim(p_line->>'providerName');service:=trim(p_line->>'serviceName');centre_name:=trim(p_line->>'centre');
 territory_name:=nullif(trim(p_line->>'territory'),'');quantity_value:=(p_line->>'quantity')::integer;row_number:=coalesce((p_line->>'row')::integer,1);
 if row_number<1 or row_number>1000 or coalesce((p_line->>'page')::integer,0)<1 or coalesce(quantity_value,0)<1 or coalesce(length(name),0)<3 or coalesce(length(service),0)<8 or coalesce(length(centre_name),0)<3
  or (nif is not null and nif !~ '^[A-Z][0-9]{7}[0-9A-Z]$') or (reses is not null and reses !~ '^S[0-9]{5}$')
  or coalesce(length(quote),0)<80 or position(regexp_replace(quote,'\s+',' ','g') in regexp_replace(d.extracted_text,'\s+',' ','g'))=0
  or position(name in quote)=0 or position(service in quote)=0 or position(centre_name in quote)=0
  or (nif is not null and position(nif in quote)=0) or (reses is not null and position(reses in quote)=0)
  or (territory_name is not null and position(territory_name in quote)=0)
  or quote !~* ('\m'||quantity_value::text||'\s+places\M')
 then raise exception 'CONCERT_RESOLC_INVALID';end if;
 -- Page evidence must be in that physical page, not merely somewhere in the PDF.
 if position('## Pàgina ' in d.extracted_text)>0 then
  page_header:='## Pàgina '||(p_line->>'page')||E'\n';
  page_start:=position(page_header in d.extracted_text);
  if page_start=0 or (page_start>1 and substring(d.extracted_text from page_start-1 for 1)<>E'\n') then raise exception 'CONCERT_RESOLC_PAGE_INVALID';end if;
  page_text:=substring(d.extracted_text from page_start+length(page_header));
  next_page:=position(E'\n## Pàgina ' in page_text);
  if next_page>0 then page_text:=substring(page_text from 1 for next_page-1);end if;
  if position(regexp_replace(quote,'\s+',' ','g') in regexp_replace(page_text,'\s+',' ','g'))=0 then raise exception 'CONCERT_RESOLC_PAGE_INVALID';end if;
 elsif (p_line->>'page')::integer<>1 then raise exception 'CONCERT_RESOLC_PAGE_INVALID';end if;
 identity:='official-resolc:'||d.storage_sha256||':'||row_number::text;
 if exists(select 1 from public.record_units where source_record_id=r.id and document_id=d.id and unit_key like 'official-resolc:'||d.storage_sha256||':%' and unit_key<>identity and evidence_quote=quote) then raise exception 'CONCERT_DUPLICATE_CLAUSE';end if;
 select * into u from public.record_units where source_record_id=r.id and unit_key=identity;
 if found then
  if u.document_id<>d.id or u.observed_provider_name is distinct from name or u.provider_nif is distinct from nif
   or u.observed_service_name is distinct from service or u.centre is distinct from centre_name or u.reses_code is distinct from reses
   or u.territory is distinct from territory_name or u.quantity is distinct from quantity_value or u.evidence_quote is distinct from quote
  then raise exception 'CONCERT_LINE_CHANGED';end if;
  return u.id;
 end if;
 insert into public.record_units(source_record_id,unit_key,provider_nif,observed_provider_name,observed_service_name,
  centre,reses_code,territory,quantity,act_type,amount,document_id,page,evidence_quote,status,extraction_origin,horizon_state)
 values(r.id,identity,nif,name,service,centre_name,reses,territory_name,quantity_value,'award',null,d.id,(p_line->>'page')::integer,quote,'draft','official-resolc-v1','in_scope')
 returning id into uid;
 return uid;
end $$;
revoke all on function public.cloud_stage_concert_resolc_line(uuid,uuid,bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_stage_concert_resolc_line(uuid,uuid,bigint,uuid,uuid,jsonb) to service_role;
