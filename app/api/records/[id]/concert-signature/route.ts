import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';

/** Supplemental, read-only observations; never a replacement for award_date. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 if(process.env.CONCERT_SIGNATURE_DATES_ENABLED!=='true')return Response.json({available:false,observations:[]});
 try {
  const db=createServerSupabase();
  const result=await db.from('current_concert_signature_observations')
   .select('document_id,document_sha256,claimed_utc,local_date,certificate_trust,verification_method,observed_at',{count:'exact'})
   .eq('source_record_id',id).order('document_id');
  if(result.error||result.count===null||result.data?.length!==result.count)return Response.json({error:'No s’ha pogut consultar la informació de signatura.'},{status:503});
  return Response.json({available:true,observations:result.data});
 } catch {return Response.json({error:'No s’ha pogut consultar la informació de signatura.'},{status:503});}
}
