import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const body=await request.json().catch(()=>null);
 if(!isUuid(id)||!isUuid(body?.expectedJobId??'')||typeof body?.note!=='string'||body.note.trim().length<10)
  return Response.json({error:'Cal indicar el registre, l’execució i una justificació de la revisió.'},{status:400});
 const names=body.names??{};
 if(typeof names!=='object'||Array.isArray(names)||Object.entries(names).length>500||
  Object.entries(names).some(([unitId,name])=>!isUuid(unitId)||typeof name!=='string'||name.trim().length<3||name.length>300))
  return Response.json({error:'Correccions de noms no vàlides.'},{status:400});
 const result=await createServerSupabase().rpc('review_reconciled_concert',{
  p_record:id,p_expected_job:body.expectedJobId,p_note:body.note.trim(),p_names:names,
 });
 if(result.error?.message==='DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED')return Response.json({error:'Aquest annex s’ha de revisar línia per línia. No s’ha desat cap aprovació del conjunt.'},{status:409});
 if(result.error?.code==='55P03')return Response.json({error:'Una altra operació està modificant aquest expedient. No s’ha desat la revisió; torna-ho a provar.'},{status:409});
 return result.error?Response.json({error:result.error.message},{status:409}):Response.json({reviewedUnits:result.data});
}
