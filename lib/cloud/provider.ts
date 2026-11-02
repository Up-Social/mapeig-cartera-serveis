import {checkpoint,readCheckpoint,rpc,lease,acquireResource,type Context} from './context';
import {CloudFailure} from './errors';
import {prepareProviderWireRequest,openAIInputTokenCeiling,OPENAI_MIGRATION_MODEL} from '../openai-model';
type Journal={state:'sending'|'unknown'|'received'|'retry'|'rejected';response?:Record<string,unknown>;attempt:number};
// A single advance owns one DB client and one task lease. Serialize any
// overlapping provider calls within that context so a losing invocation cannot
// release the winner's AI resource or end the shared lease while it is in use.
// This does not coordinate separate clients or processes that reuse a lease.
const pending=new WeakMap<Context['db'],Map<string,Promise<Record<string,unknown>>>>();
// The journal is private in Supabase; never return it from a workflow step.
export async function providerRequest(c:Context,key:string,body:unknown):Promise<Record<string,unknown>> {
 let tasks=pending.get(c.db);if(!tasks){tasks=new Map();pending.set(c.db,tasks);}
 const identity=JSON.stringify([c.task,c.owner,c.generation]);
 const prior=tasks.get(identity);
 // If the prior call fails, propagate that error instead of initiating another
 // request. After success, the regular wire hash and receipt checks apply.
 if(prior){await prior;if(tasks.get(identity)===prior)tasks.delete(identity);return providerRequest(c,key,body);}
 const work=providerRequestOnce(c,key,body);
 tasks.set(identity,work);
 try{return await work;}finally{if(tasks.get(identity)===work)tasks.delete(identity);}
}

async function providerRequestOnce(c:Context,key:string,body:unknown){
 if(process.env.WORKFLOW_TEST_PROJECT||process.env.PIPELINE_PROVIDER==='mock')throw new CloudFailure('internal');
 const saved=await readCheckpoint<Journal>(c,key);
 if(saved?.state==='sending'||saved?.state==='unknown'){
  throw new CloudFailure('provider_unknown');
 }
 const {request,serialized,fingerprint}=prepareProviderWireRequest(body as Record<string,unknown>);
 const hashKey=`provider-wire:${key}`;
 const previous=await readCheckpoint<string>(c,hashKey);
 if((previous&&previous!==fingerprint)||(!previous&&saved))throw new CloudFailure('validation',5,{operation:'provider_request',code:'NEW_ANALYSIS_REQUIRED'});
 if(!previous)await checkpoint(c,hashKey,fingerprint);
 if(saved?.state==='received'){
  await rpc(c.db,'cloud_budget_settle',{...lease(c),p_key:key,p_usage:saved.response?.usage??{}});return saved.response!;
 }
 if(saved?.state==='rejected'){
  throw new CloudFailure('validation');
 }
 await acquireResource(c,'ai');
 let block:string|null=null;let providerFailure:unknown;
 try {
  const inputBound=request.model===OPENAI_MIGRATION_MODEL?openAIInputTokenCeiling(request):null;
  if(!await rpc<boolean>(c.db,'cloud_budget_reserve',{...lease(c),p_key:key,p_model:request.model??null,p_output:request.max_output_tokens??null,...(inputBound===null?{}:{p_input_tokens:inputBound})}))throw new CloudFailure('budget');
  const attempt=(saved?.attempt??0)+1;
  if(attempt>3)throw new CloudFailure('validation');
  await checkpoint(c,key,{state:'sending',attempt});
  let response:Response;
  try {response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:serialized,signal:AbortSignal.timeout(150_000)});}
  catch {throw new CloudFailure('provider_unknown');}
  let raw:Record<string,unknown>;
  try {raw=await response.json();}catch {throw new CloudFailure('provider_unknown');}
  if(!response.ok){
   const code=(raw.error as {code?:string}|undefined)?.code;
   const quota=code==='insufficient_quota'||code==='billing_hard_limit_reached';
   if(quota||response.status===401||response.status===403){block=quota?'openai_quota':'credentials';await checkpoint(c,key,{state:'retry',attempt:0});throw new CloudFailure(quota?'openai_quota':'credentials');}
   if(response.status===429){await checkpoint(c,key,{state:'retry',attempt});const h=response.headers.get('retry-after');const wait=h?(Number(h)||Math.max(1,(Date.parse(h)-Date.now())/1000)):5*2**(attempt-1);throw new CloudFailure('transient',Math.min(3600,Math.max(5,wait)));}
   // A 5xx may follow successful provider work; don't silently pay twice.
   if(response.status>=500){await checkpoint(c,key,{state:'sending',attempt,response:raw,unknown:true});throw new CloudFailure('provider_unknown');}
   await checkpoint(c,key,{state:'rejected',attempt,http_status:response.status,error:raw.error??null});
   throw new CloudFailure('validation');
  }
  await checkpoint(c,key,{state:'received',attempt,response:raw});
  await rpc(c.db,'cloud_budget_settle',{...lease(c),p_key:key,p_usage:raw.usage??{}});
  return raw;
 } catch(error){providerFailure=error;throw error;}
 finally {
  try {
   await rpc(c.db,'cloud_resource',{p_name:'ai',p_owner:c.owner,p_release:true,p_block:block});

  }
  catch {
   if(providerFailure instanceof CloudFailure&&providerFailure.kind==='provider_unknown')
    throw new CloudFailure('provider_unknown',5,{operation:'provider_release',code:'PROVIDER_UNKNOWN_RESOURCE_RELEASE_UNCONFIRMED',details:{provider_outcome:'unknown',resource_release:'unconfirmed'}});
   // Never auto-retry when release is uncertain, including after a 429. Keep
   // only the fixed failure category; provider/error text is untrusted.
   throw new CloudFailure('provider_reconciliation',5,{operation:'provider_release',code:'PROVIDER_RESOURCE_RELEASE_UNCONFIRMED',details:{provider_failure_kind:providerFailure instanceof CloudFailure?providerFailure.kind:null,resource_release:'unconfirmed'}});
  }
 }
}
