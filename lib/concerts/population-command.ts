import {isUuid} from '../uuid';

export type PopulationCommand={jobId:string;eventId:string;previousId:string|null;decision:'confirmed'|'unknown';value:string|null;documentId:string;revision:string;page:number|null;quote:string|null;reason:string;reviewer:string;documentHash:string;unitHash:string};
const hash=/^[a-f0-9]{64}$/;
function text(value:unknown,min:number,max:number):value is string{return typeof value==='string'&&value.trim().length>=min&&value.length<=max;}
/** Parse only the review command. SQL rechecks ownership, evidence and hashes. */
export function parsePopulationCommand(value:unknown):PopulationCommand {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Dades de població invàlides');
 const x=value as Record<string,unknown>;
 if(typeof x.jobId!=='string'||!isUuid(x.jobId)||typeof x.eventId!=='string'||!isUuid(x.eventId)||
  !(x.previousId===null||typeof x.previousId==='string'&&isUuid(x.previousId))||
  typeof x.documentId!=='string'||!isUuid(x.documentId)||typeof x.revision!=='string'||!/^([a-f0-9]{64}):(?:[0-9a-f-]{36})?$/.test(x.revision)||
  typeof x.documentHash!=='string'||!hash.test(x.documentHash)||typeof x.unitHash!=='string'||!hash.test(x.unitHash)||
  !text(x.reason,10,2000)||!text(x.reviewer,3,200)||!['confirmed','unknown'].includes(String(x.decision)))throw Error('Dades de població invàlides');
 if(x.decision==='unknown'){
  if(x.value!==null||x.page!==null||x.quote!==null)throw Error('La població pendent no pot contenir un valor o cita');
 }else if(!text(x.value,3,1000)||x.value!==x.value.trim()||!Number.isSafeInteger(x.page)||Number(x.page)<1||Number(x.page)>2000||!text(x.quote,12,1000)||/[\r\n]/.test(x.quote))throw Error('Cal el valor, la pàgina i una cita literal');
 return x as PopulationCommand;
}
