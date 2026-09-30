import {hasUnitSchema} from '@/lib/runtime-schema';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!hasUnitSchema())return Response.json({units:[],supported:false});
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const result=await createServerSupabase().from('record_units').select('*').eq('source_record_id',id).neq('unit_key','legacy').order('created_at');
 return result.error?Response.json({error:'No s’han pogut consultar les unitats'},{status:500}):Response.json({units:result.data});
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!hasUnitSchema())return Response.json({error:'El desglossament d’unitats encara no està instal·lat en aquesta base de dades.'},{status:409});
 const {id}=await params;const body=await request.json().catch(()=>null);
 if(!isUuid(id)||!isUuid(body?.expectedJobId??''))return Response.json({error:'Registre o execució no vàlids'},{status:400});
 const db=createServerSupabase();
 if(body.unitId){
  if(!isUuid(body.unitId)||typeof body.approve!=='boolean')return Response.json({error:'Decisió no vàlida'},{status:400});
  const unit=await db.from('record_units').select('id').eq('id',body.unitId).eq('source_record_id',id).maybeSingle();
  if(unit.error||!unit.data)return Response.json({error:'Unitat no trobada'},{status:404});
 }
 const result=body.unitId?await db.rpc('review_record_unit',{p_unit:body.unitId,p_expected_job:body.expectedJobId,p_approve:body.approve,p_note:body.note??''}):await db.rpc('save_record_unit',{p_record:id,p_expected_job:body.expectedJobId,p_unit:body.unit??{}});
 return result.error?Response.json({error:result.error.message},{status:409}):Response.json({id:result.data});
}
