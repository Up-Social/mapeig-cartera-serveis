import type {ProvisionExcelRow} from './provision-excel';

// Private adapter for the unconnected SQL prototype.  Validation establishes
// the response shape, not that the supplied fingerprint or bytes are genuine.
type Obj=Record<string,unknown>;
type BatchExportSnapshot={run:{id:string;batch_number:number;status:string};fingerprint:string;recordIds:string[];rows:ProvisionExcelRow[];reviewWarnings:string[]};
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const list=(v:unknown):unknown[]=>{if(!Array.isArray(v))throw Error('Captura d’exportació invàlida');return v;};
function nullableText(v:unknown):string|null {if(v===null||typeof v==='string')return v;throw Error('Camp d’exportació invàlid');}
function requiredText(v:unknown):string {if(typeof v==='string')return v;throw Error('Camp d’exportació invàlid');}
function serviceName(v:unknown):string|null {
 if(v===null)return null;
 if(!object(v)||typeof v.service_name!=='string')throw Error('Servei d’exportació invàlid');
 return v.service_name;
}

/** Null means a missing lot; no side effects and no physical Excel verification. */
export function adaptBatchExportSnapshot(input:unknown):BatchExportSnapshot|null {
 if(!object(input)||!object(input.body)||typeof input.fingerprint!=='string'||!/^batch-export-v1:[a-f0-9]{64}$/.test(input.fingerprint)||input.body.schema_version!==1)
  throw Error('Captura d’exportació invàlida');
 const b=input.body,jobs=list(b.jobs),records=list(b.record_ids),provisions=list(b.provisions),pending=list(b.pending_units);
 if(b.run===null){if(jobs.length||records.length||provisions.length||pending.length)throw Error('Captura de lot inexistent inconsistent');return null;}
 if(!object(b.run)||!uuid(b.run.id)||!Number.isSafeInteger(b.run.batch_number)||typeof b.run.status!=='string')throw Error('Lot d’exportació invàlid');
 if(records.some(id=>!uuid(id))||new Set(records).size!==records.length)throw Error('Registres d’exportació invàlids');
 const recordIds=records as string[],recordSet=new Set(recordIds),jobIds=new Set<string>(),jobRecords=new Set<string>();
 for(const job of jobs){
  if(!object(job)||!uuid(job.id)||!uuid(job.source_record_id)||jobIds.has(job.id)||!recordSet.has(job.source_record_id))throw Error('Treballs d’exportació invàlids');
  jobIds.add(job.id);jobRecords.add(job.source_record_id);
 }
 if(jobRecords.size!==recordSet.size)throw Error('Abast del lot inconsistent');
 const counts=new Map<string,number>(),pendingIds=new Set<string>();
 for(const unit of pending){
  if(!object(unit)||!uuid(unit.id)||!uuid(unit.source_record_id)||pendingIds.has(unit.id)||!recordSet.has(unit.source_record_id))throw Error('Unitats pendents invàlides');
  pendingIds.add(unit.id);counts.set(unit.source_record_id,(counts.get(unit.source_record_id)??0)+1);
 }
 const ids=new Set<string>();
 const rows=provisions.map((p):ProvisionExcelRow&{id:string}=>{
  if(!object(p)||!uuid(p.id)||!uuid(p.source_record_id)||!uuid(p.unit_id)||ids.has(p.id)||!recordSet.has(p.source_record_id))throw Error('Provisió d’exportació invàlida');
  ids.add(p.id);
  if(p.amount!==null&&(typeof p.amount!=='number'||!Number.isFinite(p.amount)))throw Error('Import d’exportació invàlid');
  return {id:p.id,source_id:requiredText(p.source_id),unit_id:p.unit_id,centre:nullableText(p.centre),period:nullableText(p.period),
   act_type:nullableText(p.act_type),annex_reference:nullableText(p.annex_reference),call_url:nullableText(p.call_url),
   regulatory_basis_url:nullableText(p.regulatory_basis_url),provider_name:nullableText(p.provider_name),provider_nif:nullableText(p.provider_nif),
   mechanism:requiredText(p.mechanism),award_date:nullableText(p.award_date),amount:p.amount,
   contracting_body:nullableText(p.contracting_body),target_population:nullableText(p.target_population),
   source_reference:requiredText(p.source_reference),service_code:requiredText(p.service_code),
   service_name:serviceName(p.official_services)??serviceName(p.master_services)??'Servei no informat'};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const reviewWarnings=[...counts].sort(([a],[c])=>a.localeCompare(c)).map(([id,count])=>`Registro ${id}: ${count} líneas pendientes de revisión.`);
 return {run:{id:b.run.id,batch_number:b.run.batch_number as number,status:b.run.status},fingerprint:input.fingerprint,recordIds,rows,reviewWarnings};
}
