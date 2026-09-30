import "server-only";
import { createServerSupabase } from "./records-page";

export type ReviewListFilters = { page: number; query: string; type: string; state: "pending" | "all"; batchId?: string };
export type ReviewListRow = { id: string; jobId: string | null; title: string; sourceId: string; provider: string | null; type: string; classification: string | null; destination: string; batchNumber: number | null; updatedAt: string | null };

export async function getReviewList(filters: ReviewListFilters) {
  let query = createServerSupabase().from("current_record_results").select("id,job_id,title,source_record_id,provider_name,financing_type,classification,destination,batch_number,job_created_at", { count: "exact" }).not("job_id", "is", null);
  if (filters.state === "pending") query = query.eq("destination", "review");
  if (filters.batchId) query = query.eq("run_id", filters.batchId);
  if (filters.type !== "totes") query = query.eq("financing_type", filters.type);
  if (filters.query.trim()) {
    const safe = filters.query.replaceAll(/[,%()]/g, " ").trim();
    query = query.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);
  }
  const size = 25;
  const from = (filters.page - 1) * size;
  const response = await query.order("job_created_at", { ascending: false }).order("id").range(from, from + size - 1);
  if (response.error) throw response.error;
  const total = response.count ?? 0;
  return { rows: (response.data ?? []).map((r): ReviewListRow => ({ id: r.id, jobId: r.job_id, title: r.title, sourceId: r.source_record_id, provider: r.provider_name, type: r.financing_type, classification: r.classification, destination: r.destination, batchNumber: r.batch_number, updatedAt: r.job_created_at })), total, page: filters.page, pageCount: Math.max(1, Math.ceil(total / size)) };
}
