import { CLASSIFICATION_LABELS } from './analysis-contract';
import type { SourceRecord } from './workbench-types';
export function reviewClassificationLabel(record: Pick<SourceRecord, 'analysis' | 'status'>): string {
  const classification = record.analysis?.reviewed_classification ?? record.analysis?.classification;
  if (classification) return CLASSIFICATION_LABELS[classification];
  if (['preparant', 'preparat', 'processant'].includes(record.status)) return 'Actualitzant classificació';
  if (record.status === 'error') return 'Classificació interrompuda';
  return 'Sense classificació normativa';
}
