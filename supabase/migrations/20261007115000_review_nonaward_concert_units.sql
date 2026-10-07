-- Reviewing an amendment or renewal validates its evidence, but must not create
-- a second award in service_provisions before its predecessor and effect are known.
create or replace function public.review_record_unit(p_unit uuid,p_expected_job uuid,p_approve boolean,p_note text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare u record_units;r source_records;j pipeline_jobs;base service_provisions;pid uuid;begin
 select source_record_id into strict pid from record_units where id=p_unit;
 select * into strict r from source_records where id=pid for update;
 select * into strict u from record_units where id=p_unit for update;
 select * into strict j from pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1;
 if j.id is distinct from p_expected_job or j.id is distinct from u.pipeline_job_id or j.status not in ('approved','corrected') then raise exception 'Revisió obsoleta';end if;
 if u.unit_key='legacy' or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar la decisió de la unitat';end if;
 if u.status='approved' then select id into pid from service_provisions where unit_id=u.id;return pid;end if;
 if u.status<>'draft' then raise exception 'Unitat ja revisada';end if;
 if not p_approve then update record_units set status='rejected',review_note=p_note,reviewed_at=now() where id=u.id;return null;end if;
 if not exists(select 1 from eligible_official_services where version_id=u.catalog_version_id and service_code=u.service_code) then raise exception 'Servei no assignable';end if;
 if not exists(select 1 from source_documents where id=u.document_id and source_record_id=r.id and status='fetched' and not extraction_partial and not(coalesce(quality_flags,'{}') && array['corrupt_text','incomplete_extraction']) and position(regexp_replace(u.evidence_quote,'\s+',' ','g') in regexp_replace(extracted_text,'\s+',' ','g'))>0) then raise exception 'Evidència canviada o no llegible';end if;
 if u.act_type<>'award' then
  update record_units set status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
  return null;
 end if;
 select p.* into strict base from service_provisions p join record_units legacy on legacy.id=p.unit_id where p.source_record_id=r.id and legacy.unit_key='legacy';
 insert into service_provisions(unit_id,source_record_id,source_id,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,review_decision_id,approved_at,call_url,regulatory_basis_url,centre,period,act_type,annex_reference)
 values(u.id,r.id,base.source_id,u.provider_name,u.provider_nif,base.mechanism,base.award_date,u.amount,base.contracting_body,base.target_population,base.source_reference,u.service_code,u.catalog_version_id,base.review_decision_id,now(),base.call_url,base.regulatory_basis_url,u.centre,u.period,u.act_type,(select url from source_documents where id=u.document_id)||' · p. '||u.page)
 returning id into pid;
 update service_provisions set superseded_at=coalesce(superseded_at,now()) where id=base.id;
 delete from entity_catalog_relations where source_type='provision' and source_reference=base.id::text;
 update record_units set status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
 return pid;
end $$;
revoke all on function public.review_record_unit(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.review_record_unit(uuid,uuid,boolean,text) to service_role;
