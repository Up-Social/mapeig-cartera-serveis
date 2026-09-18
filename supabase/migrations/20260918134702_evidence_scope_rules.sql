alter table public.analysis_results add column rule_audit jsonb, add column model_conclusion jsonb;
create or replace function public.persist_analysis(p_job uuid,p_version text,p_result jsonb,p_candidates jsonb,p_evidence jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs; candidate jsonb; cid uuid; ev jsonb; position integer:=0;
begin
 select * into strict j from pipeline_jobs where id=p_job for update;
 if exists(select 1 from analysis_results where pipeline_job_id=p_job) then raise exception 'Anàlisi ja completada'; end if;
 if not exists(select 1 from catalog_versions where id=p_version and active and validated) then raise exception 'Catàleg no validat'; end if;
 if ((p_result->>'classification')='in_portfolio')<>(jsonb_array_length(p_candidates)>0) then raise exception 'Classificació incompatible amb candidats'; end if;
 if jsonb_array_length(p_candidates)>3 or jsonb_array_length(p_evidence)=0 then raise exception 'Contracte invàlid'; end if;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit,model_conclusion)
 values(p_job,j.source_record_id,p_version,coalesce(p_result->'rule_audit'->>'version','leaf-normative-v1'),p_result->>'classification',p_result->'reasons',p_result->>'explanation',p_result->>'service_description',p_result->>'target_population',p_evidence,p_result->'rule_audit',p_result->'model_conclusion');
 delete from matching_candidates where pipeline_job_id=p_job;
 for candidate in select value from jsonb_array_elements(p_candidates) loop
  position:=position+1;
  insert into matching_candidates(pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,rank,score,rationale,engine,engine_version,raw_response)
  select p_job,'official',p_version,candidate->>'code',service_name,position,(candidate->>'score')::numeric,candidate->>'rationale','openai-responses',candidate->>'model',candidate->'metadata' from official_services where version_id=p_version and service_code=candidate->>'code' returning id into cid;
  if cid is null then raise exception 'Codi desconegut'; end if;
  for ev in select value from jsonb_array_elements(candidate->'evidence') loop
   insert into matching_candidate_evidence(candidate_id,evidence_chunk_id,explanation) values(cid,(ev->>'id')::uuid,candidate->>'evidence_explanation');
  end loop;
 end loop;
 update pipeline_jobs set status='needs_review',completed_at=now() where id=p_job;
 update source_records set processing_status='revisio',updated_at=now() where id=j.source_record_id;
end $$;
revoke all on function public.persist_analysis(uuid,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.persist_analysis(uuid,text,jsonb,jsonb,jsonb) to service_role;
