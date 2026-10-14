import { getApprovedPage } from "@/lib/approved";
import { ApprovedWorkbench } from "./approved-workbench";

export default async function ApprovedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams; const parsed = Number.parseInt(typeof p.page === "string" ? p.page : "1", 10);
  const filters = { page: Number.isFinite(parsed) && parsed > 0 ? parsed : 1, query: typeof p.q === "string" ? p.q.slice(0, 120) : "", type: typeof p.type === "string" ? p.type : "totes" };
  const result = await getApprovedPage(filters);
  return <><section className="surface mb-4 p-4"><h2 className="font-semibold">Foto econòmica dels concerts</h2><p className="mt-1 text-sm">Els resultats següents conserven les adjudicacions aprovades. La foto de concerts aplica els vincles i els efectes econòmics revisats, amb els pendents en una pestanya separada. No sumis les dues sortides.</p><a href="/api/exports/concerts" className="mt-2 inline-block underline" title="Exporta la foto consolidada i els moviments amb les mateixes regles que la fitxa del concert">Descarregar foto i moviments de concerts des de 2024</a></section><ApprovedWorkbench result={result} filters={{ ...filters, page: result.page }} /></>;
}
