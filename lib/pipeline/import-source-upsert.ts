/** Retry only a database transaction that explicitly reports the future
 * deduplication lock conflict. Network errors and other 40001s may have a
 * different meaning and are never repeated here. */
export async function retryDeduplicationTransaction<T extends {error:unknown}>(
 upsert:()=>PromiseLike<T>,
 wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
):Promise<T>{
 for(let attempt=1;;attempt++){
  const result=await upsert();const {error}=result;
  if(!error)return result;
  const e=error as {code?:unknown;message?:unknown};
  if(attempt>=3||e.code!=='40001'||e.message!=='T19_DEDUP_BUSY')throw error;
  await wait(1000*2**(attempt-1));
 }
}

/** Existing import callers only retry the single transactional upsert. */
export const upsertImportedSourceBatch=retryDeduplicationTransaction;
