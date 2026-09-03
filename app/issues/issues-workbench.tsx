"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MatchingCandidateAnalysis } from "@/components/matching-candidate-analysis";
import { FINANCING_TYPES, FINANCING_TYPE_LABELS, SOURCE_LABELS } from "@/lib/financing-types";
import { ISSUE_CATEGORIES, ISSUE_CATEGORY_LABELS, type IssueFilters, type IssuePage, type IssueRecord } from "@/lib/issue-types";
import { displaySourceIdentifier } from "@/lib/source-identifiers";
import { sourceDocumentStatusLabel, sourceDocumentTypeLabel } from "@/lib/ui-labels";
import { cn } from "@/lib/utils";

export function IssuesWorkbench({ result, filters }: { result: IssuePage; filters: IssueFilters }) {
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return <main className="page-shell"><section className="page-container">
    <div><p className="page-eyebrow">Seguiment i resolució</p><h1 className="page-title">Incidències</h1><p className="page-description">Casos que no han generat una provisió aprovada: decisions negatives, evidència insuficient i errors del procés.</p></div>
    <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-5">
      <Metric label="Total" value={result.metrics.total} />
      <Metric label="No encaixen" value={result.metrics.rejected} />
      <Metric label="Evidència insuficient" value={result.metrics.insufficient} />
      <Metric label="Errors tècnics" value={result.metrics.technical} />
      <Metric label="Problemes de font" value={result.metrics.source} />
    </div>
    <form ref={formRef} className="surface mt-6 grid gap-3 p-4 lg:grid-cols-[minmax(220px,1fr)_190px_210px_170px_auto]">
      <Input name="q" defaultValue={filters.query} placeholder="Cercar títol, registre, entitat o problema..." aria-label="Cercar incidències" onChange={() => { if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => formRef.current?.requestSubmit(), 350); }} />
      <select name="category" defaultValue={filters.category} className="form-control" onChange={() => formRef.current?.requestSubmit()}><option value="totes">Tots els problemes</option>{ISSUE_CATEGORIES.map((category) => <option key={category} value={category}>{ISSUE_CATEGORY_LABELS[category]}</option>)}</select>
      <select name="type" defaultValue={filters.type} className="form-control" onChange={() => formRef.current?.requestSubmit()}><option value="totes">Totes les tipologies</option>{FINANCING_TYPES.map((type) => <option key={type} value={type}>{FINANCING_TYPE_LABELS[type]}</option>)}</select>
      <select name="batch" defaultValue={filters.batch} className="form-control" onChange={() => formRef.current?.requestSubmit()}><option value="tots">Tots els lots</option>{result.batches.map((batch) => <option key={batch.id} value={batch.id}>Lot {batch.number}</option>)}</select>
      <Button type="submit" variant="outline">Filtrar</Button>
    </form>
    <section className="surface mt-6 overflow-hidden"><div className="flex items-center justify-between gap-3 border-b p-4"><h2 className="font-semibold">Casos amb incidències ({result.total})</h2><span className="text-xs text-muted-foreground">Ordenats per activitat recent</span></div>
      {result.issues.length ? <StableAccordion stateKey="issues-list" className="divide-y">{result.issues.map((issue) => <IssueRow key={issue.record.id} issue={issue} />)}</StableAccordion> : <div className="p-10 text-center text-sm text-muted-foreground">No hi ha incidències amb aquests filtres.</div>}
      <Pagination result={result} filters={filters} />
    </section>
  </section></main>;
}

function IssueRow({ issue }: { issue: IssueRecord }) {
  const { record } = issue;
  return <AccordionItem value={record.id} className="px-4"><AccordionTrigger className="gap-4 py-4 hover:no-underline"><div className="min-w-0 flex-1 text-left"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">{ISSUE_CATEGORY_LABELS[issue.category]}</Badge><span className="text-xs text-muted-foreground">{FINANCING_TYPE_LABELS[record.financingType]} · {SOURCE_LABELS[record.sourceDataset] ?? record.sourceDataset}</span>{record.batchNumber && <span className="text-xs text-muted-foreground">Lot {record.batchNumber}</span>}</div><p className="mt-2 font-medium leading-5">{record.title}</p><p className="mt-1 text-xs text-muted-foreground">{displaySourceIdentifier(record.sourceRecordId)}{record.providerName ? ` · ${record.providerName}` : ""}</p><p className="mt-2 line-clamp-2 text-sm text-amber-900">{issue.message}</p></div></AccordionTrigger><AccordionContent keepMounted className="border-t pb-5 pt-4"><IssueDetail issue={issue} /></AccordionContent></AccordionItem>;
}

