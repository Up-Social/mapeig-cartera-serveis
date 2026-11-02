import { getApprovedPage } from "@/lib/approved";
import { ApprovedWorkbench } from "./approved-workbench";
import {LineReadUnavailable} from '@/lib/concerts/line-read-guard';

export default async function ApprovedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams; const parsed = Number.parseInt(typeof p.page === "string" ? p.page : "1", 10);
  const filters = { page: Number.isFinite(parsed) && parsed > 0 ? parsed : 1, query: typeof p.q === "string" ? p.q.slice(0, 120) : "", type: typeof p.type === "string" ? p.type : "totes" };
  let result;
  try{result=await getApprovedPage(filters);}catch(error){if(error instanceof LineReadUnavailable)return <main className="page-shell"><section className="page-container"><p role="alert">{error.message}</p></section></main>;throw error;}
  return <ApprovedWorkbench result={result} filters={{ ...filters, page: result.page }} />;
}
