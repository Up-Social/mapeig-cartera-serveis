-- Synthetic records only; the SQL runner wraps this file in a rollback.
do $$
declare sample record; sid uuid; run_id uuid; job_id uuid; candidate_id uuid; v_catalog text; code text; actual numeric;
begin
 if has_function_privilege('anon','public.contract_imported_award(jsonb,numeric)','execute')
   or has_function_privilege('authenticated','public.contract_imported_award(jsonb,numeric)','execute')
   or not has_function_privilege('service_role','public.contract_imported_award(jsonb,numeric)','execute') then
  raise exception 'TEST: incorrect award helper privileges';
 end if;
 select id into strict v_catalog from catalog_versions where active and validated;
 select service_code into strict code from eligible_official_services where version_id=v_catalog limit 1;
 for sample in select * from (values
  ('award', '{"Importe de adjudicación":700,"Presupuesto de licitación":1000}'::jsonb,700::numeric,900::numeric,700::numeric,'contractacions','contractacio'),
  ('zero', '{"Importe de adjudicación":0,"Presupuesto de licitación":1000}'::jsonb,0::numeric,900::numeric,0::numeric,'contractacions','contractacio'),
  ('decimal', '{"Importe de adjudicación":"12,50"}'::jsonb,12.50::numeric,900::numeric,12.50::numeric,'contractacions','contractacio'),
  ('tender', '{"Importe de adjudicación":null,"Presupuesto de licitación":1000}'::jsonb,1000::numeric,700::numeric,null::numeric,'contractacions','contractacio'),
  ('estimated', '{"Valor estimado del contrato":1000}'::jsonb,1000::numeric,700::numeric,null::numeric,'contractacions','contractacio'),
  ('missing', '{}'::jsonb,null::numeric,700::numeric,null::numeric,'contractacions','contractacio'),
  ('invalid', '{"Importe de adjudicación":"1.000,00","Presupuesto de licitación":1000}'::jsonb,1000::numeric,700::numeric,null::numeric,'contractacions','contractacio'),
  ('stale', '{"Importe de adjudicación":700}'::jsonb,701::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('exponent', '{"Importe de adjudicación":"1e3"}'::jsonb,1000::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('precision-string', '{"Importe de adjudicación":"1.00000000000000001"}'::jsonb,1::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('precision-number', '{"Importe de adjudicación":1.00000000000000001}'::jsonb,1::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('unsafe-euros', '{"Importe de adjudicación":70368744177664}'::jsonb,70368744177664::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('whitespace', '{"Importe de adjudicación":" 700 "}'::jsonb,700::numeric,900::numeric,null::numeric,'contractacions','contractacio'),
  ('wrong-type', '{"Importe de adjudicación":700}'::jsonb,700::numeric,900::numeric,null::numeric,'contractacions','subvencio'),
  ('wrong-dataset', '{"Importe de adjudicación":700}'::jsonb,700::numeric,900::numeric,null::numeric,'raisc_local','contractacio'),
  ('grant', '{}'::jsonb,22::numeric,33::numeric,22::numeric,'raisc_local','subvencio'),
  ('grant-document', '{}'::jsonb,null::numeric,33::numeric,33::numeric,'raisc_local','subvencio')
 ) as cases(label,payload,source_amount,document_amount,expected,dataset,financing_type) loop
  sid:=gen_random_uuid();
  insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,source_payload,amount)
  values(sid,sample.dataset,sid::text,'Mecanisme sintètic','Registre de prova',sample.financing_type,sample.payload,sample.source_amount);
  -- The import trigger ordinarily aligns these fields; direct privileged writes
  -- can nevertheless leave inconsistent historical records.
  if sample.label in ('wrong-type','wrong-dataset') then
   update source_records set financing_type=sample.financing_type where id=sid;
  end if;
  insert into pipeline_runs default values returning id into run_id;
  insert into pipeline_jobs(run_id,source_record_id,status) values(run_id,sid,'needs_review') returning id into job_id;
  insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
  values(job_id,sid,v_catalog,'fixture','insufficient_evidence','[]','Explicació sintètica','Servei sintètic','Població sintètica','[{"content":"fixture"}]');
  insert into record_enrichments(source_record_id,amount,summary,confidence,engine,engine_version)
  values(sid,sample.document_amount,'Extracció sintètica',0.5,'mock','fixture');
  insert into matching_candidates(pipeline_job_id,target_catalog,catalog_version_id,target_code,target_name,rank,score,rationale,engine,engine_version)
  values(job_id,'official',v_catalog,code,'Servei sintètic',1,0.8,'Evidència sintètica','mock','fixture') returning id into candidate_id;
  perform review_analysis(sid,'select',job_id,'{}',candidate_id,null,'Aprovació sintètica');
  select amount into actual from service_provisions where source_record_id=sid;
  if not found or actual is distinct from sample.expected then
   raise exception 'TEST: incorrect provision for %: expected %, got %',sample.label,sample.expected,actual;
  end if;
 end loop;
end $$;
