import { getIssuePage } from "@/lib/issues";
import { ISSUE_CATEGORIES } from "@/lib/issue-types";
import { IssuesWorkbench } from "./issues-workbench";

export default async function IssuesPage({ searchParams }: PageProps<"/issues">) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10);
  const requestedCategory = typeof params.category === "string" ? params.category : "totes";
  const filters = {
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
    type: typeof params.type === "string" ? params.type : "totes",
    category: requestedCategory === "totes" || ISSUE_CATEGORIES.includes(requestedCategory as (typeof ISSUE_CATEGORIES)[number]) ? requestedCategory : "totes",
    batch: typeof params.batch === "string" ? params.batch : "tots",
  };
  const result = await getIssuePage(filters);
  return <IssuesWorkbench result={result} filters={{ ...filters, page: result.page }} />;
}
