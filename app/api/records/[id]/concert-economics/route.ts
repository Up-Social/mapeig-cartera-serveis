import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {concertEvolution} from '@/lib/concerts/evolution';
import {loadConcertEvolution} from '@/lib/concerts/evolution-store';
import {storeConcertLinkProposals} from '@/lib/concerts/link-discovery';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const search=new URL(request.url).searchParams.get('search');
 if(search!==null){
  const q=search.replaceAll(/[,%()]/g,' ').trim().slice(0,120);if(q.length<3)return Response.json({units:[]});
  const rows=await createServerSupabase().from('concert_economic_source').select('id,source_record_id,provider_name,observed_provider_name,reses_code,provider_nif,service_code,observed_service_code,act_type,period').neq('source_record_id',id).neq('status','rejected')
   .or(`provider_name.ilike.%${q}%,observed_provider_name.ilike.%${q}%,reses_code.ilike.%${q}%,provider_nif.ilike.%${q}%`).order('created_at',{ascending:false}).order('id').limit(30);
  return rows.error?Response.json({error:'No s’han pogut cercar originals'},{status:500}):Response.json({units:rows.data});
 }
 const cutoff=new URL(request.url).searchParams.get('cutoff')??new Date().toISOString().slice(0,10);
 try{const data=await loadConcertEvolution(createServerSupabase(),id);return Response.json({data,projection:concertEvolution(data,cutoff)});}
 catch{return Response.json({error:'No s’ha pogut carregar l’evolució econòmica. Torna a provar-ho.'},{status:500});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 let body;try{body=await request.json();}catch{return Response.json({error:'Petició no vàlida'},{status:400});}
 if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Petició no vàlida'},{status:400});
 const db=createServerSupabase();
 if(body.action==='discover'){
  const record=await db.from('source_records').select('financing_type').eq('id',id).single();
  if(record.error||record.data.financing_type!=='concert')return Response.json({error:'Concert no trobat'},{status:404});
  try{return Response.json(await storeConcertLinkProposals(db,id));}catch{return Response.json({error:'No s’han pogut preparar les propostes'},{status:500});}
 }
 if(!isUuid(body.unitId)||!Number.isSafeInteger(body.version)||body.version<0||typeof body.fingerprint!=='string')return Response.json({error:'Revisió no vàlida'},{status:400});
 const unit=await db.from('record_units').select('id').eq('id',body.unitId).eq('source_record_id',id).single();
 if(unit.error)return Response.json({error:'Línia no trobada en aquest registre'},{status:404});
 if(body.action==='propose'){
  if(!isUuid(body.earlierId)||typeof body.evidence!=='string'||body.evidence.trim().length<20)return Response.json({error:'Cal la línia anterior i una cita literal de la resolució posterior'},{status:400});
  const result=await db.rpc('propose_concert_link',{p_later:body.unitId,p_earlier:body.earlierId,p_fingerprint:body.fingerprint,p_quote:body.evidence});
  return result.error?Response.json({error:result.error.message},{status:409}):Response.json({id:result.data});
 }
 if(body.action==='link'){
  if(!isUuid(body.linkId)||typeof body.earlierFingerprint!=='string'||!['confirmed','rejected','out_of_horizon'].includes(body.status))return Response.json({error:'Vincle no vàlid'},{status:400});
  const link=await db.from('concert_unit_links').select('id').eq('id',body.linkId).eq('later_unit_id',body.unitId).single();
  if(link.error)return Response.json({error:'Vincle no trobat'},{status:404});
  const result=await db.rpc('review_concert_link',{p_link:body.linkId,p_version:body.version,p_later_fingerprint:body.fingerprint,p_earlier_fingerprint:body.earlierFingerprint,p_status:body.status,p_note:body.note});
  return result.error?Response.json({error:result.error.message},{status:409}):Response.json({version:result.data});
 }
 if(body.action!=='economics'||!isUuid(body.expectedJobId)||!body.value||typeof body.value!=='object')return Response.json({error:'Revisió no vàlida'},{status:400});
 const result=await db.rpc('review_concert_economics',{p_unit:body.unitId,p_version:body.version,p_fingerprint:body.fingerprint,p_job:body.expectedJobId,p_value:body.value});
 return result.error?Response.json({error:result.error.message},{status:409}):Response.json({version:result.data});
}
