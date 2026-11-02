import {isUuid} from '../uuid';

export type ConcertReprocessPending={recordId:string;expectedJobId:string|null;jobId?:string};
export const concertReprocessStorageKey=(recordId:string)=>`concert-reprocess-pending:${recordId}`;

/** A retry reuses the original compare-and-swap expectation, including null.
 * Never derive this payload from the refreshed record: that could start a
 * second analysis after the first request committed. */
export function concertReprocessRequest(pending:ConcertReprocessPending){
  return {operation:'process' as const,concertRefresh:true,expectedJobId:pending.expectedJobId};
}

export function canRetryConcertReprocess(pending:ConcertReprocessPending|null){
  return pending!==null&&pending.jobId===undefined;
}

export function canClearRejectedConcertRequest(retry:boolean,outcome?:string){
  // A retry's rejection says nothing about the original delayed request.
  return !retry&&outcome==='not_started';
}

export function parseConcertReprocessPending(raw:string,recordId:string):ConcertReprocessPending{
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_PENDING_OPERATION');
  const item=value as Partial<ConcertReprocessPending>;
  if(item.recordId!==recordId||!isUuid(item.recordId)||!(item.expectedJobId===null||(typeof item.expectedJobId==='string'&&isUuid(item.expectedJobId)))||(item.jobId!==undefined&&(typeof item.jobId!=='string'||!isUuid(item.jobId))))throw Error('INVALID_PENDING_OPERATION');
  return item as ConcertReprocessPending;
}

/** The server compares the previous current job, including null, atomically.
 * Seeing a different current job therefore fences a delayed duplicate request.
 * Absence of an active task alone must never release an uncertain request. */
export function observedConcertReprocess(pending:ConcertReprocessPending,record:{id:string;currentJobId?:string|null}):boolean{
  if(record.id!==pending.recordId||typeof record.currentJobId!=='string'||!isUuid(record.currentJobId))return false;
  return record.currentJobId!==pending.expectedJobId;
}
