import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SOURCE_BUCKET} from '../source-storage';
import {MAX_PDF_BYTES} from '../pipeline/document-input';

// An archived copy can be verified whenever it could be downloaded.
const MAX_BYTES=MAX_PDF_BYTES;
const TIMEOUT_MS=30_000;
function abortable<T>(operation:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('Verificació interrompuda'));return;}
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Verificació interrompuda'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
/** Read and hash the current object. This does not assert that its version stays unchanged. */
async function readArchive(db:SupabaseClient,path:string,sha:string,collect:boolean,signal?:AbortSignal):Promise<Buffer|undefined>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try {
  if(controller.signal.aborted)throw Error('Verificació interrompuda');
  const request=db.storage.from(SOURCE_BUCKET).download(path,{}, {signal:controller.signal,cache:'no-store'}).asStream();
  void Promise.resolve(request).then(result=>{if(controller.signal.aborted)void result.data?.cancel().catch(()=>{});},()=>{});
  const result=await abortable(request,controller.signal);
  if(result.error||!result.data)throw Error('La còpia arxivada no està disponible');
  reader=result.data.getReader();const hash=createHash('sha256');let size=0;const chunks:Buffer[]=[];
  for(;;){const part=await abortable(reader.read(),controller.signal);if(part.done)break;
   size+=part.value.byteLength;if(size>MAX_BYTES)throw Error('La còpia supera el límit de verificació');hash.update(part.value);
   if(collect)chunks.push(Buffer.from(part.value));
  }
  if(hash.digest('hex')!==sha)throw Error('La còpia no supera la comprovació d’integritat');
  return collect?Buffer.concat(chunks,size):undefined;
 } finally {
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
 }
}

/** Verify bytes read now, without asserting object version remains unchanged. */
export async function verifyPopulationArchive(db:SupabaseClient,path:string,sha:string,signal?:AbortSignal):Promise<void>{
 await readArchive(db,path,sha,false,signal);
}

/** Capture the exact verified bytes for a later transactional database check. */
export async function readVerifiedPopulationArchive(db:SupabaseClient,path:string,sha:string,signal?:AbortSignal):Promise<Buffer>{
 const bytes=await readArchive(db,path,sha,true,signal);
 if(!bytes?.length)throw Error('La còpia arxivada és buida');
 return bytes;
}

/** Return the source bytes only after independently checking the line copy. */
export async function captureVerifiedArchivePair(db:SupabaseClient,sourcePath:string,itemPath:string,sha:string,signal?:AbortSignal):Promise<Buffer>{
 if(sourcePath===itemPath)throw Error('La font i la còpia han de ser diferents');
 const source=await readVerifiedPopulationArchive(db,sourcePath,sha,signal);
 await verifyPopulationArchive(db,itemPath,sha,signal);
 return source;
}
