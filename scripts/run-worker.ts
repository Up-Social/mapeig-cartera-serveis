import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Falten NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});
const once = process.argv.includes("--once");
const pollMs = integerOption("--poll-ms", 3000, 500, 60000);
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

type Task = {
  id: string;
  task_type: "prepare_run" | "enrich_record" | "match_run" | "process_run";
  run_id: string | null;
  source_record_id: string | null;
  attempts: number;
};

async function main() {
  console.log(`Worker ${workerId} connectat. ${once ? "Una tasca" : `Sondeig cada ${pollMs} ms`}.`);
  do {
    const task = await claimTask();
    if (!task) {
      if (once) break;
      await delay(pollMs);
      continue;
    }
    await executeTask(task);
  } while (!stopping);
  console.log("Worker aturat.");
}

async function claimTask(): Promise<Task | null> {
  const { data, error } = await db.rpc("claim_worker_task", { p_worker_id: workerId });
  if (error) throw error;
  return (data?.[0] as Task | undefined) ?? null;
}

async function executeTask(task: Task) {
  const command = commandFor(task);
  const heartbeat = setInterval(() => {
    void db.from("worker_tasks").update({ claimed_at: new Date().toISOString() }).eq("id", task.id).eq("claimed_by", workerId).eq("status", "running");
  }, 60_000);
  console.log(`${task.id}: ${task.task_type} · intent ${task.attempts}`);
  try {
    const { stdout, stderr } = await execFileAsync("npm", command, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
    const { error } = await db.from("worker_tasks").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", task.id).eq("claimed_by", workerId);
    if (error) throw error;
    console.log(`${task.id}: completada`);
  } catch (error) {
    const message = formatError(error).slice(0, 2000);
    await markDomainFailure(task, message);
    const willRetry = task.task_type === "process_run" && task.attempts < 3;
    if (willRetry && task.run_id) {
      await db.from("pipeline_runs").update({ status: "queued" }).eq("id", task.run_id);
    }
    const { error: updateError } = await db.from("worker_tasks").update({
      status: willRetry ? "queued" : "failed",
      claimed_by: willRetry ? null : workerId,
      claimed_at: willRetry ? null : new Date().toISOString(),
      completed_at: willRetry ? null : new Date().toISOString(),
      error_message: message,
    }).eq("id", task.id).eq("claimed_by", workerId);
    if (updateError) console.error(`${task.id}: no s'ha pogut registrar l'error: ${formatError(updateError)}`);
    console.error(`${task.id}: ${message}`);
  } finally {
    clearInterval(heartbeat);
  }
}

function commandFor(task: Task): string[] {
  if (task.task_type === "prepare_run" && task.run_id)
    return ["run", "pipeline:prepare", "--", "--run-id", task.run_id];
  if (task.task_type === "enrich_record" && task.source_record_id)
    return ["run", "enrichment:run", "--", "--source-record-id", task.source_record_id];
  if (task.task_type === "match_run" && task.run_id)
    return ["run", "matching:run", "--", "--run-id", task.run_id];
  if (task.task_type === "process_run" && task.run_id)
    return ["run", "pipeline:process", "--", "--run-id", task.run_id];
  throw new Error(`Tasca ${task.id} sense objectiu vàlid`);
}

async function markDomainFailure(task: Task, message: string) {
  if (task.task_type === "enrich_record" && task.source_record_id) {
    await db.from("source_records").update({ enrichment_status: "error", enrichment_error: message }).eq("id", task.source_record_id);
  } else if (task.task_type === "prepare_run" && task.run_id) {
    await db.from("pipeline_runs").update({ status: "preparation_error", error_count: 1 }).eq("id", task.run_id);
    const { data: jobs } = await db.from("pipeline_jobs").select("source_record_id").eq("run_id", task.run_id);
    const recordIds = (jobs ?? []).map((job) => job.source_record_id);
    if (recordIds.length) {
      await db.from("source_records").update({
        evidence_status: "error",
        evidence_error: message,
        processing_status: "error",
        updated_at: new Date().toISOString(),
      }).in("id", recordIds);
    }
  } else if (task.task_type === "process_run" && task.run_id) {
    await db.from("pipeline_runs").update({ status: "processing_error", error_count: 1 }).eq("id", task.run_id);
  } else if (task.task_type === "match_run" && task.run_id) {
    await db.from("pipeline_runs").update({ status: "matching_error", error_count: 1 }).eq("id", task.run_id);
    const { data: jobs } = await db.from("pipeline_jobs").select("source_record_id").eq("run_id", task.run_id);
    const recordIds = (jobs ?? []).map((job) => job.source_record_id);
    if (recordIds.length) {
      await db.from("source_records").update({
        processing_status: "error",
        updated_at: new Date().toISOString(),
      }).in("id", recordIds);
    }
  }
}

function integerOption(name: string, fallback: number, min: number, max: number) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} ha de ser un enter entre ${min} i ${max}`);
  return value;
}
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(" · ") || JSON.stringify(value);
  }
  return String(error);
}

void main().catch((error: unknown) => {
  console.error(`Worker fallit: ${formatError(error)}`);
  process.exitCode = 1;
});
