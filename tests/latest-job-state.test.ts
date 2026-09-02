import assert from "node:assert/strict";
import test from "node:test";
import { latestJobsByRecord, newestProcessedFirst, prioritizeById, summarizeLatestJobs } from "../lib/latest-job-state";

const jobs = [
  { source_record_id: "record-a", status: "needs_review", created_at: "2026-09-01T10:00:00Z" },
  { source_record_id: "record-a", status: "approved", created_at: "2026-09-02T10:00:00Z" },
  { source_record_id: "record-b", status: "needs_review", created_at: "2026-09-02T09:00:00Z" },
  { source_record_id: "record-c", status: "matching", created_at: "2026-09-02T08:00:00Z" },
];

test("conserva només el job més recent de cada registre", () => {
  assert.deepEqual(
    latestJobsByRecord(jobs).map((job) => [job.source_record_id, job.status]),
    [["record-a", "approved"], ["record-b", "needs_review"], ["record-c", "matching"]],
  );
});

test("calcula les mètriques sense comptar jobs històrics", () => {
  assert.deepEqual(summarizeLatestJobs(jobs), { queued: 1, completed: 1, review: 1 });
});

test("ordena primer el registre processat més recentment", () => {
  assert.deepEqual(
    newestProcessedFirst([
      { ...jobs[2], completed_at: "2026-09-02T11:00:00Z" },
      { ...jobs[1], completed_at: "2026-09-02T12:00:00Z" },
    ]).map((job) => job.source_record_id),
    ["record-a", "record-b"],
  );
});

test("prioritza el registre d'accés directe sense eliminar la resta", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(prioritizeById(items, "b").map((item) => item.id), ["b", "a", "c"]);
});
