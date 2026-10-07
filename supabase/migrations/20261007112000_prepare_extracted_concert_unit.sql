create function public.prepare_extracted_concert_unit(
 p_unit uuid,p_expected_job uuid,p_provider_name text,p_service_code text
) returns uuid language plpgsql security invoker set search_path=public as $$
declare u record_units; j pipeline_jobs; s official_services; d source_documents;
begin
 select * into strict u from record_units where id=p_unit for update;
 if u.status<>'draft' or u.extraction_origin is null then raise exception 'Només es poden completar propostes documentals pendents'; end if;
 if nullif(trim(p_provider_name),'') is null or length(trim(p_provider_name))<3 then raise exception 'Cal identificar l’entitat prestadora'; end if;
 if u.provider_nif is null or u.reses_code is null or u.document_id is null or u.page is null then raise exception 'La línia no té identificadors o font suficients'; end if;
 select * into strict j from pipeline_jobs where source_record_id=u.source_record_id order by created_at desc,id desc limit 1;
 if j.id is distinct from p_expected_job or j.status not in ('approved','corrected') then raise exception 'Cal validar el registre vigent abans de revisar aquesta línia'; end if;
 if u.observed_service_code is distinct from p_service_code then raise exception 'El codi ha de coincidir amb el que consta a l’annex'; end if;
 select * into strict s from eligible_official_services where service_code=p_service_code;
 select * into strict d from source_documents where id=u.document_id and source_record_id=u.source_record_id and status='fetched' and not extraction_partial;
 if position(u.provider_nif in u.evidence_quote)=0 or position(u.reses_code in u.evidence_quote)=0 or position(p_service_code in u.evidence_quote)=0
   or position(regexp_replace(u.evidence_quote,'\s+',' ','g') in regexp_replace(d.extracted_text,'\s+',' ','g'))=0 then
  raise exception 'La cita no acredita NIF, RESES i codi de servei';
 end if;
 update record_units set pipeline_job_id=j.id,provider_name=trim(p_provider_name),service_code=s.service_code,catalog_version_id=s.version_id
  where id=u.id;
 return u.id;
end $$;
revoke all on function public.prepare_extracted_concert_unit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_extracted_concert_unit(uuid,uuid,text,text) to service_role;
