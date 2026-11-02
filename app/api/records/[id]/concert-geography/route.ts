import {verifiedGeographyCapture,requireExpectedGeographyCapture} from '@/lib/concerts/supplemental-geography-capture';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {readPages} from '@/lib/read-pages';
export const dynamic='force-dynamic';
const enabled=()=>process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_ENABLED==='true'&&process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_REVIEW_ENABLED==='true';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const url=new URL(request.url),unit=url.searchParams.get('unit');
 if(!isUuid(id)||!isUuid(unit??''))return Response.json({error:'Registre o línia no vàlids'},{status:400});
 if(!enabled())return Response.json({available:false});
 try{
  const db=createServerSupabase();
  const owned=await db.from('record_units').select('id').eq('id',unit!).eq('source_record_id',id).maybeSingle();
  if(owned.error)throw owned.error;if(!owned.data)return Response.json({error:'Línia no trobada'},{status:404});
  const current=await db.from('current_concert_supplemental_geography_review').select('*').eq('unit_id',unit!).eq('source_record_id',id).maybeSingle();
  if(current.error)throw current.error;
  const proposals=await readPages((from,to)=>db.from('concert_supplemental_geography').select('id,source_url,source_sha256,source_captured_at,municipality,county,province').eq('unit_id',unit!).eq('source_record_id',id).order('id',{ascending:false}).range(from,to));
  const history=proposals.length?await readPages((from,to)=>db.from('concert_supplemental_geography_reviews').select('*').in('proposal_id',proposals.map(p=>p.id)).order('review_sequence',{ascending:false}).range(from,to)):[];
  if(url.searchParams.get('capture')==='bytes')requireExpectedGeographyCapture(current.data,url.searchParams.get('proposalId'),url.searchParams.get('hash'));
  let capture=null;
  if(current.data){

   const stored=await db.from('concert_supplemental_geography').select('source_bytes,source_text,source_sha256,source_text_sha256').eq('id',current.data.id).eq('unit_id',unit!).eq('source_record_id',id).single();
   if(stored.error)throw stored.error;
   const verified=verifiedGeographyCapture(stored.data,current.data.source_sha256);
   // A concurrent new proposal or review must not be mixed into this response.
   // POST repeats the comparison under locks before persisting a decision.
   const recheck=await db.from('current_concert_supplemental_geography_review').select('id,review_id,review_fingerprint,conflict').eq('unit_id',unit!).eq('source_record_id',id).maybeSingle();
   if(recheck.error)throw recheck.error;
   if(!recheck.data||recheck.data.id!==current.data.id||recheck.data.review_id!==current.data.review_id||recheck.data.review_fingerprint!==current.data.review_fingerprint||recheck.data.conflict!==current.data.conflict)
    return Response.json({error:'La proposta o la revisió ha canviat. Actualitza-la abans de continuar.'},{status:409});
   if(url.searchParams.get('capture')==='bytes'){
    return new Response(verified.raw,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="geografia-${current.data.id}.html"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
   }
   capture={source_text:verified.source_text,source_text_sha256:verified.source_text_sha256};
  }
  return Response.json({available:true,current:current.data,capture,history,proposals});
 }catch(error){if(error instanceof Error&&error.message==='CAPTURE_SELECTION_CHANGED')return Response.json({error:'La captura ja no correspon a la proposta mostrada. Actualitza la revisió.'},{status:409});return Response.json({error:error instanceof Error&&error.message.startsWith('CAPTURE_')?'La còpia capturada o la transcripció no supera la verificació d’integritat. No es pot revisar aquesta proposta.':'No s’ha pogut consultar la revisió geogràfica. Torna-ho a provar.'},{status:503});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 if(!enabled())return Response.json({error:'Revisió geogràfica no disponible'},{status:409});
 const b=await request.json().catch(()=>null);
 if(!b||!isUuid(b.unitId)||!isUuid(b.eventId)||(b.previousId!==null&&!isUuid(b.previousId))
  ||!Number.isSafeInteger(b.proposalId)||b.proposalId<=0||!['confirmed','rejected','revoked'].includes(b.decision)
  ||typeof b.reviewFingerprint!=='string'||!/^[a-f0-9]{32}$/.test(b.reviewFingerprint)||typeof b.reviewer!=='string'||b.reviewer.trim().length<2||b.reviewer.length>200
  ||typeof b.rationale!=='string'||b.rationale.trim().length<20||b.rationale.length>4000||b.checked!==true)
  return Response.json({error:'Cal indicar revisor, motiu i confirmar el contrast de la còpia, servei i període.'},{status:400});
 try{
  const result=await createServerSupabase().rpc('review_concert_supplemental_geography',{p_record:id,p_unit:b.unitId,p_proposal:b.proposalId,p_event:b.eventId,p_previous:b.previousId,p_decision:b.decision,p_reviewer:b.reviewer.trim(),p_rationale:b.rationale.trim(),p_checked:true,p_review_fingerprint:b.reviewFingerprint});
  return result.error?Response.json({error:'La proposta ha canviat, hi ha un conflicte documental o no es pot desar. Actualitza la revisió i torna a contrastar-la.'},{status:409}):Response.json({id:result.data});
 }catch{return Response.json({error:'No s’ha pogut desar. Comprova l’historial abans de tornar-ho a provar.'},{status:503});}
}
