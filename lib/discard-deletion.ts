import 'server-only';
import {createServerSupabase} from './records-page';
import {purgeTargets} from './storage-purge';
export async function purgeDeletion(batchId:string){
 const db=createServerSupabase();
 const batch=await db.from('storage_purge_batches').select('id').eq('id',batchId).single();if(batch.error)throw batch.error;
 const items:{id:string;bucket:string;path:string;attempts:number}[]=[];
 for(let offset=0;;offset+=500){const r=await db.from('storage_purge_items').select('id,bucket,path,attempts').eq('batch_id',batchId).eq('status','pending').order('id').range(offset,offset+499);if(r.error)throw r.error;items.push(...(r.data??[]));if((r.data?.length??0)<500)break;}
 const result=await purgeTargets(items,{
  async remove(bucket,path){const r=await db.storage.from(bucket).remove([path]);if(r.error)throw r.error;},
  async exists(bucket,path){const r=await db.storage.from(bucket).exists(path);if(r.error){const e=r.error as {status?:number;statusCode?:number;code?:string;originalError?:{status?:number}};if(r.data===false&&(Number(e.status??e.statusCode??e.originalError?.status)===404||e.code==='NoSuchKey'))return false;throw r.error;}return r.data===true;},
  async record(id,complete,error){const attempts=items.find(i=>i.id===id)?.attempts??0;const r=await db.from('storage_purge_items').update({status:complete?'complete':'pending',attempts:attempts+1,last_error:error,verified_at:complete?new Date().toISOString():null}).eq('id',id);if(r.error)throw r.error;},
 });
 if(result.complete){const r=await db.from('storage_purge_batches').update({completed_at:new Date().toISOString()}).eq('id',batchId);if(r.error)throw r.error;}
 return result;
}
