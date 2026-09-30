import type {SupabaseClient} from '@supabase/supabase-js';
export type EvidenceRow = {id:string;content:string;ordinal:number;source_document_id:string};
/** Page before selecting a prompt window so annexes beyond row 96 are visible. */
export async function readEvidenceChunks(db:SupabaseClient, documents:string[]) {
 const chunks:EvidenceRow[]=[];
 for(let group=0;group<documents.length;group+=100) {
  for(let offset=0;;offset+=500) {
   const result=await db.from('current_evidence_chunks').select('id,content,ordinal,source_document_id').in('source_document_id',documents.slice(group,group+100)).order('source_document_id').order('ordinal').range(offset,offset+499);
   if(result.error)throw result.error;
   chunks.push(...result.data);if(result.data.length<500)break;
  }
 }
 return chunks.sort((a,b)=>a.source_document_id.localeCompare(b.source_document_id)||a.ordinal-b.ordinal);
}
