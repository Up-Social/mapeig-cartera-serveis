do $$
declare
  record_id uuid:='aaaaaaaa-0000-4000-8000-000000000001';
  run_id uuid;
  job_id uuid;
  version_id text;
  failed boolean:=false;
begin
  insert into pipeline_runs default values returning id into run_id;
  insert into pipeline_jobs(run_id,source_record_id,status)
  values(run_id,record_id,'needs_review') returning id into job_id;
  select id into version_id from catalog_versions where active and validated limit 1;
  insert into analysis_results(
    pipeline_job_id,source_record_id,catalog_version_id,rules_version,
    classification,reasons,explanation,service_description,target_population,evidence
  ) values(
    job_id,record_id,version_id,'test','insufficient_evidence','[]',
    'Explicació fictícia','Servei fictici','Població fictícia','[{"content":"fixture"}]'
  );

  perform review_analysis(record_id,'insufficient',null,null,'Falta evidència en client antic');
  if not exists(
    select 1 from review_decisions
    where source_record_id=record_id and classification='insufficient_evidence'
  ) then raise exception 'La transició antiga no ha delegat la decisió segura'; end if;

  begin
    perform review_analysis(record_id,'reject',null,null,'Motiu sense estructura');
  exception when others then
    failed:=position('motius estructurats' in sqlerrm)>0;
  end;
  if not failed then raise exception 'El descart antic ha de fallar tancat'; end if;
end $$;
