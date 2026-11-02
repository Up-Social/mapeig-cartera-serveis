import type {SourceRecord} from '@/lib/workbench-types';
import {DISCARD_REASON_LABELS} from '@/lib/review-contract';

/** Current decision only; historical reasons remain in the review history. */
export function HumanDecisionReason({record}:{record:Pick<SourceRecord,'reviewDecision'|'reviewReason'|'reviewHistory'>}){
 if(!record.reviewDecision)return null;
 const reasons=record.reviewHistory?.[0]?.reasons??[];
 return <div className="mt-3 rounded-lg border bg-muted/20 p-3 text-sm" aria-label="Motiu de la decisió humana">
  <p className="font-semibold">Motiu de la decisió humana</p>
  <p className="mt-1 whitespace-pre-wrap">{record.reviewReason?.trim()||'No consta una justificació escrita per a aquesta decisió.'}</p>
  {reasons.length>0&&<p className="mt-1">Motius registrats: {reasons.map(reason=>DISCARD_REASON_LABELS[reason]??reason).join(', ')}</p>}
 </div>;
}
