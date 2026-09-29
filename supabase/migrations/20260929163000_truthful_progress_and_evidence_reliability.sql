alter table public.worker_tasks
  add column current_step text check (current_step is null or current_step in ('document_discovery','document_extraction','ocr','enrichment','matching','closing')),
  add column progress_job_id uuid references public.pipeline_jobs(id) on delete set null,
  add column progress_completed integer check (progress_completed is null or progress_completed >= 0),
  add column progress_total integer check (progress_total is null or progress_total >= 0),
  add column progress_detail text;

create function public.cloud_progress(
  p_task uuid,
  p_owner uuid,
  p_generation bigint,
  p_step text,
  p_completed integer default null,
  p_total integer default null,
  p_detail text default null,
  p_job uuid default null
) returns void
language plpgsql
security invoker
set search_path=public
as $$
begin
  perform public.cloud_assert_lease(p_task,p_owner,p_generation);
  if p_step not in ('document_discovery','document_extraction','ocr','enrichment','matching','closing')
    or p_completed < 0 or p_total < 0 or p_completed > p_total then
    raise exception 'CLOUD_PROGRESS_INVALID';
  end if;
  if p_job is not null and not exists(
    select 1 from public.pipeline_jobs j join public.worker_tasks t on t.id=p_task
    where j.id=p_job and (j.id=t.pipeline_job_id or j.run_id=t.run_id)
  ) then raise exception 'CLOUD_PROGRESS_SCOPE';end if;
  update public.worker_tasks
  set current_step=p_step,
      progress_job_id=p_job,
      progress_completed=p_completed,
      progress_total=p_total,
      progress_detail=left(nullif(trim(p_detail),''),240),
      last_progress_at=clock_timestamp(),
      lease_until=clock_timestamp()+interval '4 minutes'
  where id=p_task;
