import "server-only";

import {
  classifyIssue,
  issueMatchesFilters,
  type IssueFilters,
  type IssuePage,
} from "./issue-types";
import { createServerSupabase, mapRecord, RECORD_SELECT } from "./records-page";

const PAGE_SIZE = 25;
const DATABASE_PAGE_SIZE = 1000;

export async function getIssuePage(filters: IssueFilters): Promise<IssuePage> {
  const db = createServerSupabase();
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("source_records")
      .select(RECORD_SELECT)
      .in("processing_status", ["rebutjat", "sense_evidencia", "error"])
      .order("updated_at", { ascending: false })
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data?.length ?? 0) < DATABASE_PAGE_SIZE) break;
    from += DATABASE_PAGE_SIZE;
  }

  const allIssues = rows
    .map(mapRecord)
    .map(classifyIssue)
    .filter((issue): issue is NonNullable<typeof issue> => issue !== null);
  const issues = allIssues.filter((issue) =>
    issueMatchesFilters(issue, {
      query: filters.query,
      type: filters.type,
      category: filters.category,
      batch: filters.batch,
    }),
  );
  const total = issues.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const batchMap = new Map<string, string>();
  for (const issue of allIssues) {
    if (issue.record.pipelineRunId && issue.record.batchNumber) {
      batchMap.set(issue.record.pipelineRunId, issue.record.batchNumber);
    }
  }

  return {
    issues: issues.slice(start, start + PAGE_SIZE),
    total,
    page,
    pageCount,
    pageSize: PAGE_SIZE,
    batches: [...batchMap].map(([id, number]) => ({ id, number })).sort((a, b) => b.number.localeCompare(a.number)),
    metrics: {
      total: allIssues.length,
      rejected: allIssues.filter((issue) => issue.category === "rejected").length,
      insufficient: allIssues.filter((issue) => issue.category === "insufficient_evidence").length,
      technical: allIssues.filter((issue) => ["matching_error", "enrichment_error", "document_error"].includes(issue.category)).length,
      source: allIssues.filter((issue) => ["no_source", "unsupported"].includes(issue.category)).length,
    },
  };
}
