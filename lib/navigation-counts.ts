import "server-only";

import { latestJobsByRecord } from "./latest-job-state";
import { getIssuePage } from "./issues";
import { createServerSupabase } from "./records-page";

export type NavigationCounts = { review: number; issues: number; approved: number };

export async function getNavigationCounts(): Promise<NavigationCounts> {
  const db = createServerSupabase();
  const [jobs, issues, approved] = await Promise.all([
    db.from("pipeline_jobs").select("source_record_id,status,created_at").in("status", ["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"]).order("created_at", { ascending: false }),
    getIssuePage({ page: 1, query: "", type: "totes" }),
    db.from("service_provisions").select("id,source_records!inner(processing_status)", { count: "exact", head: true }).eq("source_records.processing_status", "completat"),
  ]);
  if (jobs.error) throw jobs.error;
  if (approved.error) throw approved.error;
  return {
    review: latestJobsByRecord(jobs.data ?? []).filter((job) => job.status === "needs_review").length,
    issues: issues.metrics.total,
    approved: approved.count ?? 0,
  };
}
