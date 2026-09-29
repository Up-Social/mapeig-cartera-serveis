import Link from "next/link";
import { notFound } from "next/navigation";

import { batchButtonVariants } from "@/components/batch-button";
import { CLASSIFICATION_LABELS } from "@/lib/analysis-contract";
import { batchResultGuidance } from "@/lib/batch-result-guidance";
import type { BatchJob } from "@/lib/batch-types";
import { getBatch } from "@/lib/batches";
import { FINANCING_TYPE_LABELS } from "@/lib/financing-types";
import { isUuid } from "@/lib/uuid";

type ResultView = "all" | "review" | "errors" | "resolved";

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
  const view = resultView(filter);
  const jobs = batch.jobs.filter(
    (job) =>
      matchesView(job, view) &&
      (!filter.classification ||
        (job.analysis?.reviewed_classification ?? job.analysis?.classification) ===
          filter.classification) &&
      (!filter.type || job.financingType === filter.type),
  );
  const resolvedCount = batch.jobs.filter((job) => matchesView(job, "resolved")).length;
  const hasAdvancedFilters = Boolean(filter.classification || filter.type);

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-5">
      <Link className={batchButtonVariants({ size: "sm" })} href={`/batches?batch=${id}`}>
        Tornar a la llista de lots
      </Link>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Detall del lot
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {batch.selectedCount ? `Lot ${batch.batchNumber}` : "Lot buit"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {batch.jobs.length} {batch.jobs.length === 1 ? "registre" : "registres"} · {batch.reviewCount} per revisar ·{" "}
          {batch.errorCount} {batch.errorCount === 1 ? "error tècnic" : "errors tècnics"}
        </p>
        {batch.reviewCount > 0 && (
          <Link
            className={batchButtonVariants({ className: "mt-4" })}
            href={`/review?batch=${id}&state=pending`}
          >
            Revisar {batch.reviewCount} {batch.reviewCount === 1 ? "pendent" : "pendents"}
          </Link>
        )}
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

      <nav className="flex flex-wrap gap-2" aria-label="Filtrar registres del lot">
        <ResultViewLink id={id} current={view} value="all" label={`Tots (${batch.jobs.length})`} />
        <ResultViewLink id={id} current={view} value="review" label={`Per revisar (${batch.reviewCount})`} />
        <ResultViewLink id={id} current={view} value="errors" label={`Errors (${batch.errorCount})`} />
        <ResultViewLink id={id} current={view} value="resolved" label={`Revisats (${resolvedCount})`} />
      </nav>

      <details className="rounded-xl border p-4" open={hasAdvancedFilters}>
        <summary className="cursor-pointer text-sm font-semibold">Filtres avançats</summary>
        <form className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="view" value={view} />
          <select
            name="classification"
            aria-label="Classificació"
            defaultValue={filter.classification ?? ""}
            className="form-control sm:w-auto"
          >
            <option value="">Totes les classificacions</option>
            {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
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
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className={batchButtonVariants()} type="submit">Aplicar</button>
          {hasAdvancedFilters && (
            <Link className={batchButtonVariants()} href={`/batches/${id}/results?view=${view}`}>
              Netejar
            </Link>
          )}
        </form>
      </details>

      <p className="text-sm text-muted-foreground">
        Mostrant {jobs.length} de {batch.jobs.length} registres
      </p>

      <section className="space-y-4" aria-label="Resultats del lot">
        {jobs.map((job) => (
          <JobResult key={job.id} job={job} batchId={id} />
        ))}
        {!jobs.length && (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No hi ha registres en aquest grup.
          </p>
        )}
      </section>
    </main>
  );
}

function ResultViewLink({
  id,
  current,
  value,
  label,
}: {
  id: string;
  current: ResultView;
  value: ResultView;
  label: string;
}) {
  return (
    <Link
      href={`/batches/${id}/results?view=${value}`}
      className={batchButtonVariants({ size: "sm", selected: current === value })}
      aria-current={current === value ? "page" : undefined}
    >
      {label}
    </Link>
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

function resultView(filter: Record<string, string | undefined>): ResultView {
  if (["all", "review", "errors", "resolved"].includes(filter.view ?? "")) {
    return filter.view as ResultView;
  }
  if (filter.review === "needs_review") return "review";
  if (filter.review === "error") return "errors";
  if (["approved", "corrected", "rejected", "insufficient_evidence"].includes(filter.review ?? "")) {
    return "resolved";
  }
  return "all";
}

function matchesView(job: BatchJob, view: ResultView) {
  const state = jobState(job);
  if (view === "review") return state === "needs_review";
  if (view === "errors") return state === "error";
  if (view === "resolved") {
    return ["approved", "corrected", "rejected", "insufficient_evidence"].includes(state);
  }
  return true;
}
