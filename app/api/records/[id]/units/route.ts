import {recoverConcertDisplayNames,recoverPrintedServiceCandidates,recoverPrintedSupportCandidates} from '@/lib/concerts/presentation';
import {readPages} from '@/lib/read-pages';
import {hasUnitSchema} from '@/lib/runtime-schema';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {archiveUnitSource} from '@/lib/source-storage';
import {parseDiagnosticReconciliationStatus} from '@/lib/concerts/diagnostic-reconciliation';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!hasUnitSchema())return Response.json({units:[],supported:false});
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre no vàlid'},{status:400});
 const db=createServerSupabase();
 try{
  const [units,observations,reconciliations,corrections,documents,geography]=await Promise.all([
   readPages((from,to)=>db.from('record_units').select('*').eq('source_record_id',id).neq('unit_key','legacy').order('created_at').order('id').range(from,to)),
   readPages((from,to)=>db.from('concert_line_observations').select('unit_id,proposed_value,applied').eq('source_record_id',id).order('created_at',{ascending:false}).order('id').range(from,to)),
   readPages((from,to)=>db.from('concert_annex_reconciliations').select('id,document_id,document_sha256,annex,row_count,sum_cents,declared_cents,reconciled,coverage').eq('source_record_id',id).order('id').range(from,to)),
   readPages((from,to)=>db.from('current_documented_corrections').select('*').eq('source_record_id',id).order('id').range(from,to)),
   readPages((from,to)=>db.from('source_documents').select('id,extracted_text,quality_flags,storage_sha256,extraction_method,extraction_coverage,mime_type,extraction_partial').eq('source_record_id',id).eq('status','fetched').eq('extraction_partial',false).order('id').range(from,to)),
   readPages((from,to)=>db.from('current_concert_unit_geography').select('unit_id,municipality,county,province,page,evidence').eq('source_record_id',id).order('unit_id').range(from,to)),
  ]);
  let diagnosticReconciliation=null;let diagnosticReconciliationStatus:'disabled'|'absent'|'current'|'unavailable'='disabled';
  if(process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true'){
   try{
    const result=await db.rpc('concert_diagnostic_reconciliation_status',{p_record:id});
    if(result.error)diagnosticReconciliationStatus='unavailable';
    else {const status=parseDiagnosticReconciliationStatus(result.data);diagnosticReconciliation=status.report;diagnosticReconciliationStatus=status.status;}
   }catch{diagnosticReconciliationStatus='unavailable';}
  }
  const withNames=recoverConcertDisplayNames(units,documents.filter(d=>!d.quality_flags?.includes('corrupt_text'))).map(unit=>({...unit,geography:geography.find(row=>row.unit_id===unit.id)??null}));
  return Response.json({units:recoverPrintedSupportCandidates(recoverPrintedServiceCandidates(withNames,documents),documents).map(unit=>{const history=observations.filter(row=>row.unit_id===unit.id),latest=history[0],applied=history.find(row=>row.applied);const codeCorrection=corrections.find(c=>c.unit_id===unit.id&&c.field==='service_code');return {...unit,service_code_correction:codeCorrection?{value:codeCorrection.value,valid:codeCorrection.valid,reviewer:codeCorrection.reviewer,reason:codeCorrection.reason,page:codeCorrection.page,document_id:codeCorrection.document_id}:null,effective_service_code:codeCorrection?.valid?codeCorrection.value:unit.observed_service_code,effective_provider_name:corrections.find(c=>c.valid&&c.unit_id===unit.id&&c.field==='provider_name')?.value??unit.provider_name??unit.recovered_provider_name??unit.observed_provider_name,observed_establishment_code:applied?.proposed_value?.resesCode??null,observation:latest?{...applied?.proposed_value,pendingRevision:!latest.applied}:null};}),reconciliations,diagnosticReconciliation,diagnosticReconciliationStatus});
 }catch{return Response.json({error:'No s’han pogut consultar les unitats i les revisions'},{status:500});}

}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!hasUnitSchema())return Response.json({error:'El desglossament d’unitats encara no està instal·lat en aquesta base de dades.'},{status:409});
 const {id}=await params;const body=await request.json().catch(()=>null);
 if(!isUuid(id)||!isUuid(body?.expectedJobId??''))return Response.json({error:'Registre o execució no vàlids'},{status:400});
 const db=createServerSupabase();
 if(body.prepareExtractedUnitId){
  if(!isUuid(body.prepareExtractedUnitId)||typeof body.providerName!=='string'||typeof body.serviceCode!=='string')
   return Response.json({error:'Dades de la línia no vàlides'},{status:400});
  const owned=await db.from('record_units').select('id').eq('id',body.prepareExtractedUnitId).eq('source_record_id',id).maybeSingle();
  if(owned.error||!owned.data)return Response.json({error:'Unitat no trobada'},{status:404});
  const prepared=await db.rpc('prepare_extracted_concert_unit',{p_unit:body.prepareExtractedUnitId,p_expected_job:body.expectedJobId,
   p_provider_name:body.providerName,p_service_code:body.serviceCode});
  if(prepared.error)return Response.json({error:prepared.error.message},{status:409});
  return Response.json({id:prepared.data});
 }
 if(body.unitId){
  if(!isUuid(body.unitId)||typeof body.approve!=='boolean')return Response.json({error:'Decisió no vàlida'},{status:400});
  const unit=await db.from('record_units').select('id').eq('id',body.unitId).eq('source_record_id',id).maybeSingle();
  if(unit.error||!unit.data)return Response.json({error:'Unitat no trobada'},{status:404});
  if(body.approve){
   if(process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true'){
    const line=await db.rpc('concert_line_has_award',{p_record:id,p_unit:body.unitId});
    if(line.error)return Response.json({error:'No s’ha pogut comprovar el circuit de revisió de la línia.'},{status:503});
    if(line.data===true)return Response.json({error:'Aquesta línia té una revisió econòmica individual; utilitza el seu circuit de revisió.'},{status:409});
   }
   try{await archiveUnitSource(db,id,body.unitId);}catch(error){return Response.json({error:`No s’ha pogut arxivar la font de la unitat: ${error instanceof Error?error.message:'error de Storage'}`},{status:503});}
  }
 }
 if(!body.unitId){
  const saved=await db.rpc('save_record_unit',{p_record:id,p_expected_job:body.expectedJobId,p_unit:body.unit??{}});
  if(saved.error)return Response.json({error:saved.error.message},{status:409});
  try {await archiveUnitSource(db,id,saved.data as string);}
  catch(error){return Response.json({error:`Unitat desada, però no s’ha pogut arxivar la font. Torna a enviar la mateixa unitat: ${error instanceof Error?error.message:'error de Storage'}`},{status:503});}
  return Response.json({id:saved.data});
 }
 const result=await db.rpc('review_record_unit',{p_unit:body.unitId,p_expected_job:body.expectedJobId,p_approve:body.approve,p_note:body.note??''});
 if(result.error?.message==='DIAGNOSTIC_REVIEW_INDIVIDUAL_REQUIRED')return Response.json({error:'Aquesta línia pertany a un annex que s’ha de conciliar i revisar individualment. Utilitza «Revisió econòmica de la línia»; no s’ha desat cap aprovació.'},{status:409});
 if(result.error?.code==='55P03')return Response.json({error:'Una altra operació està modificant aquest expedient. No s’ha desat la revisió; torna-ho a provar.'},{status:409});
 return result.error?Response.json({error:result.error.message},{status:409}):Response.json({id:result.data});
}
