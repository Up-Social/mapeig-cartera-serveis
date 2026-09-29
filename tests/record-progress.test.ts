import test from "node:test";
import assert from "node:assert/strict";
import { recordOperationProgress } from "../lib/record-progress";

const now = Date.parse("2026-09-29T15:00:00Z");
const base = {
  status: "running",
  execution_state: "running",
  failure_kind: null,
  current_step: "ocr" as const,
  progress_completed: 2,
  progress_total: 5,
  progress_detail: "OCR de la pàgina 3 de 5",
  created_at: "2026-09-29T14:55:00Z",
  dispatch_at: "2026-09-29T14:55:01Z",
  claimed_at: "2026-09-29T14:55:02Z",
  last_progress_at: "2026-09-29T14:59:50Z",
  completed_at: null,
  attempts: 4,
};

test("active progress exposes the exact durable step and units", () => {
  const result = recordOperationProgress(base, now);
  assert.equal(result?.state, "active");
  assert.equal(result?.step, "ocr");
  assert.equal(result?.completed, 2);
  assert.equal(result?.total, 5);
});

test("ten minutes without activity is a possible stall", () => {
  const result = recordOperationProgress({ ...base, last_progress_at: "2026-09-29T14:49:59Z" }, now);
  assert.equal(result?.state, "stalled");
});

test("completed status wins over stale legacy execution state", () => {
  const result = recordOperationProgress({ ...base, status: "completed", execution_state: "pending", completed_at: "2026-09-29T14:58:00Z" }, now);
  assert.equal(result?.state, "finished");
});

test("paused and failed tasks are incidents, not active work", () => {
  const result = recordOperationProgress({ ...base, status: "failed", execution_state: "paused", failure_kind: "vercel_quota" }, now);
  assert.equal(result?.state, "incident");
});
