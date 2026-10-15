import {extractProgramAnnex,type ProgramLine} from './program-annex';

type DisplayUnit={id:string;document_id:string|null;page:number|null;provider_nif:string|null;reses_code:string|null;provider_name:string|null;observed_provider_name:string|null;status:string;pipeline_job_id?:string|null;recovered_provider_name?:string|null;recovered_service_name?:string|null};
/** Display-only recovery from the same document and exact documentary identity.
 * Never changes observations, reviews, financial inputs or source fingerprints. */
export function recoverConcertDisplayNames<T extends DisplayUnit>(units:T[],documents:Array<{id:string;extracted_text:string|null}>):T[]{
 const parsed=new Map<string,ProgramLine[]>();
 return units.map(unit=>{
  if(unit.status!=='draft'||unit.pipeline_job_id||unit.provider_name||!unit.document_id)return unit;
  if(!parsed.has(unit.document_id))parsed.set(unit.document_id,extractProgramAnnex(documents.find(d=>d.id===unit.document_id)?.extracted_text??''));
  const matches=parsed.get(unit.document_id)!.filter(r=>r.nif===unit.provider_nif&&r.resesCode===unit.reses_code&&r.page===unit.page);
  if(matches.length!==1)return unit;
  const row=matches[0];
  return {...unit,recovered_provider_name:row.observedProviderName!==unit.observed_provider_name?row.observedProviderName:null,recovered_service_name:row.observedServiceName};
 });
}
