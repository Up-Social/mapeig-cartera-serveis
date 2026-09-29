import Link from "next/link";
import { notFound } from "next/navigation";

import { batchButtonVariants } from "@/components/batch-button";
import { CLASSIFICATION_LABELS } from "@/lib/analysis-contract";
import { batchResultGuidance } from "@/lib/batch-result-guidance";
import type { BatchJob } from "@/lib/batch-types";
import { getBatch } from "@/lib/batches";
import { FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { isUuid } from "@/lib/uuid";

const REVIEW_FILTER_LABELS = {
  pending: "Pendent de començar",
  blocked: "Bloquejat",
  needs_review: "Pendent de revisió",
  approved: "Aprovat",
  corrected: "Corregit",
  rejected: "Descartat o fora de cartera",
  insufficient_evidence: "Evidència insuficient",
  error: "Error tècnic",
};

export default async function BatchResults({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const batch = await getBatch(id);
  if (!batch) notFound();

  const filter = await searchParams;
  const jobs = batch.jobs.filter(
    (job) =>
      (!filter.classification ||
        (job.analysis?.reviewed_classification ?? job.analysis?.classification) ===
          filter.classification) &&
      (!filter.review || jobState(job) === filter.review) &&
      (!filter.type || job.financingType === filter.type),
  );

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-5">
      <Link
        className={batchButtonVariants({ size: "sm" })}
        href={`/batches?batch=${id}`}
      >
        Tornar al lot {batch.batchNumber}
      </Link>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resultats i diagnòstic
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {batch.selectedCount ? `Resultats del lot ${batch.batchNumber}` : "Lot buit"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {batch.jobs.length} treballs · {batch.reviewCount} pendents de revisió humana ·{" "}
          {batch.errorCount} errors tècnics
        </p>
      </div>

      {(batch.reviewCount > 0 || batch.errorCount > 0) && (
        <section
          aria-label="Què requereix atenció"
          className="grid gap-3 md:grid-cols-2"
        >
          {batch.reviewCount > 0 && (
            <article className="rounded-xl border bg-card p-4">
              <p className="text-2xl font-semibold tabular-nums">{batch.reviewCount}</p>
              <h2 className="mt-1 font-semibold">Revisions humanes pendents</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                El procés automàtic ha acabat i ha deixat una proposta o una falta
                d’evidència. Una persona ha de confirmar o rectificar el resultat abans
                de donar-lo per vàlid.
              </p>
            </article>
          )}
          {batch.errorCount > 0 && (
            <article className="rounded-xl border bg-card p-4">
              <p className="text-2xl font-semibold tabular-nums">{batch.errorCount}</p>
              <h2 className="mt-1 font-semibold">Errors tècnics</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                El procés s’ha aturat abans d’obtenir un resultat revisable. Cada registre
                indica la fase, una explicació entenedora i l’acció recomanada.
              </p>
            </article>
          )}
        </section>
      )}

      {batch.status === "paused" && (
        <p
          role="status"
          className="rounded-xl border-2 border-neutral-900 bg-neutral-100 p-4"
        >
          Aquest lot està aturat. Els registres sense resultat no s’estan processant i es
          reprendran des del primer pas incomplet.
        </p>
      )}

      <form className="flex flex-wrap items-center gap-3">
        <select
          name="classification"
          aria-label="Classificació"
          defaultValue={filter.classification ?? ""}
          className="form-control sm:w-auto"
        >
          <option value="">Totes les classificacions</option>
          {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="review"
          aria-label="Revisió"
          defaultValue={filter.review ?? ""}
          className="form-control sm:w-auto"
        >
          <option value="">Totes les revisions i estats</option>
          {Object.entries(REVIEW_FILTER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="type"
          aria-label="Tipologia"
          defaultValue={filter.type ?? ""}
          className="form-control sm:w-auto"
        >
          <option value="">Totes les tipologies</option>
          {Object.entries(FINANCING_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className={batchButtonVariants()} type="submit">
          Filtrar
        </button>
      </form>

      <p className="text-sm text-muted-foreground">{jobs.length} resultats filtrats</p>

      <section className="space-y-4" aria-label="Resultats del lot">
        {jobs.map((job) => (
          <JobResult key={job.id} job={job} batchId={id} />
        ))}
      </section>
    </main>
  );
}

function JobResult({ job, batchId }: { job: BatchJob; batchId: string }) {
  const classification =
    job.analysis?.reviewed_classification ?? job.analysis?.classification;
  const guidance = batchResultGuidance(job);
  const isTechnical = guidance.kind === "technical";
  const needsReview = guidance.kind === "review";
  const resultHref = needsReview
    ? `/review?state=all&batch=${batchId}&record=${job.sourceRecordId}&job=${job.id}`
    : isTechnical
      ? `/issues?q=${encodeURIComponent(job.externalId)}`
      : `/review?state=all&batch=${batchId}&record=${job.sourceRecordId}&job=${job.id}`;

  return (
    <article className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">{job.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {job.externalId} · {FINANCING_TYPE_LABELS[job.financingType]}
        </p>
        <p className="mt-2 text-sm">
          Estat: {jobStateLabel(job)} · Classificació:{" "}
          {classification
            ? CLASSIFICATION_LABELS[classification]
            : "Sense resultat automàtic"}
        </p>
      </div>

      <section
        aria-label={guidance.label}
        className="rounded-lg border-l-4 border-foreground bg-muted/60 p-4"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {guidance.label}
          {guidance.phase ? ` · ${guidance.phase}` : ""}
        </p>
        <h3 className="mt-1 font-semibold">{guidance.title}</h3>
        <p className="mt-2 text-sm leading-6">{guidance.explanation}</p>
        <p className="mt-3 text-sm">
          <strong>Què cal fer:</strong> {guidance.nextStep}
        </p>
        {guidance.technicalDetail && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">Veure detall tècnic</summary>
            <p className="mt-2 break-words rounded bg-background p-3 font-mono text-xs">
              {guidance.technicalDetail}
            </p>
          </details>
        )}
      </section>

      {job.analysis && (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-semibold">Servei identificat</dt>
            <dd className="mt-1 text-muted-foreground">
              {job.analysis.service_description?.trim() || "No prou acreditat"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Destinataris</dt>
            <dd className="mt-1 text-muted-foreground">
              {job.analysis.target_population?.trim() || "No prou acreditats"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Evidència disponible</dt>
            <dd className="mt-1 text-muted-foreground">
              {job.analysis.evidence.length
                ? `${job.analysis.evidence.length} fragment(s)`
                : "Cap fragment acreditat"}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={resultHref}
          className={batchButtonVariants({ size: "sm", selected: true })}
        >
          {needsReview
            ? "Revisar ara"
            : isTechnical
              ? "Veure incidència"
              : "Veure resultat i evidència"}
        </Link>
        <Link
          href={`/?record=${job.sourceRecordId}`}
          className={batchButtonVariants({ size: "sm" })}
        >
          Obrir registre
        </Link>
      </div>
    </article>
  );
}

function jobState(job: BatchJob) {
  if (job.status === "error") return "error";
  if (
    ["approved", "corrected", "rejected", "insufficient_evidence", "needs_review"].includes(
      job.status,
    )
  ) {
    return job.status;
  }
  if (job.phases && Object.values(job.phases).includes("blocked")) return "blocked";
  return "pending";
}

function jobStateLabel(job: BatchJob) {
  return (
    {
      pending: "Pendent de començar",
      blocked: "Bloquejat",
      needs_review: "Pendent de revisió",
      approved: "Aprovat",
      corrected: "Corregit",
      rejected: "Revisat",
      insufficient_evidence: "Evidència insuficient",
      error: "Error tècnic",
    } as Record<string, string>
  )[jobState(job)] ?? "Pendent";
}
