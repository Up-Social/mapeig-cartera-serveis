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
 const r=await db.rpc(name,args);if(r.error)throw new Error('CLOUD_DATABASE');return r.data as T;
}
export function lease(c:Context){return {p_task:c.task,p_owner:c.owner,p_generation:c.generation};}
export async function checkpoint(c:Context,key:string,value:unknown){await rpc(c.db,'cloud_checkpoint',{...lease(c),p_key:key,p_value:value});}
export async function readCheckpoint<T>(c:Context,key:string):Promise<T|null>{
 const r=await c.db.from('cloud_checkpoints').select('value').eq('task_id',c.task).eq('item_key',key).maybeSingle();
 if(r.error)throw new Error('CLOUD_DATABASE');return r.data?.value as T??null;
}
export async function commit(c:Context,job:string,operation:string,data:unknown){await rpc(c.db,'cloud_commit',{...lease(c),p_job:job,p_operation:operation,p_data:data});}

export async function acquireResource(c:Context,name:'ai'|'sandbox'){
 const {CloudFailure,CloudYield}=await import('./errors');
 const acquired=await rpc<boolean>(c.db,'cloud_resource',{p_name:name,p_owner:c.owner});
 if(acquired)return;
 const r=await c.db.from('cloud_resources').select('blocked_kind').eq('name',name).single();
 if(r.error)throw new CloudFailure('internal');
 if(r.data.blocked_kind)throw new CloudFailure(name==='ai'?(r.data.blocked_kind==='credentials'?'credentials':'openai_quota'):'vercel_quota');
 throw new CloudYield(30);
}
