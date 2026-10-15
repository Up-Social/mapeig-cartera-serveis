import {prepareProgramObservations} from './program-observations';
import {declaredEconomicAnnexTotal,extractConcertAnnexRows,extractEconomicAnnexRows,extractProgram317Rows,type EconomicAnnexLine} from '../concerts/annex-extraction';
import {concertActKind,type ConcertPublication} from '../concerts/record-linking';
import {extractConcertChangeRows,operativeConcertChange} from '../concerts/change-extraction';
import {storeConcertLinkProposals} from '../concerts/link-discovery';
import {archiveUnitSource} from '../source-storage';
import {checkpoint,lease,readCheckpoint,type Context} from './context';
import {CloudFailure} from './errors';

type Job={id:string;source_record_id:string};
const BATCH_SIZE=5;

/** Each invocation stages at most five immutable source-backed drafts. */
export async function prepareConcertObservations(c:Context,job:Job):Promise<boolean>{
 const key=`concert-observations:${job.id}:v2`;
 if(await readCheckpoint(c,key))return true;
 const current=await c.db.from('source_records').select('id,title,source_record_id,source_payload,financing_type').eq('id',job.source_record_id).single();
 if(current.error)throw new CloudFailure('internal');
 if(current.data.financing_type!=='concert')return true;
 const documents=await c.db.from('source_documents').select('id,mime_type,status,extraction_partial,storage_sha256,extracted_text')
  .eq('source_record_id',job.source_record_id).eq('status','fetched').order('id');
 if(documents.error)throw new CloudFailure('internal');
 const all=documents.data.filter(d=>d.mime_type?.includes('pdf')&&!d.extraction_partial&&d.storage_sha256&&d.extracted_text);
 const seen=new Set<string>();
 const reconciliation:Array<{documentId:string;annex:number;rows:number;sumCents:number;declaredCents:number|null;reconciled:boolean}>=[];
 const publication=current.data as ConcertPublication;
 const actKind=concertActKind(publication);
 const titleActType=actKind&&actKind!=='other'?actKind:null;
 // Publication year is not the financed period. Only source-backed dates qualify.
 const period=null;
 const prior=await c.db.from('record_units').select('id,unit_key,storage_path,observed_service_code,amount,quantity_delta').eq('source_record_id',job.source_record_id).neq('unit_key','legacy');
 if(prior.error)throw new CloudFailure('internal');
 const existing=new Map((prior.data??[]).map(unit=>[unit.unit_key,unit]));
 let staged=0;
 for(const document of all){
  if(seen.has(document.storage_sha256!))continue;
  seen.add(document.storage_sha256!);
  const actType=titleActType??operativeConcertChange(document.extracted_text!)??'award';
  if(['modification','termination'].includes(actType)){
   const changes=extractConcertChangeRows(document.extracted_text!);
   for(const row of changes){
    const key=`official-change:${document.storage_sha256}:${row.row}`;
    const prior=existing.get(key);
    if(prior?.storage_path){
     if(prior.observed_service_code!==row.observedServiceCode||Math.round(Number(prior.amount)*100)!==row.amountCents||prior.quantity_delta!==row.quantityDelta)throw new CloudFailure('validation',5,{operation:'concert_change_drift',code:'CONCERT_SOURCE_CHANGED'});
     continue;
    }
    const registry=await c.db.from('reses_services').select('county,entities(nif,legal_name)').eq('registry_number',row.resesCode).maybeSingle();
    if(registry.error)throw new CloudFailure('internal');
    const entity=Array.isArray(registry.data?.entities)?registry.data.entities[0]:registry.data?.entities;
    const registeredProviderName=entity?.nif===row.nif?entity.legal_name:null;
    const saved=await c.db.rpc('cloud_stage_concert_change_line',{...lease(c),p_job:job.id,p_document:document.id,p_line:{...row,actType,registeredProviderName,territory:registry.data?.county??null}});
    if(saved.error)throw new CloudFailure('validation',5,{operation:'stage_concert_change',code:saved.error.code??'DATABASE_ERROR'});
    await archiveUnitSource(c.db,job.source_record_id,saved.data as string);
    staged++;if(staged>=BATCH_SIZE)return false;
   }
   // Changes retain their signed source amount, never become an award annex.
   continue;
  }
  const program=await prepareProgramObservations(c,job,{id:document.id,storage_sha256:document.storage_sha256!,extracted_text:document.extracted_text!},actType);
  if(program===false)return false;
  if(program===true)continue;
  let rows:EconomicAnnexLine[]=extractEconomicAnnexRows(document.extracted_text!);
  if(!rows.length&&!(prior.data??[]).some(unit=>!unit.unit_key.startsWith('official-annex:'))){
   const raw=document.extracted_text!.replace(/^## Pàgina \d+\s*$/gm,'\f').replace(/^\f\s*/,'');
   rows=extractConcertAnnexRows(raw).map(row=>({annex:0,page:row.page,row:row.row,nif:row.nif,
    observedProviderName:row.observedProviderName,observedServiceCode:row.serviceCode,resesCode:row.resesCode,
    municipality:row.territory,quantity:row.quantity,amountCents:row.amountCents,effectiveStart:row.effectiveStart,effectiveEnd:row.effectiveEnd,quote:row.quote} satisfies EconomicAnnexLine));
   if(!rows.length&&actType==='renewal')rows=extractProgram317Rows(raw).map(row=>({annex:0,page:row.page,row:row.row,
    nif:row.nif,observedProviderName:row.observedProviderName,observedServiceCode:null,
    observedServiceName:row.observedServiceName,resesCode:row.resesCode,municipality:null,
    quantity:null,amountCents:null,quote:row.quote} satisfies EconomicAnnexLine));
  }
  if(rows.length>1_000)throw new CloudFailure('validation');
  if(rows.length){
   const annex=rows[0].annex;
   const declared=annex===0?null:declaredEconomicAnnexTotal(document.extracted_text!,annex);
   const sum=rows.reduce((value,row)=>value+(row.amountCents??0),0);
   reconciliation.push({documentId:document.id,annex,rows:rows.length,sumCents:sum,declaredCents:declared,reconciled:declared!==null&&sum===declared});
  }
  const registry=new Map<string,{municipality:string|null;county:string|null;legalName:string|null}>();
  const codes=[...new Set(rows.map(row=>row.resesCode))];
  for(let offset=0;offset<codes.length;offset+=100){
   const found=await c.db.from('reses_services').select('registry_number,municipality,county,entities(nif,legal_name)')
    .in('registry_number',codes.slice(offset,offset+100));
   if(found.error)throw new CloudFailure('internal');
   for(const item of found.data){
    const entity=Array.isArray(item.entities)?item.entities[0]:item.entities;
    registry.set(item.registry_number,{municipality:item.municipality,county:item.county,
     legalName:entity?.nif?`${entity.nif}|${entity.legal_name}`:null});
   }
  }
  for(const row of rows){
   const unitKey=`official-annex:${document.storage_sha256}:${row.annex}:${row.row}`;
   const archived=existing.get(unitKey);
   if(archived?.storage_path){
    // A parser correction must not silently retain stale observations or overwrite a reviewed unit.
    if(archived.observed_service_code!==row.observedServiceCode)
     throw new CloudFailure('validation',5,{operation:'concert_observation_drift',code:'CONCERT_SOURCE_CODE_CHANGED'});
    continue;
   }
   const registered=registry.get(row.resesCode);
   const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
   const officialMunicipality=registered?.municipality&&row.municipality&&
    (normalized(registered.municipality).includes(normalized(row.municipality))||normalized(row.municipality).includes(normalized(registered.municipality)))
    ?registered.municipality:row.municipality;
   const registeredName=registered?.legalName?.startsWith(`${row.nif}|`)?registered.legalName.slice(row.nif.length+1):null;
   const line={...row,municipality:officialMunicipality,territory:registered?.county??null,registeredProviderName:registeredName,actType,period:row.effectiveStart&&row.effectiveEnd?`${row.effectiveStart}/${row.effectiveEnd}`:period};
   const saved=await c.db.rpc('cloud_stage_concert_annex_line',{...lease(c),p_job:job.id,p_document:document.id,p_line:line});
   if(saved.error)throw new CloudFailure('validation',5,{operation:'stage_concert_annex',code:saved.error.code??'DATABASE_ERROR'});
   try{await archiveUnitSource(c.db,job.source_record_id,saved.data as string);}catch{throw new CloudFailure('document');}
   staged++;
   if(staged>=BATCH_SIZE)return false;
  }
 }
 for(const report of reconciliation){
  const checked=await c.db.rpc('cloud_finalize_concert_annex',{...lease(c),p_job:job.id,p_document:report.documentId,
   p_annex:report.annex,p_rows:report.rows,p_sum_cents:report.sumCents,p_declared_cents:report.declaredCents});
  if(checked.error)throw new CloudFailure('validation',5,{operation:'reconcile_concert_annex',code:checked.error.code??'DATABASE_ERROR'});
  report.reconciled=checked.data===true;
 }
 await storeConcertLinkProposals(c.db,publication.id);
 await checkpoint(c,key,{complete:true,documents:[...seen],reconciliation});
 return true;
}
