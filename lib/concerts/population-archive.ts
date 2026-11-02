import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SOURCE_BUCKET} from '../source-storage';

const MAX_BYTES=16*1024*1024;
const TIMEOUT_MS=30_000;
function abortable<T>(operation:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('Verificació interrompuda'));return;}
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Verificació interrompuda'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
/** Verify bytes read now, without asserting object version remains unchanged. */
export async function verifyPopulationArchive(db:SupabaseClient,path:string,sha:string,signal?:AbortSignal):Promise<void>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try {
  if(controller.signal.aborted)throw Error('Verificació interrompuda');
  const request=db.storage.from(SOURCE_BUCKET).download(path,{}, {signal:controller.signal,cache:'no-store'}).asStream();
  void Promise.resolve(request).then(result=>{if(controller.signal.aborted)void result.data?.cancel().catch(()=>{});},()=>{});
  const result=await abortable(request,controller.signal);
  if(result.error||!result.data)throw Error('La còpia arxivada no està disponible');
  reader=result.data.getReader();const hash=createHash('sha256');let size=0;
  for(;;){const part=await abortable(reader.read(),controller.signal);if(part.done)break;
   size+=part.value.byteLength;if(size>MAX_BYTES)throw Error('La còpia supera el límit de verificació');hash.update(part.value);
  }
  if(hash.digest('hex')!==sha)throw Error('La còpia no supera la comprovació d’integritat');
 } finally {
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
 }
}
