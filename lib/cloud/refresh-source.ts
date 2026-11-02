import {fetchOfficialDocument} from '../pipeline/official-resolution';
import {readSource} from '../source-storage';
import {readCheckpoint,checkpoint,type Context} from './context';
import {CloudFailure} from './errors';
type Source={id:string;source_record_id:string;url:string;content_hash?:string|null;storage_path:string|null;storage_sha256:string|null;mime_type?:string|null};
/** Fresh download once per new task; resumes use that task's verified identity.
 * Changed bytes stay pending without replacing the previous archive/decisions. */
export async function refreshConcertSource(c:Context,source:Source,fetchDocument=fetchOfficialDocument){
 const key=`fresh-source:${source.id}`;
 const refreshed=await readCheckpoint<{url:string;sha256:string;path:string}>(c,key);
 if(refreshed){
  if(refreshed.url!==source.url||refreshed.sha256!==source.storage_sha256||refreshed.path!==source.storage_path)
   throw new CloudFailure('validation',5,{operation:'document_refresh',code:'DOCUMENT_CHECKPOINT_SOURCE_CHANGED'});
  return refreshed;
 }
 let downloaded:Awaited<ReturnType<typeof fetchOfficialDocument>>;
 try{downloaded=await fetchDocument(source.url);}catch{throw new CloudFailure('document',5,{operation:'document_refresh',code:'CONCERT_SOURCE_REFRESH_FAILED',message:'No s’ha pogut recuperar de nou la font oficial. Es conserva la còpia anterior; no s’ha donat el reprocessament per complet.'});}
 const verified=await readSource(c.db,source,downloaded);
 const result={url:source.url,sha256:verified.sha256,path:verified.path};
 await checkpoint(c,key,result);
 return result;
}
