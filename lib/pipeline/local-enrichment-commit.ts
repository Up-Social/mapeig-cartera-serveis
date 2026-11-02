import type {SupabaseClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {LocalTypeBlocked,LOCAL_TYPE_BLOCKED} from './local-matching-guard';

export function validateLocalEvidenceOrdinals(value:unknown,count:number):number[] {
 if(!Array.isArray(value)||!value.length||value.some(ordinal=>!Number.isInteger(ordinal)||ordinal<1||ordinal>count))throw new Error('El contrast no acredita cites vàlides per a tota la resposta.');
 return [...new Set(value as number[])];
}

export function localEnrichmentSnapshot(record:Record<string,unknown>,documents:Record<string,unknown>[],chunks:ReadonlyArray<{id:string;source_document_id:string;ordinal:number;content:string}>) {
 const sourceKeys=['id','financing_type','source_dataset','source_record_id','mechanism','title','provider_name','amount','source_payload'];
 const documentKeys=['id','url','status','mime_type','text_length','extraction_method','extraction_coverage','quality_flags','extraction_partial','active_extraction_id','storage_path','storage_sha256','extracted_text_hash'];
 const pick=(value:Record<string,unknown>,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value[key]??null]));
 return {source:pick(record,sourceKeys),documents:documents.map(doc=>pick(doc,documentKeys)).sort((a,b)=>String(a.id).localeCompare(String(b.id))),
  chunks:chunks.map(chunk=>({id:chunk.id,source_document_id:chunk.source_document_id,ordinal:chunk.ordinal,content_sha256:createHash('sha256').update(chunk.content,'utf8').digest('hex')})).sort((a,b)=>a.source_document_id.localeCompare(b.source_document_id)||a.ordinal-b.ordinal||a.id.localeCompare(b.id))};
}
export async function beginLocalEnrichment(db:SupabaseClient,jobId:string,recordId:string,snapshot:Record<string,unknown>):Promise<void> {
 const result=await db.rpc('local_begin_enrichment',{p_job:jobId,p_record:recordId,p_snapshot:snapshot});
 if(result.error||result.data!==true)throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: Cal revisar l’intent, la font o els resultats històrics abans de continuar.`);
}
export async function commitLocalEnrichment(db:SupabaseClient,jobId:string,recordId:string,action:'error'|'complete'|'complete_no_evidence',data:Record<string,unknown>|null=null,evidence:string[]=[],errorMessage:string|null=null,snapshot:Record<string,unknown>|null=null,receipt:{wireHash:string;response:Record<string,unknown>}|null=null):Promise<void> {
 const result=await db.rpc('local_commit_enrichment',{p_job:jobId,p_record:recordId,p_action:action,p_data:data,p_evidence:evidence,p_error:errorMessage,p_snapshot:snapshot,p_wire_hash:receipt?.wireHash??null,p_provider_response:receipt?.response??null});
 if(result.error)throw new Error(`No s'ha pogut confirmar el contrast local: ${result.error.message}`);
 if(result.data!==true)throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: El treball ja no és vigent o el registre està en modificació. Revisa el lot abans de continuar.`);
}
