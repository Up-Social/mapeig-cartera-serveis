import type { CatalogSort } from "@/lib/catalog-types";
import { getMasterServicePage } from "@/lib/master-catalog";
import { CatalogWorkbench } from "./catalog-workbench";

const allowedSorts: CatalogSort[] = ["source_row", "code", "name"];

type CatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const pageValue = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10,
  );
  const requestedSort =
    typeof params.sort === "string" ? params.sort : "source_row";
  const filters = {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
    status: typeof params.status === "string" ? params.status : "tots",
    scope: typeof params.scope === "string" ? params.scope : "tots",
    sort: allowedSorts.includes(requestedSort as CatalogSort)
      ? (requestedSort as CatalogSort)
      : ("source_row" as const),
  };
  const result = await getMasterServicePage(filters);
  return (
    <CatalogWorkbench
      result={result}
      filters={{ ...filters, page: result.page }}
    />
  );
}
