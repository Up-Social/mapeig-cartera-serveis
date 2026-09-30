import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentResults } from "@/lib/current-results";
import { TableActionLink, WorkPager, WorkTable } from "@/components/work-list";

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const params = await searchParams;
  if (typeof params.classification === "string" && params.classification !== "out_of_portfolio") redirect(params.classification === "discarded" ? "/discarded" : params.classification === "in_portfolio" ? "/review?state=all" : "/issues");
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const query = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const { rows, total, pageCount } = await getCurrentResults({ classification: "out_of_portfolio", page, query });
  const origin = `/analysis?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) })}`;
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><p className="page-eyebrow">Resultats · validació humana</p><h1 className="page-title">Fora de cartera</h1><p className="page-description">Resultats que no corresponen a un servei final de la Cartera.</p></div>
    <AutoFilterForm className="surface flex flex-wrap gap-3 p-4"><input className="form-text flex-1" name="q" aria-label="Cercar casos" placeholder="Títol, registre o entitat…" defaultValue={query}/><button className="rounded-md bg-primary px-4 text-sm text-primary-foreground">Filtrar</button>{query && <Link className="self-center text-sm underline" href="/analysis">Netejar filtres</Link>}</AutoFilterForm>
    <a className="inline-block text-sm underline" href="/api/exports/outside">Exportar casos revisats fora de cartera</a>
    <WorkTable headings={["Cas", "Servei identificat", "Entitat", "Revisió", "Acció"]} empty={rows.length ? undefined : "No hi ha casos fora de cartera amb aquests filtres."}>
      {rows.map(row => { const href = `/records/${row.id}?${new URLSearchParams({ from: origin, ...(row.job_id ? { job: row.job_id } : {}) })}`; return <tr key={row.id}><td data-label="Cas"><Link className="font-semibold underline underline-offset-2" href={href}>{row.title}</Link><p className="mt-1 text-xs text-muted-foreground">{row.source_record_id}</p></td><td data-label="Servei identificat">{row.service_description ?? "—"}</td><td data-label="Entitat">{row.provider_name ?? "No informada"}</td><td data-label="Revisió"><span className={`table-status ${row.human_reviewed ? "status-neutral" : "status-warning"}`}>{row.human_reviewed ? "Revisat" : "Pendent"}</span></td><td data-label="Acció"><TableActionLink href={href} label={`Veure el cas ${row.title}`}/></td></tr>})}
    </WorkTable><WorkPager href={next => `/analysis?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(next) })}`} page={page} pageCount={pageCount} total={total}/>
  </section></main>;
}
