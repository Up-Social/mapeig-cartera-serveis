import "server-only";
import {executionMode} from "./pipeline/execution-mode";

import { spawn } from "node:child_process";
import { createServerSupabase } from "@/lib/records-page";

type WorkerTask =
  | { type: "prepare_run"; runId: string }
  | { type: "enrich_record"; sourceRecordId: string }
  | { type: "match_run"; runId: string }
  | { type: "process_run"; runId: string };

export async function dispatchWorkerTask(
  task: WorkerTask,
  localScript: string,
  localArgs: string[],
) {
  const mode=executionMode();
  if(mode==='disabled')throw new Error('Execució desactivada en aquest entorn.');
  if(mode==='vercel_workflow'){
    const db=createServerSupabase();
    const payload={task_type:task.type,run_id:'runId' in task?task.runId:null,source_record_id:'sourceRecordId' in task?task.sourceRecordId:null,executor:'vercel_workflow'};
    const inserted=await db.from('worker_tasks').insert(payload).select('id').single();
    if(inserted.error&&inserted.error.code!=='23505')throw new Error('No s’ha pogut posar en cua.');
    let id=inserted.data?.id;
    if(!id){let q=db.from('worker_tasks').select('id').eq('task_type',task.type).eq('executor','vercel_workflow').in('status',['queued','running']);q='runId' in task?q.eq('run_id',task.runId):q.eq('source_record_id',task.sourceRecordId);const found=await q.single();if(found.error)throw new Error('Tasca incompatible ja activa.');id=found.data.id;}
    const {launchCloudTask}=await import('./cloud/launch');await launchCloudTask(id);
    return {mode:'queued' as const};
  }
  const usePersistentQueue =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.WORKER_EXECUTION_MODE === "queue";

  if (!usePersistentQueue) {
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
