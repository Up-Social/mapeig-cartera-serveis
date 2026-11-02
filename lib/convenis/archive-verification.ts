import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {isUuid} from '../uuid';

// The 16 MiB per-document limit matches the existing PDF source limit. The
// request-wide 64 MiB and 30 s limits bound this interactive verification; a
// larger selection remains pending rather than being partially verified.
export const ARCHIVE_DOCUMENT_MAX_BYTES=16*1024*1024;
export const ARCHIVE_REQUEST_MAX_BYTES=64*1024*1024;
export const ARCHIVE_REQUEST_TIMEOUT_MS=30_000;
function abortable<T>(operation:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('Verificació interrompuda'));return;}
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Verificació interrompuda'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
type Receipt={path:string;sha256:string;object_id:string;version:string};
export type ArchiveSnapshot=Record<string,Receipt>;

/** Read only canonical Storage objects; no remote URL, recovery, OCR or write. */
export async function verifySelectedArchives(db:SupabaseClient,recordId:string,documentIds:string[],value:unknown,signal?:AbortSignal):Promise<ArchiveSnapshot>{
 if(!isUuid(recordId)||!Array.isArray(documentIds)||!documentIds.length||documentIds.length>502||new Set(documentIds).size!==documentIds.length||documentIds.some(id=>!isUuid(id)))throw Error('Selecció de documents invàlida');
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('No es disposa de versions arxivades verificables');
 const snapshot=value as Record<string,unknown>;
 if(Object.keys(snapshot).length!==documentIds.length||documentIds.some(id=>!Object.hasOwn(snapshot,id)))throw Error('La selecció de còpies arxivades és incompleta');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
 let total=0;
 try{
  for(const id of documentIds){
   if(controller.signal.aborted)throw Error('Verificació interrompuda');
   const raw=snapshot[id];if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Versió arxivada invàlida');
   const receipt=raw as Record<string,unknown>;
   const path=receipt.path,sha=receipt.sha256,objectId=receipt.object_id,version=receipt.version;
   if(typeof path!=='string'||typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha)||typeof objectId!=='string'||!isUuid(objectId)||typeof version!=='string'||!isUuid(version)
    ||!new RegExp(`^cases/${recordId}/documents/${id}/${sha}\\.[a-z0-9]+$`).test(path))throw Error('Identitat o versió de la còpia arxivada invàlida');
   const response=await abortable(db.storage.from('cloud-documents').download(path,{}, {signal:controller.signal,cache:'no-store'}).asStream(),controller.signal);
   if(response.error||!response.data)throw Error('La còpia arxivada no està disponible');
   const reader=response.data.getReader();const hash=createHash('sha256');let size=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};
   controller.signal.addEventListener('abort',cancel,{once:true});if(controller.signal.aborted)cancel();
   try{
    for(;;){const part=await reader.read();if(controller.signal.aborted)throw Error('Verificació interrompuda');if(part.done)break;
     size+=part.value.byteLength;total+=part.value.byteLength;
     if(size>ARCHIVE_DOCUMENT_MAX_BYTES||total>ARCHIVE_REQUEST_MAX_BYTES)throw Error('La verificació supera el límit de documents o de bytes');
     hash.update(part.value);
    }
   }catch(error){cancel();throw error;}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
   if(hash.digest('hex')!==sha)throw Error('La còpia arxivada no supera la verificació d’integritat');
  }
  return snapshot as ArchiveSnapshot;
 }catch(error){if(controller.signal.aborted)throw Error('La verificació de les còpies s’ha interromput o ha superat el temps disponible');throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
