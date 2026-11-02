import {CloudFailure} from './errors';
import {hasCurrentTextCoverage} from '../pipeline/document-input';
export const ANALYSIS_EVIDENCE_LIMIT = 12;

type EvidenceChunk = {
  source_document_id: string;
  ordinal: number;
  content?: string;
};

/** Preserve an uncertain provider result and never reuse legacy receipts with
 * a changed or unverifiable evidence window. */
export function assertSafeEvidenceRecovery<T extends EvidenceChunk>(priorState:string|undefined,pinned:ReadonlyArray<T>|null,pool:ReadonlyArray<T>,hasCoverage:(chunk:T)=>boolean){
 if(priorState==='sending'||priorState==='unknown')throw new CloudFailure('provider_unknown');
 if((pinned?.some(chunk=>!hasCoverage(chunk)))||(priorState==='received'&&!pinned&&pool.some(chunk=>!hasCoverage(chunk))))
  throw new CloudFailure('validation',5,{operation:'evidence_recovery',code:'NEW_ANALYSIS_REQUIRED'});
}

/** A receipt without its original input hash cannot be interpreted under a new
 * request contract; an uncertain sending state always retains priority. */
export function assertSafeRequestVersion(previousHash:string|null,currentHash:string,receiptState:string|undefined,operation='conveni_input'){
 if(receiptState==='sending'||receiptState==='unknown')throw new CloudFailure('provider_unknown');
 if((previousHash&&previousHash!==currentHash)||(!previousHash&&receiptState))
  throw new CloudFailure('validation',5,{operation,code:'NEW_ANALYSIS_REQUIRED'});
}
export function assertSafeLegacyAuditReceipts(legacyStates:Array<string|undefined>,currentState:string|undefined){
 if(legacyStates.includes('sending')||legacyStates.includes('unknown')||currentState==='sending'||currentState==='unknown')throw new CloudFailure('provider_unknown');
 if(legacyStates.some(Boolean)&&!currentState)throw new CloudFailure('validation',5,{operation:'positive_audit_input',code:'NEW_ANALYSIS_REQUIRED'});
}

export function selectEvidenceWindow<T extends EvidenceChunk>(
  chunks: T[],
  limit = ANALYSIS_EVIDENCE_LIMIT,
  legacy = false,
  coverDistinctCodes = false,
) {
  if (limit <= 0) return [];
  if (chunks.length <= limit) return [...chunks];

  const documents = new Map<string, T[]>();
  for (const chunk of chunks) {
    const documentChunks = documents.get(chunk.source_document_id) ?? [];
    documentChunks.push(chunk);
    documents.set(chunk.source_document_id, documentChunks);
  }

  const selected = new Set<T>();
  if (!legacy) {
    // Reserve at most a third of the window for explicit codes and annex rows.
    // The remaining slots preserve document coverage and beginning/end context.
    const score = (chunk:T) => (chunk.content?.match(/\b1(?:\.\d+){2,6}\b/g)?.length ?? 0)*5 + (chunk.content?.match(/annex|adjudicat|concert|pròrroga|places|destinatar/gi)?.length ?? 0);
    const remaining=[...chunks];
    const coveredCodes=new Set<string>();
    const codes=(chunk:T)=>new Set(chunk.content?.match(/\b1(?:\.\d+){2,6}\b/g)??[]);
    for(let slot=0;slot<Math.floor(limit/3);slot++){
      const rank=(chunk:T)=>score(chunk)+(coverDistinctCodes?[...codes(chunk)].filter(code=>!coveredCodes.has(code)).length*10000:0);
      remaining.sort((a,b)=>rank(b)-rank(a));
      const chunk=remaining.shift();
      if(!chunk||score(chunk)<=0)break;
      selected.add(chunk);
      for(const code of codes(chunk))coveredCodes.add(code);
    }
  }
  let depth = 0;
  let added = true;

  while (selected.size < limit && added) {
    added = false;
    for (const documentChunks of documents.values()) {
      const head = documentChunks[depth];
      const tail = documentChunks[documentChunks.length - 1 - depth];

      for (const candidate of [head, tail]) {
        if (!candidate || selected.has(candidate)) continue;
        selected.add(candidate);
        added = true;
        if (selected.size === limit) break;
      }
      if (selected.size === limit) break;
    }
    depth += 1;
  }

  return chunks.filter((chunk) => selected.has(chunk));
}

/** A declared annex is a required source; a failed or partial annex cannot be
 * replaced by an unrelated readable PDF. Other document types can be alternate
 * portal or regulatory links and are not classified as required by this rule. */
export function unavailableDeclaredAnnexes<T extends {document_type:string|null;status:string|null;extraction_partial:boolean|null;text_length:number|null;extraction_method:string|null;extraction_coverage:unknown;mime_type:string|null;quality_flags:string[]|null}>(documents:ReadonlyArray<T>):T[]{
 return documents.filter(document=>document.document_type==='annex'&&(
  document.status!=='fetched'||document.extraction_partial===true||!document.text_length||document.text_length<1||
  !hasCurrentTextCoverage(document.extraction_method,document.extraction_coverage,document.mime_type)||
  document.quality_flags?.some(flag=>['corrupt_text','incomplete_extraction','empty_text','generic_portal','javascript_shell'].includes(flag))
 ));
}

/** Return only identifiers for diagnostics; never include document text or URL. */
export function missingDeclaredAnnexIds<T extends {id:string;document_type:string|null;status:string|null;extraction_partial:boolean|null;text_length:number|null;extraction_method:string|null;extraction_coverage:unknown;mime_type:string|null;quality_flags:string[]|null}>(documents:ReadonlyArray<T>,chunks:ReadonlyArray<{source_document_id:string}>):string[]{
 const unavailable=new Set(unavailableDeclaredAnnexes(documents).map(document=>document.id));
 const represented=new Set(chunks.map(chunk=>chunk.source_document_id));
 for(const document of documents)if(document.document_type==='annex'&&!represented.has(document.id))unavailable.add(document.id);
 return [...unavailable];
}

/** Do not complete a task or enter another deterministic/provider path while
 * any paid call in that task has an uncertain outcome. */
export async function assertNoUnsettledProviderReceipts(db:import('./context').CloudDb,task:string){
 const results=await Promise.all(['sending','unknown'].map(state=>db.from('cloud_checkpoints').select('item_key').eq('task_id',task).like('item_key','ai:%').contains('value',{state}).limit(1)));
 if(results.some(result=>result.error))throw new CloudFailure('internal',5,{operation:'provider_receipts',code:'RECEIPT_QUERY_FAILED'});
 if(results.some(result=>result.data?.length))throw new CloudFailure('provider_unknown');
}
