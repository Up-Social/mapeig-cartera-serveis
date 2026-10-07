"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { TableActionLink, WorkTable } from "@/components/work-list";
import type {
  ProcessingStatus,
  SourceListPage,
  SourceRecord,
} from "@/lib/workbench-types";
import {
  FINANCING_TYPES,
  FINANCING_TYPE_LABELS,
  SOURCE_LABELS,
} from "@/lib/financing-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isRecordOperationTerminal,
  type RecordOperation,
} from "@/lib/record-operation";
import type {CloudResourceBlock} from '@/lib/batch-types';
import type {AiCostSummary} from '@/lib/records-page';

const statusLabels: Record<ProcessingStatus, string> = {
  pendent: "Pendent",
  preparant: "En cua",
  processant: "Processant",
  preparat: "Llest",
  completat: "Aprovat",
  revisio: "Per revisar",
  sense_evidencia: "Sense evidència",
  rebutjat: "Rebutjat",
  error: "Errors",
};

export function ProcessingWorkbench({
  result,
  filters,
  cloudBlock,
  aiCosts,
}: {
  result: SourceListPage;
  cloudBlock: CloudResourceBlock;
  aiCosts:AiCostSummary[];
  filters: {
    page: number;
    query: string;
    type: string;
  };
}) {
  const records = result.records;
  const metrics = result.metrics;
  const filterFormRef = useRef<HTMLFormElement>(null);
  const filterSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <main className="page-shell">
      <section className="page-container">
        <div className="mb-5"><p className="page-eyebrow">Font i procés</p><h1 className="page-title">Registres</h1><p className="page-description">Localitza un registre, consulta el resultat i segueix-ne la fase actual.</p></div>
        {cloudBlock&&<section role="alert" className="mb-5 rounded-xl border-2 border-neutral-900 bg-neutral-100 p-4"><p className="font-semibold">Processament temporalment aturat</p><p className="mt-1 text-sm">{cloudBlock.label}. Pots consultar els registres, però no iniciar un procés nou.</p></section>}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric label="Registres totals" value={metrics.total} />
          <Metric label="En cua" value={metrics.queued} accent="amber" />
          <Metric
            label="Completats"
            value={metrics.completed}
            accent="green"
          />
          <Metric
            label="Revisió necessària"
            value={metrics.review}
            accent="violet"
          />
        </div>
        <section className="surface mt-5 p-5" aria-labelledby="ai-cost-title" data-testid="ai-cost-summary">
          <h2 id="ai-cost-title" className="text-lg font-semibold">Cost mitjà de processament amb IA</h2>
          <p className="mt-1 text-sm text-muted-foreground">Estimació per registre a partir dels tokens d’IA registrats i la tarifa configurada; no és una factura del proveïdor ni l’import del concert.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(['concert','altres'] as const).map(scope=>{
              const cost=aiCosts.find(item=>item.scope===scope);
              return <div key={scope} className="rounded-lg border bg-muted/20 p-4"><p className="text-sm font-semibold">{scope==='concert'?'Concerts':'Altres tipologies'}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{cost?new Intl.NumberFormat('ca-ES',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:5}).format(cost.averageUsd):'Sense dades'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{cost?`${cost.measuredRecords} registres amb ús mesurat`:'Encara no hi ha cap ús mesurat'}</p>
              </div>;
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Mitjana de totes les execucions atribuïbles a cada registre amb cost calculat. Els registres sense ús confirmat queden fora; no inclou OCR local, infraestructura ni revisió humana.</p>
        </section>
        <div className="mt-6">
          <section className="surface overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-neutral-200 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Registres importats</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Consulta totes les files i el seu estat. La selecció i
                  execució es gestionen des de Lots.
                </p>
              </div>
              <Link href="/batches" className={buttonVariants({ size: "lg" })}>
                Anar a Lots
              </Link>
            </div>
            <form ref={filterFormRef} className="grid gap-3 border-b border-neutral-200 bg-neutral-50 p-4 md:grid-cols-[1fr_220px]">
              <Input
                name="q"
                defaultValue={filters.query}
                placeholder="Cercar títol, ID o entitat..."
                onChange={() => {
                  if (filterSearchTimer.current) clearTimeout(filterSearchTimer.current);
                  filterSearchTimer.current = setTimeout(() => filterFormRef.current?.requestSubmit(), 350);
                }}
              />
              <select
                name="type"
                defaultValue={filters.type}
                className="form-control"
                onChange={() => filterFormRef.current?.requestSubmit()}
              >
                <option value="totes">Totes les tipologies</option>
                {FINANCING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FINANCING_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </form>
            <WorkTable className="records-table" headings={["Cas i font", "Entitat", "Tipologia", "Estat", "Lot", "Acció"]} empty={records.length ? undefined : "No hi ha registres amb aquests filtres."}>
              {records.map(record => { const href = `/records/${record.id}?${new URLSearchParams({ from: `/?${new URLSearchParams({ q: filters.query, type: filters.type, page: String(filters.page) })}` })}`; return <tr key={record.id}>
                <td data-label="Cas i font"><Link href={href} className="font-semibold underline underline-offset-2">{record.title}</Link><p className="mt-1 break-words text-xs text-muted-foreground">{record.sourceRecordId} · {SOURCE_LABELS[record.sourceDataset] ?? record.sourceDataset}</p></td>
                <td data-label="Entitat">{record.providerName ?? "No informada"}</td><td data-label="Tipologia">{FINANCING_TYPE_LABELS[record.financingType]}</td>
                <td data-label="Estat"><span className={`table-status ${record.status === "error" ? "status-error" : record.status === "revisio" || record.status === "sense_evidencia" ? "status-warning" : record.status === "completat" ? "status-success" : "status-neutral"}`}>{statusLabels[record.status]}</span></td>
                <td data-label="Lot">{record.batchNumber ?? "—"}</td><td data-label="Acció"><TableActionLink href={href} label={`Obrir el cas ${record.title}`}/></td>
              </tr>; })}
            </WorkTable>
            <Pagination result={result} filters={filters} />
          </section>
        </div>
      </section>
    </main>
  );
}

function Pagination({
  result,
  filters,
}: {
  result: SourceListPage;
  filters: {
    query: string;
    type: string;
  };
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      q: filters.query,
      type: filters.type,
    });
    return `/?${params}`;
  };
  const start = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const end = Math.min(result.page * result.pageSize, result.total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 px-4 py-4 text-sm sm:flex-row sm:px-5">
      <span className="text-neutral-500">
        {start}–{end} de {result.total.toLocaleString("ca-ES")}
      </span>
      <div className="flex items-center gap-1 sm:gap-2">
        <Link
          aria-disabled={result.page <= 1}
          href={href(Math.max(1, result.page - 1))}
          className={cn(
            buttonVariants({ variant: "outline" }),
            result.page <= 1 && "pointer-events-none opacity-40",
          )}
        >
          Anterior
        </Link>
        <span className="px-2 py-2 text-neutral-600">
          {result.page} / {result.pageCount}
        </span>
        <Link
          aria-disabled={result.page >= result.pageCount}
          href={href(Math.min(result.pageCount, result.page + 1))}
          className={cn(
            buttonVariants({ variant: "outline" }),
            result.page >= result.pageCount && "pointer-events-none opacity-40",
          )}
        >
          Següent
        </Link>
      </div>
    </div>
  );
}

