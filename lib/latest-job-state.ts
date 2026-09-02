export type JobStateRow = {
  source_record_id: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
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

export function newestProcessedFirst<T extends JobStateRow>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) =>
    String(b.completed_at ?? b.created_at).localeCompare(String(a.completed_at ?? a.created_at)),
  );
}

export function prioritizeById<T extends { id: string }>(items: T[], focusedId?: string): T[] {
  if (!focusedId) return items;
  return [...items].sort((a, b) => Number(b.id === focusedId) - Number(a.id === focusedId));
}
