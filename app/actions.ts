"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/records-page";
import { dispatchWorkerTask } from "@/lib/worker-dispatch";
import { requireUuid } from "@/lib/uuid";
import { resolveRegulatoryBasisUrl } from "@/lib/provision-links";

export async function createProcessingBatch(recordIds: string[]) {
  const ids = [...new Set(recordIds)];
  if (ids.length < 1 || ids.length > 50)
    throw new Error("Selecciona entre 1 i 50 registres.");
  const supabase = createServerSupabase();
  const { data: existing, error: readError } = await supabase
    .from("source_records")
    .select("id")
    .in("id", ids);
  if (readError) throw readError;
  if ((existing?.length ?? 0) !== ids.length)
    throw new Error("La selecció conté registres inexistents.");
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "queued",
      selected_count: ids.length,
      parameters: { matching: "pending_configuration" },
    })
    .select("id")
    .single();
  if (runError) throw runError;
  const { error: jobsError } = await supabase.from("pipeline_jobs").insert(
    ids.map((id) => ({
      run_id: run.id,
      source_record_id: id,
      status: "queued",
    })),
  );
  if (jobsError) throw jobsError;
  const { error: recordsError } = await supabase
    .from("source_records")
    .update({
      processing_status: "preparant",
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (recordsError) throw recordsError;
  revalidatePath("/");
  return { runId: String(run.id), count: ids.length };
}

export async function processRecordAutomatically(sourceRecordId: string) {
  const id = requireUuid(sourceRecordId);
  const supabase = createServerSupabase();
  const { data: record, error: recordError } = await supabase
    .from("source_records")
    .select("id,processing_status,pipeline_jobs(status,matching_candidates(id),pipeline_runs(parameters))")
    .eq("id", id)
    .single();
  if (recordError) throw recordError;
  const jobs = Array.isArray(record.pipeline_jobs) ? record.pipeline_jobs : [];
  if (jobs.some((job) => Array.isArray(job.matching_candidates) && job.matching_candidates.length > 0))
    throw new Error("Aquest registre ja té un matching disponible.");
  if (["preparant", "processant"].includes(record.processing_status))
    throw new Error("Aquest registre ja s'està processant.");

  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "queued",
      stage: "preparation",
      selected_count: 1,
      started_at: new Date().toISOString(),
      parameters: { purpose: "automated_single", auto_process: true, source_record_id: id, batch_size: 1 },
    })
    .select("id")
    .single();
  if (runError) throw runError;
  const { error: jobError } = await supabase.from("pipeline_jobs").insert({
    run_id: run.id,
    source_record_id: id,
    status: "selected",
    preparation_status: "pending",
  });
  if (jobError) throw jobError;
  const { error: updateError } = await supabase
    .from("source_records")
    .update({ processing_status: "preparant", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw updateError;
  try {
    await dispatchWorkerTask(
      { type: "process_run", runId: String(run.id) },
      "pipeline:process",
      ["--run-id", String(run.id)],
    );
  } catch (error) {
    await supabase.from("pipeline_runs").update({ status: "processing_error", error_count: 1 }).eq("id", run.id);
    await supabase.from("source_records").update({ processing_status: "error", updated_at: new Date().toISOString() }).eq("id", id);
    throw error;
  }
  return { runId: String(run.id) };
}

export async function prepareRecordSources(sourceRecordId: string) {
  const id = requireUuid(sourceRecordId);
  const supabase = createServerSupabase();
  const { data: record, error } = await supabase
    .from("source_records")
    .select("id,evidence_status,source_documents(status,chunk_count)")
    .eq("id", id)
    .single();
  if (error) throw error;
  if (record.evidence_status === "preparing")
    throw new Error("La preparació d'aquest registre ja està en curs.");
  const documents = Array.isArray(record.source_documents)
    ? record.source_documents
    : [];
  if (
    documents.some(
      (document) => document.status === "fetched" && document.chunk_count > 0,
    )
  ) {
    const { error: updateError } = await supabase
      .from("source_records")
      .update({
        evidence_status: "ready",
        evidence_error: null,
        processing_status: "preparat",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateError) throw updateError;
    return { ready: true };
  }
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "draft",
      stage: "preparation",
      selected_count: 1,
      parameters: { purpose: "inspection", source_record_id: id },
    })
    .select("id")
    .single();
  if (runError) throw runError;
  const { error: jobError } = await supabase.from("pipeline_jobs").insert({
    run_id: run.id,
    source_record_id: id,
    status: "selected",
    preparation_status: "pending",
  });
  if (jobError) throw jobError;
  const { error: updateError } = await supabase
    .from("source_records")
    .update({
      evidence_status: "preparing",
      evidence_error: null,
      processing_status: "preparant",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) throw updateError;
  try {
    await dispatchWorkerTask(
      { type: "prepare_run", runId: String(run.id) },
      "pipeline:prepare",
      ["--run-id", String(run.id)],
    );
  } catch (error) {
    const message = actionErrorMessage(error);
    await supabase
      .from("source_records")
      .update({
        evidence_status: "error",
        evidence_error: message,
        processing_status: "error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    throw error;
  }
  return { ready: false };
}

export async function enrichRecordFromSources(sourceRecordId: string) {
  const id = requireUuid(sourceRecordId);
  const supabase = createServerSupabase();
  const { data: record, error } = await supabase
    .from("source_records")
    .select("evidence_status,enrichment_status")
    .eq("id", id)
    .single();
  if (error) throw error;
  if (record.evidence_status !== "ready")
    throw new Error(
      "Primer cal preparar una font documental amb fragments útils.",
    );
  if (record.enrichment_status === "processing")
    throw new Error("El contrast d'aquest registre ja està en curs.");
  const { error: updateError } = await supabase
    .from("source_records")
    .update({
      enrichment_status: "processing",
      enrichment_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) throw updateError;
  try {
    await dispatchWorkerTask(
      { type: "enrich_record", sourceRecordId: id },
      "enrichment:run",
      ["--source-record-id", id],
    );
  } catch (error) {
    const message = actionErrorMessage(error);
    await supabase
      .from("source_records")
      .update({
        enrichment_status: "error",
        enrichment_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    throw error;
  }
  return { ok: true };
}

export async function matchPreparedRecord(sourceRecordId: string) {
  const id = requireUuid(sourceRecordId);
  const supabase = createServerSupabase();
  const { data: record, error } = await supabase
    .from("source_records")
    .select(
      "evidence_status,enrichment_status,pipeline_jobs(id,run_id,status,created_at,matching_candidates(id))",
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  if (
    record.evidence_status !== "ready" ||
    record.enrichment_status !== "completed"
  )
    throw new Error("Primer cal preparar i contrastar les dades oficials.");
  const jobs = Array.isArray(record.pipeline_jobs)
    ? [...record.pipeline_jobs].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )
    : [];
  if (
    jobs.some(
      (job) =>
        Array.isArray(job.matching_candidates) &&
        job.matching_candidates.length > 0,
    )
  )
    throw new Error(
      "Aquest cas ja té un matching i no es tornarà a processar.",
    );
  let job = jobs.find((item) => item.status === "ready");
  if (!job) {
    const { data: run, error: runError } = await supabase
      .from("pipeline_runs")
      .insert({
        status: "matching",
        stage: "matching",
        selected_count: 1,
        ready_count: 1,
        parameters: { purpose: "matching_manual", source_record_id: id },
      })
      .select("id")
      .single();
    if (runError) throw runError;
    const { data: created, error: jobError } = await supabase
      .from("pipeline_jobs")
      .insert({
        run_id: run.id,
        source_record_id: id,
        status: "ready",
        preparation_status: "ready",
      })
      .select("id,run_id,status,created_at,matching_candidates(id)")
      .single();
    if (jobError) throw jobError;
    job = created;
  } else {
    await supabase
      .from("pipeline_runs")
      .update({
        status: "matching",
        stage: "matching",
        parameters: { purpose: "matching_manual", source_record_id: id },
      })
      .eq("id", job.run_id);
  }
  const { error: statusError } = await supabase
    .from("source_records")
    .update({
      processing_status: "processant",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (statusError) throw statusError;
  try {
    await dispatchWorkerTask(
      { type: "match_run", runId: String(job.run_id) },
      "matching:run",
      ["--run-id", String(job.run_id)],
    );
  } catch (error) {
    await supabase
      .from("source_records")
      .update({
        processing_status: "error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    throw error;
  }
  return { runId: String(job.run_id) };
}

export async function reviewMatching(input: {
  sourceRecordId: string;
  candidateId?: string;
  serviceCode?: string;
  outcome: "select" | "reject" | "insufficient";
  notes?: string;
}) {
  const supabase = createServerSupabase();
  const notes = input.notes?.trim().slice(0, 1000) || null;

  const { data: record, error: recordError } = await supabase
    .from("source_records")
    .select(
      "*,source_documents(url,document_type,source_fields),record_enrichments(provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population)",
    )
    .eq("id", input.sourceRecordId)
    .single();
  if (recordError) throw recordError;
  const { data: jobs, error: jobsError } = await supabase
    .from("pipeline_jobs")
    .select("id,run_id,created_at")
    .eq("source_record_id", input.sourceRecordId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (jobsError) throw jobsError;
  const job = jobs?.[0];
  if (!job) throw new Error("No hi ha cap matching completat per revisar.");

  if (input.outcome === "select") {
    if (!input.candidateId && !input.serviceCode)
      throw new Error("Falta el servei seleccionat.");
    const { data: candidate, error: candidateError } = input.candidateId
      ? await supabase
          .from("matching_candidates")
          .select("id,rank,target_code,target_name,score,rationale")
          .eq("id", input.candidateId)
          .eq("pipeline_job_id", job.id)
          .single()
      : { data: null, error: null };
    if (candidateError) throw candidateError;
    const targetCode = input.serviceCode?.trim() || candidate?.target_code;
    const { data: service, error: serviceError } = await supabase
      .from("master_services")
      .select("service_code,service_name")
      .eq("service_code", targetCode)
      .single();
    if (serviceError) throw serviceError;
    const decision =
      candidate?.rank === 1 && !input.serviceCode ? "approved" : "corrected";
    const score = candidate?.score ?? null;
    const rationale =
      candidate?.rationale ??
      notes ??
      "Servei seleccionat manualment durant la revisió.";
    const { data: review, error: reviewError } = await supabase
      .from("review_decisions")
      .insert({
        source_record_id: record.id,
        previous_code: record.cartera_code,
        final_code: service.service_code,
        decision,
        reason: notes,
        reviewer: "local_user",
      })
      .select("id")
      .single();
    if (reviewError) throw reviewError;
    const { error: evaluationError } = await supabase
      .from("matching_evaluations")
      .insert({
        pipeline_job_id: job.id,
        candidate_id: candidate?.id ?? null,
        verdict: "correct",
        expected_code: service.service_code,
        notes,
        evaluator: "local_user",
      });
    if (evaluationError) throw evaluationError;
    const payload = (record.source_payload ?? {}) as Record<string, unknown>;
    const documents = Array.isArray(record.source_documents)
      ? (record.source_documents as Array<{
          url: string;
          document_type: string;
          source_fields: string[] | null;
        }>)
      : [];
    const enrichment = Array.isArray(record.record_enrichments)
      ? record.record_enrichments[0]
      : record.record_enrichments;
    const providerNif = enrichment?.provider_nif ?? firstText(payload, ["NIF entidad", "NIF entidad beneficiaria", "NIF del adjudicatario"]);
    const normalizedNif = providerNif?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;
    const entityResult = normalizedNif ? await supabase.from("entities").select("id").eq("nif", normalizedNif).maybeSingle() : { data: null, error: null };
    if (entityResult.error) throw entityResult.error;
    const callUrl =
      firstText(payload, [
        "Enlace de la última publicación",
        "Document conveni",
        "Enllaç convocatòria",
      ]) ??
      documentUrl(documents, [
        "publication",
        "agreement",
        "contracting_profile",
      ]);
    const { data: provision, error: provisionError } = await supabase
      .from("service_provisions")
      .upsert(
        {
          source_record_id: record.id,
          source_id:
            firstText(payload, [
              "Código del expediente",
              "Número conveni definitiu",
              "Clau",
              "registre",
            ]) ?? String(record.source_record_id).split("::")[0],
          call_url: callUrl,
          regulatory_basis_url: resolveRegulatoryBasisUrl(
            payload,
            documents,
          ),
          provider_name: enrichment?.provider_name ?? record.provider_name,
          provider_nif: normalizedNif,
          entity_id: entityResult.data?.id ?? null,
          mechanism: enrichment?.mechanism ?? record.mechanism,
          award_date:
            enrichment?.award_date ??
            firstDate(payload, [
              "Fecha concesión",
              "Data signatura",
              "Fecha de adjudicación",
            ]),
          amount: enrichment?.amount ?? record.amount,
          contracting_body:
            enrichment?.contracting_body ??
            firstText(payload, [
              "Organo contratante",
              "Órgano de contratación",
              "Organismes signants per part de la Generalitat",
            ]),
          target_population:
            enrichment?.target_population ??
            firstText(payload, [
              "Población objetivo / beneficiarios",
              "Col·lectiu",
              "Población objetivo",
            ]),
          source_reference: `${record.source_dataset}/${record.source_record_id}`,
          service_code: service.service_code,
          matching_candidate_id: candidate?.id ?? null,
          review_decision_id: review.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source_record_id" },
      ).select("id").single();
    if (provisionError) throw provisionError;
    if (entityResult.data?.id && provision) {
      const relation = await supabase.from("entity_catalog_relations").upsert({ entity_id: entityResult.data.id, service_code: service.service_code, relation_type: "confirmed", source_type: "provision", source_reference: provision.id, evidence: `Provisió aprovada; NIF exacte ${normalizedNif}` }, { onConflict: "entity_id,service_code,relation_type,source_type,source_reference" });
      if (relation.error) throw relation.error;
    }
    const { error: recordUpdateError } = await supabase
      .from("source_records")
      .update({
        cartera_code: service.service_code,
        cartera_name: service.service_name,
        confidence: score,
        evidence: rationale,
        processing_status: "completat",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    if (recordUpdateError) throw recordUpdateError;
    await supabase
      .from("pipeline_jobs")
      .update({ status: decision })
      .eq("id", job.id);
  } else {
    const decision =
      input.outcome === "reject" ? "rejected" : "insufficient_evidence";
    const verdict =
      input.outcome === "reject" ? "incorrect" : "insufficient_evidence";
    const { error: reviewError } = await supabase
      .from("review_decisions")
      .insert({
        source_record_id: record.id,
        previous_code: record.cartera_code,
        final_code: null,
        decision,
        reason: notes,
        reviewer: "local_user",
      });
    if (reviewError) throw reviewError;
    const { error: evaluationError } = await supabase
      .from("matching_evaluations")
      .insert({
        pipeline_job_id: job.id,
        candidate_id: null,
        verdict,
        notes,
        evaluator: "local_user",
      });
    if (evaluationError) throw evaluationError;
    const existingProvision = await supabase.from("service_provisions").select("id").eq("source_record_id", record.id).maybeSingle();
    if (existingProvision.error) throw existingProvision.error;
    if (existingProvision.data) {
      const relationDelete = await supabase.from("entity_catalog_relations").delete().eq("relation_type", "confirmed").eq("source_type", "provision").eq("source_reference", existingProvision.data.id);
      if (relationDelete.error) throw relationDelete.error;
    }
    const { error: deleteError } = await supabase
      .from("service_provisions")
      .delete()
      .eq("source_record_id", record.id);
    if (deleteError) throw deleteError;
    const { error: updateError } = await supabase
      .from("source_records")
      .update({
        cartera_code: null,
        cartera_name: null,
        confidence: null,
        evidence: null,
        processing_status:
          input.outcome === "reject" ? "rebutjat" : "sense_evidencia",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    if (updateError) throw updateError;
    await supabase
      .from("pipeline_jobs")
      .update({ status: decision })
      .eq("id", job.id);
  }
  await refreshRunCounters(job.run_id);
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/catalog");
  return { ok: true };
}

async function refreshRunCounters(runId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.rpc("refresh_pipeline_run", { p_run_id: runId });
  if (error) throw error;
}

function firstText(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function firstDate(payload: Record<string, unknown>, keys: string[]) {
  const value = firstText(payload, keys);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}
function documentUrl(
  documents: Array<{ url: string; document_type: string }>,
  types: string[],
) {
  return (
    documents.find((document) => types.includes(document.document_type))?.url ??
    null
  );
}
function actionErrorMessage(error: unknown) {
  return (error instanceof Error
    ? error.message
    : "No s'ha pogut posar la tasca en cua."
  ).slice(0, 1000);
}
