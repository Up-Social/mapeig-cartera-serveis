import {checkpoint,readCheckpoint,rpc,acquireResource,type Context} from './context';
import {CloudFailure} from './errors';
type Journal={state:'sending'|'received'|'retry';response?:Record<string,unknown>;attempt:number};
// The journal is private in Supabase; never return it from a workflow step.
export async function providerRequest(c:Context,key:string,body:unknown){
 const saved=await readCheckpoint<Journal>(c,key);
 if(saved?.state==='received')return saved.response!;
 if(saved?.state==='sending')throw new CloudFailure('provider_unknown');
 await acquireResource(c,'ai');
 let block:string|null=null;
 try {
  const attempt=(saved?.attempt??0)+1;
  if(attempt>3)throw new CloudFailure('validation');
  await checkpoint(c,key,{state:'sending',attempt});
  let response:Response;
  try {response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(150_000)});}
  catch {throw new CloudFailure('provider_unknown');}
  let raw:Record<string,unknown>;
  try {raw=await response.json();}catch {throw new CloudFailure('provider_unknown');}
  if(!response.ok){
   const code=(raw.error as {code?:string}|undefined)?.code;
   const quota=code==='insufficient_quota'||code==='billing_hard_limit_reached';
   if(quota||response.status===401||response.status===403){block=quota?'openai_quota':'credentials';await checkpoint(c,key,{state:'retry',attempt:0});throw new CloudFailure(quota?'openai_quota':'credentials');}
   if(response.status===429){await checkpoint(c,key,{state:'retry',attempt});const h=response.headers.get('retry-after');const wait=h?(Number(h)||Math.max(1,(Date.parse(h)-Date.now())/1000)):5*2**(attempt-1);throw new CloudFailure('transient',Math.min(3600,Math.max(5,wait)));}
   // A 5xx may follow successful provider work; don't silently pay twice.
   if(response.status>=500)throw new CloudFailure('provider_unknown');
   throw new CloudFailure('validation');
  }
  await checkpoint(c,key,{state:'received',attempt,response:raw});
  return raw;
 } finally {await rpc(c.db,'cloud_resource',{p_name:'ai',p_owner:c.owner,p_release:true,p_block:block});}
}
