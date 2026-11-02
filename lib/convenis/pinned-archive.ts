import {createHash} from 'node:crypto';
import {isUuid} from '../uuid';
import {ARCHIVE_DOCUMENT_MAX_BYTES,ARCHIVE_REQUEST_MAX_BYTES,ARCHIVE_REQUEST_TIMEOUT_MS} from './archive-verification';
import {checkUnitCopyIdentity} from './unit-copy-identity';
import type {Citation} from './contract';

type Receipt={path:string;sha256:string;object_id:string;version:string};
type PinnedInput={storageUrl:string;serviceKey:string;recordId:string;documentId:string;receipt:Receipt;signal?:AbortSignal;fetcher?:typeof fetch};
function abortable<T>(task:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('Verificació interrompuda'));return;}
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('Verificació interrompuda'));};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(task).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}

/** Experimental read-only primitive. A successful hash is not a decision or
 * proof that this object remains current: the caller must fence its version
 * and document state transactionally before any subsequent write. */
async function verifyPinnedReceipt(input:{storageUrl:string;serviceKey:string;receipt:Receipt;signal?:AbortSignal;fetcher?:typeof fetch;budget:number}):Promise<number>{
 const {storageUrl,serviceKey,receipt,signal,fetcher=fetch,budget}=input;
 if(typeof serviceKey!=='string'||!serviceKey.trim())throw Error('Credencial de Storage no disponible');
 let base:URL;
 try{base=new URL(storageUrl);}catch{throw Error('Origen de Storage invàlid');}
 if((base.protocol!=='https:' && !(base.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))
  ||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname))throw Error('Origen de Storage invàlid');
 const url=new URL(`/storage/v1/object/authenticated/cloud-documents/${receipt.path}`,base);
 url.searchParams.set('versionId',receipt.version);
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const onAbort=()=>controller.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)controller.abort();
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  if(controller.signal.aborted)throw Error('Verificació interrompuda');
  const request=fetcher(url,{method:'GET',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`},redirect:'error',cache:'no-store',signal:controller.signal});
  void request.then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});},()=>{});
  const response=await abortable(request,controller.signal);
  if(!response.ok||!response.body||response.redirected){void response.body?.cancel().catch(()=>{});throw Error('La versió arxivada no està disponible');}
  reader=response.body.getReader();const hash=createHash('sha256');let size=0;
  for(;;){const part=await abortable(reader.read(),controller.signal);if(controller.signal.aborted)throw Error('Verificació interrompuda');if(part.done)break;
     size+=part.value.byteLength;if(size>ARCHIVE_DOCUMENT_MAX_BYTES||size>budget)throw Error('La verificació supera el límit de bytes');hash.update(part.value);
  }
  if(hash.digest('hex')!==receipt.sha256)throw Error('La còpia arxivada no supera la verificació d’integritat');
  return size;
 }catch(error){if(controller.signal.aborted)throw Error('Verificació interrompuda o fora de temps');throw error;}
 finally{if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);}
}

export async function verifyPinnedArchive(input:PinnedInput):Promise<Receipt> {
 const {recordId,documentId}=input;
 // Pin the caller's declared identity before the first asynchronous read.
 // Later mutations must not change the expected hash or the returned receipt.
 const receipt=input.receipt && {...input.receipt};
 if(!isUuid(recordId)||!isUuid(documentId)||!receipt||typeof receipt.path!=='string'
  || typeof receipt.sha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sha256)
  || typeof receipt.object_id!=='string'||!isUuid(receipt.object_id)
  || typeof receipt.version!=='string'||!isUuid(receipt.version)
  || !new RegExp(`^cases/${recordId}/documents/${documentId}/${receipt.sha256}\\.[a-z0-9]+$`).test(receipt.path))
  throw Error('Identitat o versió de la còpia arxivada invàlida');
 await verifyPinnedReceipt({...input,receipt,budget:ARCHIVE_DOCUMENT_MAX_BYTES});
 return {path:receipt.path,sha256:receipt.sha256,object_id:receipt.object_id,version:receipt.version};
}

/** Experimental physical read of both objects, not a write or a currentness
 * proof. storageUrl/serviceKey and the receipts must come from trusted server
 * configuration and DB snapshots, never from a request body. SQL must compare
 * object identities and versions again under lock before any decision. */
export async function verifyPinnedUnitCopy(input:{storageUrl:string;serviceKey:string;recordId:string;unitId:string;
 monetaryCitation:Citation;source:Receipt;copy:Receipt;signal?:AbortSignal;fetcher?:typeof fetch}) {
 const identity=checkUnitCopyIdentity(input);
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const onAbort=()=>controller.abort();input.signal?.addEventListener('abort',onAbort,{once:true});if(input.signal?.aborted)controller.abort();
 try {
  const common={storageUrl:input.storageUrl,serviceKey:input.serviceKey,signal:controller.signal,fetcher:input.fetcher};
  const sourceBytes=await verifyPinnedReceipt({...common,receipt:identity.source,budget:ARCHIVE_REQUEST_MAX_BYTES});
  const copyBytes=await verifyPinnedReceipt({...common,receipt:identity.copy,budget:ARCHIVE_REQUEST_MAX_BYTES-sourceBytes});
  return {...identity,sourceBytes,copyBytes};
 } finally {clearTimeout(timeout);input.signal?.removeEventListener('abort',onAbort);}
}

/** Experimental verification of all distinct documents cited by an economic
 * review. The caller must obtain the receipts from a trusted database snapshot;
 * this does not establish currentness, reviewer intent, or approve anything. */
export async function verifyPinnedEconomicEvidence(input:{storageUrl:string;serviceKey:string;recordId:string;unitId:string;
 monetaryCitation:Citation;identityCitation:Citation;rolePeriodCitation:Citation;additionalCitations?:Citation[];
 archives:Array<{documentId:string;source:Receipt;copy:Receipt}>;signal?:AbortSignal;fetcher?:typeof fetch}) {
 if(input.additionalCitations!==undefined&&!Array.isArray(input.additionalCitations))throw Error('Les cites documentals no són vàlides');
 const citations=[input.monetaryCitation,input.identityCitation,input.rolePeriodCitation,...(input.additionalCitations??[])];
 if(citations.some(c=>!c||typeof c.document_id!=='string'||!isUuid(c.document_id)))
  throw Error('Les cites documentals no són vàlides');
 // PostgreSQL UUIDs are case-insensitive. Normalize identifiers before
 // deduplicating citations or object IDs so spelling cannot bypass the set.
 const expected=new Map(citations.map(c=>[c.document_id.toLowerCase(),{...c,document_id:c.document_id.toLowerCase()}]));
 if(!Array.isArray(input.archives)||input.archives.length!==expected.size)
  throw Error('El conjunt de documents citats és incomplet o duplicat');
 const identities=input.archives.map(archive=>{
  const documentId=typeof archive?.documentId==='string'?archive.documentId.toLowerCase():'';
  const citation=expected.get(documentId);
  if(!citation)throw Error('El conjunt de documents citats és incomplet o duplicat');
  expected.delete(documentId);
  return checkUnitCopyIdentity({recordId:input.recordId,unitId:input.unitId,monetaryCitation:citation,source:archive.source,copy:archive.copy});
 });
 if(expected.size!==0)throw Error('El conjunt de documents citats és incomplet o duplicat');
 const objectIds=identities.flatMap(identity=>[identity.source.object_id,identity.copy.object_id]);
 if(new Set(objectIds.map(id=>id.toLowerCase())).size!==objectIds.length)throw Error('Identitats documentals duplicades');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),ARCHIVE_REQUEST_TIMEOUT_MS);
 const onAbort=()=>controller.abort();input.signal?.addEventListener('abort',onAbort,{once:true});if(input.signal?.aborted)controller.abort();
 try {
  const common={storageUrl:input.storageUrl,serviceKey:input.serviceKey,signal:controller.signal,fetcher:input.fetcher};
  const documents:Array<{documentId:string;source:Receipt;copy:Receipt;sourceBytes:number;copyBytes:number}>=[];
  let totalBytes=0;
  for(const identity of identities){
   const sourceBytes=await verifyPinnedReceipt({...common,receipt:identity.source,budget:ARCHIVE_REQUEST_MAX_BYTES-totalBytes});
   totalBytes+=sourceBytes;
   const copyBytes=await verifyPinnedReceipt({...common,receipt:identity.copy,budget:ARCHIVE_REQUEST_MAX_BYTES-totalBytes});
   totalBytes+=copyBytes;
   documents.push({documentId:identity.monetaryCitation.document_id,source:identity.source,copy:identity.copy,sourceBytes,copyBytes});
  }
  return {documents,totalBytes};
 } finally {clearTimeout(timeout);input.signal?.removeEventListener('abort',onAbort);}
}
