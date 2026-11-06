import {isConcertRefreshNavigationDocument,isConfirmedConcertNavigationShell} from '../concerts/refresh-policy';
import {preflightConveni} from '../convenis/process';
import {cloudConveniOptions} from './conveni-conflict';
import {EXTRACTION_VERSION} from '../pipeline/readable-document';
import {randomUUID} from 'node:crypto';
import {cloudDb,CLOUD_VERSION,rpc,lease,checkpoint,readCheckpoint,commit,progress,type Context} from './context';
import {CloudFailure} from './errors';
import {handleCloudFailure} from './failure-handler';
import {documentIssueKind} from './document-issue';
import {discoverResolvedDocuments} from '../pipeline/discovery';
import {extractDocument} from './documents';
import {splitText,hash} from '../pipeline/chunks';
import {analyzeRecord} from './analysis';
import {documentQuality} from '../evidence-eligibility';
import {prepareConcertObservations} from './concerts';
import {recordDataStage} from '../record-stage-copy';
import {hasCurrentTextCoverage} from '../pipeline/document-input';
import {assertNoUnsettledProviderReceipts} from './evidence-window';
export async function advance(task:string,workflow:string):Promise<{done:boolean;wait:number}>{
 const db=cloudDb();const owner=randomUUID();
 const generation=await rpc<number|null>(db,'cloud_claim',{p_task:task,p_owner:owner,p_version:CLOUD_VERSION});
 if(!generation)return {done:true,wait:0};
 return advanceClaimed({db,owner,task,generation},workflow);
}

