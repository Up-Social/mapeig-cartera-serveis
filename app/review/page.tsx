import { AutoFilterForm } from "@/components/auto-filter-form";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getReviewList } from "@/lib/review-list";
import { FINANCING_TYPES, FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { CLASSIFICATION_LABELS, type Classification } from "@/lib/analysis-contract";
import { isUuid } from "@/lib/uuid";
import { WorkPager, WorkTable } from "@/components/work-list";

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const focused = typeof params.record === "string" && isUuid(params.record) ? params.record : undefined;
  if (focused) {
    const detail = new URLSearchParams();
    if (typeof params.job === "string" && isUuid(params.job)) detail.set("job", params.job);
    const back = new URLSearchParams();
    for (const key of ["batch", "type", "state", "q", "page"]) if (typeof params[key] === "string") back.set(key, params[key]);
    detail.set("from", `/review${back.size ? `?${back}` : ""}`);
    redirect(`/records/${focused}?${detail}`);
  }
  const filters = { page: Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1), query: typeof params.q === "string" ? params.q.slice(0, 120) : "", type: typeof params.type === "string" ? params.type : "totes", state: params.state === "all" ? "all" as const : "pending" as const, batchId: typeof params.batch === "string" && isUuid(params.batch) ? params.batch : undefined };
  const result = await getReviewList(filters);
  const list = new URLSearchParams();
  if (filters.query) list.set("q", filters.query);
  if (filters.type !== "totes") list.set("type", filters.type);
  if (filters.state === "all") list.set("state", "all");
  if (filters.batchId) list.set("batch", filters.batchId);
  if (filters.page > 1) list.set("page", String(filters.page));
  const from = `/review${list.size ? `?${list}` : ""}`;
  const caseHref = (id: string, jobId: string | null) => `/records/${id}?${new URLSearchParams({ ...(jobId ? { job: jobId } : {}), from })}`;
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><p className="page-eyebrow">Validació humana</p><h1 className="page-title">Revisió de correspondències</h1><p className="page-description">{result.total} casos en aquesta selecció. Obre un cas per estudiar les evidències i registrar la decisió.</p></div>
    {filters.batchId && <Link className="text-sm underline" href={`/batches/${filters.batchId}/results`}>Tornar al lot</Link>}
    <AutoFilterForm className="surface grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_180px_auto]">
      {filters.batchId && <input type="hidden" name="batch" value={filters.batchId} />}
      <input className="form-text" name="q" aria-label="Cercar casos" defaultValue={filters.query} placeholder="Títol, registre o entitat…" />
      <select className="form-control !h-10" name="type" aria-label="Tipologia" defaultValue={filters.type}><option value="totes">Totes les tipologies</option>{FINANCING_TYPES.map(type => <option key={type} value={type}>{FINANCING_TYPE_LABELS[type]}</option>)}</select>
      <select className="form-control !h-10" name="state" aria-label="Estat de revisió" defaultValue={filters.state}><option value="pending">Pendents</option><option value="all">Tots els resultats</option></select>
      <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Filtrar</button>
      {(filters.query || filters.type !== "totes" || filters.state !== "pending") && <Link className="text-sm underline" href={filters.batchId ? `/review?batch=${filters.batchId}` : "/review"}>Netejar filtres</Link>}
    </AutoFilterForm>
    <WorkTable headings={["Cas", "Proposta", "Revisió", "Lot", "Acció"]} empty={result.rows.length ? undefined : "No hi ha casos amb aquests filtres."}>
      {result.rows.map(row => <tr key={row.id}><td data-label="Cas"><Link className="font-semibold underline underline-offset-2" href={caseHref(row.id, row.jobId)}>{row.title}</Link><p className="mt-1 text-xs text-muted-foreground">{row.sourceId} · {row.provider ?? "Entitat no informada"} · {FINANCING_TYPE_LABELS[row.type as keyof typeof FINANCING_TYPE_LABELS] ?? row.type}</p></td><td data-label="Proposta">{CLASSIFICATION_LABELS[row.classification as Classification] ?? "Sense proposta"}</td><td data-label="Revisió"><span className={`rounded-md border px-2 py-1 text-xs ${row.destination === "review" ? "status-warning" : "status-neutral"}`}>{row.destination === "review" ? "Pendent de revisió" : "Resultat disponible"}</span></td><td data-label="Lot">{row.batchNumber ?? "—"}</td><td data-label="Acció"><Link className="inline-block rounded-md border px-3 py-2 font-medium" href={caseHref(row.id, row.jobId)}>Analitzar</Link></td></tr>)}
    </WorkTable><WorkPager href={page => `/review?${new URLSearchParams({ ...Object.fromEntries(list), page: String(page) })}`} page={result.page} pageCount={result.pageCount} total={result.total} />
  </section></main>;
}
