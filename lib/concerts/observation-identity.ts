type PriorLine={id:string;unit_key:string;provider_nif:string|null;reses_code:string|null;observed_establishment_code?:string|null;page:number|null;evidence_quote:string|null};
const monetarySuffix=(quote:string)=>[...quote.matchAll(/-?[\d.]+,\d{2}\s*€/g)].slice(-2).map(m=>m[0].replace(/\s/g,'')).join('|');
/** Same RESES may have several tariff rows. Match documentary coordinates, never array order. */
export function identifyPriorObservation<T extends PriorLine>(previous:T[],claimed:Set<string>,row:{nif:string;resesCode:string;page:number;dispositionNumber:string;quote:string},unitKey:string):T|undefined {
 const same=previous.filter(u=>u.provider_nif===row.nif&&(u.reses_code??u.observed_establishment_code??u.unit_key.match(/:([SC]\d{5}):\d+$/)?.[1])===row.resesCode&&!claimed.has(u.id));
 const exact=same.filter(u=>u.unit_key===unitKey);
 let candidates=exact.length?exact:same.length===1?same:same.filter(u=>u.page===row.page&&u.evidence_quote?.includes(row.dispositionNumber));
 if(candidates.length>1){const suffix=monetarySuffix(row.quote);if(suffix)candidates=candidates.filter(u=>monetarySuffix(u.evidence_quote??'')===suffix);}
 if(candidates.length!==1&&same.length)throw Error('AMBIGUOUS_EXISTING_LINES');
 return candidates[0];
}
