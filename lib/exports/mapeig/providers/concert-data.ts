import type {SupabaseClient} from '@supabase/supabase-js';
import {requireConsistentLineReads} from '@/lib/concerts/line-read-guard';
import type {ReviewedConcertGeography} from '@/lib/concerts/supplemental-geography-projection';
import {readPages} from '@/lib/read-pages';
import type {ConcertCorrectionRow,ConcertDocumentRow,ConcertEnrichmentRow,ConcertGeographyRow,ConcertJobRow,ConcertMapeigData,ConcertPopulationRow,ConcertProvisionRow,ConcertRecordRow,ConcertReviewRow,ConcertSignatureRow,ConcertUnitRow} from './concert-rows';

const UNIT_COLUMNS='id,source_record_id,unit_key,provider_name,provider_nif,observed_provider_name,observed_service_name,service_code,catalog_version_id,observed_service_code,reses_code,amount,act_type,status,effective_start,effective_end,period,quantity,quantity_delta,territory,municipality,centre,document_id,page,pipeline_job_id,horizon_state,review_note';
const DOCUMENT_COLUMNS='id,source_record_id,url,document_type,source_fields,status,mime_type,storage_path,storage_sha256,active_extraction_id,extracted_text_hash,extraction_method,extraction_partial,extraction_coverage,quality_flags';
const CHUNK=100;
const chunks=<T,>(items:T[])=>Array.from({length:Math.ceil(items.length/CHUNK)},(_,i)=>items.slice(i*CHUNK,(i+1)*CHUNK));
const supplementalGeographyEnabled=()=>process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_ENABLED==='true'&&process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_REVIEW_ENABLED==='true';
const signatureDatesEnabled=()=>process.env.CONCERT_SIGNATURE_DATES_ENABLED==='true';
type UnitWithRecord=ConcertUnitRow&{source_records:{id:string;source_record_id:string;title:string|null;source_payload:Record<string,unknown>|null}|Array<{id:string;source_record_id:string;title:string|null;source_payload:Record<string,unknown>|null}>|null};

/** Every Concert line with the record-level data the Mapeig columns need.
 * `awardDateMode:'printed'` reads the archived PDF texts for the printed
 * signature date (the rule that prevails); `'stored'` skips that load. */
