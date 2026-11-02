import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadOfficialCatalog} from '../official-catalog';
import {readPages} from '../read-pages';
import {readEvidenceChunks} from './evidence-reader';
import {LocalTypeBlocked} from './local-matching-guard';
import type {ScopeFacts} from '../normative-matching';

const SOURCE_KEYS=['id','financing_type','source_dataset','source_record_id','mechanism','title','provider_name','amount','source_payload','deduplication_key'];
const DOCUMENT_KEYS=['id','url','document_type','status','mime_type','text_length','extraction_method','extraction_coverage','quality_flags','extraction_partial','active_extraction_id','storage_path','storage_sha256','extracted_text_hash'];
const ENRICHMENT_KEYS=['id','summary','provider_name','provider_nif','mechanism','award_date','amount','contracting_body','target_population','scope_facts'];
type MatchingEnrichment=Record<string,unknown>&{scope_facts:ScopeFacts|null};
type MatchingRecord=Record<string,unknown>&{id:string;financing_type:string;record_enrichments:MatchingEnrichment|MatchingEnrichment[]|null};
type MatchingDocument=Record<string,unknown>&{id:string;document_type:string;status:string;extraction_partial:boolean|null;text_length:number|null;extraction_method:string|null;extraction_coverage:unknown;mime_type:string|null;quality_flags:string[]|null};
const pick=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value[key]??null]));
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}

/** Exact DB-backed input capture. This does not authorize any provider call. */
export async function captureLocalMatchingInput(db:SupabaseClient,job:{id:string;run_id:string;source_record_id:string}) {
 try{
  const [source,official]=await Promise.all([
   db.from('source_records').select('id,financing_type,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload,deduplication_key,record_enrichments(id,summary,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,scope_facts)').eq('id',job.source_record_id).single(),
   loadOfficialCatalog(db),
  ]);
  if(source.error||!source.data)throw new LocalTypeBlocked();
  const record=source.data as MatchingRecord;
  const sourceDocuments=await readPages((from,to)=>db.from('source_documents').select('id,url,document_type,status,extraction_partial,text_length,extraction_method,extraction_coverage,mime_type,quality_flags,active_extraction_id,storage_path,storage_sha256,extracted_text_hash').eq('source_record_id',job.source_record_id).order('id').range(from,to)) as MatchingDocument[];
  const evidence=await readEvidenceChunks(db,sourceDocuments.filter(document=>document.status==='fetched').map(document=>document.id));
  const enrichment=Array.isArray(record.record_enrichments)?record.record_enrichments[0]??null:record.record_enrichments;
  const expected={version:'local-matching-input-v1',job_id:job.id,run_id:job.run_id,source:pick(record,SOURCE_KEYS),documents:sourceDocuments.map(document=>pick(document,DOCUMENT_KEYS)),
   chunks:evidence.map(chunk=>({id:chunk.id,source_document_id:chunk.source_document_id,ordinal:chunk.ordinal,content_sha256:createHash('sha256').update(chunk.content,'utf8').digest('hex')})),
   enrichment:enrichment?pick(enrichment,ENRICHMENT_KEYS):null,catalog_version:official.version,services:official.all};
  const result=await db.rpc('local_verify_matching_input',{p_job:job.id,p_expected:expected});
  if(result.error||typeof result.data!=='string'||!/^local-matching-input-v1:[0-9a-f]{64}$/.test(result.data))throw new LocalTypeBlocked();
  return freeze({jobId:job.id,record,official,sourceDocuments,evidence,expected,fingerprint:result.data});
 }catch{throw new LocalTypeBlocked();}
}

/** Revalidate the same immutable inputs, rather than replacing the capture. */
export async function verifyLocalMatchingInput(db:SupabaseClient,capture:Awaited<ReturnType<typeof captureLocalMatchingInput>>):Promise<void>{
 try{const r=await db.rpc('local_verify_matching_input',{p_job:capture.jobId,p_expected:capture.expected});if(r.error||r.data!==capture.fingerprint)throw new LocalTypeBlocked();}catch{throw new LocalTypeBlocked();}
}
