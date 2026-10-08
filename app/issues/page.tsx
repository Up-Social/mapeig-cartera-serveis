import { AutoFilterForm } from "@/components/auto-filter-form";
import Link from "next/link";
import { getIssuePage } from "@/lib/issues";
import { ISSUE_CATEGORY_LABELS, issuePhaseLabel } from "@/lib/issue-types";
import { FINANCING_TYPES, FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { TableActionLink, WorkPager, WorkTable } from "@/components/work-list";

export default async function IssuesPage({ searchParams }: PageProps<"/issues">) {
  const params = await searchParams;
  const filters = { page: Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1), query: typeof params.q === "string" ? params.q.slice(0, 120) : "", type: typeof params.type === "string" ? params.type : "totes" };
  const result = await getIssuePage(filters);
  const origin = `/issues?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(filters.page) })}`;
  return <main className="page-shell"><section className="page-container space-y-5">
    <div><p className="page-eyebrow">Seguiment i resolució</p><h1 className="page-title">Incidències</h1><p className="page-description">{result.total} casos requereixen atenció. No tots són errors: la majoria són anàlisis completades que no disposen de prou evidència per proposar un servei amb seguretat.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Total", result.metrics.total], ["Anàlisi sense prou evidència", result.metrics.insufficient], ["Errors tècnics", result.metrics.technical], ["Problemes de font", result.metrics.source]].map(([label, value]) => <div className="surface p-4" key={label}><strong className="text-xl">{value}</strong><p className="text-sm text-muted-foreground">{label}</p></div>)}</div>
    <section className="surface p-4" aria-labelledby="issue-guide-title">
      <h2 id="issue-guide-title" className="font-semibold">Com interpretar aquests casos</h2>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
        <p><strong>{result.metrics.insufficient} anàlisis completades.</strong> La documentació és llegible, però no acredita amb prou precisió el servei, la població o els rols. Requereixen revisió humana o una font millor; repetir el mateix procés no garanteix un resultat diferent.</p>
        <p><strong>{result.metrics.source} problemes de font.</strong> Falta el document oficial, el format no és processable o cal recuperar el PDF. Primer s’ha de millorar la font i després tornar a analitzar.</p>
        <p><strong>{result.metrics.technical} errors tècnics.</strong> El procés es va interrompre abans de guardar un resultat revisable. Són els casos prioritaris per diagnosticar i reprendre de manera controlada.</p>
      </div>
    </section>
    <AutoFilterForm className="surface grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]"><input className="form-text" name="q" aria-label="Cercar incidències" placeholder="Títol, registre o entitat…" defaultValue={filters.query}/><select className="form-control !h-10" name="type" aria-label="Tipologia" defaultValue={filters.type}><option value="totes">Totes les tipologies</option>{FINANCING_TYPES.map(type => <option key={type} value={type}>{FINANCING_TYPE_LABELS[type]}</option>)}</select><button className="rounded-md bg-primary px-4 text-sm text-primary-foreground">Filtrar</button>{(filters.query || filters.type !== "totes") && <Link className="text-sm underline" href="/issues">Netejar filtres</Link>}</AutoFilterForm>
    <WorkTable className="issues-table" headings={["Cas", "Incidència", "Fase", "Darrera activitat", "Acció"]} empty={result.issues.length ? undefined : "No hi ha incidències amb aquests filtres."}>
      {result.issues.map(issue => { const record = issue.record; const href = `/records/${record.id}?${new URLSearchParams({ from: origin })}`; const technical = issue.phase !== "review"; return <tr key={record.id}><td data-label="Cas"><Link className="font-semibold underline underline-offset-2" href={href}>{record.title}</Link><p className="mt-1 text-xs text-muted-foreground">{record.sourceRecordId}</p></td><td data-label="Incidència"><span className={`table-status ${technical ? "status-error" : "status-warning"}`}>{ISSUE_CATEGORY_LABELS[issue.category]}</span></td><td data-label="Fase">{issuePhaseLabel(issue.phase)}</td><td data-label="Darrera activitat">{issue.occurredAt ? new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(issue.occurredAt)) : "—"}</td><td data-label="Acció"><TableActionLink href={href} label={`Veure la incidència de ${record.title}`}/></td></tr>; })}
    </WorkTable><WorkPager href={page => `/issues?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(page) })}`} page={result.page} pageCount={result.pageCount} total={result.total}/>
  </section></main>;
}
