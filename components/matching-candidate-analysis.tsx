import type { MatchingCandidate } from "@/lib/workbench-types";
import { parseMatchingRationale } from "@/lib/matching-rationale";
import { portfolioStatusLabel } from "@/lib/ui-labels";

export function MatchingCandidateAnalysis({ candidate }: { candidate: MatchingCandidate }) {
  const rationale = candidate.rationale || "Aquesta correspondència no conserva una justificació textual.";
  const rationaleParts = parseMatchingRationale(rationale);

  return <article className={`rounded-xl border p-4 ${candidate.rank === 1 ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">Candidat {candidate.rank} · {candidate.targetCode}</p><p className="mt-1 text-sm font-semibold leading-5">{candidate.targetName}</p></div>
      <div className="shrink-0 sm:text-right"><p className="text-[13.2px] font-medium text-muted-foreground">Confiança estimada per la IA</p><p className="mt-0.5 text-lg font-semibold">{Math.round(candidate.score * 100)}%</p></div>
    </div>
    <section className="mt-4">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per què encaixa amb aquest servei</h5>
      {rationaleParts.length ? (
        <div className="mt-2 grid gap-1 text-sm leading-6 text-neutral-700">
          {rationaleParts.map((part) => (
            <div key={part.label} className="block">
              <strong className="font-semibold text-neutral-900">{part.label}:</strong>{" "}
              <span>{part.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-neutral-700">{rationale}</p>
      )}
    </section>
    {candidate.serviceDetail && <dl className="mt-3 grid gap-2 rounded-lg bg-white p-3 text-xs sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Àmbit</dt><dd className="mt-1">{candidate.serviceDetail.sectorScope ?? "—"}</dd></div><div><dt className="font-semibold text-muted-foreground">Estat al catàleg</dt><dd className="mt-1">{candidate.serviceDetail.portfolioStatus ? portfolioStatusLabel(candidate.serviceDetail.portfolioStatus) : "—"}</dd></div></dl>}
    <section className="mt-3 border-t pt-3"><h5 className="text-xs font-semibold text-neutral-600">Evidència de la correspondència</h5>{candidate.evidence.length ? <div className="mt-2 space-y-3">{candidate.evidence.map((item) => <div key={`${candidate.id}-${item.ordinal}`} className="rounded-lg bg-white p-3 text-xs leading-5"><p>{item.explanation ?? "La font oficial vinculada sustenta aquesta proposta, però encara no conserva una explicació específica."}</p><details className="mt-2"><summary className="cursor-pointer font-medium text-neutral-500">Veure font oficial</summary><blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-neutral-300 pl-3 text-neutral-600">{item.content}</blockquote></details></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">Aquest candidat no té una cita oficial vinculada.</p>}</section>
    <p className="mt-3 text-[13.2px] text-muted-foreground">Model: {candidate.model} · Estimació orientativa, no probabilitat calibrada ni decisió definitiva.</p>
  </article>;
}