function IssueDetail({ issue }: { issue: IssueRecord }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const { record } = issue;
  const retry = () => { if (!issue.retryOperation) return; setMessage(""); startTransition(async () => { try { const response = await fetch(`/api/records/${encodeURIComponent(record.id)}/operation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: issue.retryOperation }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "No s'ha pogut iniciar el reintent."); setMessage("Reintent iniciat. El cas s'actualitzarà quan acabi el procés."); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "No s'ha pogut iniciar el reintent."); } }); };
  const humanDecision = issue.category === "rejected" || issue.category === "insufficient_evidence";
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
    <div className="min-w-0 space-y-5">
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Motiu de la incidència</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{issue.message}</p><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="font-semibold text-amber-900">Fase</dt><dd className="mt-1">{phaseLabel(issue.phase)}</dd></div><div><dt className="font-semibold text-amber-900">Data</dt><dd className="mt-1">{formatDate(issue.occurredAt)}</dd></div></dl></section>
      {record.matchingCandidates.length > 0 && <section><h3 className="text-sm font-semibold">Candidats proposats</h3><div className="mt-3 space-y-3">{record.matchingCandidates.map((candidate) => <MatchingCandidateAnalysis key={candidate.id} candidate={candidate} />)}</div></section>}
      <section><h3 className="text-sm font-semibold">Documents oficials</h3>{record.sourceDocuments.length ? <div className="mt-3 space-y-2">{record.sourceDocuments.map((document) => <div key={document.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{sourceDocumentTypeLabel(document.documentType)}</span><Badge variant="secondary">{sourceDocumentStatusLabel(document.status)}</Badge></div><a href={document.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-1 break-all text-xs">{document.url}<ExternalLink className="size-3 shrink-0" /></a>{document.textPreview && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Veure text extret</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{document.textPreview}</p></details>}</div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No hi ha documents vinculats a aquest registre.</p>}</section>
    </div>
    <aside className="self-start rounded-xl border p-4 xl:sticky xl:top-20"><div className="flex size-9 items-center justify-center rounded-lg bg-amber-100 text-amber-900"><AlertTriangle className="size-4" /></div><h3 className="mt-3 font-semibold">Actuació recomanada</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{humanDecision ? "Revisa la decisió i, si cal, selecciona un servei de la Cartera o modifica el motiu." : retryHelp(issue)}</p><div className="mt-4 grid gap-2">{humanDecision ? <Link href={`/review?state=all&record=${record.id}`} className={buttonVariants()}>Revisar decisió</Link> : <Button onClick={retry} disabled={pending}><RefreshCw className={cn("size-4", pending && "animate-spin")} />{pending ? "Iniciant..." : retryLabel(issue)}</Button>}<Link href={`/?q=${encodeURIComponent(displaySourceIdentifier(record.sourceRecordId))}&status=tots`} className={buttonVariants({ variant: "outline" })}>Obrir registre</Link></div>{message && <p className="mt-3 rounded-lg bg-muted p-3 text-xs leading-5">{message}</p>}</aside>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="surface p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString("ca-ES")}</p></div>; }
function phaseLabel(phase: IssueRecord["phase"]) { return ({ review: "Revisió humana", matching: "Correspondència", enrichment: "Contrast de dades", evidence: "Preparació documental" })[phase]; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("ca-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No disponible"; }
function retryLabel(issue: IssueRecord) { return issue.retryOperation === "prepare" ? "Reintentar preparació" : issue.retryOperation === "enrich" ? "Reintentar contrast" : "Reintentar correspondència"; }
function retryHelp(issue: IssueRecord) { return issue.retryOperation === "prepare" ? "Torna a cercar i preparar les fonts del registre." : issue.retryOperation === "enrich" ? "Repeteix l'extracció de dades des dels fragments oficials." : "Repeteix la proposta de correspondència amb les dades ja contrastades."; }

function Pagination({ result, filters }: { result: IssuePage; filters: IssueFilters }) {
  if (result.pageCount <= 1) return null;
  const href = (page: number) => { const params = new URLSearchParams({ page: String(page), q: filters.query, type: filters.type, category: filters.category, batch: filters.batch }); return `/issues?${params}`; };
  return <div className="flex items-center justify-between gap-3 border-t p-4 text-sm"><span className="text-muted-foreground">Pàgina {result.page} de {result.pageCount}</span><div className="flex gap-2"><Link aria-disabled={result.page <= 1} href={href(Math.max(1, result.page - 1))} className={cn(buttonVariants({ variant: "outline", size: "sm" }), result.page <= 1 && "pointer-events-none opacity-40")}>Anterior</Link><Link aria-disabled={result.page >= result.pageCount} href={href(Math.min(result.pageCount, result.page + 1))} className={cn(buttonVariants({ variant: "outline", size: "sm" }), result.page >= result.pageCount && "pointer-events-none opacity-40")}>Següent</Link></div></div>;
}
