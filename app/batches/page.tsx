import { redirect } from "next/navigation";
import { getBatchPage, getCloudResourceBlock } from "@/lib/batches";
import { BatchesWorkbench } from "./batches-workbench";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export default async function BatchesPage({ searchParams }: Props) {
  const params = await searchParams;
  const batchId = typeof params.batch === "string" ? params.batch : null;
  if (batchId) redirect(`/batches/${batchId}`);
  const filters = {
    page: Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1),
    kind: params.kind === "operations" ? "operations" as const : "batches" as const,
    status: ["active", "attention", "finished"].includes(String(params.status)) ? params.status as "active" | "attention" | "finished" : "all" as const,
  };
  const [result, cloudBlock] = await Promise.all([
    getBatchPage(filters),
    getCloudResourceBlock(),
  ]);
  return (
    <BatchesWorkbench
      key={`${filters.kind}-${filters.status}-${result.page}`}
      result={result}
      filters={filters}
      cloudBlock={cloudBlock}
    />
  );
}
