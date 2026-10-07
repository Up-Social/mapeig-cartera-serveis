import { getSourcePage } from "@/lib/records-page";
import { redirect } from "next/navigation";
import {isUuid} from '@/lib/uuid';
import { ProcessingWorkbench } from "./processing-workbench-v2";
import {getCloudResourceBlock} from '@/lib/batches';

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const pageValue = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10,
  );
  const filters = {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
    type: typeof params.type === "string" ? params.type : "totes",
    processing: ["pending", "in_progress", "processed", "error"].includes(String(params.processing)) ? String(params.processing) : "all",
    execution: ["none", "batch", "individual", "other"].includes(String(params.execution)) ? String(params.execution) : "all",
    review: ["awaiting_review", "reviewed"].includes(String(params.review)) ? String(params.review) : "all",
  };
  const [result,cloudBlock]=await Promise.all([getSourcePage(filters),getCloudResourceBlock()]);
  if(typeof params.record==='string'&&isUuid(params.record)) redirect(`/records/${params.record}?${new URLSearchParams({ from: "/" })}`);
  return (
    <ProcessingWorkbench
      key={`${filters.page}:${filters.query}:${filters.type}:${filters.processing}:${filters.execution}:${filters.review}`}
      result={result}
      filters={filters}
      cloudBlock={cloudBlock}
    />
  );
}
