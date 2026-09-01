"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { BatchSummary, SampleRecord } from "@/lib/batch-types";
import {
  FINANCING_TYPES,
  FINANCING_TYPE_LABELS,
  SOURCE_LABELS,
  type FinancingType,
} from "@/lib/financing-types";
import {
  createGuidedBatch,
  generateBalancedSample,
  replaceFailedBatchJob,
  replaceSampleRecord,
  startBatchMatching,
  startBatchPreparation,
} from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MatchingCandidateAnalysis } from "@/components/matching-candidate-analysis";

export function BatchesWorkbench({
  batches,
  activeBatch,
}: {
  batches: BatchSummary[];
  activeBatch: BatchSummary | null;
}) {
  const router = useRouter();
  const [sample, setSample] = useState<SampleRecord[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FINANCING_TYPES.map((type) => [
          type,
          sample.filter((item) => item.financingType === type).length,
        ]),
      ) as Record<FinancingType, number>,
    [sample],
  );
  const active =
    activeBatch && ["preparing", "matching"].includes(activeBatch.status);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  function run(action: () => Promise<void>) {
    setMessage("");
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "No s'ha pogut completar l'acció.",
        );
      }
    });
  }
  function generate() {
    run(async () => {
      const rows = await generateBalancedSample();
      setSample(rows);
      if (rows.length !== 4)
        setMessage(
          `Només s'han trobat ${rows.length} casos únics disponibles.`,
        );
    });
  }
  function replace(record: SampleRecord) {
    run(async () => {
      const next = await replaceSampleRecord(
        record.financingType,
        sample.map((item) => item.id),
      );
      setSample((current) =>
        current.map((item) => (item.id === record.id ? next : item)),
      );
    });
  }
  function add(type: FinancingType) {
    run(async () => {
      const next = await replaceSampleRecord(
        type,
        sample.map((item) => item.id),
      );
      setSample((current) => [...current, next]);
    });
  }
  function create() {
    run(async () => {
      const result = await createGuidedBatch(sample.map((item) => item.id));
      setSample([]);
      router.push(`/batches?batch=${result.id}`);
      router.refresh();
    });
  }

  return (
    <main className="page-shell">
      <section className="page-container">
        <div>
          <p className="page-eyebrow">Flux guiat</p>
          <h2 className="page-title">Lots de matching</h2>
          <p className="page-description">
            Selecciona, prepara evidència, confirma el cost, revisa els
            resultats i descarrega el detall de cada lot.
          </p>
        </div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-4" aria-label="Passos del procés per lots">
          {[["1", "Crear lot", "Escull 4 registres"], ["2", "Preparar", "Obté i contrasta fonts"], ["3", "Matching", "Genera candidats"], ["4", "Validar i exportar", "Aprova almenys un registre"]].map(([number, title, description]) => <li key={number} className="rounded-xl border bg-card p-3"><div className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{number}</span><strong className="text-sm">{title}</strong></div><p className="mt-1 pl-8 text-xs text-muted-foreground">{description}</p></li>)}
        </ol>
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
            <section className="surface p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Mostra per tipologia</h3>
                <span className="text-sm text-neutral-500">
                  {sample.length}/4
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                Un cas de cada tipologia disponible. Si una s&apos;ha esgotat,
                es completa el lot amb una altra sense repetir casos.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {FINANCING_TYPES.map((type) => (
                  <div key={type} className="rounded-xl bg-neutral-100 p-3">
                    <p className="text-xs text-neutral-500">
                      {FINANCING_TYPE_LABELS[type]}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <strong>{counts[type]}</strong>
                      {sample.length > 0 &&
                        sample.length < 4 &&
                        counts[type] > 0 && (
                          <Button
                            variant="link"
                            size="xs"
                            onClick={() => add(type)}
                            disabled={pending}
                          >
                            Afegir
                          </Button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={generate}
                disabled={pending}
                className="mt-3 w-full"
              >
                {sample.length
                  ? "Generar una altra mostra"
                  : "Generar mostra de 4"}
              </Button>
              {sample.length > 0 && (
                <Button
                  onClick={create}
                  disabled={pending || sample.length !== 4}
                  className="mt-2 w-full"
                >
                  Crear lot
                </Button>
              )}
            </section>
            <section className="surface p-4">
              <h3 className="font-semibold">Historial</h3>
              <p className="mt-1 text-xs text-muted-foreground">Obre un lot per executar el pas pendent. L&apos;Excel apareix quan hi ha almenys una validació humana aprovada.</p>
              <Accordion defaultValue={activeBatch ? [activeBatch.id] : []} className="mt-3 divide-y">
                {batches.map((batch) => (
                  <AccordionItem key={batch.id} value={batch.id} className="px-3">
                    <AccordionTrigger className="gap-3 py-3 hover:no-underline"><div className="min-w-0 flex-1 text-left">
                      <div className="flex justify-between gap-2">
                        <strong>Lot {batch.batchNumber}</strong>
                        <span className="text-xs text-neutral-500">
                          {stageLabel(batch.stage)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {new Intl.DateTimeFormat("ca-ES", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(batch.createdAt))}{" "}
                        · {batch.selectedCount} registres
                      </p>
                    </div></AccordionTrigger>
                    <AccordionContent className="border-t pb-4 pt-4">
                    <BatchDetail batch={batch} pending={pending} run={run} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          </div>
          <div className="space-y-6">
            {message && (
              <p className="rounded-xl border border-neutral-300 bg-white p-4 text-sm">
                {message}
              </p>
            )}
            {sample.length > 0 ? (
              <SamplePreview
                sample={sample}
                onReplace={replace}
                onRemove={(id) =>
                  setSample((current) =>
                    current.filter((item) => item.id !== id),
                  )
                }
                disabled={pending}
              />
            ) : batches.length === 0 ? (
              <EmptyState />
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function SamplePreview({
  sample,
  onReplace,
  onRemove,
  disabled,
}: {
  sample: SampleRecord[];
  onReplace: (record: SampleRecord) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-neutral-200 p-5">
        <h3 className="text-lg font-semibold">Previsualització de la mostra</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Revisa els 4 casos únics abans de crear el lot.
        </p>
      </div>
      {FINANCING_TYPES.map((type) => {
        const rows = sample.filter((item) => item.financingType === type);
        return rows.length ? (
          <div key={type} className="border-b border-neutral-200">
            <div className="bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {FINANCING_TYPE_LABELS[type]} · {rows.length}
            </div>
            <Accordion>
            {rows.map((record) => (
              <AccordionItem key={record.id} value={record.id} className="border-t px-4">
                <AccordionTrigger className="gap-3 py-3 hover:no-underline"><div className="min-w-0 flex-1 text-left">
                  <p className="text-xs font-semibold text-neutral-500">
                    {SOURCE_LABELS[record.sourceDataset] ??
                      record.sourceDataset}{" "}
                    · {record.sourceRecordId}
                  </p>
                  <p className="mt-1 text-sm font-medium leading-5">
                    {record.title}
                  </p>
                </div></AccordionTrigger>
                <AccordionContent className="pb-4"><div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onReplace(record)}
                  >
                    Substituir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onRemove(record.id)}
                  >
                    Treure
                  </Button>
                </div><p className="mt-3 text-xs text-muted-foreground">Identificador: {record.sourceRecordId} · Font: {SOURCE_LABELS[record.sourceDataset] ?? record.sourceDataset}</p></AccordionContent>
              </AccordionItem>
            ))}
            </Accordion>
          </div>
        ) : null;
      })}
    </section>
  );
}

function BatchDetail({
  batch,
  pending,
  run,
}: {
  batch: BatchSummary;
  pending: boolean;
  run: (action: () => Promise<void>) => void;
}) {
  const readyCost =
    (batch.estimatedInputTokens * 0.15) / 1_000_000 +
    (batch.readyCount * 1800 * 0.6) / 1_000_000;
  return (
    <>
      <section className="surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Lot {batch.batchNumber}
            </p>
            <h3 className="mt-1 text-xl font-semibold">
              {stageLabel(batch.stage)}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {batch.status === "draft" && (
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await startBatchPreparation(batch.id);
                    location.reload();
                  })
                }
              >
                Preparar evidència
              </Button>
            )}
            {batch.status === "ready" && batch.readyCount > 0 && (
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await startBatchMatching(batch.id);
                    location.reload();
                  })
                }
              >
                Confirmar i fer matching
              </Button>
            )}
            {batch.stage === "review" && (
              <Link
                href={`/review?batch=${batch.id}`}
                className={buttonVariants()}
              >
                Obrir revisió
              </Link>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <SmallMetric label="Seleccionats" value={batch.selectedCount} />
          <SmallMetric label="Preparats" value={batch.preparedCount} />
          <SmallMetric label="Llestos" value={batch.readyCount} />
          <SmallMetric label="Analitzats" value={batch.analyzedCount} />
          <SmallMetric label="Per revisar" value={batch.reviewCount} />
          <SmallMetric label="Revisats" value={batch.reviewedCount} />
          <SmallMetric label="Aprovats" value={batch.approvedCount} />
          <SmallMetric label="Rebutjats" value={batch.rejectedCount} />
          <SmallMetric label="Evidència insuficient" value={batch.insufficientCount} />
          <SmallMetric label="Errors" value={batch.errorCount} />
        </div>
        <div className="mt-4 rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-sm font-semibold">Exportació</h4><p className="mt-1 text-xs text-muted-foreground">{batch.exportableCount} registres aprovats i exportables.</p></div>{batch.canExport ? <a href={`/api/exports/batch/${batch.id}`} className={buttonVariants({ size: "sm" })}>Descarregar Excel del lot</a> : <Button size="sm" disabled>Sense registres exportables</Button>}</div>
          {batch.incidences.map((incidence) => <p key={incidence} className="mt-2 text-xs text-destructive">Incidència: {incidence}</p>)}
        </div>
        {batch.status === "ready" && (
          <div className="mt-4 rounded-xl bg-neutral-100 p-4 text-sm">
            <strong>Confirmació de cost</strong>
            <p className="mt-1 text-neutral-600">
              {batch.readyCount} crides · ~
              {batch.estimatedInputTokens.toLocaleString("ca-ES")} tokens
              d&apos;entrada · màxim estimat ${readyCost.toFixed(3)}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Els {batch.errorCount} registres no preparats no s&apos;enviaran a
              OpenAI. Els pots substituir abans de continuar.
            </p>
          </div>
        )}
      </section>
      <section className="surface overflow-hidden">
        <div className="border-b p-4 font-semibold">Registres del lot</div>
        <Accordion className="divide-y">
          {batch.jobs.map((job) => (
            <AccordionItem key={job.id} value={job.id} className="px-4">
            <AccordionTrigger className="gap-4 py-4 hover:no-underline"><div className="min-w-0 flex-1 text-left">
                <p className="text-xs font-semibold text-neutral-700">
                  {FINANCING_TYPE_LABELS[job.financingType]}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {SOURCE_LABELS[job.sourceDataset] ?? job.sourceDataset}
                </p>
                <p className="mt-1 text-xs">{job.externalId}</p>
              <p className="mt-1 leading-5">{job.title}</p></div>
              <div className="shrink-0 text-right">
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold">
                  {preparationLabel(job.preparationStatus, job.status)}
                </span>
                {job.preparationMessage && (
                  <p className="mt-2 text-xs leading-4 text-neutral-500">
                    {job.preparationMessage}
                  </p>
                )}
              </div></AccordionTrigger>
              <AccordionContent className="border-t pb-4 pt-3">
                <dl className="grid gap-2 text-sm sm:grid-cols-[150px_1fr]"><dt className="text-muted-foreground">Identificador</dt><dd className="break-all">{job.externalId}</dd><dt className="text-muted-foreground">Preparació</dt><dd>{job.preparationMessage ?? preparationLabel(job.preparationStatus, job.status)}</dd></dl>
                <section className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">Anàlisi del matching</h4><p className="mt-1 text-xs text-muted-foreground">Propostes de la IA pendents o sotmeses a validació humana.</p>{job.matchingCandidates.length ? <div className="mt-3 space-y-3">{job.matchingCandidates.map((candidate) => <MatchingCandidateAnalysis key={candidate.id} candidate={candidate} />)}</div> : <p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Anàlisi encara no disponible.</p>}</section>
                {["no_source", "unsupported", "error"].includes(job.preparationStatus) && batch.status === "ready" && <Button variant="outline" size="sm" disabled={pending} onClick={() => run(async () => { await replaceFailedBatchJob(batch.id, job.id); location.reload(); })} className="mt-3">Substituir registre</Button>}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </>
  );
}
function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-neutral-100 p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center">
      <h3 className="font-semibold">Crea un lot petit i equilibrat</h3>
      <p className="mt-2 text-sm text-neutral-500">
        Genera 4 casos repartits entre les tipologies disponibles i
        revisa&apos;ls abans de continuar.
      </p>
    </div>
  );
}
function stageLabel(stage: string) {
  return (
    (
      {
        selection: "Selecció",
        preparation: "Preparació d'evidència",
        confirmation: "Confirmació",
        matching: "Matching",
        review: "Revisió",
        completed: "Finalitzat",
      } as Record<string, string>
    )[stage] ?? stage
  );
}
function preparationLabel(preparation: string, status: string) {
  if (
    [
      "needs_review",
      "approved",
      "corrected",
      "rejected",
      "insufficient_evidence",
    ].includes(status)
  )
    return (
      {
        needs_review: "Per revisar",
        approved: "Aprovat",
        corrected: "Corregit",
        rejected: "Rebutjat",
        insufficient_evidence: "Evidència insuficient",
      } as Record<string, string>
    )[status];
  return (
    (
      {
        pending: "Pendent",
        discovering: "Cercant fonts",
        fetching: "Extraient",
        chunking: "Preparant fragments",
        ready: "Llest",
        no_source: "Sense font documental",
        unsupported: "Format no compatible",
        error: "Error",
      } as Record<string, string>
    )[preparation] ?? preparation
  );
}