end
$$;
revoke all on function public.cloud_progress(uuid,uuid,bigint,text,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.cloud_progress(uuid,uuid,bigint,text,integer,integer,text,uuid) to service_role;

alter table public.analysis_results
  add column reliability_status text not null default 'valid' check (reliability_status in ('valid','invalidated')),
  add column reliability_reasons text[] not null default '{}',
  add column invalidated_at timestamptz;
create index analysis_results_reliability_idx on public.analysis_results(reliability_status,created_at desc);

-- Future positive results must have a genuinely positive score and at least one
-- substantive piece of current documentary evidence for every candidate.
create or replace function public.persist_analysis(p_job uuid,p_version text,p_result jsonb,p_candidates jsonb,p_evidence jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs; candidate jsonb; cid uuid; ev jsonb; position integer:=0;
begin
 select * into strict j from pipeline_jobs where id=p_job for update;
 if exists(select 1 from analysis_results where pipeline_job_id=p_job) then raise exception 'Anàlisi ja completada'; end if;
 if not exists(select 1 from catalog_versions where id=p_version and active and validated) then raise exception 'Catàleg no validat'; end if;
 if ((p_result->>'classification')='in_portfolio')<>(jsonb_array_length(p_candidates)>0) then raise exception 'Classificació incompatible amb candidats'; end if;
 if jsonb_array_length(p_candidates)>3 or jsonb_array_length(p_evidence)=0 then raise exception 'Contracte invàlid'; end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) c where coalesce((c->>'score')::numeric,0)<=0) then raise exception 'Candidat sense confiança positiva';end if;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit,model_conclusion)
 values(p_job,j.source_record_id,p_version,coalesce(p_result->'rule_audit'->>'version','leaf-normative-v1'),p_result->>'classification',p_result->'reasons',p_result->>'explanation',p_result->>'service_description',p_result->>'target_population',p_evidence,p_result->'rule_audit',p_result->'model_conclusion');
 delete from matching_candidates where pipeline_job_id=p_job;
 for candidate in select value from jsonb_array_elements(p_candidates) loop
  if not exists(
    select 1
    from jsonb_array_elements(candidate->'evidence') candidate_evidence
    join current_evidence_chunks chunk on chunk.id=(candidate_evidence->>'id')::uuid
    join source_documents document on document.id=chunk.source_document_id
    where document.source_record_id=j.source_record_id
      and chunk.character_count>=120
      and coalesce(document.text_length,0)>=300
      and not (coalesce(document.quality_flags,'{}'::text[]) && array['duplicate_text','javascript_shell','generic_portal']::text[])
      and not (document.extraction_method='html-basic' and document.text_length<1000)
      and lower(btrim(regexp_replace(chunk.content,'\s+',' ','g'))) not in (
        'e-tauler - consorci administració oberta de catalunya',
        'e-tauler- consorci administració oberta de catalunya'
      )
  ) then raise exception 'Candidat sense evidència substantiva';end if;
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
revoke all on function public.persist_analysis(uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_analysis(uuid,text,jsonb,jsonb,jsonb) to service_role;

-- Store the same quality assessment used by the matching guard for cloud extracts.
do $$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.cloud_commit_v1(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure);
 updated:=replace(definition,
   'error_message=null,chunk_count=jsonb_array_length(p_data->''chunks'')',
   'error_message=null,quality_score=(p_data->>''quality_score'')::numeric,quality_flags=coalesce(array(select jsonb_array_elements_text(p_data->''quality_flags'')),''{}''::text[]),chunk_count=jsonb_array_length(p_data->''chunks'')');
 if updated=definition then raise exception 'cloud_commit_v1 quality patch not applied';end if;
 execute updated;
end $$;

create or replace function public.cloud_provider_usage(p_task uuid,p_owner uuid,p_generation bigint,p_key text,p_usage jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare rid uuid;
begin
 perform cloud_assert_lease(p_task,p_owner,p_generation);
 if p_key !~ '^usage:[0-9a-f-]{36}:(enrichment|analysis|positive-audit-v[123]|contract-repair-v1)$' then raise exception 'Invalid usage key';end if;
 if exists(select 1 from cloud_checkpoints where task_id=p_task and item_key=p_key) then return;end if;
 select run_id into rid from worker_tasks where id=p_task;
 update pipeline_runs set actual_input_tokens=coalesce(actual_input_tokens,0)+coalesce((p_usage->>'input_tokens')::integer,0),actual_output_tokens=coalesce(actual_output_tokens,0)+coalesce((p_usage->>'output_tokens')::integer,0) where id=rid;
 perform cloud_checkpoint(p_task,p_owner,p_generation,p_key,p_usage);
end $$;
revoke all on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.cloud_provider_usage(uuid,uuid,bigint,text,jsonb) to service_role;

-- Invalidated automatic results remain auditable but cannot be reviewed or approved.
do $$
declare definition text; updated text;
begin
 definition:=pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure);
 updated:=replace(definition,
   'select * into a from analysis_results where pipeline_job_id=j.id for update;',
   'select * into a from analysis_results where pipeline_job_id=j.id for update; if a.reliability_status=''invalidated'' or exists(select 1 from matching_candidates unreliable where unreliable.pipeline_job_id=j.id and unreliable.score<=0) then raise exception ''RESULTAT_NO_FIABLE'';end if;');
 if updated=definition then raise exception 'review reliability guard not applied';end if;
 execute updated;
end $$;

create or replace view public.current_record_results with (security_invoker=true) as
select r.id,r.source_record_id,r.title,r.provider_name,r.financing_type,r.source_dataset,
 j.id as job_id,j.run_id,b.batch_number,j.status as execution_status,j.created_at as job_created_at,j.error_message,
 a.id as analysis_id,a.catalog_version_id,a.target_population,a.service_description,a.evidence,
 case when j.status in ('selected','queued','preparing','ready','matching') or a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then null else coalesce(d.classification,a.reviewed_classification,a.classification) end as classification,
 case when d.id is not null then to_jsonb(d.reasons) when a.reviewed_classification is not null then to_jsonb(a.reviewed_reasons) else a.reasons end as reasons,
 case when a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'Resultat no fiable pendent de reanàlisi' else coalesce(d.reason,a.review_notes,a.explanation) end as explanation,
 d.decision as review_decision,coalesce(d.created_at,a.reviewed_at) as reviewed_at,
 (d.id is not null or a.reviewed_classification is not null) as human_reviewed,
 case
  when j.status='error' or a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'issues'
  when j.status in ('selected','queued','preparing','ready','matching') then 'processing'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='discarded' then 'discarded'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='insufficient_evidence' then 'issues'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='out_of_portfolio' then 'outside'
  when coalesce(d.classification,a.reviewed_classification,a.classification)='in_portfolio' and (d.id is not null or a.reviewed_classification is not null) then 'approved'
  when j.status='needs_review' then 'review'
  when j.id is null and (r.evidence_status in ('error','no_source','unsupported') or r.enrichment_status='error') then 'issues'
  else 'unprocessed' end as destination,
 md5(jsonb_build_array(j.id,a.id,coalesce(d.classification,a.reviewed_classification,a.classification),d.id,d.reasons,a.reviewed_reasons,a.explanation,a.review_notes,a.reliability_status,a.reliability_reasons,candidate_state.non_positive)::text) as result_token,
 case when a.reliability_status='invalidated' or coalesce(candidate_state.non_positive,false) then 'invalidated' else 'valid' end as reliability_status,
 case when coalesce(candidate_state.non_positive,false) then array['non_positive_confidence']::text[] else coalesce(a.reliability_reasons,'{}'::text[]) end as reliability_reasons,a.invalidated_at
from public.source_records r
left join lateral(select * from public.pipeline_jobs where source_record_id=r.id order by created_at desc,id desc limit 1) j on true
left join public.pipeline_runs b on b.id=j.run_id
left join public.analysis_results a on a.pipeline_job_id=j.id
left join lateral(select bool_or(candidate.score<=0) as non_positive from public.matching_candidates candidate where candidate.pipeline_job_id=j.id) candidate_state on true
left join lateral(select * from public.review_decisions where pipeline_job_id=j.id order by created_at desc,id desc limit 1) d on true;
revoke all on public.current_record_results from public,anon,authenticated;
grant select on public.current_record_results to service_role;

create function public.quarantine_unreliable_analyses(p_expected_ids uuid[],p_expected_count integer) returns integer
language plpgsql security invoker set search_path=public as $$
declare actual_ids uuid[];affected integer;item record;
begin
 if p_expected_count is null or p_expected_count<1 or cardinality(p_expected_ids)<>p_expected_count or cardinality(p_expected_ids)<>(select count(distinct id) from unnest(p_expected_ids) id) then raise exception 'QUARANTINE_SELECTION_INVALID';end if;
 select coalesce(array_agg(a.id order by a.id),'{}'::uuid[]) into actual_ids
 from analysis_results a
 join pipeline_jobs j on j.id=a.pipeline_job_id
 join lateral(select latest.id from pipeline_jobs latest where latest.source_record_id=j.source_record_id order by latest.created_at desc,latest.id desc limit 1) current_job on current_job.id=j.id
 where a.classification='in_portfolio' and a.reliability_status='valid'
 and exists(select 1 from matching_candidates c where c.pipeline_job_id=j.id and c.score<=0)
 and not exists(select 1 from review_decisions d where d.pipeline_job_id=j.id);
 if cardinality(actual_ids)<>p_expected_count or actual_ids<>array(select id from unnest(p_expected_ids) id order by id) then raise exception 'QUARANTINE_SELECTION_CHANGED';end if;
 perform 1 from analysis_results where id=any(actual_ids) order by id for update;
 for item in
  select j.id as job_id,j.run_id,j.source_record_id
  from analysis_results a join pipeline_jobs j on j.id=a.pipeline_job_id
  where a.id=any(actual_ids)
  order by j.id
 loop
  perform capture_job_snapshot(item.job_id,'before_evidence_quarantine');
 end loop;
 update analysis_results set reliability_status='invalidated',reliability_reasons=array['non_positive_confidence','ineligible_evidence'],invalidated_at=clock_timestamp() where id=any(actual_ids);
 get diagnostics affected=row_count;
 update pipeline_jobs set status='insufficient_evidence',completed_at=coalesce(completed_at,clock_timestamp())
 where id in(select a.pipeline_job_id from analysis_results a where a.id=any(actual_ids));
 update source_records r set processing_status='sense_evidencia',updated_at=clock_timestamp()
 where r.id in(select j.source_record_id from pipeline_jobs j join analysis_results a on a.pipeline_job_id=j.id where a.id=any(actual_ids));
 for item in
  select distinct j.run_id from pipeline_jobs j join analysis_results a on a.pipeline_job_id=j.id
  where a.id=any(actual_ids) and j.run_id is not null
 loop
  perform refresh_pipeline_run(item.run_id);
 end loop;
 return affected;
end $$;
revoke all on function public.quarantine_unreliable_analyses(uuid[],integer) from public,anon,authenticated;
grant execute on function public.quarantine_unreliable_analyses(uuid[],integer) to service_role;
