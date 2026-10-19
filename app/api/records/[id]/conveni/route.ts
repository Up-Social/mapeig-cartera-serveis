import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {aocLookupKey,normalizeConveni} from '@/lib/convenis/contract';
import {readSource,itemSourcePath,SOURCE_BUCKET,sha256} from '@/lib/source-storage';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre invàlid'},{status:400});
 const db=createServerSupabase();
 const r=await db.from('source_records').select('source_payload,financing_type').eq('id',id).single();
 if(r.error||r.data.financing_type!=='conveni')return Response.json({error:'Conveni no trobat'},{status:404});
 const job=new URL(request.url).searchParams.get('job');
 if(job&&!isUuid(job))return Response.json({error:'Execució invàlida'},{status:400});
 const latest=await db.from('pipeline_jobs').select('id').eq('source_record_id',id).eq('verification_only',false).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
 if(latest.error)return Response.json({error:latest.error.message},{status:500});
 const selectedJob=job??latest.data?.id;
 const query=db.from('conveni_analyses').select('*').eq('source_record_id',id).eq('job_id',selectedJob??'00000000-0000-0000-0000-000000000000');
 const normalized=normalizeConveni(r.data.source_payload);
 const [analysis,units,history,territories,review]=await Promise.all([query.maybeSingle(),db.from('conveni_current_units').select('*').eq('source_record_id',id),db.from('conveni_review_events').select('*').eq('source_record_id',id).order('created_at',{ascending:false}).limit(100),db.from('conveni_territories').select('*').in('aoc_code',normalized.aocCodes.map(aocLookupKey)),db.from('review_decisions').select('id').eq('source_record_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()]);
 for(const result of [analysis,units,history,territories,review])if(result.error)return Response.json({error:result.error.message},{status:500});
 let shownUnits=units.data;
 if(job&&job!==latest.data?.id&&analysis.data){
  const proposals=await db.from('conveni_unit_proposals').select('unit_id,job_id,data').eq('job_id',job);if(proposals.error)return Response.json({error:proposals.error.message},{status:500});
  shownUnits=proposals.data.map(u=>{const e=history.data?.find(e=>e.unit_id===u.unit_id&&e.job_id===job);return {...u,review_id:e?.id??null,outcome:e?.outcome??null,reviewed_job:e?.job_id??null,reviewed_code:e?.service_code??null,review_note:e?.reason??null};});
 }
 return Response.json({normalized,analysis:analysis.data,units:shownUnits,history:history.data,territories:territories.data,lastReviewId:review.data?.id??null});
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const b=await request.json().catch(()=>null);
 if(!isUuid(id)||!isUuid(b?.jobId)||!isUuid(b?.eventId)||typeof b?.note!=='string'||b.note.trim().length<10)return Response.json({error:'Cal una execució vigent i una justificació de 10 caràcters'},{status:400});
 const db=createServerSupabase();
 try {
  if(b.action==='confirm-exclusion'){
   if(b.previousReviewId!=null&&!isUuid(b.previousReviewId))return Response.json({error:'Revisió invàlida'},{status:400});
   const r=await db.rpc('confirm_conveni_exclusion',{p_record:id,p_job:b.jobId,p_event:b.eventId,p_previous:b.previousReviewId??null,p_note:b.note});if(r.error)throw Error(r.error.message);
  }else if(b.action==='reopen'){
   const r=await db.rpc('reopen_conveni',{p_record:id,p_job:b.jobId,p_event:b.eventId,p_note:b.note});if(r.error)throw Error(r.error.message);
  }else{
   if(!isUuid(b.unitId)||!['select','reject','outside','insufficient'].includes(b.outcome)||(b.previousReviewId!=null&&!isUuid(b.previousReviewId)))return Response.json({error:'Decisió invàlida'},{status:400});
   const prior=await db.from('conveni_review_events').select('source_record_id,job_id,unit_id,outcome,service_code,reason,snapshot').eq('id',b.eventId).maybeSingle();if(prior.error)throw Error(prior.error.message);
   if(prior.data){const p=prior.data;if(p.source_record_id!==id||p.job_id!==b.jobId||p.unit_id!==b.unitId||p.outcome!==b.outcome||p.service_code!==(b.outcome==='select'?b.serviceCode:null)||p.reason!==b.note||(p.snapshot?.semantic_confirmation?.confirmed??false)!==(['select','outside'].includes(b.outcome)&&b.socialConfirmed===true))throw Error('Identificador de decisió ja utilitzat');return Response.json({saved:true});}
   if(['select','outside'].includes(b.outcome)&&b.socialConfirmed!==true)throw Error('Cal confirmar la naturalesa social, la població i l’encaix revisats al document');
   // Archive bytes before the atomic review without changing the existing approved unit.
   if(b.outcome==='select'){
    const proposal=await db.from('conveni_current_units').select('data,document_revisions,job_id,review_id').eq('unit_id',b.unitId).eq('source_record_id',id).single();
    if(proposal.error||proposal.data.job_id!==b.jobId||proposal.data.review_id!==(b.previousReviewId??null))throw Error('Revisió obsoleta');
    const documentId=proposal.data.data.evidence[0].document_id;
    const doc=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type,active_extraction_id').eq('id',documentId).eq('source_record_id',id).single();
    if(doc.error)throw Error(doc.error.message);
    if(proposal.data.document_revisions[documentId]!==`${doc.data.storage_sha256}:${doc.data.active_extraction_id??''}`)throw Error('La font ha canviat');
    const source=await readSource(db,doc.data);const path=itemSourcePath(id,b.unitId,documentId,source.path);const storage=db.storage.from(SOURCE_BUCKET);
    let copy=await storage.download(path);
    if(copy.error){const c=await storage.copy(source.path,path);if(c.error)throw Error(c.error.message);copy=await storage.download(path);}
    if(copy.error||!copy.data||sha256(Buffer.from(await copy.data.arrayBuffer()))!==source.sha256)throw Error('Còpia documental no verificada');
   }
   const r=await db.rpc('review_conveni_unit',{p_record:id,p_job:b.jobId,p_unit:b.unitId,p_event:b.eventId,p_previous:b.previousReviewId??null,p_outcome:b.outcome,p_code:b.outcome==='select'?b.serviceCode:null,p_note:b.note,p_social_confirmed:['select','outside'].includes(b.outcome)&&b.socialConfirmed===true});if(r.error)throw Error(r.error.message);
  }
  return Response.json({saved:true});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'No s’ha pogut desar'},{status:409});}
}
