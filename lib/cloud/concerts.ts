import {prepareProgramObservations} from './program-observations';
import {storeConcertChangeGeography} from './concert-geography';
import {readPages} from '../read-pages';
import {declaredEconomicAnnexTotal,declaredGeneralAnnexTotal,declaredGeneralAnnexQuantity,extractColumnAnnexWithCoverage,extractConcertAnnexRows,extractEconomicAnnexRows,extractProgram317Rows,safeAnnexSum,storedAmountCents,type EconomicAnnexLine} from '../concerts/annex-extraction';
import {concertActKind,type ConcertPublication} from '../concerts/record-linking';
import {extractConcertChangeRows,operativeConcertChange} from '../concerts/change-extraction';
import {storeConcertLinkProposals} from '../concerts/link-discovery';
import {archiveUnitSource,createUnitSourceVerificationCache} from '../source-storage';
import {checkpoint,lease,readCheckpoint,type Context} from './context';
import {CloudFailure} from './errors';
import {hasCurrentConcertAward,hasMixedConcertFinancialActs} from '../concerts/no-award';
import {extractResolcAwards} from '../concerts/resolc-extraction';
import {annexAnchorDrift,annexDraftDrift} from '../concerts/observation-drift';
import {extractDiagnosticAnnex} from '../concerts/diagnostic-annex';
import {currentDocumentTextConsistent} from '../concerts/document-text-integrity';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';

type Job={id:string;source_record_id:string};
const BATCH_SIZE=5;

type AnnexReconciliation={documentId:string;annex:number;rows:number;sumCents:number;declaredCents:number|null;reconciled:boolean};
/** A PDF may contain several independent annexes. Never reconcile the sum or
 * count of all annexes against just the first annex's documented total. */
export function planConcertAnnexReconciliation(documentId:string,text:string,rows:EconomicAnnexLine[]):AnnexReconciliation[]{
 const groups=new Map<EconomicAnnexLine['annex'],EconomicAnnexLine[]>();
 for(const row of rows)groups.set(row.annex,[...(groups.get(row.annex)??[]),row]);
 return [...groups.entries()].map(([annex,group])=>{
  const total=annex===0?declaredGeneralAnnexTotal(text):null;
  const quantity=total?declaredGeneralAnnexQuantity(text,total.amountCents):null;
  const declared=annex===0?(quantity!==null&&group.every(row=>row.quantity!==null)&&group.reduce((sum,row)=>sum+(row.quantity??0),0)===quantity?total!.amountCents:null):declaredEconomicAnnexTotal(text,annex);
  const sum=safeAnnexSum(group.map(row=>row.amountCents));
  if(sum===null)throw new CloudFailure('validation',5,{operation:'concert_annex_reconciliation',code:'CONCERT_AMOUNT_RANGE',message:'La suma de l’annex supera la precisió segura o conté un import no vàlid. Cal revisar-la sense consolidar.'});
  return {documentId,annex,rows:group.length,sumCents:sum,declaredCents:declared,reconciled:group.every(row=>row.amountCents!==null)&&declared!==null&&sum===declared};
 });
}

