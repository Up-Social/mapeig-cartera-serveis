import {openAIInputTokenCeiling,prepareOpenAIRequest} from '../openai-model';
export const PILOT_API='http://127.0.0.1:55431';
export const PILOT_PROJECT='cartera-convenis-pilot';
export const PILOT_MODEL='gpt-6-luna';
export type PilotMember={database_id:string;official_id:string;expected_ai_calls:number};
export type PilotReceipt={recordId:string;requestHash:string;reserved:number;state:'sending'|'received';actual?:number;response?:Record<string,unknown>};
export function assertPilotTarget(url:string,project:string|undefined){
 if(url!==PILOT_API||project!==PILOT_PROJECT)throw Error('PILOT_LOCAL_TARGET_REQUIRED');
}
export function pilotRequest(body:Record<string,unknown>,recordId:string,members:PilotMember[],receipts:PilotReceipt[]){
 const member=members.find(m=>m.database_id===recordId);
 if(!member||member.expected_ai_calls!==1)throw Error('PILOT_RECORD_NOT_AUTHORIZED_FOR_AI');
 if(body.model!==PILOT_MODEL||body.max_output_tokens!==16000)throw Error('PILOT_MODEL_OR_OUTPUT_CHANGED');
 const request=prepareOpenAIRequest({...body,store:false});
 const input=openAIInputTokenCeiling(request);
 const reserved=(input*(input>272000?.25:.125)+16000*(input>272000?.75:.5))/1e6;
 if(reserved>.30)throw Error('PILOT_PER_CALL_BUDGET');
 if(receipts.some(r=>r.state==='sending'))throw Error('PILOT_PROVIDER_UNKNOWN');
 const repeats=receipts.length-new Set(receipts.map(r=>r.recordId)).size;
 if(receipts.length>=19||(receipts.some(r=>r.recordId===recordId)&&repeats>=3))throw Error('PILOT_CALL_LIMIT');
 const committed=receipts.reduce((n,r)=>n+(r.actual??r.reserved),0);
 if(committed+reserved>6)throw Error('PILOT_TOTAL_BUDGET');
 return {request,input,reserved};
}
export function pilotUsageCost(usage:unknown,inputBound:number):number {
 const u=usage as {input_tokens?:number;output_tokens?:number;input_tokens_details?:{cached_tokens?:number;cache_write_tokens?:number}}|null;
 const i=u?.input_tokens,o=u?.output_tokens,c=u?.input_tokens_details?.cached_tokens??0,w=u?.input_tokens_details?.cache_write_tokens??0;
 if(![i,o,c,w].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)||i!>inputBound||o!>16000||c+w>i!)throw Error('PILOT_USAGE_UNVERIFIABLE');
 const long=i!>272000;
 return ((i!-c-w)*(long?.20:.10)+c*(long?.02:.01)+w*(long?.25:.125)+o!*(long?.75:.50))/1e6;
}
