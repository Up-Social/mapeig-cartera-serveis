/** A display-only suggestion, never a classification or a reviewed code. */
export type NominalServiceEvidence={name:string;page:number;documentId:string};
type CatalogueService={code:string;name:string};
const normal=(text:string)=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function serviceName(text:string){return normal(text).replace(/^servei\s+/, '').replace(/^de\s+/, '').replace(/\s+pil$/, '').trim();}
export function proposeNominalConcertService(evidence:NominalServiceEvidence|null|undefined,catalogue:readonly CatalogueService[]){
 if(!evidence||!Number.isSafeInteger(evidence.page)||evidence.page<1||!evidence.documentId)return null;
 const label=serviceName(evidence.name);
 // Require a substantial name and an exact normalized match, not keyword overlap.
 if(label.split(' ').length<6)return null;
 const matches=catalogue.filter(item=>serviceName(item.name)===label&&!catalogue.some(child=>child.code.startsWith(`${item.code}.`)));
 if(matches.length!==1)return null;
 return {code:matches[0].code,name:matches[0].name,page:evidence.page,documentId:evidence.documentId};
}
