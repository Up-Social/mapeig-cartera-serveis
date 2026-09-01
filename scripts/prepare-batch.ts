import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const runId = option("--run-id");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!runId || !url || !key) throw new Error("Falta --run-id o la configuració de Supabase");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });

async function main() {
  try {
    await supabase.from("pipeline_jobs").update({ status: "preparing", preparation_status: "discovering", preparation_message: null }).eq("run_id", runId).in("status", ["selected", "error"]);
    await run("sources:discover", ["--run-id", runId!]);
    await supabase.from("pipeline_jobs").update({ preparation_status: "fetching" }).eq("run_id", runId).eq("status", "preparing");
    await run("sources:sample", ["--run-id", runId!, "--limit", "100"]);
    await supabase.from("pipeline_jobs").update({ preparation_status: "chunking" }).eq("run_id", runId).eq("status", "preparing");
    await run("sources:chunk", ["--run-id", runId!, "--limit", "200"]);

    const { data: jobs, error } = await supabase.from("pipeline_jobs").select("id,source_record_id,source_documents:source_records(source_documents(status,chunk_count,error_message))").eq("run_id", runId);
    if (error) throw error;
    let ready = 0; let errors = 0;
    for (const job of jobs ?? []) {
      const source = job.source_documents as unknown as { source_documents: Array<{ status: string; chunk_count: number; error_message: string | null }> };
      const documents = source?.source_documents ?? [];
      const usable = documents.some((document) => document.status === "fetched" && document.chunk_count > 0);
      const preparationStatus = usable ? "ready" : documents.length === 0 ? "no_source" : documents.every((document) => document.status === "unsupported") ? "unsupported" : "error";
      const status = usable ? "ready" : "error";
      const message = usable ? null : documents.length === 0 ? "No s'ha trobat cap URL al registre" : documents.map((document) => document.error_message).filter(Boolean).join(" · ").slice(0, 1000) || "No s'ha pogut preparar evidència";
      await supabase.from("pipeline_jobs").update({ status, preparation_status: preparationStatus, preparation_message: message }).eq("id", job.id);
      await supabase.from("source_records").update({ evidence_status: preparationStatus, evidence_error: message, processing_status: usable ? "preparat" : preparationStatus === "no_source" ? "sense_evidencia" : "error", updated_at: new Date().toISOString() }).eq("id", job.source_record_id);
      if (usable) ready += 1; else errors += 1;
    }
    const estimatedInputTokens = await estimateTokens(runId!);
    await supabase.from("pipeline_runs").update({ status: "ready", stage: "confirmation", prepared_count: (jobs ?? []).length, ready_count: ready, error_count: errors, estimated_input_tokens: estimatedInputTokens }).eq("id", runId);
    const { error: refreshError } = await supabase.rpc("refresh_pipeline_run", { p_run_id: runId });
    if (refreshError) throw refreshError;
  } catch (error) {
    await supabase.from("pipeline_runs").update({ status: "preparation_error", error_count: 1 }).eq("id", runId);
    throw error;
  }
}

async function estimateTokens(id: string) {
  const { data: jobs } = await supabase.from("pipeline_jobs").select("source_record_id").eq("run_id", id).eq("status", "ready");
  const recordIds = (jobs ?? []).map((job) => job.source_record_id);
  if (!recordIds.length) return 0;
  const { data: documents } = await supabase.from("source_documents").select("id").in("source_record_id", recordIds).eq("status", "fetched");
  const documentIds = (documents ?? []).map((document) => document.id);
  const { data: chunks } = documentIds.length ? await supabase.from("evidence_chunks").select("character_count").in("source_document_id", documentIds) : { data: [] };
  const evidenceChars = (chunks ?? []).reduce((sum, chunk) => sum + chunk.character_count, 0);
  return Math.ceil((evidenceChars + recordIds.length * 20_000) / 4);
}

async function run(script: string, args: string[]) { await execFileAsync("npm", ["run", script, "--", ...args], { cwd: process.cwd(), env: process.env, maxBuffer: 10 * 1024 * 1024 }); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
void main().catch((error: unknown) => { console.error("Preparació fallida:", error); process.exitCode = 1; });
