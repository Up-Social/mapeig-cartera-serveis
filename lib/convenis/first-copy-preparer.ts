import {verifyPinnedArchive,verifyPinnedEconomicEvidence} from './pinned-archive';
import {isDeepStrictEqual} from 'node:util';
import {ARCHIVE_DOCUMENT_MAX_BYTES,ARCHIVE_REQUEST_MAX_BYTES,ARCHIVE_REQUEST_TIMEOUT_MS} from './archive-verification';
import {itemSourcePath} from '../source-storage';
import {isUuid} from '../uuid';
import type {Citation} from './contract';
type ArchiveReceipt={path:string;sha256:string;object_id:string;version:string};
type Snapshot={draftId:string;recordId:string;unitId:string;draft:unknown;monetaryCitation:Citation;identityCitation:Citation;rolePeriodCitation:Citation;archives:Array<{documentId:string;source:ArchiveReceipt;copy:ArchiveReceipt}>};
type Receipt={event_id:string;draft_id:string;snapshot:Snapshot;kind:'physical-read-only-v1';verified_at:string};
type Archive=Snapshot['archives'][number];
export type CopyPlan=Omit<Snapshot,'archives'>&{archives:Array<Omit<Archive,'copy'>&{copy:Archive['copy']|null;copyPath:string}>};
type Dependencies={
 storage:{storageUrl:string;serviceKey:string;fetcher?:typeof fetch};
 plan:(draft:string)=>Promise<CopyPlan>;
 finishPlan:(draft:string,plan:CopyPlan)=>Promise<Snapshot>;
 find:(event:string,draft:string)=>Promise<Receipt|null>;
 save:(event:string,draft:string,snapshot:Snapshot)=>Promise<Receipt>;
};
/** A write may already have succeeded. Its outcome must be reconciled before
 * a new attempt; this error never authorizes an automatic retry. */
export class CopyPreparationUncertain extends Error {
 constructor(public readonly stage:'copy'|'receipt'|'operation',message:string){super(message);this.name='CopyPreparationUncertain';}
}
function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('Copy preparation interrupted'));return;}
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Copy preparation interrupted'));};
  signal.addEventListener('abort',abort,{once:true});
  work.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
/** Stopping the wait does not cancel SQL on the server. A timed-out RPC can
 * have committed and must not be retried or followed by another RPC here. */
export async function boundedPreparationRpc<T>(work:()=>Promise<T>,signal:AbortSignal,stage:'operation'|'receipt'='operation'):Promise<T>{
 const uncertain=()=>new CopyPreparationUncertain(stage,'Database operation outcome uncertain; review before continuing');
 if(signal.aborted)throw uncertain();
 try{return await bounded(Promise.resolve().then(()=>{if(signal.aborted)throw uncertain();return work();}),signal);}
 catch(error){if(signal.aborted)throw uncertain();throw error;}
}
/** Candidate preparation only: no publication/approval. Copies are
 * immutable uploads of verified bytes, not a server-side copy of a mutable URL.
 * A failed or uncertain write requires reconciliation; this function never
 * deletes an object or assumes that the write failed. */
