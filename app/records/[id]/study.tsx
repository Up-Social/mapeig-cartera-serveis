"use client";
import {ConcertUnits} from "@/components/concert-units";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceRecord } from "@/lib/workbench-types";
import { submitRecordReview } from "@/lib/review-client";
import { reviewValidation, DISCARD_REASON_LABELS, type ReviewOutcome } from "@/lib/review-contract";
import { sourcePayloadFieldLabel, sourcePayloadValue } from "@/lib/source-payload-display";
import { sourceDocumentStatusLabel, sourceDocumentTypeLabel } from "@/lib/ui-labels";
import { AnalysisResult } from "@/components/analysis-result";
import { ReviewHistory } from "@/components/review-history";
import { DocumentProvenance } from "@/components/document-provenance";
import { classifyIssue, ISSUE_CATEGORY_LABELS, type IssueRecord } from "@/lib/issue-types";
import { canReviewRecord, recordReviewLabel } from "@/lib/record-review-state";
import { RecordStages, inferOperation } from "@/app/processing-workbench-v2";
import type { RecordOperation } from "@/lib/record-operation";

const options: { value: ReviewOutcome; label: string }[] = [
  { value: "select", label: "Aprovar el servei seleccionat" },
  { value: "reject", label: "Descartar" },
  { value: "outside", label: "Servei social fora de cartera" },
  { value: "insufficient", label: "Evidència insuficient" },
];
const decisionLabels: Record<NonNullable<SourceRecord["reviewDecision"]>, string> = {
  approved: "Servei aprovat",
  corrected: "Servei corregit i aprovat",
  rejected: "Cas descartat",
  insufficient_evidence: "Evidència insuficient",
};

