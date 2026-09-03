import "server-only";

import { latestJobsByRecord } from "./latest-job-state";
import { createServerSupabase } from "./records-page";

export type NavigationCounts = { review: number; issues: number; approved: number };

export async function getNavigationCounts(): Promise<NavigationCounts> {
  const db = createServerSupabase();
  const [jobs, issues, approved] = await Promise.all([
    db.from("pipeline_jobs").select("source_record_id,status,created_at").in("status", ["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"]).order("created_at", { ascending: false }),
    db.from("source_records").select("id", { count: "exact", head: true }).in("processing_status", ["rebutjat", "sense_evidencia", "error"]),
    db.from("service_provisions").select("id,source_records!inner(processing_status)", { count: "exact", head: true }).eq("source_records.processing_status", "completat"),
  ]);
  if (jobs.error) throw jobs.error;
  if (issues.error) throw issues.error;
  if (approved.error) throw approved.error;
  return {
    review: latestJobsByRecord(jobs.data ?? []).filter((job) => job.status === "needs_review").length,
    issues: issues.count ?? 0,
    approved: approved.count ?? 0,
  };
}
