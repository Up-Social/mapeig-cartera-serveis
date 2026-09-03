"use server";

import { revalidatePath } from "next/cache";
import { getAvailableFinancingTypes, getBalancedSample } from "@/lib/batches";
import type { SampleRecord } from "@/lib/batch-types";
import { FINANCING_TYPES, type FinancingType } from "@/lib/financing-types";
import { createServerSupabase } from "@/lib/records-page";
import { dispatchWorkerTask } from "@/lib/worker-dispatch";

export async function generateBalancedSample(excludedIds: string[] = []) {
  return getBalancedSample(validateIds(excludedIds));
}

export async function createAutomatedBatch(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 50)
    throw new Error("La mida del lot ha de ser un enter entre 1 i 50.");
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("create_automated_batch", {
    p_batch_size: size,
  });
  if (error) throw error;
  const id = validateId(String(data));
  try {
    await dispatchWorkerTask(
      { type: "process_run", runId: id },
      "pipeline:process",
      ["--run-id", id],
    );
  } catch (error) {
    await supabase
      .from("pipeline_runs")
      .update({ status: "processing_error", error_count: 1 })
      .eq("id", id);
    const { data: jobs } = await supabase
      .from("pipeline_jobs")
      .select("source_record_id,status")
      .eq("run_id", id);
    const unfinishedIds = (jobs ?? [])
      .filter((job) => !["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status))
      .map((job) => job.source_record_id);
    if (unfinishedIds.length) {
      await supabase
        .from("source_records")
        .update({ processing_status: "error", updated_at: new Date().toISOString() })
        .in("id", unfinishedIds);
    }
    throw error;
  }
  return { id };
}

export async function replaceSampleRecord(
  type: FinancingType,
  excludedIds: string[],
): Promise<SampleRecord> {
  if (!FINANCING_TYPES.includes(type)) throw new Error("Tipologia no vàlida.");
  const candidates = await getBalancedSample(validateIds(excludedIds));
  const replacement = candidates.find((item) => item.financingType === type);
  if (!replacement)
    throw new Error(
      "No hi ha cap substitut pendent disponible per aquesta tipologia.",
    );
  return replacement;
}

export async function createGuidedBatch(recordIds: string[]) {
  const ids = validateIds(recordIds);
  if (ids.length !== 4)
    throw new Error("El lot ha de contenir exactament 4 registres.");
  const supabase = createServerSupabase();
  const { data: records, error } = await supabase
    .from("source_records")
    .select("id,financing_type,deduplication_key,processing_status")
    .in("id", ids);
  if (error) throw error;
  if (
    records?.length !== 4 ||
    records.some(
      (record) => !["pendent", "preparat"].includes(record.processing_status),
    )
  )
    throw new Error("La mostra conté registres no disponibles.");
  if (new Set(records.map((record) => record.deduplication_key)).size !== 4)
    throw new Error("La mostra conté casos duplicats.");
  const { data: equivalentRecords, error: equivalentError } = await supabase
    .from("source_records")
    .select("id")
    .in(
      "deduplication_key",
      records.map((record) => record.deduplication_key),
    );
  if (equivalentError) throw equivalentError;
  const equivalentIds = (equivalentRecords ?? []).map((record) => record.id);
  const { data: previousJobs, error: previousError } = await supabase
    .from("pipeline_jobs")
    .select("run_id")
    .in("source_record_id", equivalentIds);
  if (previousError) throw previousError;
  const previousRunIds = [
    ...new Set((previousJobs ?? []).map((job) => job.run_id)),
  ];
  const { data: previousRuns, error: previousRunsError } = previousRunIds.length
    ? await supabase
        .from("pipeline_runs")
        .select("parameters")
        .in("id", previousRunIds)
    : { data: [], error: null };
  if (previousRunsError) throw previousRunsError;
  if (
    (previousRuns ?? []).some((run) => run.parameters?.purpose !== "inspection")
  )
    throw new Error(
      "Un dels casos, o un duplicat seu, ja havia estat seleccionat per a matching. Genera una altra mostra.",
    );
  const availableTypes = await getAvailableFinancingTypes();
  const selectedTypes = records.map(
    (record) => record.financing_type as FinancingType,
  );
  const requiredTypes = availableTypes.slice(0, 4);
  if (requiredTypes.some((type) => !selectedTypes.includes(type)))
    throw new Error("Falta una de les tipologies disponibles.");
  if (
    Math.max(
      ...FINANCING_TYPES.map(
        (type) => selectedTypes.filter((value) => value === type).length,
      ),
    ) > Math.ceil(4 / Math.max(1, requiredTypes.length))
  )
    throw new Error("La mostra no està equilibrada per tipologia.");
  const { data: run, error: runError } = await supabase
    .from("pipeline_runs")
    .insert({
      status: "draft",
      stage: "preparation",
      selected_count: 4,
      parameters: {
        mode: "balanced_by_financing_type",
        batch_size: 4,
        types: selectedTypes,
      },
    })
    .select("id")
    .single();
  if (runError) throw runError;
  const { error: jobsError } = await supabase.from("pipeline_jobs").insert(
    ids.map((id) => ({
      run_id: run.id,
      source_record_id: id,
      status: "selected",
      preparation_status: "pending",
    })),
  );
  if (jobsError) throw jobsError;
  revalidatePath("/batches");
  return { id: String(run.id) };
}

export async function startBatchPreparation(runId: string) {
  const id = validateId(runId);
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .update({
      status: "preparing",
      stage: "preparation",
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["draft", "preparation_error"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error("El lot no es pot preparar en el seu estat actual.");
  await dispatchWorkerTask(
    { type: "prepare_run", runId: id },
    "pipeline:prepare",
    ["--run-id", id],
  );
  revalidatePath("/batches");
  return { ok: true };
}

export async function startBatchMatching(runId: string) {
  const id = validateId(runId);
  const supabase = createServerSupabase();
  const { count, error: countError } = await supabase
    .from("pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("run_id", id)
    .eq("status", "ready");
  if (countError) throw countError;
  if (!count)
    throw new Error("El lot no té registres preparats per al matching.");
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ status: "matching", stage: "matching" })
    .eq("id", id);
  if (error) throw error;
  await dispatchWorkerTask(
    { type: "match_run", runId: id },
    "matching:run",
    ["--run-id", id],
  );
  revalidatePath("/batches");
  return { ok: true };
}

export async function replaceFailedBatchJob(runId: string, jobId: string) {
  const run = validateId(runId);
  const job = validateId(jobId);
  const supabase = createServerSupabase();
  const { data: current, error } = await supabase
    .from("pipeline_jobs")
    .select(
      "id,source_record_id,preparation_status,source_records(financing_type)",
    )
    .eq("id", job)
    .eq("run_id", run)
    .single();
  if (error) throw error;
  if (
    !["no_source", "unsupported", "error"].includes(current.preparation_status)
  )
    throw new Error("Només es poden substituir registres no preparats.");
  const sourceRecord = Array.isArray(current.source_records)
    ? current.source_records[0]
    : current.source_records;
  const type = sourceRecord?.financing_type as FinancingType;
  if (!FINANCING_TYPES.includes(type))
    throw new Error("La tipologia del registre no és vàlida.");
  const { data: jobs, error: jobsError } = await supabase
    .from("pipeline_jobs")
    .select("source_record_id")
    .eq("run_id", run);
  if (jobsError) throw jobsError;
  const candidates = await getBalancedSample(
    (jobs ?? []).map((item) => item.source_record_id),
  );
  const replacement = candidates.find((item) => item.financingType === type);
  if (!replacement)
    throw new Error("No hi ha cap substitut pendent disponible.");
  const { error: updateError } = await supabase
    .from("pipeline_jobs")
    .update({
      source_record_id: replacement.id,
      status: "selected",
      preparation_status: "pending",
      preparation_message: null,
      claimed_at: null,
      completed_at: null,
    })
    .eq("id", job);
  if (updateError) throw updateError;
  await supabase
    .from("source_records")
    .update({
      processing_status: "pendent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.source_record_id);
  await supabase
    .from("pipeline_runs")
    .update({ status: "draft", stage: "preparation" })
    .eq("id", run);
  revalidatePath("/batches");
  return replacement;
}

function validateIds(ids: string[]) {
  const unique = [...new Set(ids)];
  unique.forEach(validateId);
  return unique;
}
function validateId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
    throw new Error("Identificador no vàlid.");
  return id;
}
