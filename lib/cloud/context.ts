import {assertProcessingEnabled,ProcessingDisabledError} from '../processing-control';
import {CloudFailure} from './errors';
import {createClient} from '@supabase/supabase-js';
import {executionMode} from '../pipeline/execution-mode';
export const CLOUD_VERSION='cloud-v1';
export function cloudDb() {
 if(executionMode()!=='vercel_workflow')throw new Error('CLOUD_DISABLED');
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||new URL(url).hostname!=='vvzxlevbfjvzygorbpxn.supabase.co')throw new Error('CLOUD_CONFIGURATION');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export type CloudDb=ReturnType<typeof cloudDb>;
export type Context={db:CloudDb;task:string;owner:string;generation:number};
export async function rpc<T=unknown>(db:CloudDb,name:string,args:Record<string,unknown>):Promise<T>{
 const r=await db.rpc(name,args);
 if(r.error){
  if(name==='cloud_checkpoint'&&r.error.message==='CONVENI_JOURNAL_RESPONSE_CONFLICT')
   throw new CloudFailure('provider_unknown',5,{operation:name,code:'CONVENI_JOURNAL_RESPONSE_CONFLICT'});
  if(['cloud_checkpoint','cloud_budget_reserve'].includes(name)&&
    ['CONVENI_JOURNAL_BUSY','CONVENI_JOURNAL_OTHER_RECEIPT','CONVENI_JOURNAL_ISOLATION_UNSUPPORTED'].includes(r.error.message))
   throw new CloudFailure('provider_reconciliation',5,{operation:name,code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED'});
  if(['conveni_bind_begin','conveni_bind_complete'].includes(name)&&
    ['CONVENI_JOURNAL_BUSY','BIND_ISOLATION','BIND_SCOPE','BIND_OTHER_TASK','BIND_WIRE_CHANGED','BIND_MISSING','BIND_RECEIPT_INVALID','BIND_RESPONSE_CHANGED'].includes(r.error.message))
   throw new CloudFailure('provider_reconciliation',5,{operation:name,code:'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED'});
  // Only this transaction's explicit group-lock conflict proves rollback.
  // Other RPCs and other 40001s keep their existing failure semantics.
  if(name==='cloud_commit'&&r.error.code==='40001'&&r.error.message==='T19_DEDUP_BUSY')throw new CloudFailure('transient',5,{operation:name,code:'T19_DEDUP_BUSY'});
  if(r.error.message.includes('PROCESSING_DISABLED'))throw new ProcessingDisabledError();
  if(r.error.message.includes('PROVIDER_RECONCILIATION_REQUIRED'))throw new CloudFailure('provider_reconciliation');
  if(r.error.message.includes('PROVIDER_UNKNOWN'))throw new CloudFailure('provider_unknown');
  if(r.error.code==='55P03'&&['cloud_resume','cloud_start_phase','cloud_record_phase','cloud_retry_validation'].includes(name))throw Error('RECORD_OPERATION_BUSY');
  if(r.error.message.includes('OCR_JOURNAL_UNVERIFIED'))throw new CloudFailure('validation',5,{operation:name,code:'OCR_JOURNAL_UNVERIFIED'});
  if(r.error.message.includes('OCR_JOURNAL_UNCERTAIN'))throw new CloudFailure('validation',5,{operation:name,code:'OCR_PAGE_OUTCOME_UNCERTAIN'});
  if(r.error.message.includes('CLOUD_RESOURCE_BLOCKED:vercel_quota'))throw new Error('La quota de Vercel està esgotada. No es poden iniciar més processos fins que es recuperi el servei.');
  if(r.error.message.includes('CLOUD_RESOURCE_BLOCKED:'))throw new Error('L’execució al núvol està bloquejada temporalment.');
  throw new CloudFailure('internal',5,{operation:name,code:r.error.message==='Invalid usage key'?'INVALID_USAGE_KEY':r.error.code??'DATABASE_ERROR'});
 }
 return r.data as T;
}
export function lease(c:Context){return {p_task:c.task,p_owner:c.owner,p_generation:c.generation};}
export async function checkpoint(c:Context,key:string,value:unknown){await rpc(c.db,'cloud_checkpoint',{...lease(c),p_key:key,p_value:value});}
export async function readCheckpoint<T>(c:Context,key:string):Promise<T|null>{
 const r=await c.db.from('cloud_checkpoints').select('value').eq('task_id',c.task).eq('item_key',key).maybeSingle();
 if(r.error)throw new Error('CLOUD_DATABASE');return r.data?.value as T??null;
}
/** Read potentially large OCR checkpoints only after a server-side size/scope check. */
export async function readBoundedPdfCheckpoint<T>(c:Context,job:string,document:string,kind:'preflight'|'page'|'legacy',key:string,maxTextBytes:number):Promise<{found:boolean;value?:T}>{
 const r=await c.db.rpc('cloud_read_pdf_checkpoint',{...lease(c),p_job:job,p_document:document,p_kind:kind,p_key:key,p_max_text_bytes:maxTextBytes});
 if(r.error){
  const message=r.error.message??'';
  if(message.includes('PDF_CHECKPOINT_TOO_LARGE'))throw new CloudFailure('document',5,{operation:'pdf_checkpoint',code:'PDF_CHECKPOINT_TOO_LARGE'});
  if(message.includes('PDF_CHECKPOINT_INVALID'))throw new CloudFailure('validation',5,{operation:'pdf_checkpoint',code:'INVALID_DOCUMENT_CHECKPOINT'});
  throw new CloudFailure('internal',5,{operation:'pdf_checkpoint',code:r.error.code??'DATABASE_ERROR'});
 }
 const result=r.data as {found?:unknown;value?:T}|null;
 if(!result||typeof result.found!=='boolean'||(result.found&&kind!=='legacy'&&(!result.value||typeof result.value!=='object'||Array.isArray(result.value))))
  throw new CloudFailure('internal',5,{operation:'pdf_checkpoint',code:'INVALID_CHECKPOINT_RESPONSE'});
 return result as {found:boolean;value?:T};
}
export async function commit(c:Context,job:string,operation:string,data:unknown){await rpc(c.db,'cloud_commit',{...lease(c),p_job:job,p_operation:operation,p_data:data});}
export async function progress(c:Context,step:'document_discovery'|'document_extraction'|'ocr'|'enrichment'|'matching'|'closing',completed:number|null=null,total:number|null=null,detail:string|null=null,job:string|null=null){
 await rpc(c.db,'cloud_progress',{...lease(c),p_step:step,p_completed:completed,p_total:total,p_detail:detail,p_job:job});
}

export async function acquireResource(c:Context,name:'ai'|'sandbox'){
 const {CloudFailure,CloudYield}=await import('./errors');
 await assertProcessingEnabled(c.db);
 const acquired=name==='sandbox'
  ?await rpc<boolean>(c.db,'cloud_acquire_sandbox',lease(c))
  :await rpc<boolean>(c.db,'cloud_resource',{p_name:name,p_owner:c.owner});
 if(acquired)return;
 const r=await c.db.from('cloud_resources').select('blocked_kind').eq('name',name).single();
 if(r.error)throw new CloudFailure('internal');
 if(r.data.blocked_kind){
  const kind=r.data.blocked_kind;
  throw new CloudFailure(kind==='credentials'?'credentials':kind==='vercel_quota'?'vercel_quota':kind==='openai_quota'?'openai_quota':'internal',5,{operation:'acquire_resource',code:'RESOURCE_BLOCKED'});
 }
 throw new CloudYield(30);
}
