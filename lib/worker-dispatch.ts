import "server-only";

import { spawn } from "node:child_process";
import { createServerSupabase } from "@/lib/records-page";

type WorkerTask =
  | { type: "prepare_run"; runId: string }
  | { type: "enrich_record"; sourceRecordId: string }
  | { type: "match_run"; runId: string };

export async function dispatchWorkerTask(
  task: WorkerTask,
  localScript: string,
  localArgs: string[],
) {
  if (!process.env.VERCEL) {
    const child = spawn("npm", ["run", localScript, "--", ...localArgs], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { mode: "local" as const };
  }

  const table = createServerSupabase().from("worker_tasks");
  const { error } = task.type === "enrich_record"
    ? await table.insert({
        task_type: task.type,
        source_record_id: task.sourceRecordId,
        run_id: null,
      })
    : await table.insert({
        task_type: task.type,
        run_id: task.runId,
        source_record_id: null,
      });
  if (error && error.code !== "23505") throw error;
  return { mode: "queued" as const };
}
