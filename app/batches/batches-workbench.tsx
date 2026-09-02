"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { BatchSummary } from "@/lib/batch-types";
import { FINANCING_TYPE_LABELS, SOURCE_LABELS } from "@/lib/financing-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MatchingCandidateAnalysis } from "@/components/matching-candidate-analysis";

export function BatchesWorkbench({ batches, activeBatch }: { batches: BatchSummary[]; activeBatch: BatchSummary | null }) {
  const [items, setItems] = useState(batches);
  const [openedId, setOpenedId] = useState(activeBatch?.id ?? null);
  const [size, setSize] = useState(4);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const opened = items.find((item) => item.id === openedId) ?? activeBatch;

  useEffect(() => {
    if (!opened?.isActive) return;
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      try {
        const batch = await fetchBatch(opened.id, controller.signal);
        if (cancelled) return;
        setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
        if (!batch.isActive) return;
      } catch (error) {
        if (!cancelled && !isAbortError(error)) setMessage(error instanceof Error ? error.message : "No s'ha pogut actualitzar el lot.");
      }
      timer = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => { cancelled = true; controller?.abort(); if (timer) window.clearTimeout(timer); };
  }, [opened?.id, opened?.isActive]);

  function create() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await runBatchOperation<{ id: string }>({ operation: "create_and_process", size });
        const batch = await fetchBatch(result.id);
        setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
        setOpenedId(batch.id);
        window.history.replaceState(null, "", `/batches?batch=${batch.id}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No s'ha pogut crear el lot.");
      }
    });
  }

  return <main className="page-shell"><section className="page-container">
    <div><p className="page-eyebrow">Flux automatitzat</p><h2 className="page-title">Lots de matching</h2><p className="page-description">Crea un lot i segueix el procés automàtic fins que els resultats quedin pendents de revisió humana.</p></div>
    <section className="surface mt-6 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold">Crear i processar un lot</h3><p className="mt-1 text-sm text-muted-foreground">Selecció equilibrada i execució completa, sense passos intermedis.</p></div><div className="flex items-end gap-3"><label className="grid gap-1 text-xs font-medium">Nombre de registres<input className="h-9 w-24 rounded-md border bg-background px-3 text-sm" type="number" min={1} max={50} value={size} onChange={(event) => setSize(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label><Button onClick={create} disabled={pending}>{pending ? "Creant..." : "Crear i processar lot"}</Button></div></div><p className="mt-3 text-xs text-muted-foreground">Entre 1 i 50. Si el worker està apagat, el lot quedarà en cua.</p></section>
    {message && <p className="mt-4 rounded-xl border p-3 text-sm">{message}</p>}
    <section className="surface mt-6 p-4"><h3 className="font-semibold">Historial i progrés</h3><p className="mt-1 text-xs text-muted-foreground">Els registres correctes continuen encara que algun presenti una incidència.</p>
      {items.length ? <StableAccordion stateKey="automated-batches" defaultValue={openedId ? [openedId] : []} className="mt-3 divide-y">{items.map((batch) => <AccordionItem key={batch.id} value={batch.id} className="px-3"><AccordionTrigger onClick={() => setOpenedId(batch.id)} className="gap-3 py-3 hover:no-underline"><div className="min-w-0 flex-1 text-left"><div className="flex justify-between gap-2"><strong>Lot {batch.batchNumber}</strong><span className="text-xs text-muted-foreground">{outcomeLabel(batch)}</span></div><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(batch.createdAt))} · {batch.selectedCount} registres</p></div></AccordionTrigger><AccordionContent className="border-t pb-4 pt-4"><BatchDetail batch={batch} /></AccordionContent></AccordionItem>)}</StableAccordion> : <p className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Encara no hi ha cap lot.</p>}
    </section>
  </section></main>;
}

function BatchDetail({ batch }: { batch: BatchSummary }) {
  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progrés del lot</p><h3 className="mt-1 text-xl font-semibold">{outcomeLabel(batch)}</h3></div>{batch.reviewCount > 0 && <Link href={`/review?batch=${batch.id}`} className={buttonVariants()}>Obrir revisió</Link>}</div>
    <div className="grid gap-3 md:grid-cols-3"><PhaseCard number="1" title="Preparació de fonts" phase={batch.progress.preparation} /><PhaseCard number="2" title="Contrast de dades" phase={batch.progress.enrichment} /><PhaseCard number="3" title="Matching" phase={batch.progress.matching} /></div>
    {batch.errorCount > 0 && !batch.isActive && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Finalitzat amb incidències: {batch.errorCount} registre(s) no han completat el procés.</p>}
    <div className="rounded-xl border"><div className="border-b p-4 font-semibold">Registres del lot</div><StableAccordion stateKey={`batch-jobs-${batch.id}`} className="divide-y">{batch.jobs.map((job) => <AccordionItem key={job.id} value={job.id} className="px-4"><AccordionTrigger className="gap-4 py-4 hover:no-underline"><div className="min-w-0 flex-1 text-left"><p className="text-xs font-semibold">{FINANCING_TYPE_LABELS[job.financingType]} · {SOURCE_LABELS[job.sourceDataset] ?? job.sourceDataset}</p><p className="mt-1 text-sm">{job.title}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{jobStatus(job, batch.stage)}</span></AccordionTrigger><AccordionContent className="border-t pb-4 pt-3"><p className="text-xs text-muted-foreground">{job.externalId}</p>{(job.errorMessage || job.enrichmentError || job.preparationMessage) && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{job.errorMessage || job.enrichmentError || job.preparationMessage}</p>}{job.matchingCandidates.length > 0 && <div className="mt-4 space-y-3">{job.matchingCandidates.map((candidate) => <MatchingCandidateAnalysis key={candidate.id} candidate={candidate} />)}</div>}</AccordionContent></AccordionItem>)}</StableAccordion></div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p className="text-sm">{batch.reviewCount} pendents de revisió · {batch.errorCount} errors</p>{batch.canExport ? <a href={`/api/exports/batch/${batch.id}`} className={buttonVariants({ size: "sm" })}>Descarregar Excel</a> : <span className="text-xs text-muted-foreground">L&apos;exportació s&apos;activa després de validar.</span>}</div>
  </div>;
}

function PhaseCard({ number, title, phase }: { number: string; title: string; phase: BatchSummary["progress"]["preparation"] }) {
  const label = { pending: "Pendent d’inici", running: "En curs", completed: "Completada", error: "Amb incidències" }[phase.state];
  const resolved = phase.completed + phase.errors;
  const percentage = phase.total > 0 ? Math.min(100, Math.round((resolved / phase.total) * 100)) : 0;
  return <div className={`rounded-xl border p-4 ${phase.state === "running" ? "border-black" : ""}`}><div className="flex items-center gap-2"><span className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold ${phase.state === "completed" ? "bg-black text-white" : "bg-muted"}`}>{phase.state === "completed" ? "✓" : number}</span><strong className="text-sm">{title}</strong></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-sm font-medium">{label}</p><strong className="text-sm tabular-nums">{phase.completed}/{phase.total}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-black transition-[width]" style={{ width: `${percentage}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{phase.completed} correctes · {phase.errors} errors</p></div>;
}

function outcomeLabel(batch: BatchSummary) { if (batch.isActive) return batch.status === "queued" ? "Pendent d’inici" : "Processant"; if (batch.reviewCount > 0 && batch.errorCount === 0) return "Lot preparat per revisar"; if (batch.errorCount > 0) return "Finalitzat amb incidències"; if (batch.stage === "review") return "Pendent de revisió"; if (batch.progress.matching.state === "completed") return "Finalitzat"; return "Pendent d’inici"; }
function jobStatus(job: BatchSummary["jobs"][number], stage: string) { if (["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)) return ({ needs_review: "Pendent de revisió", approved: "Aprovat", corrected: "Corregit", rejected: "Rebutjat", insufficient_evidence: "Evidència insuficient" } as Record<string, string>)[job.status]; if (job.status === "error") return "Error"; if (stage === "matching" && job.enrichmentStatus === "completed") return "Fent matching"; if (stage === "enrichment" && job.preparationStatus === "ready") return job.enrichmentStatus === "processing" ? "Contrastant" : "Pendent de contrast"; return ({ pending: "Pendent", discovering: "Cercant fonts", fetching: "Extraient", chunking: "Preparant fragments", ready: "Font preparada", no_source: "Sense font", unsupported: "Format no compatible", error: "Error" } as Record<string, string>)[job.preparationStatus] ?? "Pendent"; }
async function runBatchOperation<T>(body: Record<string, unknown>): Promise<T> { const response = await fetch("/api/batches/operation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json() as { result?: T; error?: string }; if (!response.ok) throw new Error(payload.error || "No s'ha pogut completar l'operació."); return payload.result as T; }
async function fetchBatch(id: string, signal?: AbortSignal) { const response = await fetch(`/api/batches/${encodeURIComponent(id)}`, { cache: "no-store", signal }); const payload = await response.json() as { batch?: BatchSummary; error?: string }; if (!response.ok || !payload.batch) throw new Error(payload.error || "No s'ha pogut consultar el lot."); return payload.batch; }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
