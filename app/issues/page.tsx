import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { getIssuePage } from "@/lib/issues";
import { ISSUE_CATEGORY_LABELS } from "@/lib/issue-types";
import { FINANCING_TYPES, FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { WorkPager, WorkTable } from "@/components/work-list";

export default async function IssuesPage({ searchParams }: PageProps<"/issues">) {
  const params = await searchParams;
  const filters = { page: Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1), query: typeof params.q === "string" ? params.q.slice(0, 120) : "", type: typeof params.type === "string" ? params.type : "totes" };
  const result = await getIssuePage(filters);
  const origin = `/issues?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(filters.page) })}`;
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><p className="page-eyebrow">Seguiment i resolució</p><h1 className="page-title">Incidències</h1><p className="page-description">{result.total} casos requereixen atenció. Obre el cas per veure la fase i el diagnòstic.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Total", result.metrics.total], ["Evidència insuficient", result.metrics.insufficient], ["Errors tècnics", result.metrics.technical], ["Problemes de font", result.metrics.source]].map(([label, value]) => <div className="surface p-4" key={label}><strong className="text-xl">{value}</strong><p className="text-sm text-muted-foreground">{label}</p></div>)}</div>
    <AutoFilterForm className="surface grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]"><input className="form-text" name="q" aria-label="Cercar incidències" placeholder="Títol, registre o entitat…" defaultValue={filters.query}/><select className="form-control !h-10" name="type" aria-label="Tipologia" defaultValue={filters.type}><option value="totes">Totes les tipologies</option>{FINANCING_TYPES.map(type => <option key={type} value={type}>{FINANCING_TYPE_LABELS[type]}</option>)}</select><button className="rounded-md bg-primary px-4 text-sm text-primary-foreground">Filtrar</button>{(filters.query || filters.type !== "totes") && <Link className="text-sm underline" href="/issues">Netejar filtres</Link>}</AutoFilterForm>
    <WorkTable headings={["Cas", "Incidència", "Fase", "Darrera activitat", "Acció"]} empty={result.issues.length ? undefined : "No hi ha incidències amb aquests filtres."}>
      {result.issues.map(issue => { const record = issue.record; const href = `/records/${record.id}?${new URLSearchParams({ from: origin })}`; const technical = issue.phase !== "review"; return <tr key={record.id}><td data-label="Cas"><Link className="font-semibold underline underline-offset-2" href={href}>{record.title}</Link><p className="mt-1 text-xs text-muted-foreground">{record.sourceRecordId}</p></td><td data-label="Incidència"><span className={`rounded-md border px-2 py-1 text-xs ${technical ? "status-error" : "status-warning"}`}>{ISSUE_CATEGORY_LABELS[issue.category]}</span></td><td data-label="Fase">{issue.phase}</td><td data-label="Darrera activitat">{issue.occurredAt ? new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(issue.occurredAt)) : "—"}</td><td data-label="Acció"><Link className="inline-block rounded-md border px-3 py-2 text-sm" href={href}>Veure incidència</Link></td></tr>; })}
    </WorkTable><WorkPager href={page => `/issues?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(page) })}`} page={result.page} pageCount={result.pageCount} total={result.total}/>
  </section></main>;
}
