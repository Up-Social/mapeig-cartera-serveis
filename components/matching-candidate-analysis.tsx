import type { MatchingCandidate } from "@/lib/workbench-types";

export function MatchingCandidateAnalysis({ candidate }: { candidate: MatchingCandidate }) {
  return <article className={`rounded-xl border p-4 ${candidate.rank === 1 ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">Candidat {candidate.rank} · {candidate.targetCode}</p><p className="mt-1 text-sm font-semibold leading-5">{candidate.targetName}</p></div>
      <div className="shrink-0 sm:text-right"><p className="text-[11px] font-medium text-muted-foreground">Confiança estimada per la IA</p><p className="mt-0.5 text-lg font-semibold">{Math.round(candidate.score * 100)}%</p></div>
    </div>
    <section className="mt-4"><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Justificació de la IA · per què té aquest percentatge</h5><p className="mt-2 text-sm leading-6 text-neutral-700">{candidate.rationale || "Aquest matching no conserva una justificació textual."}</p></section>
    {candidate.serviceDetail && <dl className="mt-3 grid gap-2 rounded-lg bg-white p-3 text-xs sm:grid-cols-2"><div><dt className="font-semibold text-muted-foreground">Àmbit</dt><dd className="mt-1">{candidate.serviceDetail.sectorScope ?? "—"}</dd></div><div><dt className="font-semibold text-muted-foreground">Estat al catàleg</dt><dd className="mt-1">{candidate.serviceDetail.portfolioStatus ?? "—"}</dd></div></dl>}
    <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs font-semibold text-neutral-600">Evidència utilitzada ({candidate.evidence.length})</summary>{candidate.evidence.length ? <div className="mt-2 max-h-56 space-y-2 overflow-auto">{candidate.evidence.map((item) => <blockquote key={`${candidate.id}-${item.ordinal}`} className="border-l-2 border-neutral-300 pl-3 text-xs leading-5 text-neutral-600">Fragment {item.ordinal} · {item.content}</blockquote>)}</div> : <p className="mt-2 text-xs text-muted-foreground">Aquest matching no té fragments vinculats.</p>}</details>
    <p className="mt-3 text-[11px] text-muted-foreground">Model: {candidate.model} · Estimació orientativa, no probabilitat calibrada ni decisió definitiva.</p>
  </article>;
}
