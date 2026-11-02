"use client";
import {ConveniStudy} from '@/components/conveni-study';
import {HumanResolution} from '@/components/human-resolution';
import {currentReservation} from '@/lib/human-resolution';
import {SourceComparison} from '@/components/source-comparison';
import {extractedFieldDisplay} from '@/lib/source-comparison';
import {EvidenceDiagnostics} from "@/components/evidence-diagnostics";
import {DocumentViewer} from "@/components/document-viewer";
import {ConcertUnits} from "@/components/concert-units";
import {ConcertReprocess} from "@/components/concert-reprocess";
import {observedConcertReprocess,concertReprocessRequest,canRetryConcertReprocess,canClearRejectedConcertRequest,type ConcertReprocessPending} from '@/lib/concerts/reprocess-recovery';
import {useConcertReprocessPending} from '@/lib/concerts/reprocess-pending-client';
import {isUuid} from '@/lib/uuid';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceRecord } from "@/lib/workbench-types";
import { submitRecordReview } from "@/lib/review-client";
import { reviewOptions, reviewValidation, MANUAL_DISCARD_REASONS, type ReviewOutcome } from "@/lib/review-contract";
import { sourcePayloadFieldLabel, sourcePayloadValue } from "@/lib/source-payload-display";
import { sourceDocumentStatusLabel, sourceDocumentTypeLabel } from "@/lib/ui-labels";
import { AnalysisResult } from "@/components/analysis-result";
import {HumanDecisionReason} from "@/components/human-decision-reason";
import {concertDiscardProposal} from "@/lib/concerts/discard-proposal";
import {isConcertSpendingAuthorizationTitle} from "@/lib/concerts/act-assessment";
import {provisionalDocumentReport} from "@/lib/concerts/provisional-report";
import { UnverifiedCandidateObservations } from "@/components/unverified-candidate-observations";
import { CaseAtAGlance } from "@/components/case-at-a-glance";
import { ReviewHistory } from "@/components/review-history";
import { DocumentProvenance } from "@/components/document-provenance";
import { classifyIssue, ISSUE_CATEGORY_LABELS, type IssueRecord } from "@/lib/issue-types";
import { canReviewRecord, recordReviewLabel } from "@/lib/record-review-state";
import { RecordStages, inferOperation } from "@/app/processing-workbench-v2";
import {recordProcessStatusLabel,type RecordOperation} from "@/lib/record-operation";
import {recordDataStage} from "@/lib/record-stage-copy";
import type {ConcertDocumentaryFacts} from '@/lib/concerts/documentary-facts';
import {currentDocumentaryAuthority} from '@/lib/concerts/documentary-authority';


const decisionLabels: Record<NonNullable<SourceRecord["reviewDecision"]>, string> = {
  approved: "Servei aprovat",
  corrected: "Servei corregit i aprovat",
  rejected: "Cas descartat",
  insufficient_evidence: "Evidència insuficient",
};

