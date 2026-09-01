import { getApprovedPage } from "@/lib/approved";
import { ApprovedWorkbench } from "./approved-workbench";

export default async function ApprovedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams; const parsed = Number.parseInt(typeof p.page === "string" ? p.page : "1", 10);
  const filters = { page: Number.isFinite(parsed) && parsed > 0 ? parsed : 1, query: typeof p.q === "string" ? p.q.slice(0, 120) : "", batch: typeof p.batch === "string" ? p.batch : "tots", type: typeof p.type === "string" ? p.type : "totes", service: typeof p.service === "string" ? p.service : "tots" };
  const result = await getApprovedPage(filters);
  return <ApprovedWorkbench result={result} filters={{ ...filters, page: result.page }} />;
}
