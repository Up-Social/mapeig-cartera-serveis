import type { SourceRecord } from './workbench-types';

export function canReviewRecord(record: SourceRecord) {
  return !record.isHistorical && record.analysis?.reliability_status !== 'invalidated'
    && !!record.currentJobId
    && !!(record.analysis || record.matchingCandidates.length)
    && ['needs_review', 'approved', 'corrected', 'rejected', 'insufficient_evidence'].includes(record.currentJobStatus ?? '');
}

export function recordReviewLabel(record: SourceRecord) {
  if (record.isHistorical) return 'Execució històrica · només lectura';
  if (record.reviewDecision) return 'Decisió humana registrada';
  if (record.analysis?.reliability_status === 'invalidated') return 'Resultat no fiable pendent de reanàlisi';
  if (canReviewRecord(record)) return 'Pendent de decisió humana';
  if (record.operationProgress?.state === 'incident' || record.currentJobStatus === 'error') return 'Incidència tècnica · sense resultat disponible';
  return 'Anàlisi pendent · revisió encara no disponible';
}