export function createFirstCopyPreparer(deps:Dependencies){
 return async(body:unknown,signal?:AbortSignal):Promise<Receipt>=>{
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
  const b=body as Record<string,unknown>;
  if(Object.keys(b).sort().join(',')!=='draftId,eventId'||typeof b.draftId!=='string'||!isUuid(b.draftId)||typeof b.eventId!=='string'||!isUuid(b.eventId))throw Error('Only draftId and eventId are accepted');
  const draft=b.draftId,event=b.eventId;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  let consumed=0;const count=(n:number)=>{consumed+=n;if(consumed>ARCHIVE_REQUEST_MAX_BYTES)throw Error('Copy preparation byte budget exceeded');};
  // Whole-operation budget includes uploads plus all physical reads.
  const request:typeof fetch=(url,options)=>{
   const pending=(deps.storage.fetcher??fetch)(url,{...options,signal:controller.signal});
   void pending.then(r=>{if(controller.signal.aborted)void r.body?.cancel().catch(()=>{});},()=>{});
   return bounded(pending,controller.signal);
  };
  const transport:typeof fetch=async(url,options)=>{
   const r=await request(url,options);
   if(r.redirected){void r.body?.cancel().catch(()=>{});throw Error('Storage redirection rejected');}
   if(!r.body)return r;
   return new Response(r.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,c){count(chunk.byteLength);c.enqueue(chunk);}})),{status:r.status,statusText:r.statusText,headers:r.headers});
  };
  try{
   const previous=await boundedPreparationRpc(()=>deps.find(event,draft),controller.signal);
   if(previous){
    // A receipt only proves a past read. Re-read both pinned objects before a
    // legacy replay, then recheck the SQL snapshot after those physical reads.
    await verifyPinnedEconomicEvidence({...previous.snapshot,storageUrl:deps.storage.storageUrl,serviceKey:deps.storage.serviceKey,fetcher:transport,signal:controller.signal});
    const current=await boundedPreparationRpc(()=>deps.find(event,draft),controller.signal);
    if(!current||!isDeepStrictEqual(previous,current))throw Error('Archive receipt changed during verification');
    return current;
   }
   const plan=structuredClone(await boundedPreparationRpc(()=>deps.plan(draft),controller.signal));if(plan.draftId!==draft)throw Error('Draft mismatch');
   for(const a of plan.archives){
    const path=itemSourcePath(plan.recordId,plan.unitId,a.documentId,a.source.path);
    if(path!==a.copyPath)throw Error('Untrusted copy path');
    if(a.copy)continue; // Never overwrite an existing copy, even if corrupt.
    const chunks:Uint8Array[]=[];let size=0;
    const capturing:typeof fetch=async(url,options)=>{
     const r=await transport(url,options);if(!r.ok||!r.body)return r;
     return new Response(r.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,c){
      size+=chunk.byteLength;if(size>ARCHIVE_DOCUMENT_MAX_BYTES)throw Error('Document exceeds byte limit');chunks.push(Uint8Array.from(chunk));c.enqueue(chunk);
     }})),{status:r.status,statusText:r.statusText,headers:r.headers});
    };
    await verifyPinnedArchive({storageUrl:deps.storage.storageUrl,serviceKey:deps.storage.serviceKey,recordId:plan.recordId,documentId:a.documentId,receipt:a.source,signal:controller.signal,fetcher:capturing});
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    count(bytes.length);if(controller.signal.aborted)throw Error('Copy preparation interrupted');
    // Source verification validates the configured origin before this POST.
    const url=new URL(`/storage/v1/object/cloud-documents/${path}`,deps.storage.storageUrl);
    let response:Response;
    try{response=await request(url,{method:'POST',headers:{authorization:`Bearer ${deps.storage.serviceKey}`,apikey:deps.storage.serviceKey,'content-type':'application/octet-stream','x-upsert':'false'},body:bytes,redirect:'error',cache:'no-store',signal:controller.signal});}
    catch{throw new CopyPreparationUncertain('copy','Copy write outcome uncertain; inspect the same server path before retry');}
    // Even conflict may mean another identical writer won; never retry upload
    // in this call. Next invocation reads metadata and verifies bytes/version.
    // Cancelling a response stream is best effort: an implementation may
    // reject or never settle cancellation even after the request is aborted.
    // Never let it hide an uncertain write or prevent the caller progressing.
    const ok=response.ok&&!response.redirected;void response.body?.cancel().catch(()=>{});
    if(!ok)throw new CopyPreparationUncertain('copy','Copy upload not confirmed; retain objects and retry through a fresh plan');
   }
   const snapshot=await boundedPreparationRpc(()=>deps.finishPlan(draft,plan),controller.signal);
   await verifyPinnedEconomicEvidence({...snapshot,storageUrl:deps.storage.storageUrl,serviceKey:deps.storage.serviceKey,fetcher:transport,signal:controller.signal});
   if(controller.signal.aborted)throw Error('Copy preparation interrupted before receipt');
   try{return await boundedPreparationRpc(()=>deps.save(event,draft,snapshot),controller.signal,'receipt');}
   catch(error){
    if(error instanceof CopyPreparationUncertain)throw error;
    let saved:Receipt|null;try{saved=await boundedPreparationRpc(()=>deps.find(event,draft),controller.signal,'receipt');}catch{throw new CopyPreparationUncertain('receipt','Receipt outcome uncertain; reconcile the event');}
    if(saved)return saved;throw new CopyPreparationUncertain('receipt','Receipt unconfirmed; copies retained for retry');
   }
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}
