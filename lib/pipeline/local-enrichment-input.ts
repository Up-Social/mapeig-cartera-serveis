import type {SupabaseClient} from '@supabase/supabase-js';
import {readPages} from '../read-pages';
import {readEvidenceChunks} from './evidence-reader';
import {LocalTypeBlocked,LOCAL_TYPE_BLOCKED} from './local-matching-guard';

type SourceDocument={id:string;status:string;text_length:number|null;extraction_method:string|null;extraction_coverage:unknown;extraction_partial:boolean|null;mime_type:string|null;quality_flags:string[]|null}&Record<string,unknown>;
type SourceRecord=Record<string,unknown>&{id:string;financing_type:string;source_dataset:string;source_record_id:string;mechanism:string;title:string;provider_name:string|null;amount:number|null;source_payload:unknown};

/** Capture every document before forming a local enrichment intent. A failed
 * page must stop before a journal, provider call or error-status write. */
export async function loadLocalEnrichmentInput(db:SupabaseClient,recordId:string){
 try{
  const source=await db.from('source_records').select('id,financing_type,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload').eq('id',recordId).single();
  if(source.error||!source.data)throw Error('source unavailable');
  const record=source.data as SourceRecord;
  const documents=await readPages((from,to)=>db.from('source_documents')
   .select('id,url,status,text_length,extraction_method,extraction_coverage,mime_type,quality_flags,extraction_partial,active_extraction_id,storage_path,storage_sha256,extracted_text_hash')
   .eq('source_record_id',recordId).order('id').range(from,to)) as SourceDocument[];
  const fetched=documents.filter(document=>document.status==='fetched');
  if(!fetched.length)throw Error('no fetched documents');
  const evidence=await readEvidenceChunks(db,fetched.map(document=>document.id));
  return {record,documents,evidence};
 }catch{
  throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: No s’ha pogut verificar el conjunt complet de documents i fragments del registre.`);
 }
}
