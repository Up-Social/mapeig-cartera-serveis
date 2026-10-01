import Link from "next/link";
import { notFound } from "next/navigation";
import { getComparisonReport } from "@/lib/comparison-report";
import { isUuid } from "@/lib/uuid";
import { CLASSIFICATION_LABELS } from "@/lib/analysis-contract";
import { TableActionLink, WorkTable } from "@/components/work-list";

const label = (value: unknown, fallback: string) => typeof value === "string" ? CLASSIFICATION_LABELS[value as keyof typeof CLASSIFICATION_LABELS] ?? value : fallback;
export default async function Comparison({ params }: PageProps<"/batches/[id]/comparison">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const report = await getComparisonReport(id);
  if (!report) notFound();
  return <main className="page-shell"><section className="page-container space-y-5"><Link className="text-sm underline" href={`/batches/${id}`}>← Tornar al lot</Link><div><p className="page-eyebrow">Anàlisi comparativa</p><h1 className="detail-title">Comparació del lot {report.run.batch_number}</h1><p className="page-description">{report.total} registres · {report.classificationChanges} canvis de classificació · {report.codeChanges} canvis de codi · {report.pendingHumanReview} revisions pendents.</p></div><p className="status-warning rounded-md border p-3 text-sm">Les propostes noves requereixen revisió humana. Les decisions anteriors es conserven.</p><div className="flex flex-wrap gap-4 text-sm"><Link className="underline" href={`/batches/${report.run.comparison_of}/results`}>Consultar lot origen</Link><a className="underline" href={`/api/batches/${id}/comparison`}>Descarregar informe JSON complet</a></div>
    <WorkTable headings={["Registre", "Classificació anterior", "Classificació nova", "Decisió humana anterior", "Revisió nova", "Acció"]}>{report.records.map(row => { const href = `/records/${row.recordId}?${new URLSearchParams({ job: row.jobId, from: `/batches/${id}/results` })}`; return <tr key={`${row.recordId}-${row.jobId}`}><td data-label="Registre" className="break-all">{row.recordId}</td><td data-label="Classificació anterior">{label(row.origin.classification, "No disponible")}</td><td data-label="Classificació nova">{label(row.current.classification, "Pendent")}</td><td data-label="Decisió humana anterior">{label(row.origin.humanClassification, "Pendent")}</td><td data-label="Revisió nova"><span className={`table-status ${row.humanReviewPending ? "status-warning" : "status-success"}`}>{row.humanReviewPending ? "Pendent" : "Revisat"}</span></td><td data-label="Acció"><TableActionLink href={href} label={`Analitzar el registre ${row.recordId}`}>Analitzar</TableActionLink></td></tr>})}</WorkTable>
  </section></main>;
}
