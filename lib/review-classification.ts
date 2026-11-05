import { CLASSIFICATION_LABELS,isRecipientReviewContainer } from './analysis-contract';
import type { SourceRecord } from './workbench-types';
import { isPendingProposal } from './proposal-review';
export function reviewClassificationLabel(record: Pick<SourceRecord, 'analysis' | 'status'>): string {
  if (record.analysis?.reliability_status === 'invalidated') return 'Resultat no fiable';
  if (record.status==='revisio'&&isRecipientReviewContainer(record.analysis)) return 'Revisió per unitat';
  const classification = record.analysis?.reviewed_classification ?? record.analysis?.classification;
  if (record.status==='revisio'&&!record.analysis?.reviewed_classification&&classification==='discarded'&&isPendingProposal(record.analysis?.rule_audit)) return 'Proposta de descart';
  if (classification) return CLASSIFICATION_LABELS[classification];
  if (['preparant', 'preparat', 'processant'].includes(record.status)) return 'Actualitzant classificació';
  if (record.status === 'error') return 'Classificació interrompuda';
  return 'Sense classificació normativa';
}
