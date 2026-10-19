import {currentReservation} from './human-resolution';
import type { SourceRecord } from './workbench-types';

export const decisionActorLabel=(actor?:string|null)=>actor?.startsWith('system:')?'Decisió automàtica':actor?'Decisió humana':'Decisió';

export function canReviewRecord(record: SourceRecord) {
  return !record.isHistorical && record.analysis?.reliability_status !== 'invalidated'
    && !!record.currentJobId
    && !!(record.analysis || record.matchingCandidates.length)
    && ['needs_review', 'approved', 'corrected', 'rejected', 'insufficient_evidence'].includes(record.currentJobStatus ?? '');
}

export function recordReviewLabel(record: SourceRecord) {
  if (record.isHistorical) return 'Execució històrica · només lectura';
  if (currentReservation(record)) return 'Acceptat amb reserves · fora dels totals definitius';
  if (record.reviewDecision) return `${decisionActorLabel(record.reviewActor)} registrada`;
  if (record.analysis?.reliability_status === 'invalidated') return 'Resultat no fiable pendent de reanàlisi';
  if (canReviewRecord(record)) return 'Pendent de decisió humana';
  if (record.operationProgress?.state === 'incident' || record.currentJobStatus === 'error') return 'Incidència tècnica · sense resultat disponible';
  return 'Anàlisi pendent · revisió encara no disponible';
}
