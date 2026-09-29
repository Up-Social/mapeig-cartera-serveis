"use client";

import {failureLabels,type FailureKind} from '@/lib/cloud/errors';
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { BatchSummary, CloudResourceBlock } from "@/lib/batch-types";
import { FINANCING_TYPE_LABELS, SOURCE_LABELS } from "@/lib/financing-types";
import { BatchButton, batchButtonVariants } from "@/components/batch-button";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {CLASSIFICATION_LABELS} from "@/lib/analysis-contract";
import {BatchPhaseDialog} from "@/components/batch-phase-dialog";
import {BatchRerun} from '@/components/batch-rerun';
import { AnalysisResult } from "@/components/analysis-result";

export function BatchesWorkbench({ batches, activeBatch, cloudBlock }: { batches: BatchSummary[]; activeBatch: BatchSummary | null; cloudBlock: CloudResourceBlock }) {
  const [items, setItems] = useState(batches);
  const [resourceBlock, setResourceBlock] = useState(cloudBlock);
  const [openedId, setOpenedId] = useState(activeBatch?.id ?? null);
  const [size, setSize] = useState(4);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"batches"|"operations">(activeBatch?.purpose === "record_operation" ? "operations" : "batches");
  const [statusFilter, setStatusFilter] = useState<"all"|"active"|"paused"|"review"|"finished">("all");
  const opened = items.find((item) => item.id === openedId) ?? activeBatch;
  const visibleItems=items.filter(item=>(kind==="operations"?item.purpose==="record_operation":item.purpose!=="record_operation")&&(
    statusFilter==="all"||(statusFilter==="active"&&item.isActive)||(statusFilter==="paused"&&item.status==="paused")||(statusFilter==="review"&&item.reviewCount>0)||(statusFilter==="finished"&&!item.isActive&&item.status!=="paused"&&item.reviewCount===0)
  ));

  useEffect(() => {
    if (!opened?.isActive || opened.jobs.length === 0) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (document.hidden) {
        timer = window.setTimeout(poll, 10_000);
        return;
      }
      controller = new AbortController();
      try {
        const batch = await fetchBatch(opened.id, controller.signal);
        if (cancelled) return;
        setMessage("");
        setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
        if (!batch.isActive) return;
      } catch (error) {
        if (!cancelled && !isAbortError(error)) setMessage(error instanceof Error ? error.message : "No s'ha pogut actualitzar el lot.");
      }
      attempt += 1;
      timer = window.setTimeout(poll, Math.min(15_000, 2_000 * 2 ** Math.min(attempt, 3)));
    };
    const resumeWhenVisible = () => {
      if (!document.hidden && timer) {
        window.clearTimeout(timer);
        timer = undefined;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", resumeWhenVisible);
    void poll();
    return () => { cancelled = true; controller?.abort(); if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resumeWhenVisible); };
  }, [opened?.id, opened?.isActive, opened?.jobs.length]);

  useEffect(() => {
    if (!openedId) return;
    const summary = items.find((item) => item.id === openedId);
    if (!summary || summary.jobs.length > 0) return;
    const controller = new AbortController();
    void fetchBatch(openedId, controller.signal)
      .then((batch) => setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]))
      .catch((error) => { if (!isAbortError(error)) setMessage(error instanceof Error ? error.message : "No s'ha pogut obrir el lot."); });
    return () => controller.abort();
  }, [openedId, items]);

  function create() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await runBatchOperation<{ id: string }>({ operation: "create_and_process", size });
        const batch = await fetchBatch(result.id);
        setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
        setOpenedId(batch.id);
        window.history.replaceState(window.history.state, "", `/batches?batch=${batch.id}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No s'ha pogut crear el lot.");
      }
    });
  }

  return <main className="page-shell"><section className="page-container">
    <div><p className="page-eyebrow">Flux automatitzat</p><h2 className="page-title">Lots de procés</h2><p className="page-description">Crea un lot i segueix el procés automàtic fins que els resultats quedin pendents de revisió humana.</p></div>
    {resourceBlock&&<VercelRecovery block={resourceBlock} onAvailable={()=>{setResourceBlock(null);setMessage("Vercel torna a estar disponible. Cap lot s’ha reprès automàticament.");}}/>}
    <section className="surface mt-6 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold">Crear i processar un lot</h3><p className="mt-1 text-sm text-muted-foreground">Selecció equilibrada i execució completa, sense passos intermedis.</p></div><div className="flex items-end gap-3"><label className="grid gap-1 text-xs font-medium">Nombre de registres<input className="h-9 w-24 rounded-md border bg-background px-3 text-sm" type="number" min={1} max={50} value={size} onChange={(event) => setSize(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label><BatchButton onClick={create} disabled={pending||Boolean(resourceBlock)}>{pending ? "Creant..." : resourceBlock ? "Processament no disponible" : "Crear i processar lot"}</BatchButton></div></div><p className="mt-3 text-xs text-muted-foreground">Entre 1 i 50. El lot pot esperar torn abans de començar.</p></section>
    {message && <p role="status" className="mt-4 rounded-xl border p-3 text-sm">{message}</p>}
    <section className="surface mt-6 p-4"><h3 className="font-semibold">Historial i progrés</h3><p className="mt-1 text-xs text-muted-foreground">Els registres correctes continuen encara que algun presenti una incidència.</p>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Tipus d’historial"><BatchButton size="sm" selected={kind==="batches"} onClick={()=>setKind("batches")}>Lots</BatchButton><BatchButton size="sm" selected={kind==="operations"} onClick={()=>setKind("operations")}>Operacions individuals</BatchButton></div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtre d’estat">{([['all','Tots'],['active','Actius'],['paused','Pausats'],['review','Per revisar'],['finished','Finalitzats']] as const).map(([value,label])=><BatchButton key={value} size="sm" selected={statusFilter===value} onClick={()=>setStatusFilter(value)}>{label}</BatchButton>)}</div>
      {visibleItems.length ? <StableAccordion stateKey={`automated-batches-${kind}-${statusFilter}`} defaultValue={openedId ? [openedId] : []} className="mt-3 divide-y">{visibleItems.map((batch) => <AccordionItem key={batch.id} value={batch.id} className="px-3"><AccordionTrigger onClick={() => setOpenedId(batch.id)} className="gap-3 py-3 text-foreground hover:text-foreground hover:no-underline"><div className="min-w-0 flex-1 text-left"><div className="flex justify-between gap-2"><strong>{batch.purpose==="record_operation"?"Operació":"Lot"} {batch.batchNumber}</strong><span className="text-xs text-muted-foreground">{outcomeLabel(batch)}</span></div><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(batch.createdAt))} · {batch.selectedCount} registres</p></div></AccordionTrigger><AccordionContent className="border-t pb-4 pt-4"><BatchDetail batch={batch} cloudBlock={resourceBlock} onUpdate={(updated)=>setItems(current=>[updated,...current.filter(item=>item.id!==updated.id)])} /></AccordionContent></AccordionItem>)}</StableAccordion> : <p className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No hi ha elements amb aquests filtres.</p>}
    </section>
  </section></main>;
}

function BatchDetail({ batch,cloudBlock,onUpdate }: { batch: BatchSummary;cloudBlock:CloudResourceBlock;onUpdate:(batch:BatchSummary)=>void }) {
  const reason=batch.execution?.reason??"";
  const providerStillBlocked=["openai_quota","credentials"].includes(reason)||(reason==="vercel_quota"&&Boolean(cloudBlock));
  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progrés del lot</p><h3 className="mt-1 text-xl font-semibold">{outcomeLabel(batch)}</h3><p className="mt-1 text-xs text-muted-foreground">Cost reservat: {formatCost(batch.reservedCostUsd)} · Cost confirmat: {batch.actualCostUsd==null?"No disponible":formatCost(batch.actualCostUsd)}</p></div>{batch.reviewCount > 0 && <Link href={`/review?batch=${batch.id}&state=pending`} className={batchButtonVariants({selected:true})}>Revisar pendents ({batch.reviewCount})</Link>}</div>
    {batch.execution && <div className="rounded-lg border p-3 text-sm"><p className="font-semibold">{batch.execution.label}</p>{batch.execution.reason&&<p className="mt-1">{failureLabels[batch.execution.reason as FailureKind]??'Cal revisar la configuració de l’execució.'}</p>}{batch.execution.lastProgress&&<p className="mt-1 text-xs text-muted-foreground">Darrer avanç: {new Intl.DateTimeFormat('ca-ES',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(batch.execution.lastProgress))}</p>}<p className="mt-1 text-xs text-muted-foreground">{batch.execution.state==='running'||batch.execution.state==='pending'?'El procés continua al núvol encara que tanquis aquesta pàgina.':'El procés està aturat i no avançarà fins que es reprengui.'}</p></div>}
    {(batch.execution?.recoverable || (!batch.execution && batch.status === "paused")) && !providerStillBlocked && <ResumeBatch batch={batch} onUpdate={onUpdate}/>}
    <NavigationLink href={`/batches/${batch.id}/results`}>Veure resultats del lot</NavigationLink><BatchProgress batch={batch}/>
    {batch.selectedCount>0&&!batch.isActive&&batch.status!=="paused"&&<details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Opcions avançades</summary><div className="mt-4"><BatchRerun key={batch.id} id={batch.id}/></div></details>}
    {batch.errorCount > 0 && !batch.isActive && <p className="rounded-lg border border-neutral-300 bg-neutral-100 p-3 text-sm">Finalitzat amb incidències: {batch.errorCount} registre(s) no han completat el procés.</p>}
    <div className="rounded-xl border"><div className="border-b p-4 font-semibold">Registres del lot</div><StableAccordion stateKey={`batch-jobs-${batch.id}`} className="divide-y">{batch.jobs.map((job) => <AccordionItem key={job.id} value={job.id} className="px-4"><AccordionTrigger className="gap-4 py-4 text-foreground hover:text-foreground hover:no-underline"><div className="min-w-0 flex-1 text-left"><p className="text-xs font-semibold">{FINANCING_TYPE_LABELS[job.financingType]} · {SOURCE_LABELS[job.sourceDataset] ?? job.sourceDataset}</p><p className="mt-1 text-sm">{job.title}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{jobStatus(job, batch.stage)}</span></AccordionTrigger><AccordionContent className="border-t pb-4 pt-3"><p className="text-xs text-muted-foreground">{job.externalId}</p>{(job.errorMessage || job.enrichmentError || job.preparationMessage) && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{job.errorMessage || job.enrichmentError || job.preparationMessage}</p>}<div className="mt-3 flex flex-wrap gap-2"><NavigationLink href={`/?record=${job.sourceRecordId}`}>Obrir registre</NavigationLink><NavigationLink href={`/review?state=all&batch=${batch.id}&record=${job.sourceRecordId}&job=${job.id}`}>Obrir resultat i evidència</NavigationLink></div><div className="mt-4"><AnalysisResult analysis={job.analysis} candidates={job.matchingCandidates}/></div></AccordionContent></AccordionItem>)}</StableAccordion></div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p className="text-sm">{batch.reviewCount} pendents de revisió · {batch.errorCount} errors</p>{batch.canExport ? <a href={`/api/exports/batch/${batch.id}`} className={batchButtonVariants({ size: "sm" })}>Descarregar Excel</a> : <span className="text-xs text-muted-foreground">L&apos;exportació s&apos;activa després de validar.</span>}</div>
  </div>;
}

function BatchProgress({batch}:{batch:BatchSummary}) {
 const phases=[['1','Preparació de fonts','preparation'],['2','Contrast de dades','enrichment'],['3','Correspondència','matching']] as const;
 const current=phases.find(([, ,phase])=>(batch.progress[phase].running??0)>0||(batch.progress[phase].pending??0)>0)??phases[2];
 const totals=batch.progress[current[2]];
 const percentage=totals.total?Math.round(((totals.completed+totals.errors+(totals.blocked??0))/totals.total)*100):0;
 return <section className="rounded-xl border p-4" aria-label="Progrés de les fases"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{current[0]}. {current[1]}</p><p className="mt-1 text-xs text-muted-foreground">{totals.completed} completats · {totals.errors} errors · {totals.blocked??0} bloquejats</p></div><span className="text-sm font-semibold tabular-nums">{percentage}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground transition-[width]" style={{width:`${percentage}%`}}/></div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Veure el detall de les tres fases</summary><div className="mt-3 grid gap-3 md:grid-cols-3">{phases.map(([number,title,phase])=><BatchPhaseDialog key={phase} batch={batch} number={number} title={title} phase={phase}/>)}</div></details></section>;
}

function outcomeLabel(batch: BatchSummary) { if(!batch.selectedCount)return "Lot buit"; if(batch.execution&&batch.execution.state!=="completed")return batch.execution.label; if(batch.status==="paused")return "Pausat"; if (batch.isActive) return batch.status === "queued" ? "Pendent d’inici" : "Processant"; if (batch.reviewCount > 0 && batch.errorCount === 0) return "Lot preparat per revisar"; if (batch.errorCount > 0) return "Finalitzat amb incidències"; if (batch.stage === "review") return "Pendent de revisió"; if (batch.progress.matching.state === "completed") return "Finalitzat"; return "Pendent d’inici"; }
function formatCost(value:number){return new Intl.NumberFormat('ca-ES',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);}
function jobStatus(job: BatchSummary["jobs"][number], stage: string) { if(job.analysis?.reviewed_classification)return CLASSIFICATION_LABELS[job.analysis.reviewed_classification]; if (["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)) return ({ needs_review: "Pendent de revisió", approved: "Aprovat", corrected: "Corregit", rejected: "Rebutjat", insufficient_evidence: "Evidència insuficient" } as Record<string, string>)[job.status]; if (job.status === "error") return "Error"; if(job.phases&&Object.values(job.phases).includes('blocked'))return "Bloquejat"; if (stage === "matching" && job.enrichmentStatus === "completed") return "Fent correspondència"; if (stage === "enrichment" && job.preparationStatus === "ready") return job.enrichmentStatus === "processing" ? "Contrastant" : "Pendent de contrast"; return ({ pending: "Pendent", discovering: "Cercant fonts", fetching: "Extraient", chunking: "Preparant fragments", ready: "Font preparada", no_source: "Sense font", unsupported: "Format no compatible", error: "Error" } as Record<string, string>)[job.preparationStatus] ?? "Pendent"; }
async function runBatchOperation<T>(body: Record<string, unknown>): Promise<T> { const response = await fetch("/api/batches/operation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json() as { result?: T; error?: string }; if (!response.ok) throw new Error(payload.error || "No s'ha pogut completar l'operació."); return payload.result as T; }
async function fetchBatch(id: string, signal?: AbortSignal) { const response = await fetch(`/api/batches/${encodeURIComponent(id)}`, { cache: "no-store", signal }); const payload = await response.json() as { batch?: BatchSummary; error?: string }; if (!response.ok || !payload.batch) throw new Error(payload.error || "No s'ha pogut consultar el lot."); return payload.batch; }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }

function NavigationLink({href,children}:{href:string;children:string}){
 const [navigating,setNavigating]=useState(false);
 return <Link href={href} aria-busy={navigating} onClick={()=>setNavigating(true)} className={batchButtonVariants({size:"sm"})}>{navigating?'Obrint…':children}</Link>;
}

function VercelRecovery({block,onAvailable}:{block:NonNullable<CloudResourceBlock>;onAvailable:()=>void}) {
 const [message,setMessage]=useState("");
 const [pending,startTransition]=useTransition();
 const canCheck=block.kind==="vercel_quota";
 return <section role="alert" className="mt-6 rounded-xl border-2 border-neutral-900 bg-neutral-100 p-5">
  <h3 className="font-semibold">Processament temporalment aturat</h3>
  <p className="mt-1 text-sm">{block.label}. Els processos pausats no avançaran fins que es comprovi el servei.</p>
  <p className="mt-2 text-sm">No es poden crear lots ni iniciar operacions individuals mentre el bloqueig continuï actiu.</p>
  {canCheck&&<div className="mt-4 flex flex-col items-start gap-2"><BatchButton disabled={pending} onClick={()=>startTransition(async()=>{
    setMessage("");
    try{
      const response=await fetch("/api/batches/vercel-check",{method:"POST"});
      const payload=await response.json() as {result?:{status:"available"|"already_available"};error?:string};
      if(!response.ok||!payload.result)throw new Error(payload.error||"No s’ha pogut comprovar Vercel.");
      onAvailable();
    }catch(error){setMessage(error instanceof Error?error.message:"No s’ha pogut comprovar Vercel.");}
  })}>{pending?"Comprovant Vercel…":"Comprovar si Vercel torna a estar disponible"}</BatchButton>
  <p className="text-xs text-muted-foreground">La comprovació crea un entorn mínim, limitat a un minut i sense cridar OpenAI. El cost és mínim i no reprèn cap lot.</p></div>}
  {message&&<p role="status" className="mt-3 rounded-lg border bg-background p-3 text-sm">{message}</p>}
 </section>;
}

function ResumeBatch({batch,onUpdate}:{batch:BatchSummary;onUpdate:(batch:BatchSummary)=>void}) {
 const [message,setMessage]=useState('');const [pending,startTransition]=useTransition();
 const subject=batch.purpose==="record_operation"?"aquesta operació":"aquest lot";
 return <div className="rounded-lg border p-4"><p>{batch.execution?.reason==='vercel_quota'?'Vercel ja està disponible, però el procés continua pausat fins que decideixis reprendre’l.':batch.pauseReason??'Lot pausat'}</p><p className="mt-1 text-xs text-muted-foreground">Reprendre tornarà a provar el servei des del primer pas incomplet, sense repetir resultats finalitzats ni activar altres lots.</p><BatchButton className="mt-3" disabled={pending} onClick={()=>startTransition(async()=>{try{await runBatchOperation({operation:'resume',batchId:batch.id});onUpdate(await fetchBatch(batch.id));}catch(error){setMessage(error instanceof Error?error.message:String(error));}})}>{pending?'Reprenent…':batch.execution?.state==='pending'?'Reintentar inici':`Reprendre només ${subject}`}</BatchButton>{message&&<p role="status" className="mt-2 text-sm">{message}</p>}</div>;
}
