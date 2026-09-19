import {createServerSupabase} from '@/lib/records-page';
import {purgeDeletion} from '@/lib/discard-deletion';
import {isUuid} from '@/lib/uuid';
import {revalidatePath} from 'next/cache';
export async function POST(request:Request){
 let purgeId:string|undefined;
 try{
  const body=await request.json();
  if(!Array.isArray(body.selection)||!Number.isInteger(body.confirmedCount)||body.selection.length!==body.confirmedCount||body.confirmedCount<1||body.confirmedCount>100||body.selection.some((r:Record<string,unknown>)=>typeof r.id!=='string'||!isUuid(r.id)||typeof r.job_id!=='string'||!isUuid(r.job_id)||typeof r.result_token!=='string'))return Response.json({error:'Selecció no vàlida.'},{status:400});
  const r=await createServerSupabase().rpc('delete_discarded_records',{p_selection:body.selection,p_confirmed_count:body.confirmedCount});if(r.error)throw r.error;purgeId=String(r.data);
  for(const path of ['/','/discarded','/issues','/review','/batches','/approved'])revalidatePath(path);
  const purge=await purgeDeletion(purgeId);return Response.json({deleted:body.confirmedCount,purgeId,pending:purge.pending});
 }catch{return purgeId?Response.json({purgeId,pending:true,message:'Registres eliminats; neteja de fitxers pendent.'}):Response.json({error:'No s’ha eliminat cap registre. La selecció ha canviat, hi ha treballs actius o dependències pendents. Actualitza i revisa la selecció.'},{status:409});}
}
