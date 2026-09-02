export type JobStateRow = {
  source_record_id: string;
  status: string;
  created_at: string;
};

export function latestJobsByRecord<T extends JobStateRow>(jobs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const job of [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!latest.has(job.source_record_id)) latest.set(job.source_record_id, job);
  }
  return [...latest.values()];
}

export function summarizeLatestJobs(jobs: JobStateRow[]) {
  const latest = latestJobsByRecord(jobs);
  return {
    queued: latest.filter((job) => ["selected", "queued", "preparing", "ready", "matching"].includes(job.status)).length,
    completed: latest.filter((job) => ["approved", "corrected"].includes(job.status)).length,
    review: latest.filter((job) => job.status === "needs_review").length,
  };
}
