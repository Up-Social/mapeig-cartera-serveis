import assert from "node:assert/strict";
import test from "node:test";
import { paginateBatchSummaries } from "../lib/batch-list";
import type { BatchSummary } from "../lib/batch-types";

const summary = (id: number, purpose: string): BatchSummary => ({
  id: String(id), purpose, status: "completed", isActive: false,
  reviewCount: 0, errorCount: 0,
} as BatchSummary);

test("recent individual operations cannot hide older batches", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, index) => summary(100 - index, "record_operation")),
    summary(61, "automated_cloud"),
    summary(60, "automated_cloud"),
  ];
  const batches = paginateBatchSummaries(rows, { page: 1, kind: "batches", status: "all" });
  assert.equal(batches.total, 2);
  assert.deepEqual(batches.items.map(item => item.id), ["61", "60"]);
  const operations = paginateBatchSummaries(rows, { page: 2, kind: "operations", status: "all" });
  assert.equal(operations.total, 30);
  assert.equal(operations.pageCount, 2);
  assert.deepEqual(operations.items.map(item => item.id), ["75", "74", "73", "72", "71"]);
});

test("batch filtering happens before pagination, including beyond the first database block", () => {
  const rows = [
    ...Array.from({ length: 510 }, (_, index) => summary(1000 - index, "record_operation")),
    ...Array.from({ length: 27 }, (_, index) => summary(61 - index, "automated_batch")),
  ];
  const page = paginateBatchSummaries(rows, { page: 2, kind: "batches", status: "all" });
  assert.equal(page.total, 27);
  assert.equal(page.pageCount, 2);
  assert.deepEqual(page.items.map(item => item.id), ["36", "35"]);
});
