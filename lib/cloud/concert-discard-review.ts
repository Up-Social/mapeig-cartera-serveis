import type {AnalysisOutput} from '../analysis-contract';
import {CloudFailure} from './errors';
import {assertNoUnsettledProviderReceipts} from './evidence-window';
import type {CloudDb} from './context';
import {concertNoAwardTitle,hasDefinitiveConcertAward} from '../concerts/no-award';
import {isDeepStrictEqual} from 'node:util';
import {readPages} from '../read-pages';

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

type ReconciliationReason='receipt_not_received'|'unsupported_receipt_phase'|'invalid_receipt_usage'|'usage_missing'|'usage_mismatch'|'reservation_missing'|'settlement_pending'|'unsupported_pricing'|'settlement_mismatch'|'orphan_reservation'|'orphan_usage';
const reconciliationFailure=(reason:ReconciliationReason)=>new CloudFailure('provider_reconciliation',5,{operation:'concert_discard_review',code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED',details:{reason}});
const queryFailure=()=>new CloudFailure('internal',5,{operation:'concert_discard_review',code:'RECEIPT_QUERY_FAILED'});
const usageKey=(key:string)=>{
 // These are the phases accepted by cloud_provider_usage. Matching records
 // its usage under analysis; the other provider phases keep their own name.
 const match=key.match(/^ai:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(enrichment|matching|positive-audit-v[1234]|contract-repair-v1|concert-role-review-v[12]|conveni)$/);
 return match?`usage:${match[1]}:${match[2]==='matching'?'analysis':match[2]}`:null;
};
// PostgreSQL numeric may arrive as a JSON number or decimal string. Compare
// exact decimal values (also handling JS scientific notation), never epsilon
// or Number(string), which could hide a mismatching settlement by rounding.
function canonicalCost(value:unknown):string|null{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 if(typeof value==='number'&&(!Number.isFinite(value)||value<0))return null;
 const text=String(value);
 if(text.length>128)return null;
 const match=text.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
 if(!match)return null;
 let exponent=Number(match[3]??0)-(match[2]?.length??0);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>128)return null;
 let digits=(match[1]+(match[2]??'')).replace(/^0+/,'');
 if(!digits)return '0';
 while(digits.endsWith('0')){digits=digits.slice(0,-1);exponent++;}
 return `${digits}e${exponent}`;
}
const usageObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** A received response is safe for a deterministic review only after both its
 * usage journal and budget settlement agree. Never repair accounting here.
 * This runs inside advance's existing exclusive task lease; legacy/no-budget
 * receipts stay pending until an explicit reconciliation proves their state. */
export async function assertNoProviderReceiptsForConcertReview(db:CloudDb,task:string):Promise<void>{
 await assertNoUnsettledProviderReceipts(db,task);
 let receipts:Array<{item_key:string;state:unknown;usage:unknown}>;
 let reservations:Array<{item_key:string;actual_usd:unknown;request_model:string|null;pricing_version:string|null}>;
 let usages:Array<{item_key:string;value:unknown}>;
 try{
  // Select only accounting metadata, never the provider's generated content.
  [receipts,reservations,usages]=await Promise.all([
   readPages((from,to)=>db.from('cloud_checkpoints').select('item_key,state:value->>state,usage:value->response->usage').eq('task_id',task).like('item_key','ai:%').order('item_key').range(from,to)),
   readPages((from,to)=>db.from('cloud_budget_reservations').select('item_key,actual_usd,request_model,pricing_version').eq('task_id',task).order('item_key').range(from,to)),
   readPages((from,to)=>db.from('cloud_checkpoints').select('item_key,value').eq('task_id',task).like('item_key','usage:%').order('item_key').range(from,to)),
  ]);
 }catch{throw queryFailure();}
 // Recheck after the paginated reads, including a state change since the first
 // uncertainty probe. Unknown provider outcome always has priority.
 if(receipts.some(receipt=>receipt.state==='sending'||receipt.state==='unknown'))throw new CloudFailure('provider_unknown');
 const budgetByKey=new Map(reservations.map(row=>[row.item_key,row]));
 const usageByKey=new Map(usages.map(row=>[row.item_key,row.value]));
 const receiptKeys=new Set(receipts.map(row=>row.item_key));
 const expectedUsageKeys=new Set(receipts.map(row=>usageKey(row.item_key)));
 if(reservations.some(row=>!receiptKeys.has(row.item_key)))throw reconciliationFailure('orphan_reservation');
 if(usages.some(row=>!expectedUsageKeys.has(row.item_key)))throw reconciliationFailure('orphan_usage');
 for(const receipt of receipts){
  const recordedKey=usageKey(receipt.item_key),usage=receipt.usage,budget=budgetByKey.get(receipt.item_key);
  if(receipt.state!=='received')throw reconciliationFailure('receipt_not_received');
  if(!recordedKey)throw reconciliationFailure('unsupported_receipt_phase');
  if(!usageObject(usage)||!Number.isSafeInteger(usage.input_tokens)||Number(usage.input_tokens)<0||!Number.isSafeInteger(usage.output_tokens)||Number(usage.output_tokens)<0)throw reconciliationFailure('invalid_receipt_usage');
  if(!usageByKey.has(recordedKey))throw reconciliationFailure('usage_missing');
  if(!isDeepStrictEqual(usageByKey.get(recordedKey),usage))throw reconciliationFailure('usage_mismatch');
  if(!budget)throw reconciliationFailure('reservation_missing');
  const actualCost=canonicalCost(budget.actual_usd);
  if(actualCost===null)throw reconciliationFailure('settlement_pending');
  if(budget.pricing_version!=='openai-standard-2026-10-15'||!budget.request_model)throw reconciliationFailure('unsupported_pricing');
  // Use the deployed pure pricing function used by cloud_budget_settle, so
  // this guard cannot silently diverge from the database's token/cache tariff.
  const expected=await db.rpc('ai_usage_cost_usd',{p_usage:usage,p_model:budget.request_model});
  if(expected.error)throw queryFailure();
  const expectedCost=canonicalCost(expected.data);
  if(expectedCost===null||expectedCost!==actualCost)throw reconciliationFailure('settlement_mismatch');
 }
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
