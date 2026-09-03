import { getSourcePage } from "@/lib/records-page";
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
  return (
    <ProcessingWorkbench
      key={`${filters.page}:${filters.query}:${filters.type}`}
      result={result}
      filters={filters}
    />
  );
}
