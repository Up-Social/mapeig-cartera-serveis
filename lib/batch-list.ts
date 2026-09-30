import type { BatchSummary } from "./batch-types";

export type BatchListFilters = {
  page: number;
  kind: "batches" | "operations";
  status: "all" | "active" | "attention" | "finished";
};

export function paginateBatchSummaries(batches: BatchSummary[], filters: BatchListFilters) {
  const filtered = batches.filter(batch => {
    if ((batch.purpose === "record_operation") !== (filters.kind === "operations")) return false;
    const attention = batch.status === "paused" || batch.reviewCount > 0 || batch.errorCount > 0;
    return filters.status === "all" || (filters.status === "active" && batch.isActive) ||
      (filters.status === "attention" && attention) ||
      (filters.status === "finished" && !batch.isActive && !attention);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  return { items: filtered.slice((page - 1) * 25, page * 25), page, pageCount, total: filtered.length };
}
