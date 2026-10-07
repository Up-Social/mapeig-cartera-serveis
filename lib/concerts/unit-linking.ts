/** Candidate-only matching. Never use e-Tauler or disposition number as a concert key. */
export type ConcertUnitForLink={
 id:string;recordId:string;recordTitle:string;recordExternalId:string;publishedAt:string;
 actType:string;resesCode:string|null;providerNif:string|null;serviceCode:string|null;
 territory:string|null;originReference:string|null;period:string|null;
};
export type UnitLinkCandidate={laterUnitId:string;earlierUnitId:string;method:'explicit_resolution'|'reses_nif';evidence:string};

function normalize(value:string|null){return (value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();}
function compatible(later:ConcertUnitForLink,earlier:ConcertUnitForLink){
 if(later.recordId===earlier.recordId||!later.publishedAt||!earlier.publishedAt||earlier.publishedAt>=later.publishedAt)return false;
 if(later.resesCode&&earlier.resesCode&&normalize(later.resesCode)!==normalize(earlier.resesCode))return false;
 if(later.serviceCode&&earlier.serviceCode&&normalize(later.serviceCode)!==normalize(earlier.serviceCode))return false;
 if(later.territory&&earlier.territory&&normalize(later.territory)!==normalize(earlier.territory))return false;
 // A cession deliberately changes the NIF, but still needs an explicit cited act.
 if(later.actType!=='cession'&&later.providerNif&&earlier.providerNif&&normalize(later.providerNif)!==normalize(earlier.providerNif))return false;
 return true;
}
export function proposeUnitLinks(units:ConcertUnitForLink[]):UnitLinkCandidate[]{
 const links:UnitLinkCandidate[]=[];
 for(const later of units){
  if(!['renewal','amendment','termination','cession','appeal','validation','modification'].includes(later.actType))continue;
  const candidates:Array<UnitLinkCandidate>=[];
  for(const earlier of units){
   if(!compatible(later,earlier))continue;
   const reference=normalize(later.originReference);
   const explicit=Boolean(reference&&reference.length>=6&&(normalize(earlier.recordTitle).includes(reference)||normalize(earlier.recordExternalId)===reference));
   const sameIdentity=Boolean(later.resesCode&&earlier.resesCode&&later.providerNif&&earlier.providerNif&&normalize(later.resesCode)===normalize(earlier.resesCode)&&normalize(later.providerNif)===normalize(earlier.providerNif));
   if(!explicit&&!sameIdentity)continue;
   if(later.actType==='cession'&&!explicit)continue;
   candidates.push({laterUnitId:later.id,earlierUnitId:earlier.id,method:explicit?'explicit_resolution':'reses_nif',
    evidence:explicit?`Referència citada: ${later.originReference}. RESES ${later.resesCode??'pendent'}, NIF ${later.providerNif??'pendent'}; contrast manual obligatori.`:
     `RESES ${later.resesCode} + NIF ${later.providerNif}${later.serviceCode?` + servei ${later.serviceCode}`:''}; contrast de període i document pendent.`});
  }
  // If several lines share the same identity, all alternatives remain reviewable.
  links.push(...candidates);
 }
 return links;
}
