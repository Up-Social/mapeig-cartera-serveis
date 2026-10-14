import {concertResolutionNumbers} from './record-linking';
/** Source references propose relationships. Only a human review confirms them. */
export type ConcertUnitForLink={
 id:string;recordId:string;recordTitle:string;recordExternalId:string;publishedAt:string;
 actType:string;resesCode:string|null;providerNif:string|null;serviceCode:string|null;
 territory:string|null;originReference:string|null;period:string|null;
 /** A literal passage about this line, never the entire PDF's unrelated references. */
 referenceText?:string|null;
};
export type UnitLinkCandidate={laterUnitId:string;earlierUnitId:string;method:'explicit_resolution'|'reses_nif';evidence:string};
const normalize=(value:string|null|undefined)=>(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9/]+/g,' ').trim();
const same=(a:string|null,b:string|null)=>Boolean(a&&b&&normalize(a)===normalize(b));
export function proposeUnitLinks(units:ConcertUnitForLink[]):UnitLinkCandidate[]{
 const links:UnitLinkCandidate[]=[];
 for(const later of units){
  if(!['renewal','amendment','termination','cession','appeal','validation','modification'].includes(later.actType))continue;
  const reference=normalize(later.originReference);
  const citedNumbers=concertResolutionNumbers(`${later.originReference??''} ${later.referenceText??''}`);
  const candidates:UnitLinkCandidate[]=[];
  for(const earlier of units){
   if(later.recordId===earlier.recordId||!later.publishedAt||!earlier.publishedAt||earlier.publishedAt>later.publishedAt)continue;
   if(later.resesCode&&earlier.resesCode&&!same(later.resesCode,earlier.resesCode))continue;
   if(later.serviceCode&&earlier.serviceCode&&!same(later.serviceCode,earlier.serviceCode))continue;
   if(later.territory&&earlier.territory&&!same(later.territory,earlier.territory))continue;
   const sameNif=same(later.providerNif,earlier.providerNif),sameReses=same(later.resesCode,earlier.resesCode);
   if(later.actType!=='cession'&&later.providerNif&&earlier.providerNif&&!sameNif)continue;
   const originalNumber=concertResolutionNumbers(earlier.recordTitle)[0];
   const explicit=Boolean((originalNumber&&citedNumbers.includes(originalNumber))||
    (reference.length>=6&&normalize(earlier.recordTitle).includes(reference)));
   // A publication ID alone cannot identify a legal predecessor. A cession can
   // instead prove continuity with both parties and the same establishment.
   const parties=normalize(later.referenceText);
   const cession=later.actType==='cession'&&sameReses&&!!earlier.providerNif&&!!later.providerNif&&
    parties.includes(normalize(earlier.providerNif))&&parties.includes(normalize(later.providerNif));
   if(later.actType==='cession'&&!explicit&&!cession)continue;
   if(!explicit&&!cession&&!(sameReses&&sameNif))continue;
   candidates.push({laterUnitId:later.id,earlierUnitId:earlier.id,method:explicit||cession?'explicit_resolution':'reses_nif',
    evidence:explicit?`Referència citada: ${later.originReference??citedNumbers.join(', ')}. RESES ${later.resesCode??'pendent'}, NIF ${later.providerNif??'pendent'}; contrast manual obligatori.`:
     cession?`Cessió: RESES ${later.resesCode}; el passatge cita NIF anterior ${earlier.providerNif} i nou ${later.providerNif}. Cal validar dates i continuïtat.`:
     `RESES ${later.resesCode} + NIF ${later.providerNif}${later.serviceCode?` + servei ${later.serviceCode}`:''}; contrast de període i document pendent.`});
  }
  // An explicit reference takes precedence; several referenced lines remain
  // alternatives. Never pick a mother just by the highest score or latest date.
  const explicit=candidates.filter(candidate=>candidate.method==='explicit_resolution');
  links.push(...(explicit.length?explicit:candidates));
 }
 return links;
}