/** Each invocation stages at most five immutable source-backed drafts. */
export async function prepareConcertObservations(c:Context,job:Job):Promise<boolean>{
 const key=`concert-observations:${job.id}:v2`;
 if(await readCheckpoint(c,key))return true;
 const current=await c.db.from('source_records').select('id,title,source_record_id,source_payload,financing_type').eq('id',job.source_record_id).single();
 if(current.error)throw new CloudFailure('internal');
 if(current.data.financing_type!=='concert')return true;
 const documents=await readPages((from,to)=>c.db.from('source_documents').select('id,mime_type,status,extraction_partial,storage_path,storage_sha256,active_extraction_id,extracted_text,extracted_text_hash,extraction_method,extraction_coverage,quality_flags')
  .eq('source_record_id',job.source_record_id).eq('status','fetched').order('id').range(from,to));
 const all=documents.filter(d=>d.mime_type?.includes('pdf')&&!d.extraction_partial&&d.storage_sha256&&d.extracted_text);
 const seen=new Set<string>();
 const reconciliation:AnnexReconciliation[]=[];
 const publication=current.data as ConcertPublication;
 const actKind=concertActKind(publication);
 const titleActType=actKind&&actKind!=='other'?actKind:null;
 // Publication year is not the financed period. Only source-backed dates qualify.
 const period=null;
 const prior=await readPages((from,to)=>c.db.from('record_units').select('id,unit_key,document_id,storage_path,storage_sha256,observed_service_code,provider_nif,observed_provider_name,reses_code,page,evidence_quote,municipality,quantity,status,reviewed_at,amount,quantity_delta').eq('source_record_id',job.source_record_id).neq('unit_key','legacy').order('id').range(from,to));
 const existing=new Map(prior.map(unit=>[unit.unit_key,unit]));
 let staged=0;
 const verifiedSources=createUnitSourceVerificationCache();
 for(const document of all){
  if(seen.has(document.storage_sha256!))continue;
  seen.add(document.storage_sha256!);
  if(hasMixedConcertFinancialActs(document.extracted_text!))throw new CloudFailure('validation',5,{operation:'concert_mixed_act',code:'CONCERT_MIXED_ACT_REVIEW',message:'La resolució combina una adjudicació amb un altre acte. Cal separar i revisar els efectes per línia abans de preparar imports.'});
  const actType=titleActType??operativeConcertChange(document.extracted_text!)??'award';
  if(['modification','termination'].includes(actType)){
   const changes=extractConcertChangeRows(document.extracted_text!);
   for(const row of changes){
    const key=`official-change:${document.storage_sha256}:${row.row}`;
    const prior=existing.get(key);
    if(prior){
     if(annexAnchorDrift(prior,row).length||prior.provider_nif!==row.nif||prior.observed_service_code!==row.observedServiceCode||storedAmountCents(prior.amount,true)!==row.amountCents||prior.quantity_delta!==row.quantityDelta)throw new CloudFailure('validation',5,{operation:'concert_change_drift',code:'CONCERT_SOURCE_CHANGED'});
     if(prior.storage_path){
      await storeConcertChangeGeography(c,job.id,prior.id,document,row);
      continue;
     }
    }
    const registry=await c.db.from('reses_services').select('county,entities(nif,legal_name)').eq('registry_number',row.resesCode).maybeSingle();
    if(registry.error)throw new CloudFailure('internal');
    const entity=Array.isArray(registry.data?.entities)?registry.data.entities[0]:registry.data?.entities;
    const registeredProviderName=entity?.nif===row.nif?entity.legal_name:null;
    const saved=await c.db.rpc('cloud_stage_concert_change_line',{...lease(c),p_job:job.id,p_document:document.id,p_line:{...row,actType,registeredProviderName,territory:registry.data?.county??null}});
    if(saved.error)throw new CloudFailure('validation',5,{operation:'stage_concert_change',code:saved.error.code??'DATABASE_ERROR'});
    await archiveUnitSource(c.db,job.source_record_id,saved.data as string,verifiedSources);
    await storeConcertChangeGeography(c,job.id,saved.data as string,document,row);
    staged++;if(staged>=BATCH_SIZE)return false;
   }
   // Changes retain their signed source amount, never become an award annex.
   continue;
  }
  const program=await prepareProgramObservations(c,job,{id:document.id,storage_sha256:document.storage_sha256!,extracted_text:document.extracted_text!},actType);
  if(program===false)return false;
  if(program===true)continue;
  let rows:EconomicAnnexLine[]=extractEconomicAnnexRows(document.extracted_text!);
  let columnCoverage:ReturnType<typeof extractColumnAnnexWithCoverage>|null=null;
  if(!rows.length&&actType==='award'&&currentDocumentTextConsistent(document)&&document.extraction_partial===false&&!document.quality_flags?.some((flag:string)=>['corrupt_text','incomplete_extraction'].includes(flag))&&hasCurrentTextCoverage(document.extraction_method,document.extraction_coverage,document.mime_type,document.extraction_partial)&&hasCurrentConcertAward(publication.title,document.extracted_text!)&&!prior.some(unit=>(unit.document_id===document.id||unit.document_id===null)&&!unit.unit_key.startsWith('official-annex:'))){
   rows=extractDiagnosticAnnex(document.extracted_text!);
  }
  if(!rows.length&&!prior.some(unit=>(unit.document_id===document.id||unit.document_id===null)&&!unit.unit_key.startsWith('official-annex:'))){
   const raw=document.extracted_text!.replace(/^## Pàgina \d+\s*$/gm,'\f').replace(/^\f\s*/,'');
   rows=extractConcertAnnexRows(raw).map(row=>({annex:0,page:row.page,row:row.row,nif:row.nif,
    observedProviderName:row.observedProviderName,observedServiceCode:row.serviceCode,resesCode:row.resesCode,
    municipality:row.territory,quantity:row.quantity,amountCents:row.amountCents,effectiveStart:row.effectiveStart,effectiveEnd:row.effectiveEnd,quote:row.quote} satisfies EconomicAnnexLine));
   if(!rows.length){columnCoverage=extractColumnAnnexWithCoverage(document.extracted_text!);rows=columnCoverage.rows;}
   if(!rows.length&&actType==='renewal'){columnCoverage=null;rows=extractProgram317Rows(raw).map(row=>({annex:0,page:row.page,row:row.row,
    nif:row.nif,observedProviderName:row.observedProviderName,observedServiceCode:null,
    observedServiceName:row.observedServiceName,resesCode:row.resesCode,municipality:null,
    quantity:null,amountCents:null,quote:row.quote} satisfies EconomicAnnexLine));}
  }
  if(!rows.length&&actType==='award'&&hasCurrentConcertAward(publication.title,document.extracted_text!)&&!prior.some(unit=>(unit.document_id===document.id||unit.document_id===null)&&!unit.unit_key.startsWith('official-resolc:'))){
   const observations=extractResolcAwards(document.extracted_text!);
   for(const observation of observations){
    const key=`official-resolc:${document.storage_sha256}:${observation.row}`;
    const saved=await c.db.rpc('cloud_stage_concert_resolc_line',{...lease(c),p_job:job.id,p_document:document.id,p_line:observation});
    if(saved.error)throw new CloudFailure('validation',5,{operation:'stage_concert_resolc',code:saved.error.code??'DATABASE_ERROR'});
    const archived=existing.get(key);
    if(!archived?.storage_path||archived.storage_sha256!==document.storage_sha256){
     try{await archiveUnitSource(c.db,job.source_record_id,saved.data as string,verifiedSources);}catch{throw new CloudFailure('document');}
     if(++staged>=BATCH_SIZE)return false;
    }
   }
   if(observations.length)continue;
  }
  if(rows.length>1_000)throw new CloudFailure('validation');
  if(rows.length)reconciliation.push(...planConcertAnnexReconciliation(document.id,document.extracted_text!,rows));
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
   const registered=registry.get(row.resesCode);
   const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
   const officialMunicipality=registered?.municipality&&row.municipality&&
    (normalized(registered.municipality).includes(normalized(row.municipality))||normalized(row.municipality).includes(normalized(registered.municipality)))
    ?registered.municipality:row.municipality;
   const archived=existing.get(unitKey);
   if(archived){
    // A parser correction must not silently retain stale observations or overwrite a reviewed unit.
    const anchor=annexAnchorDrift(archived,row);
    if(anchor.length)throw new CloudFailure('validation',5,{operation:'concert_observation_drift',code:'CONCERT_SOURCE_ANCHOR_CHANGED',message:'La línia documentada ja arxivada no coincideix amb la lectura actual. Cal revisar-la; no s’ha sobreescrit la unitat.',details:{unitId:archived.id,fields:anchor}});
    if(archived.observed_service_code!==row.observedServiceCode)
     throw new CloudFailure('validation',5,{operation:'concert_observation_drift',code:'CONCERT_SOURCE_CODE_CHANGED'});
    if(archived.status==='draft'&&!archived.reviewed_at){
     const fields=annexDraftDrift(archived,{...row,amountCents:actType==='award'?row.amountCents:null,municipality:officialMunicipality});
     if(fields.length)throw new CloudFailure('validation',5,{operation:'concert_observation_drift',code:'CONCERT_SOURCE_FACTS_CHANGED',message:'La lectura actual difereix d’una línia arxivada. Cal revisar els camps indicats; no s’ha sobreescrit la unitat.',details:{unitId:archived.id,fields}});
    }
    if(archived.storage_path)continue;
   }
   const registeredName=row.nif&&registered?.legalName?.startsWith(`${row.nif}|`)?registered.legalName.slice(row.nif.length+1):null;
   const line={...row,municipality:officialMunicipality,territory:registered?.county??null,registeredProviderName:registeredName,actType,period:row.effectiveStart&&row.effectiveEnd?`${row.effectiveStart}/${row.effectiveEnd}`:period};
   const saved=await c.db.rpc('cloud_stage_concert_annex_line',{...lease(c),p_job:job.id,p_document:document.id,p_line:line});
   if(saved.error)throw new CloudFailure('validation',5,{operation:'stage_concert_annex',code:saved.error.code??'DATABASE_ERROR'});
   try{await archiveUnitSource(c.db,job.source_record_id,saved.data as string,verifiedSources);}catch{throw new CloudFailure('document');}
   staged++;
   if(staged>=BATCH_SIZE)return false;
  }
  if(rows.length&&columnCoverage&&!columnCoverage.complete)throw new CloudFailure('validation',5,{operation:'concert_annex_coverage',code:'UNCONFIRMED_ANNEX_COVERAGE',details:{documentId:document.id,unparsedRows:columnCoverage.unparsedRows,declaredQuantity:columnCoverage.declaredQuantity}});
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
