create function public.review_analysis(p_record uuid,p_outcome text,p_candidate uuid default null,p_code text default null,p_notes text default null) returns void language plpgsql security invoker set search_path=public as $$
declare r source_records; j pipeline_jobs; a analysis_results; c matching_candidates; s official_services; e record_enrichments; decision text; classification text; rid uuid; pid uuid; note text:=nullif(trim(p_notes),'');
begin
 if p_outcome not in ('select','reject','insufficient','outside') then raise exception 'Decisió no vàlida'; end if;
 select * into strict r from source_records where id=p_record for update;
 select * into strict j from pipeline_jobs where source_record_id=p_record order by created_at desc,id desc limit 1 for update;
 if j.status in ('queued','ready','matching') then raise exception 'El procés encara no ha finalitzat'; end if;
 select * into a from analysis_results where pipeline_job_id=j.id for update;
 if p_outcome<>'select' and note is null then raise exception 'Cal indicar el motiu'; end if;
 if exists(select 1 from review_decisions where source_record_id=p_record) and note is null then raise exception 'Cal justificar la rectificació'; end if;
 if p_outcome='select' then
  if p_candidate is not null then select * into strict c from matching_candidates where id=p_candidate and pipeline_job_id=j.id; end if;
  select os.* into strict s from eligible_official_services os where os.service_code=coalesce(nullif(trim(p_code),''),c.target_code);
  if (p_code is not null or c.rank is distinct from 1) and note is null then raise exception 'Cal justificar la correcció'; end if;
  classification:='in_portfolio';decision:=case when c.rank=1 and p_code is null then 'approved' else 'corrected' end;
 else
  classification:=case p_outcome when 'outside' then 'out_of_portfolio' when 'reject' then 'discarded' else 'insufficient_evidence' end;
  if p_outcome='outside' and a.id is null then raise exception 'Cal una anàlisi normativa abans de marcar fora de cartera'; end if;
  decision:=case when p_outcome='insufficient' then 'insufficient_evidence' else 'rejected' end;
 end if;
 insert into review_decisions(source_record_id,previous_code,final_code,decision,reason,reviewer) values(p_record,r.cartera_code,s.service_code,decision,note,'local_user') returning id into rid;
 insert into matching_evaluations(pipeline_job_id,candidate_id,verdict,expected_code,notes,evaluator) values(j.id,c.id,case when p_outcome='select' then 'correct' when p_outcome='insufficient' then 'insufficient_evidence' else 'incorrect' end,s.service_code,note,'local_user');
 select id into pid from service_provisions where source_record_id=p_record;
 delete from entity_catalog_relations where relation_type='confirmed' and source_type='provision' and source_reference=pid::text;
 if p_outcome='select' then
  select * into e from record_enrichments where source_record_id=p_record;
  insert into service_provisions(source_record_id,source_id,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,matching_candidate_id,review_decision_id,approved_at,call_url,regulatory_basis_url)
  values(p_record,split_part(r.source_record_id,'::',1),coalesce(e.provider_name,r.provider_name),e.provider_nif,coalesce(e.mechanism,r.mechanism),e.award_date,coalesce(e.amount,r.amount),e.contracting_body,e.target_population,r.source_dataset||'/'||r.source_record_id,s.service_code,s.version_id,c.id,rid,now(),
   coalesce(nullif(r.source_payload->>'Enlace de la última publicación',''),nullif(r.source_payload->>'Document conveni',''),nullif(r.source_payload->>'Enllaç convocatòria',''),(select url from source_documents where source_record_id=p_record and document_type in ('publication','agreement','contracting_profile') order by created_at limit 1)),
   (select url from source_documents where source_record_id=p_record and document_type='regulatory_basis' order by created_at limit 1))
  on conflict(source_record_id) do update set provider_name=excluded.provider_name,provider_nif=excluded.provider_nif,mechanism=excluded.mechanism,award_date=excluded.award_date,amount=excluded.amount,contracting_body=excluded.contracting_body,target_population=excluded.target_population,service_code=excluded.service_code,catalog_version_id=excluded.catalog_version_id,historical_master_code=null,matching_candidate_id=excluded.matching_candidate_id,review_decision_id=excluded.review_decision_id,approved_at=excluded.approved_at,call_url=excluded.call_url,regulatory_basis_url=excluded.regulatory_basis_url,updated_at=now();
 else delete from service_provisions where source_record_id=p_record; end if;
 update source_records set cartera_code=s.service_code,cartera_name=s.service_name,confidence=c.score,evidence=case when p_outcome='select' then coalesce(c.rationale,note) else null end,processing_status=(case when p_outcome='select' or p_outcome='outside' then 'completat' when p_outcome='reject' then 'rebutjat' else 'sense_evidencia' end)::processing_status,updated_at=now() where id=p_record;
 update analysis_results set reviewed_classification=classification,review_notes=note,reviewed_at=now() where id=a.id;
 update pipeline_jobs set status=decision where id=j.id;
 perform refresh_pipeline_run(j.run_id);
end $$;
revoke all on function public.review_analysis(uuid,text,uuid,text,text) from public;
grant execute on function public.review_analysis(uuid,text,uuid,text,text) to service_role;
create view public.current_analysis_results with (security_invoker=true) as
 select a.* from public.analysis_results a join public.pipeline_jobs j on j.id=a.pipeline_job_id
 where not exists(select 1 from public.pipeline_jobs newer where newer.source_record_id=j.source_record_id and (newer.created_at,newer.id)>(j.created_at,j.id));
grant select on public.current_analysis_results to service_role;
