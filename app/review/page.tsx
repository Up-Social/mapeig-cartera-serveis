import { getReviewQueue } from "@/lib/records-page";
import { createServerSupabase } from "@/lib/records-page";
import { ReviewWorkbench } from "./review-workbench";
import { prioritizeById } from "@/lib/latest-job-state";
import { isUuid } from "@/lib/uuid";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const focusedRecordId = typeof params.record === "string" && isUuid(params.record) ? params.record : undefined;
  const filters = {
    batchId: typeof params.batch === "string" ? params.batch : undefined,
    type: typeof params.type === "string" ? params.type : "totes",
    state: "pending",
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
  };
  const [queue, services] = await Promise.all([
    getReviewQueue(filters),
    createServerSupabase()
      .from("master_services")
      .select("service_code,service_name,sector_scope")
      .eq("portfolio_status", "Dentro")
      .order("service_code"),
  ]);
  if (services.error) throw services.error;
  const focusedQueue = {
    ...queue,
    records: prioritizeById(queue.records, focusedRecordId),
  };
  return (
    <ReviewWorkbench
      key={`${focusedRecordId ?? "queue"}:${focusedQueue.records.map((record) => `${record.id}:${record.reviewDecision ?? "pending"}`).join("|")}`}
      queue={focusedQueue}
      filters={filters}
      focusedRecordId={focusedRecordId}
      services={(services.data ?? []).map((service) => ({
        code: service.service_code,
        name: service.service_name,
        scope: service.sector_scope,
      }))}
    />
  );
}
