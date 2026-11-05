-- Conveni unit aggregate and a mechanism-agnostic review destination.
-- persist_conveni (production definition as of 04/11/2026) no longer writes a
-- fixed insufficient_evidence/review_by_recipient aggregate: it summarises the
-- unit proposals and marks them as pending human review.
-- current_record_results (production definition as of 04/11/2026, after
-- 20261103120000) gains one generic branch: a result whose rule_audit carries
-- proposal.requires_review, or a legacy review_by_recipient container, goes to
-- review while no human decision exists. Concert branches are unchanged.
-- Supersedes the unapplied 20261028201000_conveni_pending_recipient_review.

CREATE OR REPLACE FUNCTION public.persist_conveni(p_job uuid, p_version text, p_payload jsonb, p_revisions jsonb, p_source_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare agg text;j pipeline_jobs;r source_records;item jsonb;uid uuid;doc source_documents;citation jsonb;
begin
 select * into strict j from pipeline_jobs where id=p_job;
 select * into strict r from source_records where id=j.source_record_id for update;
 if r.financing_type<>'conveni' or p_source_hash is distinct from conveni_source_hash(r.id) or j.id is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Anàlisi obsoleta' using errcode='PT409';end if;
 if exists(select 1 from conveni_analyses where job_id=j.id) then
  if exists(select 1 from conveni_analyses where job_id=j.id and payload=p_payload and document_revisions=p_revisions) then return;end if;
  raise exception 'Anàlisi ja desada amb altres valors';end if;
 if exists(select 1 from review_decisions where pipeline_job_id=j.id) then raise exception 'El treball ja té una decisió humana; inicia una nova anàlisi' using errcode='PT409';end if;
 if not exists(select 1 from catalog_versions where id=p_version and active and validated) or coalesce(jsonb_typeof(p_payload->'units'),'')<>'array' or coalesce(jsonb_array_length(p_payload->'units'),0)<1 then raise exception 'Anàlisi incompleta';end if;
 for doc in select * from source_documents where source_record_id=r.id and document_type in ('agreement','annex') loop
  if doc.status<>'fetched' or doc.extraction_partial or doc.storage_sha256 is null or doc.storage_path is null or (coalesce(doc.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']) or p_revisions->>doc.id::text is distinct from doc.storage_sha256||':'||coalesce(doc.active_extraction_id::text,'') then raise exception 'Cobertura documental incompleta o canviada';end if;
 end loop;
 insert into conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,document_revisions) values(j.id,r.id,p_source_hash,p_version,p_payload,p_revisions);
 for item in select value from jsonb_array_elements(p_payload->'units') loop
  if coalesce(item->>'key','')='' or jsonb_array_length(item->'evidence')<1 or (item->>'amount_cents')::numeric<0 then raise exception 'Unitat invàlida';end if;
  for citation in select value from jsonb_array_elements(item->'evidence') loop
   select * into strict doc from source_documents where id=(citation->>'document_id')::uuid and source_record_id=r.id and status='fetched';
   if length(citation->>'quote')<12 or position(regexp_replace(citation->>'quote','\s+',' ','g') in regexp_replace(doc.extracted_text,'\s+',' ','g'))=0 then raise exception 'Cita no verificable';end if;
  end loop;
  citation:=item->'evidence'->0;
  insert into record_units(source_record_id,pipeline_job_id,unit_key,provider_name,provider_nif,period,amount,document_id,page,evidence_quote,act_type)
  values(r.id,j.id,'conveni:'||(item->>'key'),item->>'recipient',item->>'recipient_nif',item->>'period',(item->>'amount_cents')::numeric/100,(citation->>'document_id')::uuid,(citation->>'page')::integer,citation->>'quote','award')
  on conflict(source_record_id,unit_key) do nothing;
  select id into strict uid from record_units where source_record_id=r.id and unit_key='conveni:'||(item->>'key');
  insert into conveni_unit_proposals(job_id,unit_id,data) values(j.id,uid,item);
 end loop;
 -- The record aggregate summarises the unit proposals; every unit still
 -- needs a human decision, so the result is a proposal routed to review.
 agg:=case
  when exists(select 1 from jsonb_array_elements(p_payload->'units') u where u->>'classification'='in_portfolio') then 'in_portfolio'
  when exists(select 1 from jsonb_array_elements(p_payload->'units') u where u->>'classification'='out_of_portfolio') then 'out_of_portfolio'
  when not exists(select 1 from jsonb_array_elements(p_payload->'units') u where u->>'classification' is distinct from 'discarded') then 'discarded'
  else 'insufficient_evidence' end;
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit)
 values(j.id,r.id,p_version,'convenis-sprint2-v1',agg,
  case when agg='discarded' then coalesce((select jsonb_agg(distinct u->>'reason') from jsonb_array_elements(p_payload->'units') u where coalesce(u->>'reason','')<>''),'[]'::jsonb) else '[]'::jsonb end,
  p_payload->>'summary','','',(select jsonb_agg(e||jsonb_build_object('content',e->>'quote','source_document_id',e->>'document_id')) from jsonb_array_elements(p_payload->'units'->0->'evidence') e),
  jsonb_build_object('version','convenis-sprint2-v1','rule','conveni_units_v2',
   'units',(select jsonb_agg(jsonb_build_object('key',u->>'key','classification',u->>'classification','reason',u->>'reason','blockers',coalesce(u->'blockers','[]'::jsonb))) from jsonb_array_elements(p_payload->'units') u),
   'proposal',jsonb_build_object('kind','units','requires_review',true)));
 update source_records set enrichment_status='completed',enrichment_error=null,processing_status='revisio',updated_at=now() where id=r.id;
 update pipeline_jobs set status='needs_review',completed_at=now() where id=j.id;
 perform refresh_pipeline_run(j.run_id);
end $fn$;

create or replace view public.current_record_results with (security_invoker = true) as
SELECT r.id,
    r.source_record_id,
    r.title,
    r.provider_name,
    r.financing_type,
    r.source_dataset,
    j.id AS job_id,
    j.run_id,
    b.batch_number,
        CASE
            WHEN worker.incident THEN 'error'::text
            ELSE j.status
        END AS execution_status,
    j.created_at AS job_created_at,
        CASE
            WHEN worker.incident THEN 'Operació interrompuda. Cal revisar el diagnòstic abans de reprendre.'::text
            ELSE j.error_message
        END AS error_message,
    a.id AS analysis_id,
    a.catalog_version_id,
    a.target_population,
    a.service_description,
    a.evidence,
        CASE
            WHEN (j.status = ANY (ARRAY['selected'::text, 'queued'::text, 'preparing'::text, 'ready'::text, 'matching'::text])) OR a.reliability_status = 'invalidated'::text OR COALESCE(candidate_state.non_positive, false) THEN NULL::text
            WHEN (a.rule_audit ->> 'rule'::text) = 'review_by_recipient'::text AND j.status = 'needs_review'::text AND d.id IS NULL AND a.reviewed_classification IS NULL THEN NULL::text
            ELSE COALESCE(d.classification, a.reviewed_classification, a.classification)
        END AS classification,
        CASE
            WHEN d.id IS NOT NULL THEN to_jsonb(d.reasons)
            WHEN a.reviewed_classification IS NOT NULL THEN to_jsonb(a.reviewed_reasons)
            ELSE a.reasons
        END AS reasons,
        CASE
            WHEN a.reliability_status = 'invalidated'::text OR COALESCE(candidate_state.non_positive, false) THEN 'Resultat no fiable pendent de reanàlisi'::text
            ELSE COALESCE(d.reason, a.review_notes, a.explanation)
        END AS explanation,
    d.decision AS review_decision,
    COALESCE(d.created_at, a.reviewed_at) AS reviewed_at,
    d.id IS NOT NULL OR a.reviewed_classification IS NOT NULL AS human_reviewed,
        CASE
            WHEN worker.incident OR j.status = 'error'::text OR a.reliability_status = 'invalidated'::text OR COALESCE(candidate_state.non_positive, false) THEN 'issues'::text
            WHEN j.status = ANY (ARRAY['selected'::text, 'queued'::text, 'preparing'::text, 'ready'::text, 'matching'::text]) THEN 'processing'::text
            WHEN (EXISTS ( SELECT 1
               FROM current_record_reservations h
              WHERE h.source_record_id = r.id AND h.pipeline_job_id = j.id AND h.action = 'accept'::text)) THEN 'reserved'::text
            WHEN r.financing_type = 'concert'::text AND COALESCE(d.classification, a.reviewed_classification, a.classification) = 'out_of_portfolio'::text THEN 'issues'::text
            WHEN d.id IS NULL AND a.reviewed_classification IS NULL AND j.status = 'needs_review'::text AND (((a.rule_audit -> 'proposal'::text) ->> 'requires_review'::text) = 'true'::text OR (a.rule_audit ->> 'rule'::text) = 'review_by_recipient'::text) THEN 'review'::text
            WHEN COALESCE(d.classification, a.reviewed_classification, a.classification) = 'discarded'::text THEN 'discarded'::text
            WHEN r.financing_type = 'concert'::text AND d.id IS NULL AND a.reviewed_classification IS NULL AND a.classification = 'insufficient_evidence'::text AND j.status = 'needs_review'::text AND (((a.rule_audit -> 'concert_discard_review'::text) ->> 'original_classification'::text) = 'discarded'::text OR r.title ~* '^\s*resoluci[oó]\s+d[''’]esmena\s+de\s+la\s+resoluci[oó]'::text AND COALESCE((a.rule_audit -> 'concert_model_discard_review'::text) -> 'original_reasons'::text, '[]'::jsonb) ? 'no_concert_award'::text) THEN 'review'::text
            WHEN COALESCE(d.classification, a.reviewed_classification, a.classification) = 'insufficient_evidence'::text THEN 'issues'::text
            WHEN COALESCE(d.classification, a.reviewed_classification, a.classification) = 'out_of_portfolio'::text THEN 'outside'::text
            WHEN COALESCE(d.classification, a.reviewed_classification, a.classification) = 'in_portfolio'::text AND (d.id IS NOT NULL OR a.reviewed_classification IS NOT NULL) THEN 'approved'::text
            WHEN j.status = 'needs_review'::text THEN 'review'::text
            WHEN j.id IS NULL AND ((r.evidence_status = ANY (ARRAY['error'::text, 'no_source'::text, 'unsupported'::text])) OR r.enrichment_status = 'error'::text) THEN 'issues'::text
            ELSE 'unprocessed'::text
        END AS destination,
    md5(jsonb_build_array(j.id, a.id, COALESCE(d.classification, a.reviewed_classification, a.classification), d.id, d.reasons, a.reviewed_reasons, a.explanation, a.review_notes, a.reliability_status, a.reliability_reasons, candidate_state.non_positive, worker.incident, worker.id, worker.failure_kind)::text) AS result_token,
        CASE
            WHEN a.reliability_status = 'invalidated'::text OR COALESCE(candidate_state.non_positive, false) THEN 'invalidated'::text
            ELSE 'valid'::text
        END AS reliability_status,
        CASE
            WHEN COALESCE(candidate_state.non_positive, false) THEN ARRAY['non_positive_confidence'::text]
            ELSE COALESCE(a.reliability_reasons, '{}'::text[])
        END AS reliability_reasons,
    a.invalidated_at,
    COALESCE(worker.incident, false) AS worker_incident,
    worker.failure_kind AS worker_failure_kind,
    worker.current_step AS worker_step,
    worker.last_progress_at AS worker_last_activity_at
   FROM source_records r
     LEFT JOIN LATERAL ( SELECT pipeline_jobs.id,
            pipeline_jobs.run_id,
            pipeline_jobs.source_record_id,
            pipeline_jobs.status,
            pipeline_jobs.attempts,
            pipeline_jobs.error_message,
            pipeline_jobs.claimed_at,
            pipeline_jobs.completed_at,
            pipeline_jobs.created_at,
            pipeline_jobs.preparation_status,
            pipeline_jobs.preparation_message,
            pipeline_jobs.error_kind,
            pipeline_jobs.enrichment_status,
            pipeline_jobs.enrichment_error,
            pipeline_jobs.previous_job_id
           FROM pipeline_jobs
          WHERE pipeline_jobs.source_record_id = r.id AND NOT pipeline_jobs.verification_only
          ORDER BY pipeline_jobs.created_at DESC, pipeline_jobs.id DESC
         LIMIT 1) j ON true
     LEFT JOIN LATERAL ( SELECT t.id,
            t.failure_kind,
            t.current_step,
            COALESCE(t.last_progress_at, t.claimed_at, t.dispatch_at, t.created_at) AS last_progress_at,
            (j.status = ANY (ARRAY['selected'::text, 'queued'::text, 'preparing'::text, 'ready'::text, 'matching'::text])) AND t.status <> 'completed'::text AND COALESCE(t.execution_state, ''::text) <> 'completed'::text AND (t.status = 'failed'::text OR (t.execution_state = ANY (ARRAY['paused'::text, 'interrupted'::text]))) AS incident
           FROM worker_tasks t
          WHERE t.pipeline_job_id = j.id OR t.progress_job_id = j.id
          ORDER BY t.created_at DESC, t.id DESC
         LIMIT 1) worker ON true
     LEFT JOIN pipeline_runs b ON b.id = j.run_id
     LEFT JOIN analysis_results a ON a.pipeline_job_id = j.id
     LEFT JOIN LATERAL ( SELECT bool_or(candidate.score <= 0::numeric) AS non_positive
           FROM matching_candidates candidate
          WHERE candidate.pipeline_job_id = j.id) candidate_state ON true
     LEFT JOIN LATERAL ( SELECT review_decisions.id,
            review_decisions.source_record_id,
            review_decisions.previous_code,
            review_decisions.final_code,
            review_decisions.decision,
            review_decisions.reason,
            review_decisions.reviewer,
            review_decisions.created_at,
            review_decisions.pipeline_job_id,
            review_decisions.classification,
            review_decisions.reasons
           FROM review_decisions
          WHERE review_decisions.pipeline_job_id = j.id
          ORDER BY review_decisions.created_at DESC, review_decisions.id DESC
         LIMIT 1) d ON true;
