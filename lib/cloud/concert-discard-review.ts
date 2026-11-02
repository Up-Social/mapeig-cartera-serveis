import type {AnalysisOutput} from '../analysis-contract';
import {CloudFailure} from './errors';
import {assertNoUnsettledProviderReceipts} from './evidence-window';
import type {CloudDb} from './context';
import {concertNoAwardTitle,hasDefinitiveConcertAward} from '../concerts/no-award';

const note='No es pot descartar aquest concert automàticament: cal revisar l’acte i la cobertura de totes les fonts abans de decidir si existeix una adjudicació o un altre motiu d’exclusió.';
const proposalNote='El títol indica una proposta prèvia de concert. Es mostra com a provisional i queda pendent de contrastar el document i, si escau, la resolució definitiva; no acredita finançament nou.';
const spendingNote='El títol indica una autorització de despesa. Per si sola no acredita una adjudicació ni una provisió nova; cal contrastar l’acte i les altres fonts abans de decidir.';

/** A positive operative clause in any available document prevents the early
 * title-only path. This does not establish complete document coverage. */
export function concertTitleReview(title:string,chunks:ReadonlyArray<{source_document_id:string;content:string}>){
 const byDocument=new Map<string,string[]>();
 for(const chunk of chunks){const texts=byDocument.get(chunk.source_document_id)??[];texts.push(chunk.content);byDocument.set(chunk.source_document_id,texts);}
 if([...byDocument.values()].some(parts=>hasDefinitiveConcertAward(parts.join('\n'))))return null;
 return concertNoAwardTitle(title);
}

/** Conservative temporary fence. A received receipt can still hold a budget
 * reservation or unrecorded usage, including receipts for other jobs. */
export async function assertNoProviderReceiptsForConcertReview(db:CloudDb,task:string):Promise<void>{
 await assertNoUnsettledProviderReceipts(db,task);
 const existing=await db.from('cloud_checkpoints').select('item_key').eq('task_id',task).like('item_key','ai:%').limit(1);
 if(existing.error)throw new CloudFailure('internal',5,{operation:'concert_discard_review',code:'RECEIPT_QUERY_FAILED'});
 if(existing.data?.length)throw new CloudFailure('provider_reconciliation',5,{operation:'concert_discard_review',code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED',message:'Cal conciliar les respostes i les reserves abans de revisar el possible descart.'});
}

/** A model or role rule is not enough to establish a negative conclusion for
 * a Concert. Ordinals are contextual evidence to review, not proof of discard. */
export function reviewConcertDiscard<T extends AnalysisOutput & {rule_audit?:Record<string,unknown>}>(
 value:T,financingType:string,chunkCount:number,
):T {
 if(financingType!=='concert'||value.classification!=='discarded')return value;
 if(!Number.isInteger(chunkCount)||chunkCount<1)throw Error('Falta un fragment per a la revisió del concert');
 const ordinals=Array.isArray(value.evidence_ordinals)
  ?[...new Set(value.evidence_ordinals.filter(n=>Number.isInteger(n)&&n>0&&n<=chunkCount))]:[];
 const diagnostics=Array.isArray(value.rule_audit?.diagnostics)?value.rule_audit.diagnostics:[];
 const rule=value.rule_audit?.version==='concert-title-no-award-v1'?value.rule_audit?.rule:null;
 const message=rule==='proposal'?proposalNote:rule==='spending'?spendingNote:note;
 return {...value,classification:'insufficient_evidence',reasons:[],candidates:[],explanation:message,
  evidence_ordinals:ordinals.length?ordinals:[1],
  rule_audit:{...value.rule_audit,concert_discard_review:{original_classification:'discarded',
   original_reasons:Array.isArray(value.reasons)?value.reasons:[],context_only:true},
   diagnostics:[...diagnostics,{code:'concert_discard_requires_review',message,action:'match',rule:'concert_discard_review'}]}};
}
