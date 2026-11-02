import {createHash} from 'node:crypto';
import {createServerSupabase} from '@/lib/records-page';
import {createProvisionExcel,type ProvisionExcelRow} from '@/lib/provision-excel';
import {isUuid} from '@/lib/uuid';
export const dynamic='force-dynamic';
/** Closed until its database functions and consumers have been reviewed. */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED!=='true')return Response.json({error:'Exportació econòmica no disponible.'},{status:404});
 const {id}=await params,b=await request.json().catch(()=>null);
 if(!isUuid(id)||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='eventId,provisionId'||!isUuid(b.eventId)||!isUuid(b.provisionId))return Response.json({error:'Exportació invàlida.'},{status:400});
 try{
  const db=createServerSupabase();const captured=await db.rpc('capture_conveni_first_export',{p_record:id,p_provision:b.provisionId});
  if(captured.error||!captured.data||typeof captured.data!=='object')throw Error('snapshot unavailable');
  const snapshot=captured.data as {provision:ProvisionExcelRow;proof:{catalog:{services:Array<{service_code:string;service_name:string}>}}};
  const service=snapshot.proof?.catalog?.services?.find(s=>s.service_code===snapshot.provision.service_code);
  if(!service?.service_name)throw Error('catalog missing');
  const bytes=await createProvisionExcel([{...snapshot.provision,service_name:service.service_name}]);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const saved=await db.rpc('finalize_conveni_first_export',{p_record:id,p_event:b.eventId,p_provision:b.provisionId,p_snapshot:snapshot,p_hash:hash});
  if(saved.error||saved.data?.event_id!==b.eventId||saved.data?.provision_id!==b.provisionId)throw Error('Export receipt not confirmed');
  return new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Conveni-provisio.xlsx"','Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'No s’ha pogut verificar l’exportació. Comprova la versió de les fonts i reconcilia l’operació abans de repetir-la.'},{status:409});}
}
