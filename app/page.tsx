import { getSourcePage,getSourceRecord } from "@/lib/records-page";
import {isUuid} from '@/lib/uuid';
import { ProcessingWorkbench } from "./processing-workbench-v2";

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
  const result = await getSourcePage(filters);
  if(typeof params.record==='string'&&isUuid(params.record)){const record=await getSourceRecord(params.record);if(record){result.records=[record];result.total=1;result.pageCount=1;}}
  return (
    <ProcessingWorkbench
      key={`${filters.page}:${filters.query}:${filters.type}`}
      result={result}
      filters={filters}
    />
  );
}
