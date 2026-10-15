import {createServerSupabase,getSourceRecord} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {revalidatePath} from 'next/cache';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 const body=await request.json().catch(()=>null);
 if(!isUuid(id)||!body||!isUuid(body.expectedJobId??'')||!isUuid(body.requestId??'')||body.expectedRevision!=null&&!isUuid(body.expectedRevision))
  return Response.json({error:'Registre, execució o revisió no vàlids.'},{status:400});
 const db=createServerSupabase();
 try {
  const common={p_record:id,p_job:body.expectedJobId,p_id:body.requestId,p_expected:body.expectedRevision??null,p_reason:body.reason,p_reviewer:body.reviewer};
  if(body.action==='accept'||body.action==='reopen') {
   const result=await db.rpc('record_reservation',{...common,p_action:body.action,p_missing:body.missingItems??''});
   if(result.error)throw result.error;
  } else if(body.action==='correct') {
   if(!isUuid(body.documentId??'')||body.unitId!=null&&!isUuid(body.unitId))return Response.json({error:'Document o línia no vàlids.'},{status:400});
   const result=await db.rpc('save_documented_correction',{...common,p_unit:body.unitId??null,p_field:body.field,p_value:body.value,p_document:body.documentId,p_revision:body.documentRevision,p_page:body.page,p_evidence:body.evidence,p_visual:body.visualCheck});
   if(result.error)throw result.error;
  } else return Response.json({error:'Acció no vàlida.'},{status:400});
  for(const path of ['/',`/records/${id}`,'/review','/issues','/approved','/reserved'])revalidatePath(path);
  return Response.json({record:await getSourceRecord(id)});
 }catch(error){return Response.json({error:typeof error==='object'&&error&&'message' in error?String(error.message):'No s’ha pogut desar la revisió.'},{status:409});}
}
