"use client";

import {failureLabels,type FailureKind} from '@/lib/cloud/errors';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { BatchSummary, CloudResourceBlock } from "@/lib/batch-types";
import { BatchButton, batchButtonVariants } from "@/components/batch-button";
import { TableActionLink, WorkPager, WorkTable } from "@/components/work-list";
import {BatchPhaseDialog} from "@/components/batch-phase-dialog";
import {BatchRerun} from '@/components/batch-rerun';
import { pipelineStageLabel } from '@/lib/ui-labels';
import {formatAiCost,type EuroReferenceRate} from '@/lib/currency';

export function BatchesWorkbench({ result, filters, cloudBlock }: { result: { items: BatchSummary[]; page: number; pageCount: number; total: number }; filters: { kind: "batches" | "operations"; status: "all" | "active" | "attention" | "finished" }; cloudBlock: CloudResourceBlock }) {
  const router = useRouter();
  const [items, setItems] = useState(result.items);
  const [resourceBlock, setResourceBlock] = useState(cloudBlock);
  const [size, setSize] = useState(4);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const activeBatchIds = items.filter((item) => item.isActive).map((item) => item.id).sort().join(",");
  const visibleItems=items;

  useEffect(() => {
    const ids = activeBatchIds ? activeBatchIds.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;
    const controllers = new Set<AbortController>();
    const poll = async () => {
      if (document.hidden || cancelled) return;
      const results = await Promise.allSettled(ids.map(async (id) => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          return await fetchBatch(id, controller.signal);
        } finally {
          controllers.delete(controller);
        }
      }));
      if (cancelled) return;
      const refreshed = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failures = results.filter((result) => result.status === "rejected" && !isAbortError(result.reason));
      if (refreshed.length > 0) {
        setMessage("");
        const byId = new Map(refreshed.map((batch) => [batch.id, batch]));
        setItems((current) => current.map((item) => byId.get(item.id) ?? item));
        const finished = refreshed.filter((batch) => !batch.isActive);
        if (finished.length > 0) {
          const labels = finished.map((batch) => `lot ${batch.batchNumber}`).join(", ");
          const verb = finished.length === 1 ? "ha finalitzat" : "han finalitzat";
          setMessage(`${labels.charAt(0).toUpperCase()}${labels.slice(1)} ${verb}. La informació de la pàgina s’ha actualitzat automàticament.`);
          router.refresh();
        }
      }
      if (failures.length === results.length) setMessage("No s'ha pogut actualitzar l'estat dels lots en curs. Es tornarà a provar automàticament.");
      if (refreshed.length === ids.length && refreshed.every((batch) => !batch.isActive)) return;
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
    return () => { cancelled = true; for (const controller of controllers) controller.abort(); if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resumeWhenVisible); };
  }, [activeBatchIds, router]);

  function create() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await runBatchOperation<{ id: string }>({ operation: "create_and_process", size });
        const batch = await fetchBatch(result.id);
        setItems((current) => [batch, ...current.filter((item) => item.id !== batch.id)]);
        router.push(`/batches/${batch.id}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No s'ha pogut crear el lot.");
      }
    });
  }

  return <main className="page-shell"><section className="page-container">
    <div><p className="page-eyebrow">Flux automatitzat</p><h1 className="page-title">Lots de procés</h1><p className="page-description">Crea un lot i segueix el procés automàtic fins que els resultats quedin pendents de revisió humana.</p></div>
    {resourceBlock&&<VercelRecovery block={resourceBlock} onAvailable={()=>{setResourceBlock(null);setMessage("Vercel torna a estar disponible. Cap lot s’ha reprès automàticament.");}}/>}
    <section className="surface mt-6 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-semibold">Crear i processar un lot</h3><p className="mt-1 text-sm text-muted-foreground">Selecció equilibrada i execució completa, sense passos intermedis.</p></div><div className="flex items-end gap-3"><label className="grid gap-1 text-xs font-medium">Nombre de registres<input className="h-9 w-24 rounded-md border bg-background px-3 text-sm" type="number" min={1} max={50} value={size} onChange={(event) => setSize(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label><BatchButton onClick={create} disabled={pending||Boolean(resourceBlock)}>{pending ? "Creant..." : resourceBlock ? "Processament no disponible" : "Crear i processar lot"}</BatchButton></div></div><p className="mt-3 text-xs text-muted-foreground">Entre 1 i 50 registres per lot. El contrast, la correspondència i les auditories tenen cost de tokens; el núvol i l’OCR també consumeixen recursos. El lot s’atura si arriba al límit preventiu de pressupost i pot esperar torn abans de començar.</p></section>
    {message && <p role="status" className="mt-4 rounded-xl border p-3 text-sm">{message}</p>}
    <section className="surface mt-6 p-4"><h3 className="font-semibold">Lots i operacions recents</h3><p className="mt-1 text-sm text-muted-foreground">Obre un element per consultar-ne el resum. El detall complet de cada registre es concentra en una sola pantalla.</p>
      <section className="mt-4 rounded-xl border bg-muted/30 p-4" aria-labelledby="batch-history-help">
        <h4 id="batch-history-help" className="text-sm font-semibold">Com llegir l’historial</h4>
        <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
          <p><strong>Preparat per revisar.</strong> L’automatització ha acabat sense errors tècnics, però els resultats encara necessiten validació humana.</p>
          <p><strong>Finalitzat amb errors parcials.</strong> Un o més registres s’han interromput; la resta del lot conserva els resultats obtinguts i es pot revisar.</p>
          <p><strong>Historial auditable.</strong> Recuperar un registre no reescriu el lot original. Consulta Incidències per veure l’estat vigent del registre.</p>
        </div>
      </section>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Tipus d’historial">{([['batches','Lots'],['operations','Operacions individuals']] as const).map(([value,label])=><Link key={value} href={`/batches?kind=${value}&status=${filters.status}`} aria-current={filters.kind===value?"page":undefined} className={batchButtonVariants({size:"sm",selected:filters.kind===value})}>{label}</Link>)}</div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Filtre d’estat">{([['all','Tots'],['active','En curs'],['attention','Amb revisió o errors'],['finished','Finalitzats sense pendents']] as const).map(([value,label])=><Link key={value} href={`/batches?kind=${filters.kind}&status=${value}`} aria-current={filters.status===value?"page":undefined} className={batchButtonVariants({size:"sm",selected:filters.status===value})}>{label}</Link>)}</div>
      <div className="mt-4"><WorkTable headings={["Lot", "Fase i estat", "Progrés", "Per revisar", "Errors tècnics", "Acció"]} empty={visibleItems.length ? undefined : "No hi ha elements amb aquests filtres."}>
        {visibleItems.map(batch => { const href = `/batches/${batch.id}`; return <tr key={batch.id}><td data-label="Lot"><Link className="font-semibold underline underline-offset-2" href={href}>{batch.purpose === "record_operation" ? "Operació" : "Lot"} {batch.batchNumber}</Link><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(batch.createdAt))}</p></td><td data-label="Fase i estat"><span className={`table-status ${batch.errorCount ? "status-error" : batch.status === "paused" || batch.reviewCount ? "status-warning" : batch.isActive ? "status-neutral" : "status-success"}`}>{outcomeLabel(batch)}</span><p className="mt-2 text-xs">{pipelineStageLabel(batch.stage)}</p></td><td data-label="Progrés">{batch.processedCount} de {batch.selectedCount}</td><td data-label="Per revisar">{batch.reviewCount}</td><td data-label="Errors tècnics">{batch.errorCount}</td><td data-label="Acció"><TableActionLink href={href} label={`Veure el lot ${batch.batchNumber}`}/></td></tr>})}
      </WorkTable></div><WorkPager href={page => `/batches?kind=${filters.kind}&status=${filters.status}&page=${page}`} page={result.page} pageCount={result.pageCount} total={result.total}/>
    </section>
  </section></main>;
}

export function BatchDetail({ batch,cloudBlock,euroRate,onUpdate }: { batch: BatchSummary;cloudBlock:CloudResourceBlock;euroRate:EuroReferenceRate|null;onUpdate:(batch:BatchSummary)=>void }) {
  const reason=batch.execution?.reason??"";
  const providerStillBlocked=["openai_quota","credentials"].includes(reason);
  return <div className="space-y-5"><div><p className="page-eyebrow">Resum del lot</p><h3 className="section-title mt-1">{outcomeLabel(batch)}</h3><p className="mt-2 text-sm">{batchSummaryLine(batch)}</p><p className="mt-1 text-xs text-muted-foreground">Cost processat: {batch.actualCostUsd==null?"Sense ús mesurat":formatAiCost(batch.actualCostUsd,euroRate)}{batch.reservedCostUsd>0?` · Reserva pendent màxima: ${formatAiCost(batch.reservedCostUsd,euroRate)}`:''}</p><p className="mt-1 text-xs text-muted-foreground">{euroRate?`Equivalència en euros amb el canvi del BCE del ${euroRate.date}; no és la factura del proveïdor.`:'El canvi del BCE no està disponible; es mostra el cost original en USD.'}</p>{batch.purpose==="record_operation"&&batch.jobs[0]?.title&&<p className="mt-2 text-sm text-muted-foreground">{batch.jobs[0].title}</p>}</div>
    <div className="flex flex-wrap gap-2" aria-label="Accions del lot"><NavigationLink href={`/batches/${batch.id}/results`}>{`Obrir detall del lot (${batch.selectedCount})`}</NavigationLink>{batch.reviewCount > 0 && <Link href={`/review?batch=${batch.id}&state=pending`} className={batchButtonVariants()}>Revisar {batch.reviewCount} {batch.reviewCount===1?"pendent":"pendents"}</Link>}</div>
    {batch.execution && batch.execution.state!=="completed" && <div className="rounded-lg border p-3 text-sm"><p className="font-semibold">{batch.execution.label}</p>{batch.execution.reason&&<p className="mt-1">{failureLabels[batch.execution.reason as FailureKind]??'Cal revisar la configuració de l’execució.'}</p>}{batch.execution.lastProgress&&<p className="mt-1 text-xs text-muted-foreground">Darrer avanç: {new Intl.DateTimeFormat('ca-ES',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Madrid'}).format(new Date(batch.execution.lastProgress))}</p>}<p className="mt-1 text-xs text-muted-foreground">{batch.execution.state==='running'||batch.execution.state==='pending'?'El procés continua al núvol encara que tanquis aquesta pàgina.':'El procés està aturat i no avançarà fins que es reprengui.'}</p></div>}
    {(batch.execution?.recoverable || (!batch.execution && batch.status === "paused")) && !providerStillBlocked && <><ResumeBatch batch={batch} onUpdate={onUpdate}/>{cloudBlock&&<p className="text-xs text-muted-foreground">El bloqueig global continua actiu. Només es reprendrà aquest procés i es tornarà a aturar si necessita un recurs no disponible.</p>}</>}
    <BatchProgress batch={batch}/>
    {batch.selectedCount>0&&!batch.isActive&&batch.status!=="paused"&&!cloudBlock&&<section className="rounded-xl border p-4"><h3 className="text-sm font-semibold">Opcions avançades</h3><div className="mt-4"><BatchRerun key={batch.id} id={batch.id}/></div></section>}
    {batch.canExport&&<div className="flex justify-end"><a href={`/api/exports/batch/${batch.id}`} className={batchButtonVariants({ size: "sm" })}>Descarregar Excel</a></div>}
  </div>;
}

function BatchProgress({batch}:{batch:BatchSummary}) {
 const phases=[['1','Preparació de fonts','preparation'],['2','Contrast de dades','enrichment'],['3','Correspondència','matching']] as const;
 const current=phases.find(([, ,phase])=>(batch.progress[phase].running??0)>0||(batch.progress[phase].pending??0)>0)??phases[2];
 const totals=batch.progress[current[2]];
 const active=batch.isActive&&batch.status!=="paused";
 return <section className="rounded-xl border p-4" aria-label="Estat del processament automàtic"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Procés automàtic</p><h4 className="mt-1 font-semibold">{active?`En curs: ${current[1]}`:batch.status==="paused"?"Processament aturat":"Processament acabat"}</h4><p className="mt-2 text-sm text-muted-foreground">{active?`${totals.completed} de ${totals.total} registres han completat aquesta fase. ${totals.running??0} en curs · ${totals.pending??0} pendents.`:batch.status==="paused"?"El lot conserva els resultats obtinguts i reprendrà els registres incomplets des del punt segur.":batch.reviewCount||batch.errorCount?`L’automatització ha acabat: ${batch.reviewCount} per revisar i ${batch.errorCount} amb error tècnic. El lot no queda resolt fins que s’atenen aquests casos.`:"Tots els registres han acabat el procés automàtic. Consulta el detall per veure el resultat de cadascun."}</p><section className="mt-3"><h3 className="text-xs font-semibold">Veure detall tècnic de les fases</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{phases.map(([number,title,phase])=><BatchPhaseDialog key={phase} batch={batch} number={number} title={title} phase={phase}/>)}</div></section></section>;
}

function outcomeLabel(batch: BatchSummary) { if(!batch.selectedCount)return "Lot buit"; if(batch.execution&&batch.execution.state!=="completed")return batch.execution.label; if(batch.status==="paused")return "Pausat"; if (batch.isActive) return batch.status === "queued" ? "Pendent d’inici" : "Processant"; if (batch.reviewCount > 0 && batch.errorCount === 0) return "Lot preparat per revisar"; if (batch.errorCount > 0) return "Finalitzat amb errors parcials"; if (batch.stage === "review") return "Pendent de revisió"; if (batch.progress.matching.state === "completed") return "Finalitzat"; return "Pendent d’inici"; }
function batchSummaryLine(batch:BatchSummary){return `${batch.selectedCount} ${batch.selectedCount===1?"registre":"registres"} · ${batch.reviewCount} per revisar · ${batch.errorCount} ${batch.errorCount===1?"error tècnic":"errors tècnics"}`;}
async function runBatchOperation<T>(body: Record<string, unknown>): Promise<T> { const response = await fetch("/api/batches/operation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json() as { result?: T; error?: string }; if (!response.ok) throw new Error(payload.error || "No s'ha pogut completar l'operació."); return payload.result as T; }
async function fetchBatch(id: string, signal?: AbortSignal) { const response = await fetch(`/api/batches/${encodeURIComponent(id)}`, { cache: "no-store", signal }); const payload = await response.json() as { batch?: BatchSummary; error?: string }; if (!response.ok || !payload.batch) throw new Error(payload.error || "No s'ha pogut consultar el lot."); return payload.batch; }
function isAbortError(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }

function NavigationLink({href,children}:{href:string;children:string}){
 const [navigating,setNavigating]=useState(false);
 return <Link href={href} aria-busy={navigating} onClick={()=>setNavigating(true)} className={batchButtonVariants({size:"sm",selected:true})}>{navigating?'Obrint…':children}</Link>;
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
