import {createServerSupabase} from '@/lib/records-page';
import {parsePopulationCommand} from '@/lib/concerts/population-command';
import {verifyPopulationArchive} from '@/lib/concerts/population-archive';
import {isUuid} from '@/lib/uuid';

type Params={params:Promise<{id:string;unitId:string}>};

/** This is a review observation, not an approval or a financing decision. */
export async function GET(request:Request,{params}:Params){
 const {id,unitId:unit}=await params;const job=new URL(request.url).searchParams.get('job');
 if(!isUuid(id)||!isUuid(unit)||!job||!isUuid(job))return Response.json({error:'Identificadors invàlids'},{status:400});
 const db=createServerSupabase();const result=await db.rpc('concert_population_snapshot',{p_record:id,p_job:job,p_unit:unit});
 if(result.error)return Response.json({error:'No s’ha pogut comprovar la població de la línia. Actualitza el registre.'},{status:409});
 return Response.json({snapshot:result.data},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request,{params}:Params){
 const {id,unitId:unit}=await params;
 if(!isUuid(id)||!isUuid(unit))return Response.json({error:'Identificadors invàlids'},{status:400});
 let input;try {input=parsePopulationCommand(await request.json());}
 catch{return Response.json({error:'Cal completar la decisió i les dades de la font.'},{status:400});}
 const db=createServerSupabase();
 const doc=await db.from('source_documents').select('id,source_record_id,storage_path,storage_sha256,active_extraction_id').eq('id',input.documentId).eq('source_record_id',id).maybeSingle();
 const sha=doc.data?.storage_sha256;const path=doc.data?.storage_path;
 const prefix=`cases/${id}/documents/${input.documentId}/`;
 if(doc.error||!doc.data||typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha)||typeof path!=='string'||
  !path.startsWith(prefix)||!new RegExp(`^${sha}\\.[a-z0-9]+$`).test(path.slice(prefix.length))||`${sha}:${doc.data.active_extraction_id??''}`!==input.revision)
  return Response.json({error:'La còpia documental ha canviat o no es pot verificar.'},{status:409});
 try {await verifyPopulationArchive(db,path,sha,request.signal);}
 catch{return Response.json({error:'No s’ha pogut verificar la còpia documental (límit de 16 MiB i 30 segons).'}, {status:409});}
 const result=await db.rpc('concert_population_decide',{p_record:id,p_job:input.jobId,p_unit:unit,p_event:input.eventId,p_previous:input.previousId,
  p_decision:input.decision,p_value:input.value,p_doc:input.documentId,p_revision:input.revision,p_page:input.page,p_quote:input.quote,
  p_reason:input.reason,p_reviewer:input.reviewer,p_expected_document_hash:input.documentHash,p_expected_unit_hash:input.unitHash});
 if(result.error||result.data!==input.eventId)return Response.json({error:'La línia o la font han canviat, o la revisió ja no és aplicable. Actualitza i torna a contrastar.'},{status:409});
 return Response.json({eventId:result.data});
}
