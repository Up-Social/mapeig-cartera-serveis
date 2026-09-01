"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import {
  reviewMatching,
} from "./actions";
import type {
  ProcessingStatus,
  SourcePage,
  SourceRecord,
} from "@/lib/workbench-types";
import {
  FINANCING_TYPES,
  FINANCING_TYPE_LABELS,
  SOURCE_LABELS,
} from "@/lib/financing-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MatchingCandidateAnalysis } from "@/components/matching-candidate-analysis";
import {
  isRecordOperationTerminal,
  type RecordOperation,
} from "@/lib/record-operation";

const statusLabels: Record<ProcessingStatus, string> = {
  pendent: "Pendent",
  preparant: "En cua",
  processant: "Processant",
  preparat: "Llest",
  completat: "Aprovat",
  revisio: "Per revisar",
  sense_evidencia: "Sense evidència",
  rebutjat: "Rebutjat",
  error: "Error",
};
const statusStyles: Record<ProcessingStatus, string> = {
  pendent: "bg-neutral-100 text-neutral-700",
  preparant: "bg-neutral-200 text-neutral-800",
  processant: "bg-neutral-800 text-white",
  completat: "bg-neutral-900 text-white",
  preparat: "bg-neutral-200 text-neutral-900",
  revisio: "bg-neutral-300 text-neutral-950",
  sense_evidencia: "bg-neutral-100 text-neutral-700",
  rebutjat: "bg-neutral-200 text-neutral-700",
  error: "bg-black text-white",
};

