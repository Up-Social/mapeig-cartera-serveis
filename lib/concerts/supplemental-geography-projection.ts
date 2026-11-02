/** Read-only metadata from the database's current, fingerprint-checked view. */
export type ReviewedConcertGeography={
 economic_review_context:Array<string|number|null>|null;id:number;unit_id:string;municipality:string;county:string|null;province:string|null;
 source_url:string;source_sha256:string;source_captured_at:string;
 review_valid:boolean;review_fingerprint:string;review_id:string|null;decision:string|null;reviewer:string|null;rationale:string|null;reviewed_at:string|null;conflict:boolean;
};
type ReviewContext={version:number;status:string;source_fingerprint:string;expected_job_id:string;period_start:string|null;period_end:string|null;effective_at:string|null};
export function geographyEconomicContext(review?:ReviewContext){return review?[review.period_start,review.period_end,review.effective_at]:null;}
export function economicConcertTerritory(original:string|null,geography?:ReviewedConcertGeography|null,review?:ReviewContext){
 if(geography?.conflict)return {territory:null,applied:false,issue:'La ubicació complementària entra en conflicte amb el territori documental'};
 const confirmed=geography?.decision==='confirmed'&&geography.review_valid===true&&!!geography.review_id&&geography.conflict===false;
 if(confirmed){
  if(!original?.trim()&&JSON.stringify(geography.economic_review_context)!==JSON.stringify(geographyEconomicContext(review)))
   return {territory:null,applied:false,issue:'La revisió geogràfica no correspon al període o a la revisió econòmica vigent'};
  if(original?.trim()&&original.trim().toLocaleLowerCase('ca')!==geography.municipality.trim().toLocaleLowerCase('ca'))
   return {territory:null,applied:false,issue:'La ubicació complementària entra en conflicte amb el territori documental'};
  return {territory:original?.trim()||geography.municipality,applied:!original?.trim(),issue:null};
 }
 return {territory:original,applied:false,issue:null};
}
