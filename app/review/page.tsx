import { getReviewQueue } from "@/lib/records-page";
import { createServerSupabase } from "@/lib/records-page";
import { ReviewWorkbench } from "./review-workbench";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function ReviewPage({ searchParams }: Props) {
  const params = await searchParams;
  const filters = {
    batchId: typeof params.batch === "string" ? params.batch : undefined,
    type: typeof params.type === "string" ? params.type : "totes",
    state: typeof params.state === "string" ? params.state : "pending",
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
  return (
    <ReviewWorkbench
      key={queue.records.map((record) => `${record.id}:${record.reviewDecision ?? "pending"}`).join("|")}
      queue={queue}
      filters={filters}
      services={(services.data ?? []).map((service) => ({
        code: service.service_code,
        name: service.service_name,
        scope: service.sector_scope,
      }))}
    />
  );
}
