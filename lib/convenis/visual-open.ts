import {verifyPinnedArchive} from './pinned-archive';
import {isUuid} from '../uuid';
import {isDeepStrictEqual} from 'node:util';
export type PdfSource={documentId:string;recordId:string;source:{path:string;sha256:string;object_id:string;version:string};document_state:unknown};

type Dependencies={
 storageUrl:string;serviceKey:string;fetcher?:typeof fetch;
 snapshot:(documentId:string)=>Promise<PdfSource>;
 saveRead:(eventId:string,documentId:string,snapshot:PdfSource)=>Promise<{event_id:string;document_id:string;snapshot:PdfSource}>;
};
/** Private server prototype: the PDF bytes returned to a viewer are exactly
 * the bytes streamed through the pinned hash verifier, not a second download.
 * DB snapshot/configuration are trusted server dependencies, never user data. */
export function createVisualOpen(d:Dependencies){
 return async function open(body:unknown,signal?:AbortSignal){
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
  const b=body as Record<string,unknown>;
  if(Object.keys(b).sort().join(',')!=='documentId,eventId'||typeof b.eventId!=='string'||!isUuid(b.eventId)||typeof b.documentId!=='string'||!isUuid(b.documentId))throw Error('Only documentId and eventId are accepted');
  const snapshot=JSON.parse(JSON.stringify(await d.snapshot(b.documentId))) as PdfSource;
  if(snapshot.documentId!==b.documentId)throw Error('Document mismatch');
  const chunks:Uint8Array[]=[];let total=0;
  const transport:typeof fetch=async(url,init)=>{
   const response=await (d.fetcher??fetch)(url,init);
   if(!response.ok||response.redirected||!response.body)throw Error('Pinned PDF unavailable');
   const reader=response.body.getReader();
   const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const next=await reader.read();if(next.done){controller.close();reader.releaseLock();return;}const copy=Uint8Array.from(next.value);chunks.push(copy);total+=copy.byteLength;controller.enqueue(copy);}catch(e){controller.error(e);}},async cancel(reason){await reader.cancel(reason);reader.releaseLock();}});
   return new Response(stream,{status:response.status,headers:response.headers});
  };
  await verifyPinnedArchive({storageUrl:d.storageUrl,serviceKey:d.serviceKey,recordId:snapshot.recordId,documentId:snapshot.documentId,receipt:snapshot.source,fetcher:transport,signal});
  if(signal?.aborted)throw Error('Verificació interrompuda');
  const receipt=await d.saveRead(b.eventId,b.documentId,snapshot);
  if(receipt.event_id!==b.eventId||receipt.document_id!==b.documentId||!isDeepStrictEqual(receipt.snapshot,snapshot))throw Error('Read receipt mismatch');
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {eventId:b.eventId,documentId:b.documentId,bytes};
 };
}
