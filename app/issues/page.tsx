import { getIssuePage } from "@/lib/issues";
import { IssuesWorkbench } from "./issues-workbench";

export default async function IssuesPage({ searchParams }: PageProps<"/issues">) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10);
  const filters = {
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
    type: typeof params.type === "string" ? params.type : "totes",
  };
  const result = await getIssuePage(filters);
  return <IssuesWorkbench result={result} filters={{ ...filters, page: result.page }} />;
}
