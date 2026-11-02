import {isDeepStrictEqual} from 'node:util';
import {boundedPreparationRpc,type createFirstCopyPreparer} from './first-copy-preparer';
import {verifyPinnedEconomicEvidence} from './pinned-archive';

type Receipt=Awaited<ReturnType<ReturnType<typeof createFirstCopyPreparer>>>;
type Scope={recordId:string;jobId:string;unitId:string;linkId:string;receiptId:string};

/** Checks what can be observed now; it does not make physical objects immutable. */
export async function verifyDecisionReceipt(input:{scope:Scope;storageUrl:string;serviceKey:string;signal:AbortSignal;
 read:()=>Promise<Receipt|null>;fetcher?:typeof fetch}){
 const receipt=await boundedPreparationRpc(input.read,input.signal);
 if(!receipt||receipt.event_id.toLowerCase()!==input.scope.receiptId.toLowerCase()
  ||receipt.snapshot.recordId.toLowerCase()!==input.scope.recordId.toLowerCase()
  ||receipt.snapshot.unitId.toLowerCase()!==input.scope.unitId.toLowerCase())throw Error('Receipt scope mismatch');
 await verifyPinnedEconomicEvidence({...receipt.snapshot,storageUrl:input.storageUrl,serviceKey:input.serviceKey,
  signal:input.signal,fetcher:input.fetcher});
 const current=await boundedPreparationRpc(input.read,input.signal);
 if(!current||!isDeepStrictEqual(receipt,current))throw Error('Receipt changed during verification');
}