export function ProcessingWorkbench({
  result,
  filters,
}: {
  result: SourcePage;
  filters: {
    page: number;
    query: string;
    type: string;
    status: string;
  };
}) {
  const [records, setRecords] = useState(result.records);
  const recordsRef = useRef(result.records);
  const [metrics, setMetrics] = useState(result.metrics);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [operations, setOperations] = useState<
    Partial<Record<string, RecordOperation>>
  >({});

  const updateRecord = useCallback((nextRecord: SourceRecord) => {
    const previous = recordsRef.current.find(
      (record) => record.id === nextRecord.id,
    );
    const nextRecords = recordsRef.current.map((record) =>
      record.id === nextRecord.id ? nextRecord : record,
    );
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    if (previous) {
      setMetrics((current) =>
        updateMetricsForRecord(current, previous.status, nextRecord.status),
      );
    }
  }, []);

  const startOperation = useCallback(
    (recordId: string, operation: RecordOperation) => {
      setOperations((current) => ({ ...current, [recordId]: operation }));
    },
    [],
  );

  const finishOperation = useCallback((recordId: string) => {
    setOperations((current) => {
      const next = { ...current };
      delete next[recordId];
      return next;
    });
  }, []);

  return (
    <main className="page-shell">
      <section className="page-container">
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
            <form className="grid gap-3 border-b border-neutral-200 bg-neutral-50 p-4 md:grid-cols-[1fr_180px_170px_auto]">
              <Input
                name="q"
                defaultValue={filters.query}
                placeholder="Cercar títol, ID o entitat..."
              />
              <select
                name="type"
                defaultValue={filters.type}
                className="form-control"
              >
                <option value="totes">Totes les tipologies</option>
                {FINANCING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FINANCING_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <select
                name="status"
                defaultValue={filters.status}
                className="form-control"
              >
                <option value="tots">Tots els estats</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button variant="outline" type="submit">
                Filtrar
              </Button>
            </form>
            <div className="divide-y">
              {records.map((record) => {
                const isOpen = openRecordId === record.id;
                return (
                  <section key={record.id} className="px-4">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`record-detail-${record.id}`}
                      className="flex w-full items-start gap-4 py-4 text-left"
                      onClick={() =>
                        setOpenRecordId(isOpen ? null : record.id)
                      }
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <p className="font-medium leading-5">{record.title}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-neutral-500">
                          {record.sourceRecordId} ·{" "}
                          {record.providerName ?? "Entitat no informada"}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700">
                            {FINANCING_TYPE_LABELS[record.financingType]}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {SOURCE_LABELS[record.sourceDataset] ??
                              record.sourceDataset}
                          </span>
                          <Badge className={statusStyles[record.status]}>
                            {statusLabels[record.status]}
                          </Badge>
                          <span className="text-xs text-neutral-500">
                            {record.carteraCode ?? "Sense matching"}
                          </span>
                        </div>
                      </div>
                      {!isOpen && record.matchingCandidates[0] && (
                        <MatchSummary record={record} />
                      )}
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "mt-1 size-4 shrink-0 text-neutral-500 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div
                        id={`record-detail-${record.id}`}
                        className="border-t pb-5 pt-4"
                      >
                        <DetailPanel
                          record={record}
                          embedded
                          operation={
                            operations[record.id] ?? inferOperation(record)
                          }
                          onRecordUpdate={updateRecord}
                          onOperationStart={startOperation}
                          onOperationFinish={finishOperation}
                        />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
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
  result: SourcePage;
  filters: {
    query: string;
    type: string;
    status: string;
  };
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      q: filters.query,
      type: filters.type,
      status: filters.status,
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

function MatchSummary({ record }: { record: SourceRecord }) {
  const candidate = record.matchingCandidates[0];
  if (!candidate) return null;
  return (
    <div className="mt-3 rounded-xl border border-neutral-300 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Proposta de matching
          </p>
          <p className="mt-1 text-sm font-semibold">
            {candidate.targetCode} · {candidate.targetName}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
          {Math.round(candidate.score * 100)}%
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-neutral-700">
        {record.reviewDecision
          ? reviewDecisionLabel(record.reviewDecision)
          : "Obre Revisió per validar"}
      </p>
    </div>
  );
}

function DetailPanel({
  record,
  embedded = false,
  operation,
  onRecordUpdate,
  onOperationStart,
  onOperationFinish,
}: {
  record?: SourceRecord;
  embedded?: boolean;
  operation?: RecordOperation;
  onRecordUpdate: (record: SourceRecord) => void;
  onOperationStart: (recordId: string, operation: RecordOperation) => void;
  onOperationFinish: (recordId: string) => void;
}) {
  if (!record)
    return (
      <aside className="rounded-2xl border border-dashed border-neutral-300 bg-white p-5 text-sm text-neutral-500">
        Selecciona un registre de la taula per consultar-ne el detall i iniciar
        el procés.
      </aside>
    );
  const payload = Object.entries(record.sourcePayload).filter(
    ([key, value]) =>
      !key.startsWith("Fórmula ·") &&
      !(typeof value === "string" && value.trim().startsWith("=")) &&
      value !== null &&
      value !== "",
  );
  return (
    <aside
      className={
        embedded ? "bg-white" : "surface self-start p-5 xl:sticky xl:top-20"
      }
    >
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-600">
        Detall i traçabilitat
      </p>
      <h2 className="mt-2 text-lg font-semibold leading-snug">
        {record.title}
      </h2>
      <dl className="mt-5 grid gap-3 border-y border-neutral-200 py-5 text-sm">
        <Detail
          label="Tipologia"
          value={FINANCING_TYPE_LABELS[record.financingType]}
        />
        <Detail
          label="Font"
          value={SOURCE_LABELS[record.sourceDataset] ?? record.sourceDataset}
        />
        <Detail label="Identificador" value={record.sourceRecordId} />
        <Detail label="Mecanisme" value={record.mechanism} />
        <Detail label="Import" value={formatAmount(record.amount)} />
        <Detail label="Fitxer" value={record.sourceFile ?? "—"} />
        <Detail
          label="Full / fila"
          value={`${record.sourceSheet ?? "—"} · ${record.sourceRow ?? "—"}`}
        />
      </dl>
      <RecordStages
        record={record}
        operation={operation}
        onRecordUpdate={onRecordUpdate}
        onOperationStart={onOperationStart}
        onOperationFinish={onOperationFinish}
      />
      {record.externalEnrichment && (
        <ExternalEnrichmentDetail enrichment={record.externalEnrichment} />
      )}
      {record.matchingCandidates.length > 0 ? (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Candidats de matching
            </p>
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold">
              {record.reviewDecision
                ? reviewDecisionLabel(record.reviewDecision)
                : "Revisió necessària"}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {record.matchingCandidates.map((candidate) => <MatchingCandidateAnalysis key={candidate.id} candidate={candidate} />)}
          </div>
          {record.reviewDecision ? (
            <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-xs font-semibold">
              Decisió registrada: {reviewDecisionLabel(record.reviewDecision)}
            </p>
          ) : (
            <ReviewControls record={record} />
          )}
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-neutral-100 p-4 text-sm text-neutral-900">
          <p className="font-semibold">Matching encara no executat</p>
          <p className="mt-1 leading-5">
            Crea un lot quan el registre disposi d&apos;evidència per generar
            una proposta.
          </p>
        </div>
      )}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Evidència documental del registre
          </p>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
            {record.sourceDocuments.length}
          </span>
        </div>
        {record.sourceDocuments.length ? (
          <ul className="mt-3 space-y-2">
            {record.sourceDocuments.map((document) => (
              <li
                key={document.id}
                className="rounded-xl border border-neutral-200 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-neutral-700">
                    {documentTypeLabel(document.documentType)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {sourceStatusLabel(document.status)}
                  </span>
                </div>
                <a
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-xs leading-5 text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:text-black"
                >
                  {document.url}
                </a>
                {document.status === "fetched" && (
                  <div className="mt-3 rounded-lg bg-neutral-50 p-3">
                    <div className="flex flex-wrap gap-2 text-[11px] text-neutral-600">
                      <span>
                        {document.textLength?.toLocaleString("ca-ES")} caràcters
                      </span>
                      <span>·</span>
                      <span>{document.chunkCount} fragments</span>
                      {document.qualityScore != null && (
                        <>
                          <span>·</span>
                          <span>
                            qualitat {Math.round(document.qualityScore * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                    {document.textPreview && (
                      <p className="mt-2 line-clamp-5 whitespace-pre-line text-xs leading-5 text-neutral-700">
                        {document.textPreview}
                      </p>
                    )}
                    {document.qualityFlags.length > 0 && (
                      <p className="mt-2 text-[11px] text-neutral-500">
                        Avisos:{" "}
                        {document.qualityFlags
                          .map(qualityFlagLabel)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-neutral-500">
                  {document.sourceFields.join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-neutral-500">
            No s&apos;ha trobat cap URL a la fila original.
          </p>
        )}
      </div>
      <details className="mt-5 rounded-xl border border-neutral-200 p-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Totes les dades originals ({payload.length})
        </summary>
        <dl className="mt-3 max-h-96 space-y-3 overflow-auto pr-2 text-xs">
          {payload.map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold text-neutral-500">{key}</dt>
              <dd className="mt-1 break-words leading-5 text-neutral-700">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}

function ExternalEnrichmentDetail({
  enrichment,
}: {
  enrichment: NonNullable<SourceRecord["externalEnrichment"]>;
}) {
  const fields = [
    ["Títol contrastat", enrichment.title],
    ["Entitat", enrichment.providerName],
    ["NIF", enrichment.providerNif],
    ["Mecanisme", enrichment.mechanism],
    ["Data", enrichment.awardDate],
    [
      "Import",
      enrichment.amount == null ? null : formatAmount(enrichment.amount),
    ],
    ["Organisme", enrichment.contractingBody],
    ["Col·lectiu", enrichment.targetPopulation],
  ];
  return (
    <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
          Dades contrastades amb fonts oficials
        </p>
        <span className="text-xs font-semibold">
          {Math.round(enrichment.confidence * 100)}%
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{enrichment.summary}</p>
      <dl className="mt-3 space-y-2 text-xs">
        {fields
          .filter(([, value]) => value !== null && value !== "")
          .map(([label, value]) => (
            <div
              key={String(label)}
              className="grid grid-cols-[105px_1fr] gap-2"
            >
              <dt className="font-semibold text-neutral-500">{label}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
      </dl>
      {enrichment.evidence.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Fragments justificatius ({enrichment.evidence.length})
          </summary>
          <div className="mt-2 max-h-56 space-y-2 overflow-auto">
            {enrichment.evidence.map((item) => (
              <blockquote
                key={item.ordinal}
                className="border-l-2 border-emerald-300 pl-3 text-xs leading-5"
              >
                {item.content}
              </blockquote>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function RecordStages({
  record,
  operation,
  onRecordUpdate,
  onOperationStart,
  onOperationFinish,
}: {
  record: SourceRecord;
  operation?: RecordOperation;
  onRecordUpdate: (record: SourceRecord) => void;
  onOperationStart: (recordId: string, operation: RecordOperation) => void;
  onOperationFinish: (recordId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [pollingStopped, setPollingStopped] = useState(false);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const [startingOperation, setStartingOperation] =
    useState<RecordOperation>();

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
          return;
        }
      }
      timer = window.setTimeout(poll, 2000);
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
          status={evidenceStatusLabel(record.evidenceStatus)}
          complete={record.evidenceStatus === "ready"}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              busy ||
              record.evidenceStatus === "preparing" ||
              record.evidenceStatus === "ready"
            }
            onClick={() =>
              run("prepare", () => startRecordOperation(record.id, "prepare"))
            }
          >
            {record.evidenceStatus === "ready"
              ? "Preparat"
              : displayedOperation === "prepare"
                ? "Preparant..."
                : "Preparar fonts"}
          </Button>
        </StageRow>
        <StageRow
          number="2"
          title="Contrastar dades"
          status={enrichmentStatusLabel(record.enrichmentStatus)}
          complete={record.enrichmentStatus === "completed"}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              busy ||
              record.evidenceStatus !== "ready" ||
              record.enrichmentStatus === "processing" ||
              record.enrichmentStatus === "completed"
            }
            onClick={() =>
              run("enrich", () => startRecordOperation(record.id, "enrich"))
            }
          >
            {record.enrichmentStatus === "completed"
              ? "Contrastat"
              : displayedOperation === "enrich"
                ? "Contrastant..."
                : "Contrastar dades"}
          </Button>
        </StageRow>
        <StageRow
          number="3"
          title="Fer matching"
          status={
            record.matchingCandidates.length
              ? "Matching disponible"
              : "No executat"
          }
          complete={record.matchingCandidates.length > 0}
        >
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              record.enrichmentStatus !== "completed" ||
              record.matchingCandidates.length > 0
            }
            onClick={() =>
              run("match", () => startRecordOperation(record.id, "match"))
            }
          >
            {record.matchingCandidates.length > 0
              ? "Matching fet"
              : displayedOperation === "match"
                ? "Fent matching..."
                : "Fer matching"}
          </Button>
        </StageRow>
        <StageRow
          number="4"
          title="Validar resultat"
          status={record.reviewDecision ? reviewDecisionLabel(record.reviewDecision) : record.matchingCandidates.length ? "Pendent de validació humana" : "Encara no disponible"}
          complete={record.reviewDecision === "approved" || record.reviewDecision === "corrected"}
        >
          {record.pipelineRunId && record.matchingCandidates.length > 0 ? (
            <Link href={`/review?batch=${record.pipelineRunId}&record=${record.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {record.reviewDecision ? "Revisar decisió" : "Validar"}
            </Link>
          ) : <Button variant="outline" size="sm" disabled>Validar</Button>}
        </StageRow>
      </div>
      {(record.evidenceError ||
        record.enrichmentError ||
        message ||
        networkError) && (
        <p className="mt-3 rounded-lg bg-neutral-100 p-2 text-xs leading-5 text-neutral-600">
          {message ||
            networkError ||
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
      <p className="mt-3 text-[11px] leading-5 text-neutral-500">
        Preparar fonts no utilitza OpenAI. Contrastar dades utilitza IA per
        estructurar només la font oficial, sense escollir cap servei. El registre
        només es considera correcte després de la validació humana.
      </p>
      {record.pipelineRunId && (record.reviewDecision === "approved" || record.reviewDecision === "corrected") && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <span>Lot individual {record.batchNumber ?? ""} · 1 registre validat</span>
          <a href={`/api/exports/batch/${record.pipelineRunId}`} className={buttonVariants({ size: "sm" })}>Descarregar Excel</a>
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
  children: React.ReactNode;
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
      error: "Error de contrast",
    } as const
  )[value];
}

function inferOperation(record: SourceRecord): RecordOperation | undefined {
  if (record.evidenceStatus === "preparing") return "prepare";
  if (record.enrichmentStatus === "processing") return "enrich";
  if (record.status === "processant") return "match";
  return undefined;
}

async function fetchSourceRecord(id: string, signal?: AbortSignal) {
  const response = await fetch(`/api/records/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
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

function updateMetricsForRecord(
  metrics: SourcePage["metrics"],
  previous: ProcessingStatus,
  next: ProcessingStatus,
) {
  if (previous === next) return metrics;
  const count = (status: ProcessingStatus, target: ProcessingStatus) =>
    status === target ? 1 : 0;
  return {
    ...metrics,
    queued:
      metrics.queued - count(previous, "preparant") + count(next, "preparant"),
    completed:
      metrics.completed - count(previous, "completat") + count(next, "completat"),
    review:
      metrics.review - count(previous, "revisio") + count(next, "revisio"),
  };
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
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-3 sm:grid-cols-[100px_1fr]">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-neutral-800">
        {value}
      </dd>
    </div>
  );
}
function formatAmount(amount: number | null) {
  return amount == null
    ? "No informat"
    : new Intl.NumberFormat("ca-ES", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(amount);
}
function documentTypeLabel(type: string) {
  return (
    (
      {
        regulatory_basis: "Bases reguladores",
        annex: "Annex",
        agreement: "Conveni",
        publication: "Publicació",
        contracting_profile: "Perfil contractant",
        other: "Altres",
      } as Record<string, string>
    )[type] ?? type
  );
}
function sourceStatusLabel(status: string) {
  return (
    (
      {
        discovered: "Descoberta",
        fetching: "Descarregant",
        fetched: "Text extret",
        unsupported: "Requereix OCR",
        error: "Error",
      } as Record<string, string>
    )[status] ?? status
  );
}
function qualityFlagLabel(flag: string) {
  return (
    (
      {
        short_text: "text curt",
        duplicate_text: "text duplicat",
        basic_html_extraction: "extracció HTML bàsica",
      } as Record<string, string>
    )[flag] ?? flag
  );
}
function ReviewControls({ record }: { record: SourceRecord }) {
  const router = useRouter();
  const [candidateId, setCandidateId] = useState(
    record.matchingCandidates[0]?.id ?? "",
  );
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(outcome: "select" | "reject" | "insufficient") {
    setMessage("");
    startTransition(async () => {
      try {
        await reviewMatching({
          sourceRecordId: record.id,
          candidateId: outcome === "select" ? candidateId : undefined,
          outcome,
          notes,
        });
        setMessage("Decisió registrada correctament.");
        router.refresh();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "No s'ha pogut registrar la decisió.",
        );
      }
    });
  }
  return (
    <div className="mt-4 rounded-xl border border-neutral-300 p-4">
      <p className="text-sm font-semibold">Validació humana</p>
      <label className="mt-3 block text-xs font-semibold text-neutral-600">
        Candidat seleccionat
        <select
          value={candidateId}
          onChange={(event) => setCandidateId(event.target.value)}
          className="form-control mt-1.5 font-normal"
        >
          {record.matchingCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.targetCode} · {Math.round(candidate.score * 100)}% ·{" "}
              {candidate.targetName}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-semibold text-neutral-600">
        Notes opcionals
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-1.5 font-normal"
          placeholder="Motiu o observacions de la decisió"
        />
      </label>
      <div className="mt-3 grid gap-2">
        <Button
          type="button"
          disabled={pending || !candidateId}
          onClick={() => submit("select")}
        >
          Aprovar candidat seleccionat
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={pending}
            onClick={() => submit("reject")}
          >
            Rebutjar matching
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={pending}
            onClick={() => submit("insufficient")}
          >
            Evidència insuficient
          </Button>
        </div>
      </div>
      {message && <p className="mt-3 text-xs text-neutral-600">{message}</p>}
    </div>
  );
}
function reviewDecisionLabel(
  decision: NonNullable<SourceRecord["reviewDecision"]>,
) {
  return (
    {
      approved: "Aprovat",
      corrected: "Corregit",
      rejected: "Rebutjat",
      insufficient_evidence: "Evidència insuficient",
    } as const
  )[decision];
}
