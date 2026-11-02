import {storedAmountCents} from './annex-extraction';

/** The ordinal is not a stable identity when extraction coverage changes.
 * Always check the documentary anchor even for a previously reviewed unit. */
export function annexAnchorDrift(existing:{reses_code:string|null;page:number|null;evidence_quote:string|null},
 proposed:{resesCode:string|null;page:number;quote:string}):string[]{
 const normalize=(value:string|null)=>value?.replace(/\s+/g,' ').trim()??'';
 return [existing.reses_code!==proposed.resesCode?'reses_code':null,
  existing.page!==proposed.page?'page':null,
  normalize(existing.evidence_quote)!==normalize(proposed.quote)?'evidence':null].filter((value):value is string=>value!==null);
}

/** Detect changed parser facts on an unreviewed draft without mutating it. */
export function annexDraftDrift(existing:{observed_service_code:string|null;provider_nif:string|null;municipality:string|null;quantity:number|null;amount:number|string|null;observed_provider_name:string|null;reses_code:string|null;page:number|null;evidence_quote:string|null},
 proposed:{observedServiceCode:string|null;nif:string|null;municipality:string|null;quantity:number|null;amountCents:number|null;observedProviderName:string|null;resesCode:string|null;page:number;quote:string}):string[]{
 const normalized=(value:string|null)=>value?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')??null;
 const amount=storedAmountCents(existing.amount);
 const differences:string[]=[];
 if(existing.observed_service_code!==proposed.observedServiceCode)differences.push('service_code');
 if(existing.provider_nif!==proposed.nif)differences.push('nif');
 if(normalized(existing.observed_provider_name)!==normalized(proposed.observedProviderName))differences.push('provider_name');
 if(existing.reses_code!==proposed.resesCode)differences.push('reses_code');
 if(existing.page!==proposed.page)differences.push('page');
 if((existing.evidence_quote??'').replace(/\s+/g,' ').trim()!==proposed.quote.replace(/\s+/g,' ').trim())differences.push('evidence');
 if(normalized(existing.municipality)!==normalized(proposed.municipality))differences.push('municipality');
 if(existing.quantity!==proposed.quantity)differences.push('quantity');
 if((existing.amount!==null&&amount===null)||amount!==proposed.amountCents)differences.push('amount');
 return differences;
}
