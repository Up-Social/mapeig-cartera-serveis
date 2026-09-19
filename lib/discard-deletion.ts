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
  async exists(bucket,path){
   const storage=db.storage.from(bucket),r=await storage.exists(path);if(!r.error)return r.data===true;
   // Some Storage versions return 400 for HEAD on an absent object. Never interpret that as absence.
   // Verify using an independently successful, fully paginated directory listing instead.
   const slash=path.lastIndexOf('/'),directory=slash<0?'':path.slice(0,slash),filename=path.slice(slash+1);
   for(let offset=0;;offset+=100){const page=await storage.list(directory,{limit:100,offset,search:filename,sortBy:{column:'name',order:'asc'}});if(page.error)throw page.error;if(page.data.some(item=>item.name===filename))return true;if(page.data.length<100)return false;}
  },
  async record(id,complete,error){const attempts=items.find(i=>i.id===id)?.attempts??0;const r=await db.from('storage_purge_items').update({status:complete?'complete':'pending',attempts:attempts+1,last_error:error,verified_at:complete?new Date().toISOString():null}).eq('id',id);if(r.error)throw r.error;},
 });
 if(result.complete){const r=await db.from('storage_purge_batches').update({completed_at:new Date().toISOString()}).eq('id',batchId);if(r.error)throw r.error;}
 return result;
}
