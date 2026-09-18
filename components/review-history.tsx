import type {SourceRecord} from '@/lib/workbench-types';
import {CLASSIFICATION_LABELS,type Classification} from '@/lib/analysis-contract';
import {DISCARD_REASON_LABELS} from '@/lib/review-contract';
export function ReviewHistory({record}:{record:SourceRecord}){
 if(!record.reviewHistory?.length)return null;
 return <details className="mt-4 text-sm"><summary>Historial de decisions ({record.reviewHistory.length})</summary><ol className="mt-2 space-y-3">{record.reviewHistory.map(r=><li key={r.id} className="rounded border p-3"><p>{r.classification?CLASSIFICATION_LABELS[r.classification as Classification]:'Decisió històrica'} · {new Date(r.createdAt).toLocaleString('ca-ES')} · {r.jobId===record.currentJobId?'Treball vigent':'Històric'}</p><p>{r.reason??'Explicació no registrada'}</p>{(r.classification==='discarded'||r.decision==='rejected')&&<p>{r.reasons.length?r.reasons.map(s=>DISCARD_REASON_LABELS[s]??s).join(', '):'Motiu estructurat no registrat'}</p>}</li>)}</ol></details>;
}
