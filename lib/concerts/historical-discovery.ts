/** Pure validation of a historical e-Tauler scan. It never fetches, imports,
 * deletes or certifies that the upstream public history is exhaustive. */
export const HISTORICAL_CONCERT_WINDOW={from:'2020-01-01',to:'2023-12-31'} as const;
export const HISTORICAL_CONCERT_TERMS=['concert social','gestió delegada'] as const;
const PAGE_SIZE=25;
const PAGE_LIMIT=5000;

type Term=typeof HISTORICAL_CONCERT_TERMS[number];
export type HistoricalEdict={id_edicte:string;titol:string;descripcio:string;data_publicacio:string;[key:string]:unknown};
export type HistoricalPage={totalEdictes:number;totalPages:number;currentPage:number;edictes:HistoricalEdict[]};
export type HistoricalQuery={term:Term;pages:HistoricalPage[]};
export type HistoricalCandidate={sourceRecordId:string;publicationDate:string;matchedTerms:Term[];edict:HistoricalEdict};
export class HistoricalScanIncomplete extends Error{
 constructor(readonly code:string){super(code);this.name='HistoricalScanIncomplete';}
}
const fail=(code:string):never=>{throw new HistoricalScanIncomplete(code);};
const normalized=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

function publicationDate(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))return fail('INVALID_PUBLICATION_DATE');
 const date=value.slice(0,10);const parsed=new Date(`${date}T00:00:00.000Z`);
 if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return fail('INVALID_PUBLICATION_DATE');
 return date;
}
// Only core fields are compared across terms; provider array order or metadata
// can change without changing identity. A substantive disagreement fails the
// scan instead of silently choosing whichever response arrived last.
function fingerprint(e:HistoricalEdict){return JSON.stringify([e.id_edicte,e.titol,e.descripcio,e.data_publicacio]);}

export function validateHistoricalConcertScan(queries:readonly HistoricalQuery[]){
 if(!Array.isArray(queries)||queries.length!==HISTORICAL_CONCERT_TERMS.length)fail('QUERY_SET_INCOMPLETE');
 const byTerm=new Map<Term,HistoricalQuery>();
 for(const query of queries){
  if(!query||!HISTORICAL_CONCERT_TERMS.includes(query.term)||byTerm.has(query.term))fail('QUERY_SET_INCOMPLETE');
  byTerm.set(query.term,query);
 }
 const candidates=new Map<string,HistoricalCandidate>();
 const observed=new Map<string,string>();
 let pagesRead=0,rowsRead=0;
 for(const term of HISTORICAL_CONCERT_TERMS){
  const query=byTerm.get(term);
  if(!query||!Array.isArray(query.pages)||!query.pages.length)throw new HistoricalScanIncomplete('QUERY_SET_INCOMPLETE');
  const first=query.pages[0];
  if(!first||!Number.isSafeInteger(first.totalEdictes)||first.totalEdictes<0||!Number.isSafeInteger(first.totalPages)||first.totalPages<0||first.totalPages>PAGE_LIMIT)
   fail('PAGINATION_INVALID');
  const expectedPages=first.totalEdictes===0?1:Math.ceil(first.totalEdictes/PAGE_SIZE);
  if(expectedPages>PAGE_LIMIT||!(first.totalPages===expectedPages||(first.totalEdictes===0&&first.totalPages===0))||query.pages.length!==expectedPages)
   fail('PAGINATION_INCOMPLETE');
  const seen=new Set<string>();
  for(let index=0;index<expectedPages;index++){
   const page=query.pages[index];
   if(!page||page.currentPage!==index||page.totalEdictes!==first.totalEdictes||page.totalPages!==first.totalPages||!Array.isArray(page.edictes))fail('PAGINATION_CHANGED');
   const expectedRows=Math.min(PAGE_SIZE,Math.max(0,first.totalEdictes-index*PAGE_SIZE));
   if(page.edictes.length!==expectedRows)fail('PAGE_ROW_COUNT_CHANGED');
   pagesRead++;rowsRead+=page.edictes.length;
   for(const entry of page.edictes){
    if(!entry||typeof entry.id_edicte!=='string'||!/^\d+$/.test(entry.id_edicte)||typeof entry.titol!=='string'||typeof entry.descripcio!=='string')fail('INVALID_EDICT');
    if(seen.has(entry.id_edicte))fail('DUPLICATE_QUERY_EDICT');seen.add(entry.id_edicte);
    const prior=observed.get(entry.id_edicte),current=fingerprint(entry);
    if(prior!==undefined&&prior!==current)fail('EDICT_CHANGED_BETWEEN_QUERIES');
    observed.set(entry.id_edicte,current);
    if(!normalized(`${entry.titol} ${entry.descripcio}`).includes(normalized(term)))continue;
    const date=publicationDate(entry.data_publicacio);
    if(date<HISTORICAL_CONCERT_WINDOW.from||date>HISTORICAL_CONCERT_WINDOW.to)continue;
    const old=candidates.get(entry.id_edicte);
    if(old)old.matchedTerms.push(term);
    else candidates.set(entry.id_edicte,{sourceRecordId:`etauler:1:${entry.id_edicte}`,publicationDate:date,matchedTerms:[term],edict:structuredClone(entry)});
   }
  }
 }
 const records=[...candidates.values()].sort((a,b)=>a.publicationDate.localeCompare(b.publicationDate)||a.sourceRecordId.localeCompare(b.sourceRecordId));
 return {window:HISTORICAL_CONCERT_WINDOW,pagesRead,rowsRead,records,coverage:'pages_validated_not_source_exhaustive' as const};
}
