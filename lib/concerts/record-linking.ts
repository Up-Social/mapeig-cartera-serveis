export type ConcertPublication={id:string;title:string;source_record_id:string;source_payload:Record<string,unknown>};
export type ConcertLinkCandidate={laterRecordId:string;earlierRecordId:string;kind:'amendment'|'renewal'|'modification'|'termination'|'cession'|'appeal'|'validation'|'other';method:'explicit_resolution'|'expedient_territory';evidence:string};

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
export function publicationDate(row:ConcertPublication):string{
 const value=row.source_payload.data_publicacio;
 return typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}/.test(value)?value.slice(0,10):'';
}
export function concertTerritory(title:string):string|null{
 const value=normalize(title);
 for(const territory of ['barcelona','lleida','girona','tarragona','terres de l ebre'])if(value.includes(territory))return territory;
 return null;
}
export function concertExpedient(title:string):string|null{
 return title.toUpperCase().match(/\b\d{2}-\d{3,6}-(?:[A-Z]{2}(?:-[A-Z]{2})*)\b/)?.[0]??null;
}
export function concertActKind(row:ConcertPublication):ConcertLinkCandidate['kind']|null{
 const value=normalize(`${row.source_payload.event_type??''} ${row.title}`);
 if(/\b(esmena|rectificaci|correcci[oó])/.test(value))return 'amendment';
 if(/\bpr[oò]rroga/.test(value))return 'renewal';
 if(/\b(cessament|extinci[oó]|minoraci[oó])/.test(value))return 'termination';
 if(/\bcessi[oó]/.test(value))return 'cession';
 if(/\brecurs/.test(value))return 'appeal';
 if(/\bconvalidaci[oó]/.test(value))return 'validation';
 if(/\b(modificaci[oó]|ampliaci[oó])/.test(value))return 'modification';
 return null;
}

/** A title-only match is always a candidate; it never confirms a financial line. */
export function proposeRecordLinks(rows:ConcertPublication[]):ConcertLinkCandidate[]{
 const result:ConcertLinkCandidate[]=[];
 for(const later of rows){
  const kind=concertActKind(later),exp=concertExpedient(later.title);
  if(!kind)continue;
  const territory=concertTerritory(later.title),date=publicationDate(later);
  const alternatives=rows.filter(earlier=>{
   if(earlier.id===later.id)return false;
   const earlierTerritory=concertTerritory(earlier.title);
   if(territory&&earlierTerritory&&territory!==earlierTerritory)return false;
   const previousDate=publicationDate(earlier);
   if(!date||!previousDate||previousDate>=date)return false;
   const sharedExp=Boolean(exp&&concertExpedient(earlier.title)===exp);
   const reses=later.title.toUpperCase().match(/\bS\d{5}\b/)?.[0];
   const citedTitle=kind==='amendment'&&Boolean(reses&&earlier.title.toUpperCase().includes(reses)
    &&normalize(later.title).includes(normalize(earlier.title)));
   return sharedExp||citedTitle;
  });
  for(const earlier of alternatives){
   const sameExp=Boolean(exp&&concertExpedient(earlier.title)===exp);
   if(!sameExp){
    const reses=later.title.toUpperCase().match(/\bS\d{5}\b/)?.[0];
    result.push({laterRecordId:later.id,earlierRecordId:earlier.id,kind,method:'explicit_resolution',
     evidence:`El títol de l’esmena cita l’acte anterior i comparteix RESES ${reses}; cal contrastar el PDF, el NIF i el període afectat.`});
    continue;
   }
   const explicitNumber=later.title.match(/\b(?:DSO|DSI|TSF)\/\d{1,5}\/20\d{2}\b/i)?.[0];
   const explicitlyNamed=Boolean(explicitNumber&&earlier.title.toUpperCase().includes(explicitNumber.toUpperCase()));
   result.push({laterRecordId:later.id,earlierRecordId:earlier.id,kind,
    method:explicitlyNamed?'explicit_resolution':'expedient_territory',
    evidence:explicitlyNamed?`El títol cita ${explicitNumber}; expedient ${exp}. Cal contrastar PDF, RESES i NIF de cada línia.`:`Coincidència d’expedient ${exp}${territory?` i territori ${territory}`:''}; cal contrastar PDF, RESES i NIF de cada línia.`});
  }
 }
 return result;
}
