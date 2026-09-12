"use server";
import {executionMode} from "@/lib/pipeline/execution-mode";
import {createCloudRun} from "@/lib/cloud/enqueue";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/records-page";
import { dispatchWorkerTask } from "@/lib/worker-dispatch";
import { requireUuid } from "@/lib/uuid";

export async function createProcessingBatch(recordIds: string[]) {
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
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
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
  const id = requireUuid(sourceRecordId);
  if(executionMode()==='vercel_workflow')return {runId:await createCloudRun([id])};
  const supabase = createServerSupabase();
  const { data: record, error: recordError } = await supabase
    .from("source_records")
    .select("id,processing_status,pipeline_jobs(status,analysis_results(id),matching_candidates(id),pipeline_runs(parameters))")
    .eq("id", id)
    .single();
  if (recordError) throw recordError;
  const jobs = Array.isArray(record.pipeline_jobs) ? record.pipeline_jobs : [];
  if (jobs.some((job) => (Array.isArray(job.analysis_results) && job.analysis_results.length > 0) || (Array.isArray(job.matching_candidates) && job.matching_candidates.length > 0)))
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

export async function recoverRecordWithOcr(sourceRecordId: string) {
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
  const id = requireUuid(sourceRecordId);
  if(executionMode()==='vercel_workflow')return {runId:await createCloudRun([id],true),documents:0};
  const supabase = createServerSupabase();
  const { data: record, error: recordError } = await supabase
    .from("source_records")
    .select("id,processing_status,source_documents(id,url,mime_type,status,error_message),pipeline_jobs(analysis_results(id),matching_candidates(id))")
    .eq("id", id)
    .single();
  if (recordError) throw recordError;
  if (["preparant", "processant"].includes(record.processing_status))
    throw new Error("Aquest registre ja s'està processant.");
  const jobs = Array.isArray(record.pipeline_jobs) ? record.pipeline_jobs : [];
  if (jobs.some((job) => (Array.isArray(job.analysis_results) && job.analysis_results.length > 0) || (Array.isArray(job.matching_candidates) && job.matching_candidates.length > 0)))
    throw new Error("Aquest registre ja té una proposta disponible per revisar.");
  const documents = Array.isArray(record.source_documents) ? record.source_documents : [];
  const ocrDocuments = documents.filter((document) => {
    const diagnostic = `${document.mime_type ?? ""} ${document.url ?? ""} ${document.error_message ?? ""}`.toLocaleLowerCase("ca");
    return document.status === "unsupported" && (diagnostic.includes("pdf") || diagnostic.includes("ocr"));
  });
  if (!ocrDocuments.length)
    throw new Error("No hi ha cap PDF pendent d'extracció OCR en aquest registre.");

  const { data: run, error: runError } = await supabase.from("pipeline_runs").insert({
    status: "queued",
    stage: "preparation",
    selected_count: 1,
    started_at: new Date().toISOString(),
    parameters: { purpose: "ocr_recovery", auto_process: true, ocr_recovery: true, source_record_id: id, batch_size: 1 },
  }).select("id").single();
  if (runError) throw runError;
  const { error: jobError } = await supabase.from("pipeline_jobs").insert({
    run_id: run.id,
    source_record_id: id,
    status: "selected",
    preparation_status: "pending",
  });
  if (jobError) throw jobError;
  const { error: updateError } = await supabase.from("source_records").update({
    evidence_status: "preparing",
    evidence_error: null,
    enrichment_status: "pending",
    enrichment_error: null,
    processing_status: "preparant",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (updateError) throw updateError;
  try {
    await dispatchWorkerTask(
      { type: "process_run", runId: String(run.id) },
      "pipeline:process",
      ["--run-id", String(run.id)],
    );
  } catch (error) {
    const message = actionErrorMessage(error);
    await supabase.from("pipeline_runs").update({ status: "processing_error", error_count: 1 }).eq("id", run.id);
    await supabase.from("source_records").update({ evidence_status: "error", evidence_error: message, processing_status: "error", updated_at: new Date().toISOString() }).eq("id", id);
    throw error;
  }
  return { runId: String(run.id), documents: ocrDocuments.length };
}

export async function prepareRecordSources(sourceRecordId: string) {
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
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
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
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
        processing_status: "error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    throw error;
  }
  return { ok: true };
}

export async function matchPreparedRecord(sourceRecordId: string) {
  if(executionMode()==='disabled')throw new Error('Execució desactivada en aquest entorn.');
  const id = requireUuid(sourceRecordId);
  const supabase = createServerSupabase();
  const { data: record, error } = await supabase
    .from("source_records")
    .select(
      "evidence_status,enrichment_status,pipeline_jobs(id,run_id,status,created_at,analysis_results(id),matching_candidates(id))",
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
        (Array.isArray(job.analysis_results) && job.analysis_results.length>0) || (Array.isArray(job.matching_candidates) &&
        job.matching_candidates.length > 0),
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
      .select("id,run_id,status,created_at,analysis_results(id),matching_candidates(id)")
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
  outcome: "select" | "reject" | "insufficient" | "outside";
  notes?: string;
}) {
  const {error}=await createServerSupabase().rpc('review_analysis',{p_record:input.sourceRecordId,p_outcome:input.outcome,p_candidate:input.candidateId??null,p_code:input.serviceCode??null,p_notes:input.notes?.trim().slice(0,1000)??null});
  if(error)throw error;

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/issues");
  revalidatePath("/approved");
  revalidatePath("/catalog");
  return { ok: true };
}


function actionErrorMessage(error: unknown) {
  return (error instanceof Error
    ? error.message
    : "No s'ha pogut posar la tasca en cua."
  ).slice(0, 1000);
}
