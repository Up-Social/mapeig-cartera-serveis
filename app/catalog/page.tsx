import { getMasterServicePage } from "@/lib/master-catalog";
import { CatalogWorkbench } from "./catalog-workbench";

type CatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const pageValue = Number.parseInt(
    typeof params.page === "string" ? params.page : "1",
    10,
  );
  const filters = {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    query: typeof params.q === "string" ? params.q.slice(0, 120) : "",
  };
  const result = await getMasterServicePage(filters);
  return (
    <CatalogWorkbench
      result={result}
      filters={{ ...filters, page: result.page }}
    />
  );
}
