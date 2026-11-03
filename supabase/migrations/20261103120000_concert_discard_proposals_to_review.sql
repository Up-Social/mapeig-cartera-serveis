-- Concert discard proposals (Sprint 1: calls, proposal agreements, vacant-place
-- amendments, spending authorizations and amendments without a new award) are
-- pending a human decision, not incidents: route them to the review queue.
-- Mirrors lib/concerts/discard-proposal.ts; the classification is unchanged and
-- nothing is discarded automatically.
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
            WHEN COALESCE(d.classification, a.reviewed_classification, a.classification) = 'discarded'::text THEN 'discarded'::text
            WHEN r.financing_type = 'concert'::text AND d.id IS NULL AND a.reviewed_classification IS NULL AND a.classification = 'insufficient_evidence'::text AND j.status = 'needs_review'::text
             AND ((a.rule_audit -> 'concert_discard_review' ->> 'original_classification') = 'discarded'::text
              OR (r.title ~* '^\s*resoluci[oó]\s+d[''’]esmena\s+de\s+la\s+resoluci[oó]' AND COALESCE(a.rule_audit -> 'concert_model_discard_review' -> 'original_reasons', '[]'::jsonb) ? 'no_concert_award'::text)) THEN 'review'::text
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
