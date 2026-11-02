import {createServerSupabase} from '@/lib/records-page';
import {createVisualOpen,type PdfSource} from '@/lib/convenis/visual-open';
import {isUuid} from '@/lib/uuid';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(process.env.CONVENI_VISUAL_REVIEW_ENABLED!=='true')return Response.json({error:'Revisió visual no disponible.'},{status:404});
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre invàlid.'},{status:400});
 try{const db=createServerSupabase();const r=await db.rpc('conveni_visual_history',{p_record:id});
  if(r.error||!Array.isArray(r.data))throw Error('history unavailable');return Response.json({observations:r.data},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'No s’ha pogut carregar l’historial visual.'},{status:503});}
}
/** This preparation records declarations only. Economic approval remains fenced. */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(process.env.CONVENI_VISUAL_REVIEW_ENABLED!=='true')return Response.json({error:'Revisió visual no disponible.'},{status:404});
 const {id}=await params;const b=await request.json().catch(()=>null);
 if(!isUuid(id)||!b||typeof b!=='object'||Array.isArray(b)||!isUuid(b.documentId)||!isUuid(b.eventId))return Response.json({error:'Dades de revisió invàlides.'},{status:400});
 const db=createServerSupabase();
 try{
  if(b.action==='open'){
   if(Object.keys(b).sort().join(',')!=='action,documentId,eventId')return Response.json({error:'Dades de revisió invàlides.'},{status:400});
   const storageUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
   if(!storageUrl||!serviceKey)throw Error('Configuració de Storage no disponible');
   const open=createVisualOpen({storageUrl,serviceKey,snapshot:async(documentId)=>{
    const r=await db.rpc('conveni_visual_source',{p_record:id,p_document:documentId});if(r.error)throw r.error;return r.data as PdfSource;
   },saveRead:async(eventId,documentId,snapshot)=>{
    const r=await db.rpc('conveni_visual_save_read',{p_event:eventId,p_record:id,p_document:documentId,p_snapshot:snapshot});if(r.error)throw r.error;return r.data;
   }});
   const result=await open({documentId:b.documentId,eventId:b.eventId},request.signal);
   return new Response(Uint8Array.from(result.bytes).buffer,{headers:{'Content-Type':'application/pdf','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  if(b.action==='assert'){
   if(Object.keys(b).sort().join(',')!=='action,confirmed,documentId,eventId,page,quote,rationale,readId,reviewer,role'||!isUuid(b.readId)||!Number.isInteger(b.page)||b.page<1||b.page>10000||!['identity','economic','role_period','social',...(process.env.CONVENI_ECONOMIC_REVIEW_ENABLED==='true'&&process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED==='true'?['coverage']:[])].includes(b.role)||typeof b.quote!=='string'||typeof b.reviewer!=='string'||typeof b.rationale!=='string'||b.confirmed!==true)return Response.json({error:'Cal completar la declaració de revisió.'},{status:400});
   const r=await db.rpc('conveni_visual_assert',{p_event:b.eventId,p_read:b.readId,p_record:id,p_document:b.documentId,p_page:b.page,p_role:b.role,p_quote:b.quote,p_declared_reviewer:b.reviewer,p_rationale:b.rationale,p_confirmed:true});
   if(r.error)throw r.error;
   return Response.json({saved:true,eventId:b.eventId});
  }
  return Response.json({error:'Acció invàlida.'},{status:400});
 }catch{return Response.json({error:'No s’ha pogut verificar la font o desar la declaració. Comprova que la versió no hagi canviat.'},{status:409});}
}