// The caller must have acquired the lease. Keep acquisition and its failure
// outside this continuation's error handler so a losing claimant cannot finish
// another invocation's task. No second entrypoint is exposed yet.
async function advanceClaimed(c:Context,workflow:string):Promise<{done:boolean;wait:number}>{
 const {db,task}=c;
 let currentJob:string|undefined;
 let failureStage='load_task';
 try{
  const t=await db.from('worker_tasks').select('*').eq('id',task).single();if(t.error)throw Error();
  await checkpoint(c,'workflow',{id:workflow});
  await assertNoUnsettledProviderReceipts(db,task);
  let q=db.from('pipeline_jobs').select('id,source_record_id,status,preparation_status,analysis_results(id)').order('created_at').order('id');
  q=t.data.run_id?q.eq('run_id',t.data.run_id):q.eq('source_record_id',t.data.source_record_id);
  if(t.data.pipeline_job_id)q=q.eq('id',t.data.pipeline_job_id);
  // Cursor pagination isn't needed here: completed records are excluded server-side.
  if(t.data.task_type==='prepare_run')q=q.neq('preparation_status','ready');
  const jobs=await q.not('status','in','(needs_review,approved,corrected,rejected,insufficient_evidence,error)').limit(1);
  if(jobs.error)throw Error();
  const job=jobs.data?.[0];
  if(!job){await progress(c,'closing',1,1,'Execució automàtica finalitzada');await rpc(db,'cloud_finish',{...lease(c),p_state:'completed'});if(t.data.run_id)await rpc(db,'refresh_pipeline_run',{p_run_id:t.data.run_id});return {done:true,wait:0};}
  currentJob=job.id;
  failureStage='conveni_preflight';
  if(await preflightConveni(db,job.id,cloudConveniOptions(c))){await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};}
  const complete=await readCheckpoint(c,`${job.id}:complete`);
  if(job.analysis_results?.length){await rpc(db,'cloud_mark_existing_analysis_review',{...lease(c),p_job:job.id});await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};}
  if(complete)throw new CloudFailure('validation');
  if(!await readCheckpoint(c,`${job.id}:discovered`)){
   failureStage='document_discovery';
   await progress(c,'document_discovery',0,null,'Localitzant documents oficials',job.id);
   const r=await db.from('source_records').select('id,source_payload').eq('id',job.source_record_id).single();if(r.error)throw Error();
   const discovered=await discoverResolvedDocuments(r.data);
   await commit(c,job.id,'discover',discovered);await checkpoint(c,`${job.id}:discovered`,true);
   await progress(c,'document_discovery',discovered.length,discovered.length,`${discovered.length} documents localitzats`,job.id);
  }else if(job.preparation_status!=='ready'){
   failureStage='document_extraction';
   const docs:{data:Array<{id:string;url:string;status:string;chunk_count:number;extraction_version:string|null;extraction_method:string|null;extraction_coverage:unknown;extraction_partial:boolean|null;quality_score:number|null;quality_flags:string[]|null;mime_type:string|null;document_type:string|null;storage_sha256:string|null;storage_path:string|null;active_extraction_id:string|null;extracted_text_hash:string|null}>}={data:[]};
   for(let offset=0;;offset+=200){
    const page=await db.from('source_documents').select('id,url,status,chunk_count,extraction_version,extraction_method,extraction_coverage,extraction_partial,quality_score,quality_flags,mime_type,document_type,source_fields,storage_sha256,storage_path,active_extraction_id,extracted_text_hash').eq('source_record_id',job.source_record_id).order('id').range(offset,offset+199);
    if(page.error)throw Error();docs.data.push(...page.data);if(page.data.length<200)break;
   }
   if(!docs.data.length)throw new CloudFailure('document');
   let processed=false;
   const usable=(doc:typeof docs.data[number])=>doc.status==='fetched'&&doc.chunk_count>0&&doc.extraction_version===EXTRACTION_VERSION&&hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial)&&
    Number(doc.quality_score)>0&&!doc.quality_flags?.some(flag=>['corrupt_text','incomplete_extraction','generic_portal','javascript_shell','short_text'].includes(flag));
   let completedDocuments=docs.data.filter(usable).length;
   const run=await db.from('pipeline_runs').select('parameters').eq('id',t.data.run_id).maybeSingle();
   if(run.error)throw Error();
   const recovery=run.data?.parameters?.targeted_ocr;
   const refreshSources=run.data?.parameters?.concert_refresh_sources===true;
   if(refreshSources){
    const navigation=await Promise.all(docs.data.map(async doc=>isConcertRefreshNavigationDocument(doc)||await isConfirmedConcertNavigationShell(doc)));
    docs.data=docs.data.filter((_,index)=>!navigation[index]);
    if(!docs.data.length)throw new CloudFailure('document',5,{operation:'document_refresh',code:'CONCERT_SOURCE_REFRESH_FAILED'});
    completedDocuments=0;
   }
   for(const doc of docs.data){
    const forcePages=recovery?.documentId===doc.id?recovery.pages as number[]:[];
    let forcedDone=true;
    const refreshReceipt=refreshSources?await readCheckpoint<{sha256:string;path:string;extractionId:string;textHash:string}>(c,`concert_refresh_document:${job.id}:${doc.id}`):null;
    if(refreshReceipt&&(refreshReceipt.sha256!==doc.storage_sha256||refreshReceipt.path!==doc.storage_path||refreshReceipt.extractionId!==doc.active_extraction_id||refreshReceipt.textHash!==doc.extracted_text_hash))
     throw new CloudFailure('validation',5,{operation:'document_refresh',code:'CONCERT_REFRESH_REVISION_CHANGED'});
    const refreshDone=!refreshSources||!!refreshReceipt;
    if(forcePages.length){
     const checked=await db.rpc('verify_targeted_ocr_checkpoint',{...lease(c),p_job:job.id,p_document:doc.id,p_pages:forcePages});
     if(checked.error)throw new CloudFailure(checked.error.code==='40001'?'validation':'internal',5,{operation:'targeted_ocr',code:checked.error.code==='40001'?'DOCUMENT_CHECKPOINT_SOURCE_CHANGED':'TARGETED_OCR_CHECK_FAILED'});
     if(typeof checked.data!=='boolean')throw new CloudFailure('internal',5,{operation:'targeted_ocr',code:'TARGETED_OCR_CHECK_FAILED'});
     forcedDone=checked.data;
    }
    if(doc.status==='fetched'&&doc.chunk_count>0&&doc.extraction_version===EXTRACTION_VERSION&&hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial)&&forcedDone&&refreshDone){if(refreshSources)completedDocuments+=1;continue;}
    if(await readCheckpoint(c,`document_failed:${doc.id}`))continue;
    await progress(c,'document_extraction',completedDocuments,docs.data.length,`Preparant el document ${Math.min(completedDocuments+1,docs.data.length)} de ${docs.data.length}`,job.id);
    let result:Awaited<ReturnType<typeof extractDocument>>;
    try {result=await extractDocument(c,job.id,doc.id,doc.url,run.data?.parameters?.ocr_recovery===true,forcePages,refreshSources);if(result.partial){if(refreshSources)throw new CloudFailure('document',5,{operation:'document_refresh',code:'CONCERT_EXTRACTION_INCOMPLETE'});await commit(c,job.id,'document_failure',{id:doc.id,coverage:result.coverage,kind:'incomplete_extraction'});throw new CloudFailure('document');}}
    catch(error){const kind=documentIssueKind(error);if(refreshSources&&error instanceof CloudFailure&&error.diagnostic?.code==='CONCERT_EXTRACTION_INCOMPLETE')throw error;if(refreshSources&&kind)throw new CloudFailure('document',5,{operation:'document_refresh',code:kind==='source_changed'?'CONCERT_SOURCE_CHANGED':kind==='archive_unavailable'?'CONCERT_ARCHIVE_UNAVAILABLE':'CONCERT_SOURCE_REFRESH_FAILED',message:kind==='source_changed'?'La font oficial ha canviat. Es conserva la versió anterior i cal revisar la nova font abans de substituir-la.':'No s’ha completat la nova lectura documental. Es conserva la versió anterior; consulta la incidència.'});if(kind){await commit(c,job.id,'document_failure',{id:doc.id,kind,...(kind==='document'?{}:{coverage:{complete:false,issue:kind}})});await checkpoint(c,`document_failed:${doc.id}`,{kind,...(error instanceof CloudFailure&&error.diagnostic?.code==='DOCUMENT_TOO_LARGE'?{code:'DOCUMENT_TOO_LARGE'}:{})});processed=true;break;}throw error;}
    const textHash=hash(result.text);
    const duplicate=await db.from('source_documents').select('id').eq('source_record_id',job.source_record_id).eq('extracted_text_hash',textHash).neq('id',doc.id).limit(1);
    if(duplicate.error)throw Error();
    const quality=documentQuality(result.text,result.method,Boolean(duplicate.data?.length));
    await commit(c,job.id,'document',{...result,id:doc.id,text_hash:textHash,quality_score:quality.qualityScore,quality_flags:quality.qualityFlags,chunks:splitText(result.text).map((content,ordinal)=>({ordinal,content,hash:hash(content)}))});if(refreshSources){
     const saved=await db.from('source_documents').select('storage_sha256,storage_path,active_extraction_id,extracted_text_hash').eq('id',doc.id).single();
     if(saved.error||!saved.data?.active_extraction_id||saved.data.storage_sha256!==result.source_sha256||saved.data.storage_path!==result.source_path||saved.data.extracted_text_hash!==textHash)
      throw new CloudFailure('validation',5,{operation:'document_refresh',code:'CONCERT_REFRESH_REVISION_CHANGED'});
     await checkpoint(c,`concert_refresh_document:${job.id}:${doc.id}`,{sha256:saved.data.storage_sha256,path:saved.data.storage_path,extractionId:saved.data.active_extraction_id,textHash:saved.data.extracted_text_hash});
    }processed=true;completedDocuments+=1;
    await progress(c,'document_extraction',completedDocuments,docs.data.length,`${completedDocuments} de ${docs.data.length} documents preparats`,job.id);break;
   }
   if(!processed){
    // Keep the concrete reason of a document that could not be read, so the
    // record explains it instead of the generic «Document no processable».
    const documentFailure=async()=>{for(const d of docs.data){if(usable(d))continue;const failed=await readCheckpoint<{code?:string}>(c,`document_failed:${d.id}`);if(failed?.code==='DOCUMENT_TOO_LARGE')return new CloudFailure('document',5,{operation:'document_download',code:'DOCUMENT_TOO_LARGE'});}return new CloudFailure('document');};
    if(!docs.data.some(usable))throw await documentFailure();
    const pdfs=docs.data.filter(d=>d.mime_type?.includes('pdf'));
    if(pdfs.length&&!pdfs.some(usable))throw await documentFailure();
    await commit(c,job.id,'ready',{});if(t.data.task_type==='prepare_run')await checkpoint(c,`${job.id}:complete`,true);
   }
  }else{
   failureStage='concert_observations';
   if(!await prepareConcertObservations(c,job)){
    await progress(c,'document_extraction',null,null,'Desglossant les línies de l’annex oficial',job.id);
    await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
   }
   const r=await db.from('source_records').select('enrichment_status,financing_type').eq('id',job.source_record_id).single();if(r.error)throw Error();
   const dataStage=recordDataStage(r.data.financing_type);
   if(r.data.enrichment_status!=='completed'){failureStage='enrichment';await progress(c,'enrichment',0,1,dataStage.progress,job.id);await analyzeRecord(c,job,'enrichment');await progress(c,'enrichment',1,1,dataStage.completed,job.id);}
   else if(t.data.task_type!=='enrich_record'){failureStage='matching';await progress(c,'matching',0,1,'Comprovant la correspondència amb la Cartera',job.id);await analyzeRecord(c,job,'matching');await progress(c,'closing',1,1,'Resultat guardat i pendent de revisió',job.id);}
   if(t.data.task_type==='enrich_record'){await rpc(db,'cloud_finish',{...lease(c),p_state:'completed'});return {done:true,wait:0};}
  }
  await checkpoint(c,`retry:${currentJob??'task'}`,0);
  await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
 }catch(error){
  return handleCloudFailure(c,error,currentJob,failureStage);
 }
}
