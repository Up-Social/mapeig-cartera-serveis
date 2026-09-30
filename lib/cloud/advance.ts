import {EXTRACTION_VERSION} from '../pipeline/readable-document';
import {randomUUID} from 'node:crypto';
import {cloudDb,CLOUD_VERSION,rpc,lease,checkpoint,readCheckpoint,commit,progress,type Context} from './context';
import {publicFailure,failureLabels,CloudYield,CloudFailure} from './errors';
import {discoverResolvedDocuments} from '../pipeline/discovery';
import {extractDocument} from './documents';
import {splitText,hash} from '../pipeline/chunks';
import {analyzeRecord} from './analysis';
import {documentQuality} from '../evidence-eligibility';
export async function advance(task:string,workflow:string):Promise<{done:boolean;wait:number}>{
 const db=cloudDb();const owner=randomUUID();
 const generation=await rpc<number|null>(db,'cloud_claim',{p_task:task,p_owner:owner,p_version:CLOUD_VERSION});
 if(!generation)return {done:true,wait:0};
 const c:Context={db,owner,task,generation};
 let currentJob:string|undefined;
 try{
  const t=await db.from('worker_tasks').select('*').eq('id',task).single();if(t.error)throw Error();
  await checkpoint(c,'workflow',{id:workflow});
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
  const complete=await readCheckpoint(c,`${job.id}:complete`);
  if(job.analysis_results?.length){await db.from('pipeline_jobs').update({status:'needs_review'}).eq('id',job.id);await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};}
  if(complete)throw new CloudFailure('validation');
  if(!await readCheckpoint(c,`${job.id}:discovered`)){
   await progress(c,'document_discovery',0,null,'Localitzant documents oficials',job.id);
   const r=await db.from('source_records').select('id,source_payload').eq('id',job.source_record_id).single();if(r.error)throw Error();
   const discovered=await discoverResolvedDocuments(r.data);
   await commit(c,job.id,'discover',discovered);await checkpoint(c,`${job.id}:discovered`,true);
   await progress(c,'document_discovery',discovered.length,discovered.length,`${discovered.length} documents localitzats`,job.id);
  }else if(job.preparation_status!=='ready'){
   const docs:{data:Array<{id:string;url:string;status:string;chunk_count:number;extraction_version:string|null}>}={data:[]};
   for(let offset=0;;offset+=200){
    const page=await db.from('source_documents').select('id,url,status,chunk_count,extraction_version').eq('source_record_id',job.source_record_id).order('id').range(offset,offset+199);
    if(page.error)throw Error();docs.data.push(...page.data);if(page.data.length<200)break;
   }
   if(!docs.data.length)throw new CloudFailure('document');
   let processed=false;
   let completedDocuments=docs.data.filter(doc=>doc.status==='fetched'&&doc.chunk_count>0&&doc.extraction_version===EXTRACTION_VERSION).length;
   for(const doc of docs.data){
    if(doc.status==='fetched'&&doc.chunk_count>0&&doc.extraction_version===EXTRACTION_VERSION)continue;
    if(await readCheckpoint(c,`document_failed:${doc.id}`))continue;
    await progress(c,'document_extraction',completedDocuments,docs.data.length,`Preparant el document ${Math.min(completedDocuments+1,docs.data.length)} de ${docs.data.length}`,job.id);
    const run=await db.from('pipeline_runs').select('parameters').eq('id',t.data.run_id).maybeSingle();
    let result:Awaited<ReturnType<typeof extractDocument>>;
    try {result=await extractDocument(c,job.id,doc.id,doc.url,run.data?.parameters?.ocr_recovery===true);if(result.partial){await commit(c,job.id,'document_failure',{id:doc.id,coverage:result.coverage,kind:'incomplete_extraction'});throw new CloudFailure('document');}}
    catch(error){if(error instanceof CloudFailure&&error.kind==='document'){await commit(c,job.id,'document_failure',{id:doc.id,kind:'document'});await checkpoint(c,`document_failed:${doc.id}`,{kind:'document'});processed=true;break;}throw error;}
    const textHash=hash(result.text);
    const duplicate=await db.from('source_documents').select('id').eq('source_record_id',job.source_record_id).eq('extracted_text_hash',textHash).neq('id',doc.id).limit(1);
    if(duplicate.error)throw Error();
    const quality=documentQuality(result.text,result.method,Boolean(duplicate.data?.length));
    await commit(c,job.id,'document',{...result,id:doc.id,text_hash:textHash,quality_score:quality.qualityScore,quality_flags:quality.qualityFlags,chunks:splitText(result.text).map((content,ordinal)=>({ordinal,content,hash:hash(content)}))});processed=true;completedDocuments+=1;
    await progress(c,'document_extraction',completedDocuments,docs.data.length,`${completedDocuments} de ${docs.data.length} documents preparats`,job.id);break;
   }
   if(!processed){if(!docs.data.some(d=>d.status==='fetched'&&d.chunk_count>0))throw new CloudFailure('document');await commit(c,job.id,'ready',{});if(t.data.task_type==='prepare_run')await checkpoint(c,`${job.id}:complete`,true);}
  }else{
   const r=await db.from('source_records').select('enrichment_status').eq('id',job.source_record_id).single();if(r.error)throw Error();
   if(r.data.enrichment_status!=='completed'){await progress(c,'enrichment',0,1,'Contrastant les dades amb la font oficial',job.id);await analyzeRecord(c,job,'enrichment');await progress(c,'enrichment',1,1,'Dades oficials contrastades',job.id);}
   else if(t.data.task_type!=='enrich_record'){await progress(c,'matching',0,1,'Comprovant la correspondència amb la Cartera',job.id);await analyzeRecord(c,job,'matching');await progress(c,'closing',1,1,'Resultat guardat i pendent de revisió',job.id);}
   if(t.data.task_type==='enrich_record'){await rpc(db,'cloud_finish',{...lease(c),p_state:'completed'});return {done:true,wait:0};}
  }
  await checkpoint(c,`retry:${currentJob??'task'}`,0);
  await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
 }catch(error){
  if(error instanceof CloudYield){await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:error.wait};}
  const failure=publicFailure(error);
  try {await checkpoint(c,'last_failure',{kind:failure.kind,job:currentJob??null,diagnostic:failure.diagnostic??null,at:new Date().toISOString()});} catch { /* Do not mask the original failure if the lease has expired. */ }
  if(failure.kind==='transient'){
   const key=`retry:${currentJob??'task'}`;const attempts=(await readCheckpoint<number>(c,key)??0)+1;
   await checkpoint(c,key,attempts);
   if(attempts<3){await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:failure.retryAfter};}
  }
  if(currentJob&&['document','validation'].includes(failure.kind)){
   await commit(c,currentJob,'error',{kind:failure.kind,message:failureLabels[failure.kind]});
   await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
  }
  await rpc(db,'cloud_finish',{...lease(c),p_state:'paused',p_kind:failure.kind});return {done:true,wait:0};
 }
}
