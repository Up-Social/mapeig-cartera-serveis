"use server";

import { executionMode } from "@/lib/pipeline/execution-mode";
import { cloudDb, rpc } from "@/lib/cloud/context";
import { launchRun } from "@/lib/cloud/enqueue";
import { createServerSupabase } from "@/lib/records-page";
import { dispatchWorkerTask } from "@/lib/worker-dispatch";

export async function createAutomatedBatch(size: number) {
  if (executionMode() === "disabled") throw new Error("Execució desactivada en aquest entorn.");
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error("La mida del lot ha de ser un enter entre 1 i 50.");
  if (executionMode() === "vercel_workflow") {
    const id = await rpc<string>(cloudDb(), "cloud_create_automated", { p_size: size });
    await launchRun(id);
    return { id };
  }
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc("create_automated_batch", { p_batch_size: size });
  if (error) throw error;
  const id = String(data);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(id)) throw new Error("Identificador no vàlid.");
  try {
    await dispatchWorkerTask({ type: "process_run", runId: id }, "pipeline:process", ["--run-id", id]);
  } catch (dispatchError) {
    await supabase.from("pipeline_runs").update({ status: "processing_error", error_count: 1 }).eq("id", id);
    const { data: jobs } = await supabase.from("pipeline_jobs").select("source_record_id,status").eq("run_id", id);
    const unfinishedIds = (jobs ?? []).filter((job) => !["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)).map((job) => job.source_record_id);
    if (unfinishedIds.length) await supabase.from("source_records").update({ processing_status: "error", updated_at: new Date().toISOString() }).in("id", unfinishedIds);
    throw dispatchError;
  }
  return { id };
}
