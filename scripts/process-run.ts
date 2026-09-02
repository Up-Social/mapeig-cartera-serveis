import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const runId = option("--run-id");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!runId || !url || !key) throw new Error("Falta --run-id o la configuració de Supabase");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });

async function main() {
  const { data: run, error } = await db.from("pipeline_runs").select("id,parameters").eq("id", runId).single();
  if (error) throw error;
  if (run.parameters?.auto_process !== true) throw new Error("El lot no està configurat per al procés automàtic");

  await setRun("preparing", "preparation");
  await runCommand("pipeline:prepare", ["--run-id", runId!]);

  await setRun("enriching", "enrichment");
  const jobs = await loadJobs();
  for (const job of jobs) {
    if (job.preparation_status !== "ready" || job.status === "error") continue;
    const source = sourceOf(job);
    if (source.enrichment_status !== "completed") {
      let completed = false;
      let lastError = "No s'ha pogut contrastar el registre.";
      for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
        await db.from("source_records").update({ enrichment_status: "processing", enrichment_error: null, updated_at: new Date().toISOString() }).eq("id", job.source_record_id);
        try {
          await runCommand("enrichment:run", ["--source-record-id", job.source_record_id]);
          completed = true;
        } catch (failure) {
          lastError = messageOf(failure);
        }
      }
      if (!completed) {
        await db.from("pipeline_jobs").update({ status: "error", error_message: lastError, completed_at: new Date().toISOString() }).eq("id", job.id);
      }
    }
    await refresh();
  }

  const afterEnrichment = await loadJobs();
  for (const job of afterEnrichment) {
    if (job.status === "error") continue;
    const source = sourceOf(job);
    await db.from("pipeline_jobs").update(source.enrichment_status === "completed" ? { status: "ready", error_message: null } : { status: "error", error_message: source.enrichment_error ?? "Contrast incomplet", completed_at: new Date().toISOString() }).eq("id", job.id);
  }

  await setRun("matching", "matching");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { count } = await db.from("pipeline_jobs").select("id", { count: "exact", head: true }).eq("run_id", runId).eq("status", "ready");
    if (!count) break;
    await runCommand("matching:run", ["--run-id", runId!]);
    if (attempt < 3) {
      const failed = await loadJobs();
      const retryable = failed.filter((job) => job.status === "error" && !String(job.error_message ?? "").startsWith("Cas omès:"));
      for (const job of retryable) await db.from("pipeline_jobs").update({ status: "ready", error_message: null, completed_at: null }).eq("id", job.id);
    }
  }

  await refresh();
  const finalJobs = await loadJobs();
  const review = finalJobs.filter((job) => job.status === "needs_review").length;
  const errors = finalJobs.filter((job) => job.status === "error").length;
  await db.from("pipeline_runs").update({ status: review > 0 ? "needs_review" : "completed", stage: review > 0 ? "review" : "completed", review_count: review, error_count: errors, completed_at: new Date().toISOString() }).eq("id", runId);
  console.log(`Lot ${runId}: ${review} per revisar · ${errors} errors`);
}

async function loadJobs() {
  const { data, error } = await db.from("pipeline_jobs").select("id,source_record_id,status,error_message,preparation_status,source_records(enrichment_status,enrichment_error)").eq("run_id", runId).order("created_at");
  if (error) throw error;
  return data ?? [];
}
function sourceOf(job: Awaited<ReturnType<typeof loadJobs>>[number]) { const value = job.source_records; return (Array.isArray(value) ? value[0] : value) as { enrichment_status: string; enrichment_error: string | null }; }
async function setRun(status: string, stage: string) { const { error } = await db.from("pipeline_runs").update({ status, stage, completed_at: null }).eq("id", runId); if (error) throw error; }
async function refresh() { const { error } = await db.rpc("refresh_pipeline_run", { p_run_id: runId }); if (error) throw error; }
async function runCommand(script: string, args: string[]) { await execFileAsync("npm", ["run", script, "--", ...args], { cwd: process.cwd(), env: process.env, maxBuffer: 20 * 1024 * 1024 }); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function messageOf(error: unknown) { return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000); }
void main().catch(async (error: unknown) => { const message = messageOf(error); await db.from("pipeline_runs").update({ status: "processing_error", error_count: 1 }).eq("id", runId); console.error("Procés automàtic fallit:", message); process.exitCode = 1; });
