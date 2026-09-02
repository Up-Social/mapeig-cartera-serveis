"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReviewQueue, SourceRecord } from "@/lib/workbench-types";
import { submitRecordReview } from "@/lib/review-client";
import {
  FINANCING_TYPES,
  FINANCING_TYPE_LABELS,
  SOURCE_LABELS,
} from "@/lib/financing-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StableAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MatchingCandidateAnalysis } from "@/components/matching-candidate-analysis";
import { displaySourceIdentifier } from "@/lib/source-identifiers";

type Filters = { batchId?: string; type: string; state: string; query: string };
type ServiceOption = { code: string; name: string; scope: string | null };
export function ReviewWorkbench({
  queue,
  filters,
  focusedRecordId,
  services,
}: {
  queue: ReviewQueue;
  filters: Filters;
  focusedRecordId?: string;
  services: ServiceOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [records, setRecords] = useState(queue.records);
  const [refreshing, startRefresh] = useTransition();
  const reviewed = records.filter(
    (record) => record.reviewDecision !== null,
  ).length;
  const updateRecord = (nextRecord: SourceRecord) => {
    setRecords((current) => {
      if (filters.state === "pending" && nextRecord.reviewDecision) {
        return current.filter((record) => record.id !== nextRecord.id);
      }
      return current.map((record) =>
        record.id === nextRecord.id ? nextRecord : record,
      );
    });
    startRefresh(() => router.refresh());
  };
  return (
    <main className="page-shell">
      <section className="page-container">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="page-eyebrow">Validació humana</p>
            <h2 className="page-title">Revisió de matchings</h2>
            <p className="page-description">
              {reviewed} revisats · {records.length - reviewed} pendents
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? "Actualitzant…" : "Actualitzar"}
          </Button>
        </div>
        <form ref={formRef} className="surface mt-5 grid gap-3 p-4 md:grid-cols-[minmax(220px,1fr)_220px_180px]">
          <input type="hidden" name="batch" value={filters.batchId ?? ""} />
          <input type="hidden" name="record" value={focusedRecordId ?? ""} />
          <Input name="q" defaultValue={filters.query} placeholder="Cercar títol, registre o entitat..." aria-label="Cercar registres analitzats" onChange={() => { if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => formRef.current?.requestSubmit(), 350); }} />
          <select
            name="type"
            defaultValue={filters.type}
            className="form-control"
            onChange={() => formRef.current?.requestSubmit()}
          >
            <option value="totes">Totes les tipologies</option>
            {FINANCING_TYPES.map((type) => (
              <option key={type} value={type}>
                {FINANCING_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            name="state"
            defaultValue={filters.state}
            className="form-control"
            onChange={() => formRef.current?.requestSubmit()}
          >
            <option value="pending">Pendents de revisar</option>
            <option value="all">Totes les decisions</option>
          </select>
        </form>
        <div className="mt-6">
          <section className="surface overflow-hidden">
            <div className="border-b p-4 font-semibold">
              {filters.state === "pending" ? "Registres pendents de validar" : "Registres revisats i pendents"} ({records.length})
            </div>
            <StableAccordion stateKey={`review-records:${focusedRecordId ?? "queue"}`} defaultValue={focusedRecordId ? [focusedRecordId] : []} className="divide-y">
              {records.map((record) => (
                <AccordionItem key={record.id} value={record.id} className="px-4">
                <AccordionTrigger className="gap-4 py-4 hover:no-underline"><div className="min-w-0 flex-1 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-neutral-500">
                      {FINANCING_TYPE_LABELS[record.financingType]} ·{" "}
                      {displaySourceIdentifier(record.sourceRecordId)}
                    </p>
                    <Badge variant="secondary">
                      {record.reviewDecision
                        ? decisionLabel(record.reviewDecision)
                        : "Pendent"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {SOURCE_LABELS[record.sourceDataset] ??
                      record.sourceDataset}
                  </p>
                  <p className="mt-2 text-sm font-medium leading-5">
                    {record.title}
                  </p>
                  {record.matchingCandidates[0] && (
                    <p className="mt-2 text-xs text-neutral-600">
                      {record.matchingCandidates[0].targetCode} ·{" "}
                      {record.matchingCandidates[0].targetName} ·{" "}
                      {Math.round(record.matchingCandidates[0].score * 100)}%
                    </p>
                  )}
                </div></AccordionTrigger>
                <AccordionContent keepMounted className="border-t pb-5 pt-4"><ReviewDetail record={record} services={services} onRecordUpdate={updateRecord} /></AccordionContent>
                </AccordionItem>
              ))}
            </StableAccordion>
            {records.length === 0 && (
              <div className="surface border-dashed p-10 text-center text-sm text-muted-foreground">
                No hi ha registres per revisar amb aquests filtres.
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function ReviewDetail({
  record,
  services,
  onRecordUpdate,
}: {
  record: SourceRecord;
  services: ServiceOption[];
  onRecordUpdate: (record: SourceRecord) => void;
}) {
  const [selection, setSelection] = useState(
    record.matchingCandidates[0]
      ? `candidate:${record.matchingCandidates[0].id}`
      : "",
  );
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(!record.reviewDecision);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(outcome: "select" | "reject" | "insufficient") {
    if (
      record.reviewDecision &&
      !window.confirm(
        "Aquesta acció substituirà la decisió vigent. Vols continuar?",
      )
    )
      return;
    startTransition(async () => {
      try {
        const [kind, id] = selection.split(":");
        const nextRecord = await submitRecordReview(record.id, {
          outcome,
          candidateId:
            outcome === "select" && kind === "candidate" ? id : undefined,
          serviceCode:
            outcome === "select" && kind === "service" ? id : undefined,
          notes,
        });
        onRecordUpdate(nextRecord);
        setEditing(false);
        setMessage("Decisió desada correctament.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "No s'ha pogut registrar la decisió.",
        );
      }
    });
  }
  const excelFields = Object.entries(record.sourcePayload).filter(
    ([key, value]) =>
      !key.startsWith("Fórmula ·") &&
      !(typeof value === "string" && value.trim().startsWith("=")) &&
      value !== null &&
      value !== "",
  );
  return (
    <article className="surface min-w-0 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {record.sourceDataset} · {displaySourceIdentifier(record.sourceRecordId)}
          </p>
          <h3 className="mt-2 break-words text-xl font-semibold leading-7">
            {record.title}
          </h3>
        </div>
        {record.reviewDecision && (
          <Button onClick={() => setEditing(true)} variant="outline" size="sm">
            Modificar decisió
          </Button>
        )}
      </div>
      <section className="mt-5 border-t pt-5">
        <h4 className="text-sm font-semibold">
          Dades originals de l&apos;Excel
        </h4>
        <p className="mt-1 text-xs text-neutral-500">
          Informació importada, separada de les dades contrastades.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs md:grid-cols-2">
          {excelFields.map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold text-neutral-500">{key}</dt>
              <dd className="mt-1 break-words leading-5">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="mt-5 border-t pt-5">
        <h4 className="text-sm font-semibold">
          Dades contrastades amb fonts oficials
        </h4>
        {record.externalEnrichment ? (
          <EnrichmentPanel enrichment={record.externalEnrichment} />
        ) : (
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Aquest matching anterior va utilitzar evidència documental, però
            encara no té camps externs estructurats. Els nous matchings els
            desaran automàticament.
          </p>
        )}
        {record.sourceDocuments.length ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {record.sourceDocuments.map((document) => (
              <div key={document.id} className="rounded-xl bg-neutral-100 p-3">
                <div className="flex justify-between text-xs">
                  <strong>{documentTypeLabel(document.documentType)}</strong>
                  <span>
                    {document.status} · qualitat{" "}
                    {document.qualityScore == null
                      ? "—"
                      : `${Math.round(document.qualityScore * 100)}%`}
                  </span>
                </div>
                <a
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-xs underline"
                >
                  {document.url}
                </a>
                {document.textPreview && (
                  <p className="mt-2 line-clamp-4 text-xs leading-5 text-neutral-600">
                    {document.textPreview}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            Sense document oficial vinculat.
          </p>
        )}
      </section>
      <section className="mt-5 border-t pt-5">
        <h4 className="text-sm font-semibold">
          Candidats i servei del catàleg
        </h4>
        <div className="mt-3 space-y-3">
          {record.matchingCandidates.map((candidate) => <MatchingCandidateAnalysis key={candidate.id} candidate={candidate} />)}
        </div>
      </section>
      {editing && (
        <section className="mt-5 rounded-xl border border-neutral-300 p-4">
          <h4 className="font-semibold">Decisió</h4>
          <select
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
            className="form-control mt-3"
          >
            <optgroup label="Candidats proposats">
              {record.matchingCandidates.map((candidate) => (
                <option key={candidate.id} value={`candidate:${candidate.id}`}>
                  {candidate.targetCode} · {Math.round(candidate.score * 100)}%
                  · {candidate.targetName}
                </option>
              ))}
            </optgroup>
            <optgroup label="Tot el catàleg">
              {services.map((service) => (
                <option key={service.code} value={`service:${service.code}`}>
                  {service.code} · {service.name}
                </option>
              ))}
            </optgroup>
          </select>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="mt-3"
            placeholder="Notes opcionals"
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Button
              disabled={pending || !selection}
              onClick={() => submit("select")}
            >
              Aprovar selecció
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => submit("reject")}
            >
              Rebutjar
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => submit("insufficient")}
            >
              Evidència insuficient
            </Button>
          </div>
          {message && (
            <p className="mt-3 text-sm text-neutral-600">{message}</p>
          )}
        </section>
      )}
    </article>
  );
}
function EnrichmentPanel({
  enrichment,
}: {
  enrichment: NonNullable<SourceRecord["externalEnrichment"]>;
}) {
  const fields = [
    ["Títol", enrichment.title],
    ["Entitat", enrichment.providerName],
    ["NIF", enrichment.providerNif],
    ["Mecanisme", enrichment.mechanism],
    ["Data", enrichment.awardDate],
    [
      "Import",
      enrichment.amount == null
        ? null
        : new Intl.NumberFormat("ca-ES", {
            style: "currency",
            currency: "EUR",
          }).format(enrichment.amount),
    ],
    ["Òrgan", enrichment.contractingBody],
    ["Població objectiu", enrichment.targetPopulation],
  ];
  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex justify-between gap-3">
        <strong className="text-sm">Extracció de la font oficial</strong>
        <span className="text-xs font-semibold">
          {Math.round(enrichment.confidence * 100)}%
        </span>
      </div>
      <p className="mt-2 text-sm leading-6">{enrichment.summary}</p>
      <dl className="mt-3 grid gap-3 text-xs md:grid-cols-2">
        {fields
          .filter(([, value]) => value !== null && value !== "")
          .map(([label, value]) => (
            <div key={String(label)}>
              <dt className="font-semibold text-neutral-500">{label}</dt>
              <dd className="mt-1">{String(value)}</dd>
            </div>
          ))}
      </dl>
      {enrichment.evidence.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Fragments que sustenten l&apos;extracció (
            {enrichment.evidence.length})
          </summary>
          <div className="mt-2 space-y-2">
            {enrichment.evidence.map((item) => (
              <blockquote
                key={item.ordinal}
                className="border-l-2 pl-3 text-xs leading-5"
              >
                {item.content}
              </blockquote>
            ))}
          </div>
        </details>
      )}
      <p className="mt-3 text-[11px] text-neutral-500">
        Model: {enrichment.model}
      </p>
    </div>
  );
}
function decisionLabel(value: NonNullable<SourceRecord["reviewDecision"]>) {
  return (
    {
      approved: "Aprovat",
      corrected: "Corregit",
      rejected: "Rebutjat",
      insufficient_evidence: "Evidència insuficient",
    } as const
  )[value];
}

function documentTypeLabel(type: string) {
  return (
    (
      {
        regulatory_basis: "Bases reguladores",
        annex: "Annex",
        agreement: "Conveni",
        publication: "Publicació",
        contracting_profile: "Perfil del contractant",
        other: "Altres",
      } as Record<string, string>
    )[type] ?? type
  );
}
