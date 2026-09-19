do $$
declare
  record_id uuid:='aaaaaaaa-0000-4000-8000-000000000001';
  run_id uuid;
  job_id uuid;
  selected_version text;
  selected_code text;
  candidate_id uuid;
  decision_id uuid;
  affected integer;
begin
  insert into pipeline_runs default values returning id into run_id;
  insert into pipeline_jobs(run_id,source_record_id,status)
  values(run_id,record_id,'approved') returning id into job_id;

  select service.version_id,service.service_code
  into selected_version,selected_code
  from eligible_official_services service
  order by service.service_code
  limit 1;

  insert into matching_candidates(
    pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,
    rank,score,rationale,engine,engine_version
  ) values(
    job_id,'official',selected_version,selected_code,'Fixture',1,0.9,
    'Evidència fictícia','mock','mock'
  ) returning id into candidate_id;

  insert into review_decisions(
    source_record_id,previous_code,final_code,decision,reason,reviewer
  ) values(
    record_id,null,selected_code,'approved','Revisió històrica fictícia','fixture'
  ) returning id into decision_id;

  insert into service_provisions(
    source_record_id,source_id,mechanism,source_reference,service_code,
    catalog_version_id,matching_candidate_id,review_decision_id
  ) values(
    record_id,'fixture','Subvenció','fixture/'||record_id,selected_code,
    selected_version,candidate_id,decision_id
  );

  select backfill_provable_legacy_reviews() into affected;

  if affected<>1 then
    raise exception 'Cal recuperar exactament una revisió, no %',affected;
  end if;
  if not exists(
    select 1 from review_decisions
    where id=decision_id
      and pipeline_job_id=job_id
      and classification='in_portfolio'
  ) then
    raise exception 'No s''ha recuperat la relació històrica demostrable';
  end if;
  if not exists(
    select 1 from current_record_results
    where id=record_id and destination='approved' and human_reviewed
  ) then
    raise exception 'El resultat vigent no reflecteix l''aprovació recuperada';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon','public.backfill_provable_legacy_reviews()','execute')
    or has_function_privilege('authenticated','public.backfill_provable_legacy_reviews()','execute') then
    raise exception 'La recuperació històrica no pot quedar exposada';
  end if;
  if not has_function_privilege('service_role','public.backfill_provable_legacy_reviews()','execute') then
    raise exception 'El servidor ha de poder executar la recuperació històrica';
  end if;
end $$;