type Service = { code: string; name: string; scope: string | null };
export function CaseStudy({ initialRecord, services, concertServices, origin, next, cloudBlocked, concertExportState }: { initialRecord: SourceRecord; services: Service[]; concertServices:Array<{code:string;name:string}>; origin: string; next: string | null; issue: IssueRecord | null; cloudBlocked: boolean; concertExportState: "ready" | "partial" | "pending" }) {
  const [record, setRecord] = useState(initialRecord);
  const [outcome, setOutcome] = useState<ReviewOutcome | "">("");
  const [selection, setSelection] = useState(record.matchingCandidates[0] ? `candidate:${record.matchingCandidates[0].id}` : "");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [operation, setOperation] = useState<RecordOperation | undefined>(() => cloudBlocked && !initialRecord.operationProgress ? undefined : inferOperation(initialRecord));
  const startOperation = useCallback((_: string, current: RecordOperation) => setOperation(current), []);
  const finishOperation = useCallback(() => {setOperation(undefined);router.refresh();}, [router]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reprocessMessage, setReprocessMessage] = useState("");
  const [reprocessError, setReprocessError] = useState("");
  const reprocessInFlight = useRef(false);
  const [concertConfirmation,setConcertConfirmation]=useState<string|null>(null);
  const concertConfirmationDialog=useRef<HTMLDialogElement|null>(null);
  const concertConfirmationResolver=useRef<((confirmed:boolean)=>void)|null>(null);
  const concertConfirmationOrigin=useRef<HTMLElement|null>(null);
  const [concertRecoveryChecking,setConcertRecoveryChecking]=useState(false);
  const [showDocumentText,setShowDocumentText]=useState(false);
  const [showOriginalFields,setShowOriginalFields]=useState(false);
  const [documentaryState,setDocumentaryState]=useState<{recordId:string;jobId:string|null;facts:ConcertDocumentaryFacts|null}|null>(null);
  const onDocumentaryFacts=useCallback((value:{recordId:string;jobId:string|null;facts:ConcertDocumentaryFacts|null})=>setDocumentaryState(value),[]);
  const documentaryFacts=documentaryState?.recordId===record.id&&documentaryState.jobId===(record.currentJobId??null)&&record.sourceDocuments.some(document=>document.id===documentaryState.facts?.documentId&&document.revision===documentaryState.facts.revision)?documentaryState.facts:null;
  const discardProposal=concertDiscardProposal(record);
  const provisionalReport=provisionalDocumentReport(record);
  const spendingAmountPending=record.financingType==='concert'&&isConcertSpendingAuthorizationTitle(record.title)&&record.externalEnrichment?.amount!=null;
  const displayEnrichment=provisionalReport&&record.externalEnrichment?{...record.externalEnrichment,amount:null,summary:`Proposta provisional amb ${provisionalReport.rows.length} serveis descrits a l’annex. Els imports per servei estan pendents de revisió i no acrediten una resolució definitiva.`}:spendingAmountPending&&record.externalEnrichment?{...record.externalEnrichment,amount:null}:record.externalEnrichment;
  const displayRecord=displayEnrichment&&record.externalEnrichment?{...record,externalEnrichment:displayEnrichment}:record;
  const independentAuthority=currentDocumentaryAuthority(record);
  const documentarySigner=documentaryFacts?.authority??independentAuthority?.authority??null;
  const comparisonRecord=documentaryFacts&&record.externalEnrichment?{...record,externalEnrichment:{...record.externalEnrichment,contractingBody:documentaryFacts.authority?.value??record.externalEnrichment.contractingBody}}:record;
  const historical = !!record.isHistorical;
  const isConcert = record.financingType === "concert";
  const {pending:concertPending,ready:concertRecoveryReady,error:concertStorageError,save:saveConcertPending}=useConcertReprocessPending(record.id,isConcert);
  const dataStage = recordDataStage(record.financingType);
  const invalidated = record.analysis?.reliability_status === "invalidated";
  const correctedCode=record.corrections?.find(c=>c.valid&&!c.unit_id&&c.field==='service_code')?.value;
  const canEdit = record.financingType!=='conveni'&&canReviewRecord(record)&&!currentReservation(record);
  const concertBulkReview=record.financingType==='concert'&&['concert-reconciled-annex-v1','concert-program-lines-v2'].includes(record.analysis?.rules_version??'');
  const issue = classifyIssue(record);
  const changed = !!outcome || !!notes || !!reasons.length || !!search;
  const reprocessState=useRef({record,busy,operation,cloudBlocked,concertRecoveryChecking,isConcert,historical,concertPending,concertRecoveryReady,changed});
  useEffect(()=>{reprocessState.current={record,busy,operation,cloudBlocked,concertRecoveryChecking,isConcert,historical,concertPending,concertRecoveryReady,changed};},[record,busy,operation,cloudBlocked,concertRecoveryChecking,isConcert,historical,concertPending,concertRecoveryReady,changed]);
  const finishConcertConfirmation=useCallback((confirmed:boolean)=>{
    const resolve=concertConfirmationResolver.current;
    if(!resolve)return;
    concertConfirmationResolver.current=null;
    concertConfirmationDialog.current?.close();
    setConcertConfirmation(null);
    concertConfirmationOrigin.current?.focus();
    resolve(confirmed);
  },[]);
  useEffect(()=>()=>{concertConfirmationResolver.current?.(false);concertConfirmationResolver.current=null;},[]);
  function confirmConcertReprocess(message:string):Promise<boolean>{
    if(concertConfirmationResolver.current)return Promise.resolve(false);
    concertConfirmationOrigin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    return new Promise(resolve=>{
      concertConfirmationResolver.current=resolve;setConcertConfirmation(message);
      try{if(!concertConfirmationDialog.current)throw Error('DIALOG_UNAVAILABLE');concertConfirmationDialog.current.showModal();}
      catch{finishConcertConfirmation(false);setReprocessError('No s’ha pogut obrir la confirmació. No s’ha iniciat cap procés.');}
    });
  }
  const rectification = !!record.reviewDecision || selection.startsWith("service:") || (!!correctedCode&&!selection);
  const matches = useMemo(() => search.trim().length < 2 ? [] : services.filter(s => `${s.code} ${s.name}`.toLocaleLowerCase("ca").includes(search.toLocaleLowerCase("ca"))).slice(0, 12), [search, services]);

  const updateRecord=useCallback((latest:SourceRecord)=>{
    setRecord(latest);
    if(!historical&&concertPending&&observedConcertReprocess(concertPending,latest)){
      try{saveConcertPending(null);setOperation(inferOperation(latest));}
      catch{setReprocessError('S’ha observat la nova execució, però no s’ha pogut actualitzar l’estat de la petició al navegador. Torna a comprovar-lo.');return false;}
    }
    return true;
  },[historical,concertPending,saveConcertPending]);

  async function checkConcertReprocess(){
    if(!concertPending||concertRecoveryChecking||reprocessInFlight.current)return;
    setConcertRecoveryChecking(true);
    try{
      const response=await fetch(`/api/records/${record.id}`,{cache:'no-store',signal:AbortSignal.timeout(20_000)});
      const body=await response.json() as {record?:SourceRecord};
      if(!response.ok||!body.record||body.record.id!==record.id||!Array.isArray(body.record.sourceDocuments)||!Array.isArray(body.record.matchingCandidates))throw Error('STATUS_UNAVAILABLE');
      const latest=body.record;
      if(!updateRecord(latest))return;
      if(observedConcertReprocess(concertPending,latest)){
        setOperation(inferOperation(latest));
        setReprocessError('');
        setReprocessMessage('El cas ja té una execució posterior a la petició. Consulta’n el progrés i el resultat.');
      }else{
        setReprocessError('Encara no s’ha pogut confirmar una nova execució. Pots comprovar-ne l’estat o reenviar la mateixa petició amb la referència original, sense iniciar una segona anàlisi si ja s’ha registrat.');
      }
    }catch{
      setReprocessError('No s’ha pogut consultar l’estat del concert. La petició anterior continua pendent de confirmar i no s’ha repetit.');
    }finally{setConcertRecoveryChecking(false);}
  }

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
    if (outcome === "select" && !selection&&!correctedCode) { setError("Selecciona un servei abans d'aprovar."); return; }
    if (outcome === "select" && concertBulkReview) { setError("Aquest concert es valida amb totes les línies a l’apartat de repartiment."); return; }
    if (record.reviewDecision && !window.confirm("Aquesta acció substituirà la decisió vigent. Vols continuar?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const [kind, id] = selection.split(":");
      const updated = await submitRecordReview(record.id, { expectedJobId: record.currentJobId ?? "", outcome, reasons: outcome === "reject" ? reasons : [], candidateId: outcome === "select" && kind === "candidate" ? id : undefined, serviceCode: outcome === "select" ? (kind === "service" ? id : !selection?correctedCode:undefined) : undefined, notes });
      setRecord(updated); setOutcome(""); setNotes(""); setReasons([]); setSearch("");
      setMessage("Decisió desada correctament.");
      window.dispatchEvent(new Event("navigation-counts:refresh"));
      router.refresh();
      if (advance && next) router.push(next);
      if (advance && !next) setMessage("Decisió desada. No queden més casos en aquesta selecció.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No s'ha pogut desar la decisió."); }
    finally { setBusy(false); }
  }

  async function reprocess(operationToRun: RecordOperation,ocrRecovery?:import('@/lib/ocr-recovery').OcrRecovery,concertRefresh=false,retryPending?:ConcertReprocessPending) {
    if(retryPending&&(!concertRefresh||retryPending!==concertPending||retryPending.recordId!==record.id||!canRetryConcertReprocess(retryPending)))return;
    if (busy || operation || cloudBlocked || reprocessInFlight.current || concertRecoveryChecking || (isConcert && (historical||inferOperation(record)||(concertPending&&!retryPending)||!concertRecoveryReady))) return;
    if(concertRefresh&&(!isConcert||operationToRun!=='process'))return;
    if (isConcert && operationToRun === 'process') {
      if (changed) {
        setReprocessError('Hi ha canvis de revisió sense desar. Desa’ls o descarta’ls abans de tornar a processar el concert.');
        return;
      }
      if (!await confirmConcertReprocess(retryPending?'Vols reenviar la mateixa petició pendent? Si ja es va registrar, no s’iniciarà una segona anàlisi. Si encara no es va registrar, s’iniciarà el reprocessament sol·licitat, que pot tenir cost d’IA i OCR.':'Vols tornar a cercar i processar aquest concert? Es repetirà la cerca, la descàrrega i l’extracció de les fonts, l’anàlisi de la resolució i la correspondència. Pot tenir cost d’IA i OCR. El resultat anterior queda a l’historial i la nova proposta requerirà revisió humana.')) return;
      // A DOM dialog is asynchronous. Do not send a request using state that
      // changed while the user was deciding; the API still checks expectedJobId.
      const current=reprocessState.current;
      if(current.record.id!==record.id||current.record.currentJobId!==record.currentJobId||current.busy||current.operation||current.cloudBlocked||reprocessInFlight.current||current.concertRecoveryChecking||!current.isConcert||current.historical||inferOperation(current.record)||!current.concertRecoveryReady||current.changed||
        (retryPending?(retryPending!==current.concertPending||!canRetryConcertReprocess(retryPending)):!!current.concertPending)){
        setReprocessError('L’estat del cas ha canviat mentre confirmaves. Revisa’l abans de tornar a sol·licitar el reprocessament.');return;
      }
    }
    let pending:ConcertReprocessPending|null=null;
    if(concertRefresh){
      pending=retryPending??{recordId:record.id,expectedJobId:record.currentJobId??null};
      try{saveConcertPending(pending);}
      catch{setReprocessError('No s’ha pogut conservar l’estat de la petició al navegador. No s’ha iniciat el reprocesament.');return;}
    }
    reprocessInFlight.current = true;
    setBusy(true);
    setReprocessMessage("");
    setReprocessError("");
    try {
      const response = await fetch(`/api/records/${record.id}/operation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending?concertReprocessRequest(pending):{ operation: operationToRun, ...(ocrRecovery?{ocrRecovery}:{}), ...(record.currentJobId?{expectedJobId:record.currentJobId}:{}) }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json() as { ok?:boolean;error?: string;outcome?:string;code?:string;result?:{jobId?:string} };
      if(pending&&typeof payload.result?.jobId==='string'&&isUuid(payload.result.jobId)){
        pending={...pending,jobId:payload.result.jobId};
        saveConcertPending(pending);
      }
      if(pending&&(!response.ok||payload.ok===false)&&canClearRejectedConcertRequest(!!retryPending,payload.outcome)){
        saveConcertPending(null);
        pending=null;
      }
      if (!response.ok||payload.ok===false) throw new Error(payload.error ?? "No s'ha pogut iniciar el reintent.");
      setReprocessMessage(operationToRun === "process" || operationToRun === "ocr"
        ? isConcert ? "Reprocessament iniciat: fonts, anàlisi de la resolució i correspondència. El progrés s'actualitza a continuació." : "Reprocessament iniciat: fonts, contrast i correspondència. El progrés s'actualitza a continuació."
        : "Fase reiniciada. El progrés s'actualitza a continuació.");
      setOperation(operationToRun);
      window.dispatchEvent(new Event("navigation-counts:refresh"));
      router.refresh();
    } catch (cause) {
      setReprocessError(pending?`${cause instanceof Error?cause.message:'No s’ha rebut confirmació.'} La petició pot haver-se registrat. Comprova’n l’estat abans de repetir-la.`:cause instanceof Error ? cause.message : "No s'ha pogut iniciar el reintent.");
    } finally {
      reprocessInFlight.current = false;
      setBusy(false);
    }
    if(retryPending)await checkConcertReprocess();
  }

  const originalFields = Object.entries(record.sourcePayload).filter(([key, value]) => !key.startsWith("Fórmula ·") && value !== null && value !== "" && !(typeof value === "string" && value.trim().startsWith("=")));
  return <div className="min-w-0 space-y-5">
    <dialog ref={concertConfirmationDialog} aria-labelledby="concert-reprocess-confirm-title" aria-describedby="concert-reprocess-confirm-description" onCancel={event=>{event.preventDefault();finishConcertConfirmation(false);}} onClose={()=>finishConcertConfirmation(false)} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(95vw,36rem)] overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40">
      <h2 id="concert-reprocess-confirm-title" className="text-lg font-semibold">Confirmar el reprocessament del concert</h2>
      <p id="concert-reprocess-confirm-description" className="mt-3 text-sm leading-6">{concertConfirmation}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" autoFocus className="rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-2" onClick={()=>finishConcertConfirmation(false)}>Cancel·lar</button><button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-2" onClick={()=>finishConcertConfirmation(true)}>Confirmar i continuar</button></div>
    </dialog>
    <CaseAtAGlance record={displayRecord}/>{spendingAmountPending&&<p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">L’import extret automàticament no s’ha verificat com a import global de l’autorització. Contrasta les partides i els imports del resolc; la lectura preliminar es conserva a «Dades».</p>}{provisionalReport&&<p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Els imports de la proposta es mostren per servei a l’annex. La seva suma és orientativa i no constitueix finançament adjudicat.</p>}
    {isConcert&&<ConcertReprocess recordId={record.id} historical={historical} busy={busy} active={!!operation||!!inferOperation(record)} cloudBlocked={cloudBlocked} recoveryPending={!!concertPending} recoveryReady={concertRecoveryReady} recoveryChecking={concertRecoveryChecking} recoveryRetryable={canRetryConcertReprocess(concertPending)} message={reprocessMessage} error={reprocessError||concertStorageError} onReprocess={()=>void reprocess('process',undefined,true)} onCheckStatus={()=>void checkConcertReprocess()} onRetryPending={()=>{if(concertPending)void reprocess('process',undefined,true,concertPending);}}/>}
    {record.financingType==='conveni'&&<ConveniStudy record={record} services={services}/>}
    <HumanDecisionReason record={record}/>
    {record.financingType!=='conveni'&&<HumanResolution record={record} services={isConcert?concertServices:services} onSaved={setRecord}/>}
    {record.financingType!=='conveni'&&<section id="decisio" className="surface scroll-mt-32 p-5 sm:p-6"><div className="w-full min-w-0"><div className="text-center"><p className="page-eyebrow">Validació humana</p><h2 className="section-title mt-1">Decisió</h2></div><p className={`mt-3 w-full min-w-0 rounded-md border p-3 text-center text-sm ${record.reviewDecision === "approved" || record.reviewDecision === "corrected" ? "status-success" : record.reviewDecision === "insufficient_evidence" || !record.reviewDecision ? "status-warning" : "status-neutral"}`}>{currentReservation(record)?'Acceptat amb reserves · fora dels totals definitius':record.reviewDecision ? `Decisió registrada: ${decisionLabels[record.reviewDecision]}` : recordReviewLabel(record)}</p>
      {concertBulkReview&&<p className="mt-3 text-center text-sm">Per aprovar aquest concert, revisa les entitats, els serveis i els imports a <a className="underline" href="#unitats">Repartiment del concert</a>.</p>}
      {canEdit ? <div className="mt-5 space-y-4"><fieldset><legend className="mb-3 text-center text-sm font-semibold">Quina decisió vols registrar?</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{reviewOptions(record.financingType).filter(option=>!concertBulkReview||option.value!=='select').map(option => <label key={option.value} className={`flex min-h-12 items-start gap-2 rounded-lg border p-3 text-sm ${outcome === option.value ? "border-neutral-900 bg-neutral-50" : "border-border"}`}><input type="radio" className="mt-1" name="decision" value={option.value} checked={outcome === option.value} onChange={() => { setOutcome(option.value); setError(""); }} />{option.label}</label>)}</div></fieldset>
      {outcome === "select" && <div className="w-full min-w-0"><label className="text-sm font-semibold" htmlFor="service-select">Servei proposat</label><select id="service-select" className="form-control mt-1 !h-10" value={selection} onChange={event => setSelection(event.target.value)}><option value="">{correctedCode?`Correcció documentada: ${correctedCode}`:"Selecciona un servei"}</option>{record.matchingCandidates.map(candidate => <option key={candidate.id} value={`candidate:${candidate.id}`}>{candidate.targetCode} · {candidate.targetName}</option>)}{selection.startsWith("service:") && <option value={selection}>{selection.slice(8)} · Servei del catàleg</option>}</select><input className="form-text mt-2" aria-label="Cercar un altre servei" placeholder="Cercar un altre servei…" value={search} onChange={event => setSearch(event.target.value)} />{matches.length > 0 && <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border">{matches.map(service => <li key={service.code}><button className="w-full px-2 py-2 text-left text-sm hover:bg-muted" type="button" onClick={() => { setSelection(`service:${service.code}`); setSearch(`${service.code} · ${service.name}`); }}>{service.code} · {service.name}</button></li>)}</ul>}</div>}
      {outcome === "reject" && <fieldset className="w-full min-w-0 space-y-2"><legend className="text-sm font-semibold">Motius del descart</legend>{Object.entries(MANUAL_DISCARD_REASONS).map(([value, label]) => <label key={value} className="flex gap-2 text-sm"><input type="checkbox" checked={reasons.includes(value)} onChange={event => setReasons(event.target.checked ? [...reasons, value] : reasons.filter(reason => reason !== value))} />{label}</label>)}</fieldset>}
      {outcome && <div className="w-full min-w-0"><label className="text-sm font-semibold" htmlFor="review-notes">Justificació {outcome !== "select" || rectification ? "(obligatòria)" : "(opcional)"}</label><textarea id="review-notes" className="mt-1 w-full rounded-md border p-3 text-sm" rows={4} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></div>}
      <div className="flex flex-wrap justify-center gap-2"><button type="button" disabled={!outcome || busy} onClick={() => void save()} className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Desant…" : "Desar decisió"}</button><button type="button" disabled={!outcome || busy} onClick={() => void save(true)} className="rounded-md border px-4 py-3 text-sm font-semibold disabled:opacity-50">Desar i anar al següent</button></div></div> : <p className="mt-3 text-center text-sm">{historical ? "Resultat històric de només lectura." : currentReservation(record) ? "Reobre el cas a Acceptat amb reserves abans de registrar una nova validació." : invalidated ? "Resultat invalidat. Cal reanalitzar-lo abans de validar." : "La revisió encara no està disponible. Cal un resultat de l’anàlisi guardat i un treball revisable."}</p>}
      {message && <p role="status" className="status-success mt-3 w-full min-w-0 rounded-md border p-3 text-sm">{message}</p>}{error && <p role="alert" className="status-error mt-3 w-full min-w-0 rounded-md border p-3 text-sm">{error}</p>}
    </div></section>}
    <div className="min-w-0 space-y-5">
      {!historical && <section className="surface p-4"><h3 className="text-sm font-semibold">Procés · {record.reviewDecision ? decisionLabels[record.reviewDecision] : record.analysis ? "Anàlisi completada · pendent de validació humana" : record.operationProgress?.state === "incident" ? recordReviewLabel(record) : record.operationProgress?.detail ?? recordProcessStatusLabel(record)}</h3><RecordStages record={record} operation={operation} onRecordUpdate={updateRecord} onOperationStart={startOperation} onOperationFinish={finishOperation} cloudBlocked={cloudBlocked||(isConcert&&(!concertRecoveryReady||!!concertPending))} concertExportState={concertExportState} /></section>}
      {issue && <section role={issue.phase === "review" ? "status" : "alert"} className={`rounded-xl border p-5 ${issue.phase === "review" ? "status-warning" : "status-error"}`}><h2 className="text-lg font-semibold">Incidència · {ISSUE_CATEGORY_LABELS[issue.category]}</h2>{record.analysis?.classification!=="insufficient_evidence"&&<p className="mt-2 w-full text-sm leading-6">{issue.message}</p>}<div className="mt-3"><EvidenceDiagnostics record={record} onRetry={(op,recovery)=>void reprocess(op,recovery)} disabled={busy || !!operation || cloudBlocked || (isConcert && (historical||!concertRecoveryReady||!!concertPending))}/></div>{!isConcert && issue.retryOperation && <div className="mt-4 space-y-3"><p className="w-full text-sm leading-6">{isConcert ? "Torna a cercar i preparar els documents, analitza la resolució i proposa la correspondència. Conserva l’anàlisi anterior a l’historial; no aprova cap resultat. L’anàlisi i la correspondència poden tenir cost d’IA." : "Torna a cercar i preparar els documents, contrasta les dades i proposa la correspondència. Conserva l’anàlisi anterior a l’historial; no aprova cap resultat. El contrast i la correspondència poden tenir cost d’IA."}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !!operation || cloudBlocked} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void reprocess(issue.retryOperation === "ocr" ? "ocr" : "process")}>{busy ? "Iniciant…" : issue.retryOperation === "ocr" ? "Tornar a processar amb OCR" : "Tornar a processar tot el cas"}</button>{(["prepare", "enrich", "match"] as const).includes(issue.retryOperation as "prepare" | "enrich" | "match") && <button type="button" disabled={busy || !!operation || cloudBlocked} className="rounded-md border border-current px-4 py-2 text-sm disabled:opacity-50" onClick={() => void reprocess(issue.retryOperation!)}>{issue.retryOperation === "prepare" ? "Reintentar només la preparació" : issue.retryOperation === "enrich" ? dataStage.retry : "Reintentar només la correspondència"}</button>}</div><p className="text-xs">El processament complet repeteix totes les fases; no canvia automàticament el model ni la qualitat de l’OCR.</p>{cloudBlocked && <p className="text-xs">El processament no està disponible en aquest entorn de consulta.</p>}{reprocessMessage && <p role="status" className="text-sm">{reprocessMessage}</p>}{reprocessError && <p role="alert" className="text-sm">{reprocessError}</p>}</div>}</section>}
      {!isConcert && !historical && record.analysis && !record.reviewDecision && !issue?.retryOperation && <section className="surface p-4"><h3 className="text-sm font-semibold">Revisar l&apos;anàlisi automàtica</h3><p className="mt-2 w-full text-sm leading-6">Si el resultat no concorda amb l&apos;acte publicat, torna a preparar les fonts i a analitzar el cas. L&apos;anàlisi anterior queda a l&apos;historial; {isConcert ? "l’anàlisi de la resolució" : "el contrast"} pot tenir cost d&apos;IA i la nova proposta també requerirà validació humana.</p><button type="button" disabled={busy || !!operation || cloudBlocked} className="mt-3 rounded-md border border-current px-4 py-2 text-sm font-semibold disabled:opacity-50" onClick={() => void reprocess("process")}>{busy ? "Iniciant…" : "Tornar a processar tot el cas"}</button>{cloudBlocked && <p className="mt-2 text-xs">El processament no està disponible en aquest entorn de consulta.</p>}{reprocessMessage && <p role="status" className="mt-2 text-sm">{reprocessMessage}</p>}{reprocessError && <p role="alert" className="mt-2 text-sm">{reprocessError}</p>}</section>}
      <section id="resultat" className="surface scroll-mt-32 p-5"><p className="page-eyebrow">Proposta automàtica</p><h2 className="section-title mt-1">Resultat de l’anàlisi</h2><p className="mt-1 text-sm text-muted-foreground">Una proposta requereix validació humana, encara que la confiança estimada sigui alta.</p><div className="mt-4 space-y-4"><AnalysisResult discardProposal={discardProposal} reviewActor={record.reviewActor} analysis={record.analysis} candidates={record.matchingCandidates} returnTo={`/records/${record.id}?${new URLSearchParams({from:origin,...(record.isHistorical&&record.currentJobId?{job:record.currentJobId}:{})})}`} /><UnverifiedCandidateObservations observations={record.unverifiedCandidateObservations}/></div></section>
      <section id="evidencies" className="surface scroll-mt-32 p-5"><h2 className="section-title">Evidències i fonts oficials</h2><p className="mt-1 text-sm text-muted-foreground">Documents i fragments utilitzats per contrastar el cas.</p>{record.sourceDocuments.length ? <><button type="button" aria-expanded={showDocumentText} onClick={()=>setShowDocumentText(value=>!value)} className="mt-3 rounded-md border px-3 py-2 text-sm font-medium">{showDocumentText?'Amaga el text complet':'Mostra el text complet dels documents'}</button><div className="mt-4 space-y-3">{record.sourceDocuments.map(doc => <article key={doc.id} className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{sourceDocumentTypeLabel(doc.documentType)}</strong><span className="text-sm">{sourceDocumentStatusLabel(doc.status)}</span></div><a className="mt-2 block break-all text-sm underline" href={`/api/documents/${doc.id}/open`} target="_blank" rel="noreferrer">{doc.archived?'Obrir còpia arxivada':doc.status==='fetched'?'Comprovar i arxivar l’original':'Obrir document oficial'}</a>{doc.status==='fetched'&&doc.archived===false&&<p role="alert" className="status-error mt-3 p-3 text-sm">El text es va extreure anteriorment, però la còpia original encara no és a Storage. Cal verificar que la font actual coincideix amb l’original abans de donar-la per arxivada.</p>}<DocumentProvenance document={doc}/>{doc.mimeType?.includes("pdf")&&doc.archived&&<DocumentViewer url={`/api/documents/${doc.id}/open`}/>}{doc.qualityFlags.some(flag=>["corrupt_text","incomplete_extraction"].includes(flag))&&<p role="alert" className="status-error mt-3 p-3 text-sm">Text no fiable. Cal recuperar el document abans de tornar a analitzar aquest cas.</p>}<p className="mt-2 text-xs">{doc.textLength??0} caràcters · {doc.chunkCount} fragments · qualitat tècnica {doc.qualityScore==null?"pendent de comprovar":`${Math.round(doc.qualityScore*100)}%`}</p>{showDocumentText&&(doc.extractedText||doc.textPreview) && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{doc.extractedText||doc.textPreview}</p>}</article>)}</div></> : <p className="mt-4 text-sm">Sense document oficial vinculat.</p>}</section>
      <section id="dades" className="surface scroll-mt-32 p-5"><p className="page-eyebrow">Extracció · pendent de revisió</p><h2 className="section-title mt-1">{isConcert&&!documentaryFacts?'Extracció automàtica preliminar':'Dades extretes de fonts oficials'}</h2>{record.externalEnrichment ? <><p className="mt-3 w-full text-sm leading-6">{documentaryFacts?.summary??displayEnrichment?.summary??record.externalEnrichment.summary}</p>{isConcert&&<p className="mt-2 text-sm text-muted-foreground">{documentaryFacts?'Resum de les línies de l’annex contrastat. El títol general i l’extracció automàtica poden incloure serveis o poblacions diferents; es conserven a continuació per a la revisió.':'Extracció automàtica preliminar. Aquests camps encara no s’han contrastat amb el conjunt de línies de l’annex; el títol general pot incloure serveis no adjudicats.'}</p>}<dl className="card-fields mt-4 text-sm">{([["Entitat", record.externalEnrichment.providerName], ["NIF", record.externalEnrichment.providerNif], ["Mecanisme", record.externalEnrichment.mechanism], ["Data indicada", record.externalEnrichment.awardDate?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")], [documentarySigner?"Òrgan signant documentat":isConcert?"Òrgan (extracció preliminar)":"Òrgan indicat", documentarySigner?.value??record.externalEnrichment.contractingBody], [documentaryFacts?.populations?"Població indicada a les línies":isConcert?"Població (extracció preliminar)":"Població", documentaryFacts?.populations?.join(" · ")??record.externalEnrichment.targetPopulation], [record.financingType === "concert" ? "Import global del document" : "Import", displayEnrichment?.amount??null]] as const).map(([label, value]) => <div key={label}><dt className="font-semibold text-muted-foreground">{label}</dt><dd>{spendingAmountPending&&label==="Import global del document"?"No verificat com a import global · pendent de contrast":extractedFieldDisplay(record.financingType,label,value)}</dd>{record.financingType === "concert" && label === "Import global del document" && <p className="mt-1 text-xs text-muted-foreground">Aquest valor no està assignat a cada entitat. Consulta el repartiment de l’annex.</p>}</div>)}</dl>{documentaryFacts&&documentaryFacts.managerCodes.length>0&&<p className="mt-3 text-sm">Centre gestor indicat a l’annex: {documentaryFacts.managerCodes.map(cell=>`${cell.value} (pàgina ${cell.page})`).join('; ')}.</p>}{documentaryFacts?.period&&<div className="mt-4 rounded-lg border p-3 text-sm"><h3 className="font-semibold">Període indicat al document</h3><blockquote className="mt-2">«{documentaryFacts.period.quote}» · pàgina {documentaryFacts.period.page}</blockquote>{documentaryFacts.period.condition&&<p className="mt-2">Condició: «{documentaryFacts.period.condition}»</p>}<p className="mt-2">És el període de l’import màxim documental. La data efectiva de cada línia i qualsevol reducció posterior continuen pendents de revisió.</p></div>}{documentaryFacts&&<><details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Veure la procedència dels camps documentals</summary><ul className="mt-2 list-disc space-y-2 pl-5">{documentaryFacts.services.map(service=><li key={service.value}>{service.value} · pàgines {service.pages.join(', ')}</li>)}{documentaryFacts.authority&&<li>{documentaryFacts.authority.value} · bloc de signatura, pàgina {documentaryFacts.authority.page}</li>}</ul><p className="mt-2">La població prové de la tipologia impresa de cada línia; no substitueix la revisió individual ni confirma les condicions d’accés del catàleg.</p></details><details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Dades emmagatzemades per contrastar discrepàncies</summary><p className="mt-2">{record.externalEnrichment.summary}</p><p className="mt-2">Població emmagatzemada: {record.externalEnrichment.targetPopulation??'No identificada'}</p><p className="mt-2">Òrgan emmagatzemat: {record.externalEnrichment.contractingBody??'No identificat'}</p></details></>}</> : <p className="mt-3 text-sm">No hi ha camps contrastats estructurats per a aquesta execució.</p>}
      {spendingAmountPending&&record.externalEnrichment&&<details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Veure l’import preliminar per contrastar</summary><p className="mt-2">Import extret automàticament: {new Intl.NumberFormat("ca-ES",{style:"currency",currency:"EUR"}).format(record.externalEnrichment.amount!)}. La seva naturalesa i correspondència amb el resolc no estan verificades; no és un total acreditat ni finançament nou.</p></details>}
      {provisionalReport&&record.externalEnrichment&&<details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Veure la lectura preliminar anterior</summary><p className="mt-2">{record.externalEnrichment.provisionalOriginal?.summary??record.externalEnrichment.summary}</p><p>Import preliminar guardat: {(record.externalEnrichment.provisionalOriginal?record.externalEnrichment.provisionalOriginal.amount:record.externalEnrichment.amount)==null?'no identificat':new Intl.NumberFormat('ca-ES',{style:'currency',currency:'EUR'}).format((record.externalEnrichment.provisionalOriginal?record.externalEnrichment.provisionalOriginal.amount:record.externalEnrichment.amount)!)}. No s’ha acreditat com a total de l’annex; contrasta els imports per servei.</p></details>}
      {independentAuthority?.authority&&<p className="mt-3 text-sm">Òrgan signant documentat a la pàgina {independentAuthority.authority.page} de la resolució.</p>}{independentAuthority?.managerCodes.map(code=><p key={`${code.page}:${code.value}`} className="mt-2 text-sm">Centre gestor indicat a l’annex: {code.value} (pàgina {code.page}).</p>)}
      {record.financingType!=='conveni'&&<SourceComparison record={comparisonRecord}/>}<section className="mt-6 border-t pt-4"><h3 className="font-semibold">Dades originals ({originalFields.length} camps)</h3>{record.sourceFile&&<p className="mt-2 text-sm">{record.sourceFile} · {record.sourceSheet} · fila {record.sourceRow}{(record.importRunId||record.sourceStoragePath)&&<> · <a className="underline" href={`/api/records/${record.id}/import-source`}>Descarrega la font original arxivada</a></>}</p>}<button type="button" aria-expanded={showOriginalFields} onClick={()=>setShowOriginalFields(value=>!value)} className="mt-3 rounded-md border px-3 py-2 text-sm font-medium">{showOriginalFields?'Amaga les dades originals':'Mostra totes les dades originals'}</button>{showOriginalFields&&<dl className="card-fields mt-4 text-sm">{originalFields.map(([key, value]) => <div key={key}><dt className="font-semibold text-muted-foreground">{sourcePayloadFieldLabel(key)}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{sourcePayloadValue(key, value)}</dd></div>)}</dl>}</section></section>
      {record.financingType === "concert" && <ConcertUnits record={record} services={concertServices} onSaved={setRecord} onDocumentaryFacts={onDocumentaryFacts} />}
      <section id="historial" className="surface scroll-mt-32 p-5"><h2 className="section-title">Historial i traçabilitat</h2><ReviewHistory record={record}/></section>
    </div>
  </div>;
}
