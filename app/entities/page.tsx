import { getEntityPage } from "@/lib/entities";
import { EntitiesWorkbench } from "./entities-workbench";

export default async function EntitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const page = Number.parseInt(typeof p.page === "string" ? p.page : "1", 10);
  const filters = { page: Number.isFinite(page) && page > 0 ? page : 1, query: typeof p.q === "string" ? p.q.slice(0, 120) : "", qualification: typeof p.qualification === "string" ? p.qualification : "totes", county: typeof p.county === "string" ? p.county : "totes" };
  const result = await getEntityPage(filters);
  return <EntitiesWorkbench result={result} filters={{ ...filters, page: result.page }} />;
}