export async function loadConcertMapeigData(db:SupabaseClient,options:{awardDateMode?:'printed'|'stored'}={}):Promise<ConcertMapeigData>{
 await requireConsistentLineReads(db);
 const printedDates=(options.awardDateMode??'printed')==='printed';
 const joined=await readPages(async(from,to)=>db.from('record_units').select(`${UNIT_COLUMNS},source_records!inner(id,source_record_id,title,source_payload)`).eq('source_records.financing_type','concert').order('id').range(from,to).returns<UnitWithRecord[]>());
 const records=new Map<string,ConcertRecordRow>();
 const units:ConcertUnitRow[]=joined.map(({source_records,...unit})=>{
  const record=Array.isArray(source_records)?source_records[0]:source_records;
  if(record&&!records.has(record.id))records.set(record.id,{id:record.id,source_record_id:record.source_record_id,title:record.title,record_url:typeof record.source_payload?.record_url==='string'?record.source_payload.record_url:null});
  return unit;
 });
 const unitIds=units.map(u=>u.id),recordIds=[...records.keys()];
 const reviews:ConcertReviewRow[]=[],geography:ConcertGeographyRow[]=[],supplemental:ReviewedConcertGeography[]=[],populations:ConcertPopulationRow[]=[],provisions:ConcertProvisionRow[]=[];
 // The population events table is only readable through its review RPCs
 // (20261030046000 revokes service_role); a direct read is attempted so a
 // future view can expose it, and its absence is reported, not hidden.
 let populationEvents=true;
 for(const ids of chunks(unitIds)){
  reviews.push(...await readPages(async(from,to)=>db.from('concert_economic_reviews').select('unit_id,version,status,source_fingerprint,expected_job_id,operation,amount_cents,amount_kind,period_start,period_end,effective_at,funder').in('unit_id',ids).order('unit_id').range(from,to).returns<ConcertReviewRow[]>()));
  geography.push(...await readPages(async(from,to)=>db.from('current_concert_unit_geography').select('unit_id,municipality,county,province').in('unit_id',ids).order('unit_id').range(from,to).returns<ConcertGeographyRow[]>()));
  if(supplementalGeographyEnabled())supplemental.push(...await readPages(async(from,to)=>db.from('current_concert_supplemental_geography_review').select('*').in('unit_id',ids).order('unit_id').range(from,to).returns<ReviewedConcertGeography[]>()));
  if(populationEvents){
   try{populations.push(...await readPages(async(from,to)=>db.from('concert_population_events').select('unit_id,job_id,sequence,decision,value').in('unit_id',ids).order('id').range(from,to).returns<ConcertPopulationRow[]>()));}
   catch{populationEvents=false;populations.length=0;}
  }
  provisions.push(...await readPages(async(from,to)=>db.from('service_provisions').select('source_record_id,unit_id,award_date,contracting_body,target_population,call_url').in('unit_id',ids).is('superseded_at',null).order('id').range(from,to).returns<ConcertProvisionRow[]>()));
 }
 const corrections:ConcertCorrectionRow[]=[],latestJobs:ConcertJobRow[]=[],enrichments:ConcertEnrichmentRow[]=[],documents:ConcertDocumentRow[]=[],signatures:ConcertSignatureRow[]=[];
 for(const ids of chunks(recordIds)){
  corrections.push(...await readPages(async(from,to)=>db.from('current_documented_corrections').select('source_record_id,unit_id,field,value,valid').in('source_record_id',ids).in('field',['service_code','provider_name','provider_nif','final_population']).order('id').range(from,to).returns<ConcertCorrectionRow[]>()));
  enrichments.push(...await readPages(async(from,to)=>db.from('record_enrichments').select('source_record_id,award_date,contracting_body,target_population,scope_facts').in('source_record_id',ids).order('id').range(from,to).returns<ConcertEnrichmentRow[]>()));
  provisions.push(...await readPages(async(from,to)=>db.from('service_provisions').select('source_record_id,unit_id,award_date,contracting_body,target_population,call_url').in('source_record_id',ids).is('unit_id',null).order('id').range(from,to).returns<ConcertProvisionRow[]>()));
  const latest=new Map<string,ConcertJobRow>();
  const jobs=await readPages(async(from,to)=>db.from('pipeline_jobs').select('id,source_record_id,status').in('source_record_id',ids).eq('verification_only',false).order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to).returns<ConcertJobRow[]>());
  for(const job of jobs)if(!latest.has(job.source_record_id))latest.set(job.source_record_id,job);
  latestJobs.push(...latest.values());
  const columns=printedDates?`${DOCUMENT_COLUMNS},extracted_text`:DOCUMENT_COLUMNS;
  const docs=await readPages(async(from,to)=>db.from('source_documents').select(columns).in('source_record_id',ids).order('id').range(from,to).returns<ConcertDocumentRow[]>(),printedDates?20:500);
  documents.push(...docs.map(doc=>({...doc,extracted_text:printedDates?doc.extracted_text:null})));
  if(signatureDatesEnabled())signatures.push(...await readPages(async(from,to)=>db.from('current_concert_signature_observations').select('source_record_id,document_id,document_sha256,claimed_utc,local_date,certificate_trust,verification_method,signature_coverage,observed_at').in('source_record_id',ids).order('id').range(from,to).returns<ConcertSignatureRow[]>()));
 }
 await requireConsistentLineReads(db);
 return {units,records:[...records.values()],reviews,geography,supplemental,corrections,populations,latestJobs,enrichments,provisions,documents,signatures,
  gates:{supplementalGeography:supplementalGeographyEnabled(),signatureDates:signatureDatesEnabled(),printedDates,populationEvents}};
}
