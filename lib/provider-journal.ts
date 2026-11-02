import {assertProcessingEnabled,ProcessingDisabledError} from './processing-control';
import type {SupabaseClient} from '@supabase/supabase-js';
import {prepareProviderWireRequest} from './openai-model';
type Claim={send:boolean;id:string;response?:Record<string,unknown>};
export type ProviderJournal={claim:()=>Promise<Claim>;save:(id:string,state:'sending'|'received'|'retry'|'rejected',response:Record<string,unknown>)=>Promise<void>};
export async function executeJournaledCall(journal:ProviderJournal,send:()=>Promise<{status:number;body:Record<string,unknown>}>){
 const call=await journal.claim();if(!call.send){if(!call.response)throw Error('PROVIDER_RESPONSE_MISSING');return call.response;}
 let response:{status:number;body:Record<string,unknown>};try{response=await send();}catch{throw Error('PROVIDER_UNKNOWN');}
 if(response.status>=500){await journal.save(call.id,'sending',response.body);throw Error('PROVIDER_UNKNOWN');}
 if(response.status===429){await journal.save(call.id,'retry',response.body);throw Error('OpenAI 429');}
 if(response.status<200||response.status>=300){await journal.save(call.id,'rejected',response.body);throw Error(`OpenAI ${response.status}`);}
 await journal.save(call.id,'received',response.body);return response.body;
}
export async function journaledProviderRequest(db:SupabaseClient,jobId:string,phase:string,body:unknown){
 if(process.env.WORKFLOW_TEST_PROJECT||process.env.PIPELINE_PROVIDER==='mock')throw Error('Real provider forbidden in isolated tests');
 const {serialized,fingerprint}=prepareProviderWireRequest(body as Record<string,unknown>);
 return executeJournaledCall({
  async claim(){await assertProcessingEnabled(db);const r=await db.rpc('claim_provider_call',{p_job:jobId,p_phase:phase,p_hash:fingerprint});if(r.error){if(r.error.message.includes('PROCESSING_DISABLED'))throw new ProcessingDisabledError();if(phase==='conveni'&&['CONVENI_JOURNAL_BUSY','CONVENI_JOURNAL_OTHER_RECEIPT','CONVENI_JOURNAL_ISOLATION_UNSUPPORTED'].includes(r.error.message))throw Error('PROVIDER_UNKNOWN: Hi ha una petició o reserva d’una altra execució pendent de conciliació.');throw Error(r.error.message.includes('PROVIDER_UNKNOWN')?'PROVIDER_UNKNOWN':r.error.message.includes('PROVIDER_REQUEST_CHANGED')?'NEW_ANALYSIS_REQUIRED':'Provider request cannot be resumed');}return r.data as Claim;},
  async save(id,state,response){const r=await db.from('provider_calls').update({state,response,received_at:new Date().toISOString()}).eq('id',id).eq('state','sending').select('id').single();if(r.error||!r.data)throw Error('PROVIDER_UNKNOWN');},
 },async()=>{const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.timeout(150_000)});const text=await response.text();let data:Record<string,unknown>;try{data=JSON.parse(text);}catch{data={raw_text:text};}return {status:response.status,body:data};});
}

/** A local job cannot take a deterministic path while a different provider
 * phase may still have incurred an unknown charge. */
export async function assertNoUnsettledLocalCalls(db:SupabaseClient,jobId:string){
 const result=await db.from('provider_calls').select('id').eq('pipeline_job_id',jobId).eq('state','sending').limit(1);
 if(result.error)throw Error('PROVIDER_STATUS_UNAVAILABLE');
 if(result.data?.length)throw Error('PROVIDER_UNKNOWN');
}
