import {createServerSupabase} from '@/lib/records-page';
import {purgeDeletion} from '@/lib/discard-deletion';
import {isUuid} from '@/lib/uuid';
import {revalidatePath} from 'next/cache';
export async function POST(request:Request){
 let purgeId:string|undefined;
 try{
  const body=await request.json();
  if(!Array.isArray(body.selection)||!Number.isInteger(body.confirmedCount)||body.selection.length!==body.confirmedCount||body.confirmedCount<1||body.confirmedCount>100||body.selection.some((r:Record<string,unknown>)=>typeof r.id!=='string'||!isUuid(r.id)||typeof r.job_id!=='string'||!isUuid(r.job_id)||typeof r.result_token!=='string'))return Response.json({rejection:'invalid_selection',error:'Selecció no vàlida.'},{status:400});
  const r=await createServerSupabase().rpc('delete_discarded_records',{p_selection:body.selection,p_confirmed_count:body.confirmedCount});if(r.error)throw r.error;if(typeof r.data!=='string'||!isUuid(r.data))throw Error('Invalid purge identifier');purgeId=r.data;
  for(const path of ['/','/discarded','/issues','/review','/batches','/approved'])revalidatePath(path);
  const purge=await purgeDeletion(purgeId);return Response.json({deleted:body.confirmedCount,purgeId,pending:purge.pending});
 }catch(error){
  if(!purgeId&&error&&typeof error==='object'&&'message' in error&&error.message==='PRESERVED_HISTORY_EXISTS')return Response.json({rejection:'preserved_history',error:'No s’ha eliminat cap registre: la selecció inclou expedients amb revisions o comprovants que cal conservar.'},{status:409});
  if(!purgeId&&error&&typeof error==='object'&&'message' in error&&error.message==='POPULATION_HISTORY_EXISTS')return Response.json({rejection:'population_history',error:'No s’ha eliminat cap registre: hi ha observacions de població per línia que cal conservar fins que se’n defineixi la retenció.'},{status:409});
  return purgeId?Response.json({purgeId,pending:true,message:'Registres eliminats; neteja de fitxers pendent.'}):Response.json({uncertain:true,error:'No s’ha pogut confirmar el resultat de l’eliminació; pot continuar en curs. Actualitza la llista i revisa els registres i la neteja pendent abans de tornar-ho a intentar.'},{status:503});
 }
}
