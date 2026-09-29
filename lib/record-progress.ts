import type { RecordOperationProgress } from "./workbench-types";

export const RECORD_STALL_AFTER_MS = 10 * 60_000;

export type ProgressTask = {
  status: string;
  execution_state: string | null;
  failure_kind: string | null;
  current_step: RecordOperationProgress["step"] | null;
  progress_completed: number | null;
  progress_total: number | null;
  progress_detail: string | null;
  created_at: string;
  dispatch_at: string | null;
  claimed_at: string | null;
  last_progress_at: string | null;
  completed_at: string | null;
  attempts: number | null;
};

export function recordOperationProgress(
  task: ProgressTask | null,
  now = Date.now(),
): RecordOperationProgress | null {
  if (!task) return null;
  const startedAt = task.claimed_at ?? task.dispatch_at ?? task.created_at;
  const lastActivityAt = task.last_progress_at ?? startedAt;
  const terminal = task.status === "completed" || task.execution_state === "completed";
  const incident =
    task.status === "failed" || ["paused", "interrupted"].includes(task.execution_state ?? "");
  const active = task.status === "running" || task.execution_state === "running";
  const waiting = task.status === "queued" || task.execution_state === "pending";
  const stalled =
    !terminal &&
    !incident &&
    (active || waiting) &&
    now - Date.parse(lastActivityAt) >= RECORD_STALL_AFTER_MS;
  const state: RecordOperationProgress["state"] = terminal
    ? "finished"
    : incident
      ? "incident"
      : stalled
        ? "stalled"
        : active
          ? "active"
          : waiting
            ? "waiting"
            : "idle";

  return {
    state,
    step: task.current_step,
    completed: task.progress_completed,
    total: task.progress_total,
    detail: task.progress_detail,
    startedAt,
    lastActivityAt,
    finishedAt: task.completed_at,
    attempts: Number(task.attempts ?? 0),
    failureKind: task.failure_kind,
  };
}
