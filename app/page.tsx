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
  };
  if(typeof params.record==='string'&&isUuid(params.record)) redirect(`/records/${params.record}?${new URLSearchParams({ from: "/" })}`);
  const [result,cloudBlock]=await Promise.all([getSourcePage(filters),getCloudResourceBlock()]);
  return (
    <ProcessingWorkbench
      key={`${filters.page}:${filters.query}:${filters.type}`}
      result={result}
      filters={filters}
      cloudBlock={cloudBlock}
    />
  );
}
