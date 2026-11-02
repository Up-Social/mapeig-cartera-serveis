/** Preserve unknown provider outcomes across child-process boundaries. */
export function isProviderOutcomeUnknown(error:unknown):boolean {
 if(typeof error==='string')return error.includes('PROVIDER_UNKNOWN');
 if(!error||typeof error!=='object')return false;
 const value=error as {message?:unknown;stderr?:unknown;code?:unknown};
 return [value.message,value.stderr,value.code].some(item=>typeof item==='string'&&item.includes('PROVIDER_UNKNOWN'));
}
export function classifyFailure(error:unknown){
 const message=error instanceof Error?error.message:String(error); const lower=message.toLowerCase();
 if(lower.includes('provider_unknown'))return {kind:'provider_unknown',retryable:false,blocked:true,message:'Resposta de proveïdor desconeguda. No es repetirà la petició automàticament.'};
 if(/insufficient_quota|billing_hard_limit|quota_exceeded|quota exhausted/.test(lower))return {kind:'quota',retryable:false,blocked:true,message:'Quota de la IA esgotada. Reprèn el lot després de resoldre la facturació.'};
 if(/invalid_api_key|incorrect api key|openai 40[13]|authentication_error/.test(lower))return {kind:'credentials',retryable:false,blocked:true,message:'Credencials de la IA no vàlides. Revisa la configuració abans de reprendre.'};
 if(/openai (429|5\d\d)|rate_limit|econnreset|etimedout|fetch failed|timeout/.test(lower))return {kind:'transient',retryable:true,blocked:false,message:'Error temporal de connexió o límit de peticions.'};
 return {kind:/candidat|catàleg|classificació|evidència|codi/.test(lower)?'validation':'document_or_internal',retryable:false,blocked:false,message};
}
export const retryDelay=(attempt:number)=>1000*2**(attempt-1);
export async function retryTransient<T>(operation:()=>Promise<T>,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){for(let attempt=1;;attempt++){try{return await operation();}catch(error){if(attempt>=3||!classifyFailure(error).retryable)throw error;await wait(retryDelay(attempt));}}}
