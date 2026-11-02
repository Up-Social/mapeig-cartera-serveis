/** Status is advisory; the database repeats the check in the decision transaction. */
export async function readConcertWriteStatus(read:()=>PromiseLike<{data:unknown;error:unknown}>):Promise<{state:'open'|'paused'|'unavailable';reason:string|null}>{
 try{
  const result=await read();
  if(result.error||!result.data||typeof result.data!=='object'||Array.isArray(result.data)||typeof (result.data as {enabled?:unknown}).enabled!=='boolean')return {state:'unavailable',reason:null};
  const value=result.data as {enabled:boolean;reason?:unknown};
  const reason=typeof value.reason==='string'&&value.reason.trim()?value.reason.trim().slice(0,240):null;
  return {state:value.enabled?'open':'paused',reason};
 }catch{return {state:'unavailable',reason:null};}
}
