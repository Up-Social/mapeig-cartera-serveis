import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {parseGroupPreparation} from '@/lib/convenis/group-preparation';
import {isGroupPreparationEnabled,performGroupPreparation} from '@/lib/convenis/group-action';
import {conceptReviewRpcArgs,parseConceptReview} from '@/lib/convenis/concept-review';
import {readPages} from '@/lib/read-pages';
import {readConveniReviewPages} from '@/lib/convenis/review-pages';
import {createServerSupabase} from '@/lib/records-page';
import {isUuid} from '@/lib/uuid';
import {aocLookupKey,normalizeConveni} from '@/lib/convenis/contract';
import {readSource,itemSourcePath,SOURCE_BUCKET,sha256} from '@/lib/source-storage';
import {retainedConveniProposals} from '@/lib/convenis/retained-receipt';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;if(!isUuid(id))return Response.json({error:'Registre invàlid'},{status:400});
 const db=createServerSupabase();
 try{await requireConsistentConveniReads(db);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
 const independent=independentConveniReadersEnabled();
 const r=await db.from('source_records').select('source_payload,financing_type').eq('id',id).single();
 if(r.error||r.data.financing_type!=='conveni')return Response.json({error:'Conveni no trobat'},{status:404});
 const job=new URL(request.url).searchParams.get('job');
 if(job&&!isUuid(job))return Response.json({error:'Execució invàlida'},{status:400});
 const latest=await db.from('pipeline_jobs').select('id').eq('source_record_id',id).eq('verification_only',false).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
 if(latest.error)return Response.json({error:latest.error.message},{status:500});
 const selectedJob=job??latest.data?.id;
 const query=db.from('conveni_analyses').select('*').eq('source_record_id',id).eq('job_id',selectedJob??'00000000-0000-0000-0000-000000000000');
 const normalized=normalizeConveni(r.data.source_payload);
 const [analysis,territories,review]=await Promise.all([query.maybeSingle(),db.from('conveni_territories').select('*').in('aoc_code',normalized.aocCodes.map(aocLookupKey)),db.from('review_decisions').select('id').eq('source_record_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()]);
 for(const result of [analysis,territories,review])if(result.error)return Response.json({error:result.error.message},{status:500});
 let pageData;
 try {
  pageData=await readConveniReviewPages(
   (from,to)=>(independent?db.rpc('conveni_independent_units'):db.from('conveni_current_units')).select('*').eq('source_record_id',id).order('unit_id').range(from,to),
   (from,to)=>(independent?db.rpc('conveni_independent_history'):db.from('conveni_review_events')).select('*').eq('source_record_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to),
   (from,to)=>db.from('conveni_concept_review_events').select('id,job_id,unit_id,concept_index,concept_hash,sequence,outcome,service_code,reason,selected_citation,concept_snapshot,actor,created_at').eq('source_record_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to),
  );
 }catch{return Response.json({error:'No s’ha pogut carregar l’historial complet de la revisió.'},{status:500});}
 let shownUnits=pageData.unitRows;
 if(job&&job!==latest.data?.id&&analysis.data){
  try {
   const proposals=await readPages((from,to)=>db.from('conveni_unit_proposals').select('unit_id,job_id,data').eq('job_id',job).order('unit_id').range(from,to));
   shownUnits=proposals.map(u=>{const e=pageData.reviewRows.find(e=>e.unit_id===u.unit_id&&e.job_id===job);return {...u,review_id:e?.id??null,outcome:e?.outcome??null,reviewed_job:e?.job_id??null,reviewed_code:e?.service_code??null,review_note:e?.reason??null};}) as typeof shownUnits;
  }catch{return Response.json({error:'No s’han pogut carregar totes les unitats històriques.'},{status:500});}
 }
 let concepts:unknown[]=[];let preparations:unknown[]=[];
 if(!job||job===latest.data?.id){
  try {[concepts,preparations]=await Promise.all([readPages((from,to)=>db.from('conveni_concept_proposals').select('*').eq('source_record_id',id).order('unit_id').order('concept_index').range(from,to)),readPages((from,to)=>db.from('conveni_group_preparations').select('*').eq('source_record_id',id).order('unit_id').range(from,to))]);}
  catch(error){return Response.json({error:error instanceof Error?error.message:'No s’han pogut carregar les revisions dels conceptes.'},{status:500});}
 }
 let retainedProposal=null,retainedCheckFailed=false;
 if(!analysis.data&&selectedJob){
  // The RPC returns at most one bounded receipt and never modifies a journal.
  // If absent, ambiguous, unsafe or unavailable, fail closed without exposing it.
  const retained=await db.rpc('read_conveni_retained_receipt',{p_record:id,p_job:selectedJob});
  if(retained.error)retainedCheckFailed=true;
  else retainedProposal=retainedConveniProposals(retained.data);
 }
 try{await requireConsistentConveniReads(db);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
 return Response.json({legacyReviewAvailable:!independent,visualReviewAvailable:process.env.CONVENI_VISUAL_REVIEW_ENABLED==='true',economicReviewAvailable:process.env.CONVENI_ECONOMIC_REVIEW_ENABLED==='true',economicCoverageAvailable:process.env.CONVENI_ECONOMIC_REVIEW_ENABLED==='true'&&process.env.CONVENI_ECONOMIC_COVERAGE_ENABLED==='true',normalized,analysis:analysis.data,units:shownUnits,concepts,preparations,preparationAvailable:isGroupPreparationEnabled(),history:pageData.reviewRows,conceptHistory:pageData.conceptRows,territories:territories.data,lastReviewId:review.data?.id??null,retainedProposal,retainedCheckFailed});
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params;const b=await request.json().catch(()=>null);
 if(!isUuid(id)||!isUuid(b?.jobId)||!isUuid(b?.eventId)||typeof b?.note!=='string'||b.note.trim().length<10)return Response.json({error:'Cal una execució vigent i una justificació de 10 caràcters'},{status:400});
 const db=createServerSupabase();
 try{await requireConsistentConveniReads(db);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
 if(independentConveniReadersEnabled())return Response.json({error:'Les decisions individuals de convenis estan temporalment desactivades mentre s’integra el circuit versionat.'},{status:503});
 try {
  if(b.action==='prepare-group'){
   const c=parseGroupPreparation(b);
   await performGroupPreparation(db,id,c,request.signal,isGroupPreparationEnabled());
  }else if(b.action==='review-concept'){
   const c=parseConceptReview(b);
   const r=await db.rpc('review_conveni_concept',conceptReviewRpcArgs(id,c));
   if(r.error)throw Error(r.error.message);
  }else if(b.action==='confirm-exclusion'){
   if(b.previousReviewId!=null&&!isUuid(b.previousReviewId))return Response.json({error:'Revisió invàlida'},{status:400});
   const r=await db.rpc('confirm_conveni_exclusion',{p_record:id,p_job:b.jobId,p_event:b.eventId,p_previous:b.previousReviewId??null,p_note:b.note});if(r.error)throw Error(r.error.message);
  }else if(b.action==='reopen'){
   const r=await db.rpc('reopen_conveni',{p_record:id,p_job:b.jobId,p_event:b.eventId,p_note:b.note});if(r.error)throw Error(r.error.message);
  }else{
   if(!isUuid(b.unitId)||!['select','reject','outside','insufficient'].includes(b.outcome)||(b.previousReviewId!=null&&!isUuid(b.previousReviewId)))return Response.json({error:'Decisió invàlida'},{status:400});
   // Stop before reading or copying Storage. Social confirmation alone does
   // not attest the economic assignment to this recipient and period.
   if(b.outcome==='select')return Response.json({error:'Aprovació temporalment desactivada: cal una revisió documental de l’atribució econòmica al receptor i període.'},{status:409});
   const prior=await db.from('conveni_review_events').select('source_record_id,job_id,unit_id,outcome,service_code,reason,snapshot').eq('id',b.eventId).maybeSingle();if(prior.error)throw Error(prior.error.message);
   if(prior.data){const p=prior.data;if(p.source_record_id!==id||p.job_id!==b.jobId||p.unit_id!==b.unitId||p.outcome!==b.outcome||p.service_code!==(b.outcome==='select'?b.serviceCode:null)||p.reason!==b.note||(p.snapshot?.semantic_confirmation?.confirmed??false)!==(['select','outside'].includes(b.outcome)&&b.socialConfirmed===true))throw Error('Identificador de decisió ja utilitzat');}
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
