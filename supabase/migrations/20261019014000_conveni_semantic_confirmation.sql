-- A positive conveni decision requires an explicit human check of social
-- purpose, population and catalog fit. Existing proposals/decisions are preserved.
-- Keep the default false so older clients cannot silently attest new positives.
drop function public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text);
create function public.review_conveni_unit(p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_outcome text,p_code text,p_note text,p_social_confirmed boolean default false) returns void
language plpgsql security invoker set search_path=public,storage as $$
declare r source_records;a conveni_analyses;u record_units;d jsonb;citation jsonb;doc source_documents;s official_services;rid uuid;chosen_classification text;latest uuid;total numeric;parts numeric;
begin
 select * into strict r from source_records where id=p_record for update;
 select * into strict a from conveni_analyses where job_id=p_job and source_record_id=r.id;
 if exists(select 1 from conveni_review_events where id=p_event and source_record_id=r.id and job_id=p_job and unit_id=p_unit and outcome=p_outcome and service_code is not distinct from p_code and reason=p_note and coalesce((snapshot->'semantic_confirmation'->>'confirmed')::boolean,false)=coalesce(p_social_confirmed,false)) then return;end if;
 if p_job is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) or a.source_hash is distinct from conveni_source_hash(r.id) then raise exception 'Revisió obsoleta' using errcode='40001';end if;
 if p_outcome not in ('select','reject','outside','insufficient') or length(trim(coalesce(p_note,'')))<10 then raise exception 'Cal justificar la decisió';end if;
 if p_outcome in ('select','outside') and not coalesce(p_social_confirmed,false) then raise exception 'Cal confirmar la naturalesa social, la població i l’encaix revisats al document';end if;
 select * into strict u from record_units where id=p_unit and source_record_id=r.id for update;
 select id into latest from conveni_review_events where unit_id=u.id order by created_at desc,id desc limit 1;
 if latest is distinct from p_previous then raise exception 'Revisió concurrent' using errcode='40001';end if;
 select data into strict d from conveni_unit_proposals where job_id=p_job and unit_id=u.id;
 if p_outcome in ('select','outside') then
  if d->>'classification' not in ('in_portfolio','out_of_portfolio') or coalesce(d->>'population','')='' or coalesce(d->>'description','')='' then raise exception 'Servei i població no acreditats';end if;
  for citation in select value from jsonb_array_elements(d->'evidence') loop
   select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id;
   if doc.status<>'fetched' or doc.extraction_partial or a.document_revisions->>doc.id::text is distinct from doc.storage_sha256||':'||coalesce(doc.active_extraction_id::text,'') or position(regexp_replace(citation->>'quote','\s+',' ','g') in regexp_replace(doc.extracted_text,'\s+',' ','g'))=0 then raise exception 'Evidència canviada';end if;
  end loop;
 end if;
 if p_outcome='select' then
  if exists(select 1 from jsonb_each_text(a.document_revisions) rev left join source_documents d on d.id::text=rev.key where d.id is null or d.status<>'fetched' or d.extraction_partial or rev.value is distinct from d.storage_sha256||':'||coalesce(d.active_extraction_id::text,'')) then raise exception 'Cobertura documental canviada';end if;
  if coalesce(jsonb_array_length(d->'blockers'),1)>0 or d->>'recipient_nature'<>'private' or (d->>'joint')::boolean or (d->>'mixed')::boolean or d->>'recipient_nif' is null or (d->>'amount_cents')::numeric is null then raise exception 'Import o receptor pendent de resoldre';end if;
  total:=conveni_public_amount(r.source_payload)*100;
  select sum((value->>'amount_cents')::numeric) into parts from jsonb_array_elements(a.payload->'units');
  if total is null or parts+coalesce((a.payload->>'unallocated_cents')::numeric,-1)<>total or not (a.payload->>'coverage_complete')::boolean then raise exception 'Imports no conciliats';end if;
  select os.* into strict s from eligible_official_services os where os.version_id=a.catalog_version_id and os.service_code=p_code;
  if exists(select 1 from record_units other join service_provisions p on p.unit_id=other.id and p.superseded_at is null join conveni_current_units c on c.unit_id=other.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' where other.source_record_id=r.id and other.id<>u.id and public.normalize_matching_identity(other.provider_name)=public.normalize_matching_identity(d->>'recipient') and p.service_code<>s.service_code) then raise exception 'Un únic servei principal per entitat';end if;
 end if;
 chosen_classification:=case p_outcome when 'select' then 'in_portfolio' when 'reject' then 'discarded' when 'outside' then 'out_of_portfolio' else 'insufficient_evidence' end;
 insert into conveni_review_events(id,source_record_id,job_id,unit_id,outcome,service_code,reason,actor,snapshot)
 values(p_event,r.id,p_job,u.id,p_outcome,p_code,p_note,'local_user',jsonb_build_object('proposal',d,'previous_unit',to_jsonb(u),'semantic_confirmation',jsonb_build_object('confirmed',coalesce(p_social_confirmed,false),'classification',chosen_classification,'service_code',p_code,'service_name',s.service_name,'catalog_version',a.catalog_version_id,'document_revisions',a.document_revisions,'reason',p_note)));
 insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer,final_code)
 values(r.id,p_job,chosen_classification,case when p_outcome='reject' then array[coalesce(d->>'reason','manual_scope')] else '{}' end,case when p_outcome='select' then 'approved' when p_outcome='insufficient' then 'insufficient_evidence' else 'rejected' end,p_note,'local_user',s.service_code) returning id into rid;
 -- Supersede the aggregate and the previous revision, never delete historical provisions.
 update service_provisions set superseded_at=coalesce(superseded_at,now()) where source_record_id=r.id and (unit_id=u.id or unit_id in(select id from record_units where source_record_id=r.id and unit_key='legacy'));
 if p_outcome='select' then
  citation:=d->'evidence'->0;
  -- The API archives the new source for this item before calling the atomic review.
  select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id;
  update record_units set document_id=doc.id,storage_sha256=doc.storage_sha256,storage_path='cases/'||r.id||'/items/'||u.id||'/documents/'||doc.id||'/'||split_part(doc.storage_path,'/',5),pipeline_job_id=p_job,provider_name=d->>'recipient',provider_nif=d->>'recipient_nif',period=d->>'period',amount=(d->>'amount_cents')::numeric/100,service_code=s.service_code,catalog_version_id=s.version_id,page=(citation->>'page')::integer,evidence_quote=citation->>'quote',status='approved',review_note=p_note,reviewed_at=now() where id=u.id;
  insert into service_provisions(unit_id,source_record_id,source_id,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,review_decision_id,approved_at,call_url,regulatory_basis_url,period,act_type,annex_reference)
  values(u.id,r.id,r.source_record_id,d->>'recipient',d->>'recipient_nif','Conveni',imported_priority_value('convenis',r.source_payload,'date')::date,(d->>'amount_cents')::numeric/100,(select string_agg(value, '; ') from jsonb_array_elements_text(d->'financiers')),d->>'population','Registre de Convenis de Col·laboració i Cooperació',s.service_code,s.version_id,rid,now(),r.source_payload->>'Document conveni',null,d->>'period','award',(citation->>'document_id')||' · p. '||(citation->>'page'))
  on conflict(unit_id) do update set provider_name=excluded.provider_name,provider_nif=excluded.provider_nif,amount=excluded.amount,service_code=excluded.service_code,catalog_version_id=excluded.catalog_version_id,review_decision_id=excluded.review_decision_id,period=excluded.period,contracting_body=excluded.contracting_body,target_population=excluded.target_population,superseded_at=null,approved_at=now(),updated_at=now();
 else
  update record_units set status=case when p_outcome='insufficient' then 'draft' else 'rejected' end,review_note=p_note,reviewed_at=now() where id=u.id;
 end if;
 -- Keep mixed cases in review until every current unit has a decision for this job.
 if exists(select 1 from conveni_unit_proposals cp where cp.job_id=p_job and not exists(select 1 from (select e.job_id,e.outcome from conveni_review_events e where e.unit_id=cp.unit_id order by e.created_at desc,e.id desc limit 1) latest where latest.job_id=p_job and latest.outcome<>'insufficient')) then
  update pipeline_jobs set status='needs_review' where id=p_job;
  update source_records set processing_status='revisio' where id=r.id;
 else
  update pipeline_jobs set status=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'approved' when chosen_classification='insufficient_evidence' then 'insufficient_evidence' else 'rejected' end where id=p_job;
  update source_records set processing_status=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'completat'::processing_status when chosen_classification='out_of_portfolio' then 'completat'::processing_status when chosen_classification='insufficient_evidence' then 'sense_evidencia'::processing_status else 'rebutjat'::processing_status end where id=r.id;
 end if;
 update analysis_results set reviewed_classification=case when exists(select 1 from service_provisions p join conveni_current_units c on c.unit_id=p.unit_id where c.source_record_id=r.id and c.job_id=p_job and c.reviewed_job=p_job and c.outcome='select' and p.superseded_at is null) then 'in_portfolio' else chosen_classification end,review_notes='Decisions individuals a les unitats del conveni',reviewed_at=now() where pipeline_job_id=p_job;
 perform refresh_pipeline_run((select run_id from pipeline_jobs where id=p_job));
end $$;

revoke all on function public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.review_conveni_unit(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean) to service_role;
