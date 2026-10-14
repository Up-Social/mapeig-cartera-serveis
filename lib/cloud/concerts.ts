import {declaredEconomicAnnexTotal,extractConcertAnnexRows,extractEconomicAnnexRows,extractProgram317Rows,type EconomicAnnexLine} from '../concerts/annex-extraction';
import {concertActKind,proposeRecordLinks,publicationDate,type ConcertPublication} from '../concerts/record-linking';
import {proposeUnitLinks,type ConcertUnitForLink} from '../concerts/unit-linking';
import {archiveUnitSource} from '../source-storage';
import {checkpoint,lease,readCheckpoint,type Context} from './context';
import {CloudFailure} from './errors';

type Job={id:string;source_record_id:string};
const BATCH_SIZE=5;
const relationKind:Record<string,string>={modification:'delta',amendment:'amendment',renewal:'renewal',termination:'termination',cession:'cession',appeal:'appeal',validation:'validation'};

/** Each invocation stages at most five immutable source-backed drafts. */
export async function prepareConcertObservations(c:Context,job:Job):Promise<boolean>{
 const key=`concert-observations:${job.id}:v1`;
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
 const actType=actKind&&actKind!=='other'?actKind:'award';
 const period=publicationDate(publication).slice(0,4)||null;
 const prior=await c.db.from('record_units').select('id,unit_key,storage_path').eq('source_record_id',job.source_record_id).neq('unit_key','legacy');
 if(prior.error)throw new CloudFailure('internal');
 const existing=new Map((prior.data??[]).map(unit=>[unit.unit_key,unit]));
 let staged=0;
 for(const document of all){
  if(seen.has(document.storage_sha256!))continue;
  seen.add(document.storage_sha256!);
  let rows=extractEconomicAnnexRows(document.extracted_text!);
  if(!rows.length&&!(prior.data??[]).some(unit=>!unit.unit_key.startsWith('official-annex:'))){
   const raw=document.extracted_text!.replace(/^## Pàgina \d+\s*$/gm,'\f').replace(/^\f\s*/,'');
   rows=extractConcertAnnexRows(raw).map(row=>({annex:0,page:row.page,row:row.row,nif:row.nif,
    observedProviderName:row.observedProviderName,observedServiceCode:row.serviceCode,resesCode:row.resesCode,
    municipality:row.territory,quantity:row.quantity,amountCents:row.amountCents,quote:row.quote} satisfies EconomicAnnexLine));
   if(!rows.length&&actType==='renewal')rows=extractProgram317Rows(raw).map(row=>({annex:0,page:row.page,row:row.row,
    nif:row.nif,observedProviderName:row.observedProviderName,observedServiceCode:null,
    observedServiceName:row.observedServiceName,resesCode:row.resesCode,municipality:null,
    quantity:1,amountCents:0,quote:row.quote} satisfies EconomicAnnexLine));
  }
  if(rows.length>1_000)throw new CloudFailure('validation');
  if(rows.length){
   const annex=rows[0].annex;
   const declared=annex===0?null:declaredEconomicAnnexTotal(document.extracted_text!,annex);
   const sum=rows.reduce((value,row)=>value+row.amountCents,0);
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
   if(existing.get(unitKey)?.storage_path)continue;
   const registered=registry.get(row.resesCode);
   const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
   const officialMunicipality=registered?.municipality&&row.municipality&&
    (normalized(registered.municipality).includes(normalized(row.municipality))||normalized(row.municipality).includes(normalized(registered.municipality)))
    ?registered.municipality:row.municipality;
   const registeredName=registered?.legalName?.startsWith(`${row.nif}|`)?registered.legalName.slice(row.nif.length+1):null;
   const line={...row,municipality:officialMunicipality,territory:registered?.county??null,registeredProviderName:registeredName,actType,period};
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
 await proposeConcertLinks(c,publication);
 await checkpoint(c,key,{complete:true,documents:[...seen],reconciliation});
 return true;
}

async function proposeConcertLinks(c:Context,current:ConcertPublication){
 const publications:ConcertPublication[]=[];
 for(let offset=0;;offset+=500){
  const page=await c.db.from('source_records').select('id,title,source_record_id,source_payload').eq('financing_type','concert').order('id').range(offset,offset+499);
  if(page.error)throw new CloudFailure('internal');
  publications.push(...page.data as ConcertPublication[]);if(page.data.length<500)break;
 }
 const candidates=proposeRecordLinks(publications).filter(link=>link.laterRecordId===current.id);
 if(!candidates.length)return;
 const recordRows=candidates.map(link=>({later_record_id:link.laterRecordId,earlier_record_id:link.earlierRecordId,link_kind:link.kind,
  matching_method:link.method,status:'candidate',evidence:link.evidence}));
 const inserted=await c.db.from('concert_record_links').upsert(recordRows,{onConflict:'later_record_id,earlier_record_id',ignoreDuplicates:true});
 if(inserted.error)throw new CloudFailure('internal');
 const recordById=new Map(publications.map(row=>[row.id,row]));
 const relevant=new Set([current.id,...candidates.map(link=>link.earlierRecordId)]);
 const units=[];
 for(const id of relevant){
  const result=await c.db.from('record_units').select('id,source_record_id,act_type,reses_code,provider_nif,service_code,observed_service_code,territory,origin_reference,period')
   .eq('source_record_id',id).neq('unit_key','legacy');
  if(result.error)throw new CloudFailure('internal');units.push(...result.data);
 }
 const forLink:ConcertUnitForLink[]=units.flatMap(unit=>{
  const publication=recordById.get(unit.source_record_id);
  return publication?[{id:unit.id,recordId:unit.source_record_id,recordTitle:publication.title,recordExternalId:publication.source_record_id,
   publishedAt:publicationDate(publication),actType:unit.act_type,resesCode:unit.reses_code,providerNif:unit.provider_nif,
   serviceCode:unit.service_code??unit.observed_service_code,territory:unit.territory,originReference:unit.origin_reference,period:unit.period}]:[];
 });
 const sourceByUnit=new Map(forLink.map(unit=>[unit.id,unit]));
 const links=proposeUnitLinks(forLink).filter(link=>sourceByUnit.get(link.laterUnitId)?.recordId===current.id);
 if(!links.length)return;
 const unitRows=links.map(link=>({later_unit_id:link.laterUnitId,earlier_unit_id:link.earlierUnitId,root_unit_id:link.earlierUnitId,
  relation_kind:relationKind[sourceByUnit.get(link.laterUnitId)!.actType],matching_method:link.method,status:'candidate',evidence:link.evidence}));
 const saved=await c.db.from('concert_unit_links').upsert(unitRows,{onConflict:'later_unit_id,earlier_unit_id',ignoreDuplicates:true});
 if(saved.error)throw new CloudFailure('internal');
}