export function RecordStages({
  record,
  operation,
  onRecordUpdate,
  onOperationStart,
  onOperationFinish,
  cloudBlocked,
  concertExportState = "ready",
}: {
  record: SourceRecord;
  operation?: RecordOperation;
  onRecordUpdate: (record: SourceRecord) => void;
  onOperationStart: (recordId: string, operation: RecordOperation) => void;
  onOperationFinish: (recordId: string) => void;
  cloudBlocked: boolean;
  concertExportState?: "ready" | "partial" | "pending";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [pollingStopped, setPollingStopped] = useState(false);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const [clock, setClock] = useState(() => record.operationProgress ? Date.parse(record.operationProgress.lastActivityAt) : 0);
  const [startingOperation, setStartingOperation] =
    useState<RecordOperation>();

  useEffect(() => {
    if (!record.operationProgress || !['active','waiting','stalled'].includes(record.operationProgress.state)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [record.operationProgress]);

  useEffect(() => {
    if (operation) return;
    const controller = new AbortController();
    void fetchSourceRecord(record.id, controller.signal)
      .then(onRecordUpdate)
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setNetworkError(
            error instanceof Error
              ? error.message
              : "No s'ha pogut actualitzar l'estat del registre.",
          );
        }
      });
    return () => controller.abort();
  }, [operation, record.id, onRecordUpdate]);

  useEffect(() => {
    if (!operation) return;
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let consecutiveFailures = 0;

    const poll = async () => {
      controller = new AbortController();
      try {
        const latest = await fetchSourceRecord(record.id, controller.signal);
        if (cancelled) return;
        consecutiveFailures = 0;
        setNetworkError("");
        setPollingStopped(false);
        onRecordUpdate(latest);
        if (isRecordOperationTerminal(operation, latest)) {
          onOperationFinish(record.id);
          return;
        }
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        consecutiveFailures += 1;
        setNetworkError(
          error instanceof Error
            ? error.message
            : "No s'ha pogut actualitzar l'estat del registre.",
        );
        if (consecutiveFailures >= 5) {
          setPollingStopped(true);
        }
      }
      timer = window.setTimeout(poll, consecutiveFailures >= 5 ? 15_000 : 2_000);
    };

    void poll();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    operation,
    pollingAttempt,
    record.id,
    onOperationFinish,
    onRecordUpdate,
  ]);

  const run = (
    nextOperation: RecordOperation,
    action: () => Promise<unknown>,
  ) => {
    setMessage("");
    setNetworkError("");
    setPollingStopped(false);
    setStartingOperation(nextOperation);
    startTransition(async () => {
      try {
        await action();
        onOperationStart(record.id, nextOperation);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "No s'ha pogut iniciar l'operació.",
        );
        try {
          onRecordUpdate(await fetchSourceRecord(record.id));
        } catch {
          // The action error is the useful message; a later retry can refresh.
        }
        onOperationFinish(record.id);
      } finally {
        setStartingOperation(undefined);
      }
    });
  };
  const busy =
    pending || operation !== undefined || startingOperation !== undefined;
  const displayedOperation = operation ?? startingOperation;
  return (
    <section className="mt-5 rounded-xl border border-neutral-300 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Procés del registre
      </p>
      <div className="mt-3 space-y-3">
        <StageRow
          number="1"
          title="Preparar fonts"
          status={record.issueGroup === "source" ? "Error de preparació" : evidenceStatusLabel(record.evidenceStatus)}
          complete={record.evidenceStatus === "ready"}
        />
        <StageRow
          number="2"
          title="Contrastar dades"
          status={enrichmentStatusLabel(record.enrichmentStatus)}
          complete={record.enrichmentStatus === "completed"}
        />
        <StageRow
          number="3"
          title="Fer correspondència"
          status={
            record.analysis?.reliability_status === "invalidated"
              ? "Resultat no fiable; cal reanalitzar"
              : record.analysis
              ? "Anàlisi completada"
              : record.matchingCandidates.length
              ? "Matching disponible"
              : record.operationProgress?.state === "incident" && record.operationProgress.step === "matching"
                ? "Interromput durant la correspondència"
              : record.issueGroup === "source"
                ? "No executat"
              : record.matchingError
              ? "Errors de correspondència"
                : "No executat"
          }
          complete={(Boolean(record.analysis) || record.matchingCandidates.length > 0) && record.analysis?.reliability_status !== "invalidated"}
        />
        <StageRow
          number="4"
          title="Validar resultat"
          status={record.analysis?.reliability_status === "invalidated" ? "Bloquejat fins al reanàlisi" : record.reviewDecision ? reviewDecisionLabel(record.reviewDecision) : (record.analysis || record.matchingCandidates.length) ? "Pendent de validació humana" : "Encara no disponible"}
          complete={record.reviewDecision === "approved" || record.reviewDecision === "corrected"}
        >
          {record.analysis?.reliability_status !== "invalidated" && record.pipelineRunId && (record.analysis || record.matchingCandidates.length > 0) ? (
            <Link href={`/review?record=${record.id}${record.reviewDecision ? "&state=all" : ""}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {record.reviewDecision ? "Revisar decisió" : "Validar"}
            </Link>
          ) : <Button variant="outline" size="sm" disabled>Validar</Button>}
        </StageRow>
      </div>
      {record.operationProgress && (
        <OperationProgressCard progress={record.operationProgress} now={clock} />
      )}
      {!record.analysis && !record.matchingCandidates.length && (
        <Button
          type="button"
          className="mt-4 w-full sm:w-auto"
          disabled={busy||cloudBlocked||record.operationProgress?.state === 'incident'}
          onClick={() => run("process", () => startRecordOperation(record.id, "process"))}
        >
          {displayedOperation === "process" ? "Processant..." : cloudBlocked ? "Processament no disponible" : record.status === "error" ? "Tornar a processar" : "Processar"}
        </Button>
      )}
      {cloudBlocked&&!record.analysis&&!record.matchingCandidates.length&&<p className="mt-2 text-xs text-muted-foreground">No es poden iniciar operacions des d’aquest entorn mentre l’execució estigui desactivada o bloquejada.</p>}
      {record.operationProgress?.state === 'incident' && record.pipelineRunId && <p className="mt-2 text-sm"><Link className="underline" href={`/batches/${record.pipelineRunId}`}>Consultar l’operació interrompuda</Link>. Cal revisar el diagnòstic i les respostes rebudes abans de reprendre.</p>}
      {record.matchingCandidates.length > 0 && !record.reviewDecision && (
        <p className="mt-4 rounded-lg bg-neutral-100 p-3 text-sm font-medium">Procés completat · Pendent de revisió</p>
      )}
      {(record.evidenceError ||
        record.enrichmentError ||
        record.matchingError ||
        message ||
        networkError) && (
        <p className="mt-3 rounded-lg bg-neutral-100 p-2 text-xs leading-5 text-neutral-600">
          {message ||
            networkError ||
            record.matchingError ||
            record.enrichmentError ||
            record.evidenceError}
        </p>
      )}
      {pollingStopped && operation && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            setNetworkError("");
            setPollingStopped(false);
            setPollingAttempt((value) => value + 1);
          }}
        >
          Tornar a comprovar
        </Button>
      )}
      <p className="mt-3 text-[13.2px] leading-5 text-neutral-500">
        Preparar fonts no utilitza OpenAI. Contrastar dades utilitza IA per
        estructurar només la font oficial, sense escollir cap servei. El registre
        només es considera correcte després de la validació humana.
      </p>
      {record.pipelineRunId && (record.reviewDecision === "approved" || record.reviewDecision === "corrected") && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <span>Lot individual {record.batchNumber ?? ""} · {concertExportState === "pending" ? "línies pendents de revisar; encara no hi ha cap fila exportable" : concertExportState === "partial" ? "exportació parcial: queden línies pendents de revisar" : "1 registre validat"}</span>
          {concertExportState !== "pending" && <a href={`/api/exports/batch/${record.pipelineRunId}`} className={buttonVariants({ size: "sm" })}>{concertExportState === "partial" ? "Descarregar Excel parcial" : "Descarregar Excel"}</a>}
        </div>
      )}
    </section>
  );
}
function StageRow({
  number,
  title,
  status,
  complete,
  children,
}: {
  number: string;
  title: string;
  status: string;
  complete: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${complete ? "bg-black text-white" : "bg-neutral-100"}`}
      >
        {complete ? "✓" : number}
      </span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-neutral-500">{status}</p>
      </div>
      {children}
    </div>
  );
}
function evidenceStatusLabel(value: SourceRecord["evidenceStatus"]) {
  return (
    {
      pending: "Pendent",
      preparing: "Preparant documents",
      ready: "Documents i fragments preparats",
      no_source: "Sense URL documental",
      unsupported: "Format no compatible",
      error: "Error de preparació",
    } as const
  )[value];
}
function enrichmentStatusLabel(value: SourceRecord["enrichmentStatus"]) {
  return (
    {
      pending: "Pendent",
      processing: "Contrastant amb la font oficial",
      completed: "Dades oficials contrastades",
      error: "Errors de contrast",
    } as const
  )[value];
}

export function inferOperation(record: SourceRecord): RecordOperation | undefined {
  if (["incident", "finished"].includes(record.operationProgress?.state ?? "")) return undefined;
  if (["active", "waiting", "stalled"].includes(record.operationProgress?.state ?? "") || record.evidenceStatus === "preparing" || record.enrichmentStatus === "processing" || ["preparant", "processant"].includes(record.status)) return "process";
  return undefined;
}

function OperationProgressCard({progress,now}:{progress:NonNullable<SourceRecord["operationProgress"]>;now:number}) {
  const stateLabel={idle:"Pendent d’inici",waiting:"Esperant el pas següent",active:"Processant amb activitat",stalled:"Possible bloqueig",incident:"Incidència tècnica",finished:"Execució automàtica finalitzada"}[progress.state];
  const stepLabel=progress.step?({document_discovery:"Localització de documents",document_extraction:"Lectura dels documents",ocr:"Reconeixement OCR",enrichment:"Contrast de dades",matching:"Correspondència amb la Cartera",closing:"Tancament de l’operació"} as const)[progress.step]:null;
  const elapsed=formatDuration(Math.max(0,(progress.finishedAt?Date.parse(progress.finishedAt):now)-Date.parse(progress.startedAt)));
  const activityAgo=formatDuration(Math.max(0,now-Date.parse(progress.lastActivityAt)));
  const determinate=progress.total!=null&&progress.total>0&&progress.completed!=null;
  const percentage=determinate?Math.min(100,Math.round((progress.completed!/progress.total!)*100)):null;
  return <div className={cn("mt-4 rounded-lg border p-3",progress.state==="stalled"||progress.state==="incident"?"border-neutral-900 bg-neutral-100":"border-neutral-200 bg-neutral-50")} role={progress.state==="stalled"||progress.state==="incident"?"alert":undefined}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{stateLabel}</p><span className="text-xs text-neutral-500">Temps transcorregut: {elapsed}</span></div>
    {stepLabel&&<p className="mt-1 text-sm text-neutral-700">{progress.state==='incident'?'Pas interromput: ':''}{stepLabel}{progress.detail&&progress.state!=='incident'?` · ${progress.detail}`:""}</p>}
    {determinate&&<div className="mt-3" aria-label={`${progress.completed} de ${progress.total}`}><div className="mb-1 flex justify-between text-xs text-neutral-500"><span>{progress.completed} de {progress.total}</span><span>{percentage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-neutral-900 transition-[width]" style={{width:`${percentage}%`}} /></div></div>}
    <p className="mt-2 text-xs text-neutral-500">{['incident','finished'].includes(progress.state) ? `Darrera activitat: ${new Intl.DateTimeFormat('ca-ES',{dateStyle:'short',timeStyle:'medium',timeZone:'Europe/Madrid'}).format(new Date(progress.lastActivityAt))}.` : `Darrera activitat fa ${activityAgo}.`}{progress.state==="stalled"?" No s’ha detectat activitat durant més de 10 minuts.":""}</p>
  </div>;
}

function formatDuration(milliseconds:number){
 const seconds=Math.floor(milliseconds/1000);if(seconds<60)return `${seconds} s`;
 const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes} min ${seconds%60} s`;
 const hours=Math.floor(minutes/60);return `${hours} h ${minutes%60} min`;
}

async function fetchSourceRecord(id: string, signal?: AbortSignal) {
  const response = await fetch(`/api/records/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as {
    record?: SourceRecord;
    error?: string;
  };
  if (!response.ok || !payload.record) {
    throw new Error(payload.error || "No s'ha pogut consultar el registre.");
  }
  return payload.record;
}

async function startRecordOperation(id: string, operation: RecordOperation) {
  const response = await fetch(
    `/api/records/${encodeURIComponent(id)}/operation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation }),
    },
  );
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "No s'ha pogut iniciar l'operació.");
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number;
  accent?: "slate" | "amber" | "green" | "violet";
}) {
  return (
    <Card className="gap-1 p-4 sm:p-5">
      <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
      <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {value.toLocaleString("ca-ES")}
      </p>
    </Card>
  );
}

function reviewDecisionLabel(decision: NonNullable<SourceRecord["reviewDecision"]>) {
  return { approved: "Aprovat", corrected: "Corregit", rejected: "Rebutjat", insufficient_evidence: "Evidència insuficient" }[decision];
}
