import {safeAnnexSum,storedAmountCents} from './annex-extraction';

type Line={document_id?:string|null;unit_key:string;storage_sha256:string|null;evidence_quote:string|null;act_type:string;amount:number|string|null;observation?:{pendingRevision?:boolean}};
type Reconciliation={document_id:string;document_sha256:string;annex:number;row_count:number;sum_cents:number;reconciled:boolean};
type LineAmountSummary={count:number;totalCents:number|null;reason:'none'|'mixed'|'pending_revision'|'invalid'|null};

/** A presentation total is not a balance. Only add comparable award rows from
 * the same document, using exact cents. Separate documents and administrative
 * changes may describe the same funding at different points in time. */
export function concertLineAmountSummary(lines:readonly Line[],reports:readonly Reconciliation[],allowDocumentarySubtotal:boolean):LineAmountSummary {
 const withAmount=lines.filter(line=>line.amount!==null&&line.amount!==undefined);
 if(!withAmount.length)return {count:0,totalCents:null,reason:'none'};
 if(lines.some(line=>line.observation?.pendingRevision===true))return {count:withAmount.length,totalCents:null,reason:'pending_revision'};
 const document=lines[0]?.document_id,sha=lines[0]?.storage_sha256;
 if(!allowDocumentarySubtotal||!document||!sha||!/^[a-f0-9]{64}$/.test(sha)||lines.some(line=>line.act_type!=='award'||line.document_id!==document||line.storage_sha256!==sha))return {count:withAmount.length,totalCents:null,reason:'mixed'};
 // A document can contain several annexes or repeated tables. Only the exact
 // rows of one complete reconciled official annex can form a subtotal.
 const matches=reports.filter(report=>report.reconciled&&report.document_id===document&&report.document_sha256===sha&&report.row_count===lines.length&&
  Number.isSafeInteger(report.annex)&&report.annex>=0&&lines.every(line=>new RegExp(`^official-annex:${sha}:${report.annex}:[1-9][0-9]*$`).test(line.unit_key)));
 const quotes=lines.map(line=>line.evidence_quote?.replace(/\s+/g,' ').trim()??'');
 if(matches.length!==1||new Set(lines.map(line=>line.unit_key)).size!==lines.length||quotes.some(quote=>!quote)||new Set(quotes).size!==lines.length||withAmount.length!==lines.length)return {count:withAmount.length,totalCents:null,reason:'mixed'};
 const amounts=withAmount.map(line=>storedAmountCents(line.amount));
 if(amounts.some(amount=>amount===null))return {count:withAmount.length,totalCents:null,reason:'invalid'};
 const totalCents=safeAnnexSum(amounts);
 if(totalCents===null)return {count:withAmount.length,totalCents:null,reason:'invalid'};
 if(totalCents!==matches[0].sum_cents)return {count:withAmount.length,totalCents:null,reason:'mixed'};
 return {count:withAmount.length,totalCents,reason:null};
}

/** Sprint 1: when the annex of a modification already gives the change, it is
 * recorded as such. Rows of one document that add up exactly to the maximum the
 * same resolution declares document that act's increment; it is not a balance,
 * real spending or new funding, and still needs human validation. */
export function concertModificationIncrement(lines:readonly Line[],maxima:ReadonlyArray<{documentId:string;amountCents:number}>):{count:number;totalCents:number}|null {
 if(!lines.length||lines.some(line=>line.act_type!=='modification'||line.observation?.pendingRevision===true||!line.evidence_quote?.trim()))return null;
 const document=lines[0].document_id;
 const maximum=maxima.filter(item=>item.documentId===document);
 if(!document||maximum.length!==1||lines.some(line=>line.document_id!==document)||new Set(lines.map(line=>line.unit_key)).size!==lines.length)return null;
 const totalCents=safeAnnexSum(lines.map(line=>line.amount===null||line.amount===undefined?null:storedAmountCents(line.amount)));
 return totalCents!==null&&totalCents===maximum[0].amountCents?{count:lines.length,totalCents}:null;
}
