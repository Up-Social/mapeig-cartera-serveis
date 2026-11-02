import {validCitation,type Citation,type DocumentEvidence} from './contract';
import {groupLiteralCents} from './group-preparation';

/** Checks only that one unambiguous numeric literal occurs intact in a quote.
 * The surrounding text can still describe a maximum, a cost, another actor or
 * another period. Those relationships require separate human review. */
export function quoteHasAmountLiteral(quote:string,literal:string):boolean {
 if(typeof quote!=='string'||typeof literal!=='string'||groupLiteralCents(literal)===null)return false;
 const needle=literal.trim();let offset=0;
 while(offset<=quote.length){
  const pos=quote.indexOf(needle,offset);if(pos<0)return false;
  const before=pos===0?'':quote[pos-1],after=quote[pos+needle.length]??'';
  const left=quote.slice(0,pos),right=quote.slice(pos+needle.length);
  if(!/[\p{L}\p{N}.,+−-]/u.test(before)&&!/[\p{L}\p{N}.,%]/u.test(after)
   &&!/(?:\p{N}|[-+−])\s+$/u.test(left)&&!/^\s+\p{N}/u.test(right)
   &&!(/\(\s*$/u.test(left)&&/^\s*\)/u.test(right))
   &&!/(?:\p{N})\s*[-+−–—*/×÷xX=]\s*$/u.test(left)
   &&!/^\s*[-+−–—*/×÷xX=]\s*\p{N}/u.test(right))return true;
  offset=pos+1;
 }
 return false;
}

type LiteralCheck=
 |{status:'literal_verified_only';amountCents:number}
 |{status:'rejected';reason:'INVALID_AMOUNT'|'INVALID_DOCUMENT'|'STALE_REVISION'|'INVALID_PAGE_OR_QUOTE'|'LITERAL_NOT_FOUND'};

/** Pure precheck for a future economic review; never approval or proof of
 * physical Storage bytes. SQL must independently verify the same conditions
 * under locks and the reviewer must establish economic attribution. */
export function checkEconomicCitation(input:{citation:Citation;literal:string;amountCents:number;documents:DocumentEvidence[];documentRevisions:Record<string,string>}):LiteralCheck {
 const {citation,literal,amountCents,documents,documentRevisions}=input;
 if(!Number.isSafeInteger(amountCents)||amountCents<0||groupLiteralCents(literal)!==amountCents)return {status:'rejected',reason:'INVALID_AMOUNT'};
 if(!citation||!Array.isArray(documents)||!documentRevisions||typeof documentRevisions!=='object'||Array.isArray(documentRevisions))return {status:'rejected',reason:'INVALID_DOCUMENT'};
 const matches=documents.filter(document=>document&&typeof document==='object'&&document.id===citation.document_id);
 if(matches.length!==1||typeof matches[0].extracted_text!=='string'||!/^[0-9a-f]{64}$/.test(matches[0].storage_sha256))return {status:'rejected',reason:'INVALID_DOCUMENT'};
 const document=matches[0];
 if(documentRevisions[document.id]!==`${document.storage_sha256}:${document.active_extraction_id??''}`)return {status:'rejected',reason:'STALE_REVISION'};
 if(!validCitation(citation,[document]))return {status:'rejected',reason:'INVALID_PAGE_OR_QUOTE'};
 if(!quoteHasAmountLiteral(citation.quote,literal))return {status:'rejected',reason:'LITERAL_NOT_FOUND'};
 return {status:'literal_verified_only',amountCents};
}