type Service = { code: string; name: string; scope: string | null };
export function CaseStudy({ initialRecord, services, origin, next, cloudBlocked }: { initialRecord: SourceRecord; services: Service[]; origin: string; next: string | null; issue: IssueRecord | null; cloudBlocked: boolean }) {
  const [record, setRecord] = useState(initialRecord);
  const [outcome, setOutcome] = useState<ReviewOutcome | "">("");
  const [selection, setSelection] = useState(record.matchingCandidates[0] ? `candidate:${record.matchingCandidates[0].id}` : "");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<RecordOperation | undefined>(() => cloudBlocked && !initialRecord.operationProgress ? undefined : inferOperation(initialRecord));
  const startOperation = useCallback((_: string, current: RecordOperation) => setOperation(current), []);
  const finishOperation = useCallback(() => setOperation(undefined), []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const historical = !!record.isHistorical;
  const invalidated = record.analysis?.reliability_status === "invalidated";
  const canEdit = canReviewRecord(record);
  const issue = classifyIssue(record);
  const changed = !!outcome || !!notes || !!reasons.length || !!search;
  const rectification = !!record.reviewDecision || selection.startsWith("service:");
  const matches = useMemo(() => search.trim().length < 2 ? [] : services.filter(s => `${s.code} ${s.name}`.toLocaleLowerCase("ca").includes(search.toLocaleLowerCase("ca"))).slice(0, 12), [search, services]);

  useEffect(() => {
    if (!changed || busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [changed, busy]);

  useEffect(() => {
    if (!changed || busy) return;
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a[href]");
      if (!link || link.getAttribute("href")?.startsWith("#") || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (!window.confirm("Hi ha canvis sense desar. Vols sortir del cas i descartar-los?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [changed, busy]);

  async function save(advance = false) {
    if (!outcome || busy || !canEdit) return;
    const validation = reviewValidation(outcome, notes, reasons, rectification);
    if (validation) { setError(validation); return; }
    if (outcome === "select" && !selection) { setError("Selecciona un servei abans d'aprovar."); return; }
    if (record.reviewDecision && !window.confirm("Aquesta acció substituirà la decisió vigent. Vols continuar?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const [kind, id] = selection.split(":");
      const updated = await submitRecordReview(record.id, { expectedJobId: record.currentJobId ?? "", outcome, reasons: outcome === "reject" ? reasons : [], candidateId: outcome === "select" && kind === "candidate" ? id : undefined, serviceCode: outcome === "select" && kind === "service" ? id : undefined, notes });
      setRecord(updated); setOutcome(""); setNotes(""); setReasons([]); setSearch("");
      setMessage("Decisió desada correctament.");
      window.dispatchEvent(new Event("navigation-counts:refresh"));
      router.refresh();
      if (advance && next) router.push(next);
      if (advance && !next) setMessage("Decisió desada. No queden més casos en aquesta selecció.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No s'ha pogut desar la decisió."); }
    finally { setBusy(false); }
  }

  const originalFields = Object.entries(record.sourcePayload).filter(([key, value]) => !key.startsWith("Fórmula ·") && value !== null && value !== "" && !(typeof value === "string" && value.trim().startsWith("=")));
  return <div className="min-w-0 space-y-5">
    <section id="decisio" className="surface scroll-mt-32 p-5 sm:p-6"><div className="mx-auto max-w-5xl"><div className="text-center"><p className="page-eyebrow">Validació humana</p><h2 className="section-title mt-1">Decisió</h2></div><p className={`mx-auto mt-3 max-w-3xl rounded-md border p-3 text-center text-sm ${record.reviewDecision === "approved" || record.reviewDecision === "corrected" ? "status-success" : record.reviewDecision === "insufficient_evidence" || !record.reviewDecision ? "status-warning" : "status-neutral"}`}>{record.reviewDecision ? `Decisió registrada: ${decisionLabels[record.reviewDecision]}` : recordReviewLabel(record)}</p>
      {canEdit ? <div className="mt-5 space-y-4"><fieldset><legend className="mb-3 text-center text-sm font-semibold">Quina decisió vols registrar?</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{options.map(option => <label key={option.value} className={`flex min-h-12 items-start gap-2 rounded-lg border p-3 text-sm ${outcome === option.value ? "border-neutral-900 bg-neutral-50" : "border-border"}`}><input type="radio" className="mt-1" name="decision" value={option.value} checked={outcome === option.value} onChange={() => { setOutcome(option.value); setError(""); }} />{option.label}</label>)}</div></fieldset>
      {outcome === "select" && <div className="mx-auto max-w-3xl"><label className="text-sm font-semibold" htmlFor="service-select">Servei proposat</label><select id="service-select" className="form-control mt-1 !h-10" value={selection} onChange={event => setSelection(event.target.value)}><option value="">Selecciona un servei</option>{record.matchingCandidates.map(candidate => <option key={candidate.id} value={`candidate:${candidate.id}`}>{candidate.targetCode} · {candidate.targetName}</option>)}{selection.startsWith("service:") && <option value={selection}>{selection.slice(8)} · Servei del catàleg</option>}</select><input className="form-text mt-2" aria-label="Cercar un altre servei" placeholder="Cercar un altre servei…" value={search} onChange={event => setSearch(event.target.value)} />{matches.length > 0 && <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border">{matches.map(service => <li key={service.code}><button className="w-full px-2 py-2 text-left text-sm hover:bg-muted" type="button" onClick={() => { setSelection(`service:${service.code}`); setSearch(`${service.code} · ${service.name}`); }}>{service.code} · {service.name}</button></li>)}</ul>}</div>}
      {outcome === "reject" && <fieldset className="mx-auto max-w-3xl space-y-2"><legend className="text-sm font-semibold">Motius del descart</legend>{Object.entries(DISCARD_REASON_LABELS).map(([value, label]) => <label key={value} className="flex gap-2 text-sm"><input type="checkbox" checked={reasons.includes(value)} onChange={event => setReasons(event.target.checked ? [...reasons, value] : reasons.filter(reason => reason !== value))} />{label}</label>)}</fieldset>}
      {outcome && <div className="mx-auto max-w-3xl"><label className="text-sm font-semibold" htmlFor="review-notes">Justificació {outcome !== "select" || rectification ? "(obligatòria)" : "(opcional)"}</label><textarea id="review-notes" className="mt-1 w-full rounded-md border p-3 text-sm" rows={4} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></div>}
      <div className="flex flex-wrap justify-center gap-2"><button type="button" disabled={!outcome || busy} onClick={() => void save()} className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Desant…" : "Desar decisió"}</button><button type="button" disabled={!outcome || busy} onClick={() => void save(true)} className="rounded-md border px-4 py-3 text-sm font-semibold disabled:opacity-50">Desar i anar al següent</button></div></div> : <p className="mt-3 text-center text-sm">{historical ? "Resultat històric de només lectura." : invalidated ? "Resultat invalidat. Cal reanalitzar-lo abans de validar." : "La revisió encara no està disponible. Cal un resultat de l’anàlisi guardat i un treball revisable."}</p>}
      {message && <p role="status" className="status-success mx-auto mt-3 max-w-3xl rounded-md border p-3 text-sm">{message}</p>}{error && <p role="alert" className="status-error mx-auto mt-3 max-w-3xl rounded-md border p-3 text-sm">{error}</p>}
    </div></section>
    <div className="min-w-0 space-y-5">
      {!historical && <section className="surface p-4"><h3 className="text-sm font-semibold">Procés · {record.reviewDecision ? decisionLabels[record.reviewDecision] : record.analysis ? "Anàlisi completada · pendent de validació humana" : record.operationProgress?.state === "incident" ? recordReviewLabel(record) : record.operationProgress?.detail ?? record.status}</h3><RecordStages record={record} operation={operation} onRecordUpdate={setRecord} onOperationStart={startOperation} onOperationFinish={finishOperation} cloudBlocked={cloudBlocked} /></section>}
      {issue && <section role={issue.phase === "review" ? "status" : "alert"} className={`rounded-xl border p-5 ${issue.phase === "review" ? "status-warning" : "status-error"}`}><h2 className="text-lg font-semibold">Incidència · {ISSUE_CATEGORY_LABELS[issue.category]}</h2><p className="mt-2 max-w-[75ch] text-sm leading-6">{issue.message}</p>{issue.retryOperation && <button type="button" disabled={busy || cloudBlocked} className="mt-3 rounded-md border border-current px-3 py-2 text-sm" onClick={async () => { setBusy(true); setError(""); try { const response = await fetch(`/api/records/${record.id}/operation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: issue.retryOperation, expectedJobId: record.currentJobId }), signal: AbortSignal.timeout(20000) }); const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "No s'ha pogut iniciar el reintent."); setMessage("Reintent iniciat."); router.refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No s'ha pogut iniciar el reintent."); } finally { setBusy(false); } }}>Reintentar aquesta fase</button>}</section>}
      <section id="resultat" className="surface scroll-mt-32 p-5"><p className="page-eyebrow">Proposta automàtica</p><h2 className="section-title mt-1">Resultat de l’anàlisi</h2><p className="mt-1 text-sm text-muted-foreground">Una proposta requereix validació humana, encara que la confiança estimada sigui alta.</p><div className="mt-4"><AnalysisResult analysis={record.analysis} candidates={record.matchingCandidates} returnTo={`/records/${record.id}?${new URLSearchParams({from:origin,...(record.isHistorical&&record.currentJobId?{job:record.currentJobId}:{})})}`} /></div></section>
      <section id="evidencies" className="surface scroll-mt-32 p-5"><h2 className="section-title">Evidències i fonts oficials</h2><p className="mt-1 text-sm text-muted-foreground">Documents i fragments utilitzats per contrastar el cas.</p>{record.sourceDocuments.length ? <div className="mt-4 space-y-3">{record.sourceDocuments.map(doc => <article key={doc.id} className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{sourceDocumentTypeLabel(doc.documentType)}</strong><span className="text-sm">{sourceDocumentStatusLabel(doc.status)}</span></div><a className="mt-2 block break-all text-sm underline" href={`/api/documents/${doc.id}/open`} target="_blank" rel="noreferrer">Obrir document oficial</a><DocumentProvenance document={doc}/>{doc.qualityFlags.some(flag=>["corrupt_text","incomplete_extraction"].includes(flag))&&<p role="alert" className="status-error mt-3 p-3 text-sm">Text no fiable. Cal recuperar el document abans de tornar a analitzar aquest cas.</p>}<p className="mt-2 text-xs">{doc.textLength??0} caràcters · {doc.chunkCount} fragments · qualitat tècnica {doc.qualityScore==null?"pendent de comprovar":`${Math.round(doc.qualityScore*100)}%`}</p>{(doc.extractedText||doc.textPreview) && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{doc.extractedText||doc.textPreview}</p>}</article>)}</div> : <p className="mt-4 text-sm">Sense document oficial vinculat.</p>}</section>
      <section id="dades" className="surface scroll-mt-32 p-5"><p className="page-eyebrow">Extracció · dada contrastada</p><h2 className="section-title mt-1">Dades extretes de fonts oficials</h2>{record.externalEnrichment ? <><p className="mt-3 max-w-[75ch] text-sm leading-6">{record.externalEnrichment.summary}</p><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">{([["Entitat", record.externalEnrichment.providerName], ["NIF", record.externalEnrichment.providerNif], ["Mecanisme", record.externalEnrichment.mechanism], ["Població", record.externalEnrichment.targetPopulation], ["Import", record.externalEnrichment.amount]] as const).filter(([, value]) => value != null).map(([label, value]) => <div key={label}><dt className="font-semibold text-muted-foreground">{label}</dt><dd>{String(value)}</dd></div>)}</dl></> : <p className="mt-3 text-sm">No hi ha camps contrastats estructurats per a aquesta execució.</p>}
      <section className="mt-6 border-t pt-4"><h3 className="font-semibold">Dades originals ({originalFields.length} camps)</h3><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">{originalFields.map(([key, value]) => <div key={key}><dt className="font-semibold text-muted-foreground">{sourcePayloadFieldLabel(key)}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{sourcePayloadValue(key, value)}</dd></div>)}</dl></section></section>
      {record.financingType === "concert" && <ConcertUnits record={record} services={services} />}
      <section id="historial" className="surface scroll-mt-32 p-5"><h2 className="section-title">Historial i traçabilitat</h2><ReviewHistory record={record}/></section>
    </div>
  </div>;
}
