import {randomUUID} from 'node:crypto';
import {cloudDb,CLOUD_VERSION,rpc,lease,checkpoint,readCheckpoint,commit,type Context} from './context';
import {publicFailure,failureLabels,CloudYield,CloudFailure} from './errors';
import {discoverRecordDocuments} from '../pipeline/discovery';
import {extractDocument} from './documents';
import {splitText,hash} from '../pipeline/chunks';
import {analyzeRecord} from './analysis';
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
  // Cursor pagination isn't needed here: completed records are excluded server-side.
  if(t.data.task_type==='prepare_run')q=q.neq('preparation_status','ready');
  const jobs=await q.not('status','in','(needs_review,approved,corrected,rejected,insufficient_evidence,error)').limit(1);
  if(jobs.error)throw Error();
  const job=jobs.data?.[0];
  if(!job){await rpc(db,'cloud_finish',{...lease(c),p_state:'completed'});if(t.data.run_id)await rpc(db,'refresh_pipeline_run',{p_run_id:t.data.run_id});return {done:true,wait:0};}
  currentJob=job.id;
  const complete=await readCheckpoint(c,`${job.id}:complete`);
  if(complete||job.analysis_results?.length){await commit(c,job.id,'ready',{});throw Error('INVALID_PENDING_RESULT');}
  if(!await readCheckpoint(c,`${job.id}:discovered`)){
   const r=await db.from('source_records').select('id,source_payload').eq('id',job.source_record_id).single();if(r.error)throw Error();
   await commit(c,job.id,'discover',discoverRecordDocuments(r.data));await checkpoint(c,`${job.id}:discovered`,true);
  }else if(job.preparation_status!=='ready'){
   const docs=await db.from('source_documents').select('id,url,status,chunk_count').eq('source_record_id',job.source_record_id).order('id');if(docs.error)throw Error();
   if(!docs.data.length)throw new (await import('./errors')).CloudFailure('document');
   let processed=false;
   for(const doc of docs.data){
    if(doc.status==='fetched'&&doc.chunk_count>0)continue;
    if(await readCheckpoint(c,`document_failed:${doc.id}`))continue;
    const run=await db.from('pipeline_runs').select('parameters').eq('id',t.data.run_id).maybeSingle();
    let result:Awaited<ReturnType<typeof extractDocument>>;
    try {result=await extractDocument(c,doc.id,doc.url,run.data?.parameters?.ocr_recovery===true);if(result.partial)throw new CloudFailure('document');}
    catch(error){if(error instanceof CloudFailure&&error.kind==='document'){await checkpoint(c,`document_failed:${doc.id}`,{kind:'document'});processed=true;break;}throw error;}
    await commit(c,job.id,'document',{...result,id:doc.id,text_hash:hash(result.text),chunks:splitText(result.text).map((content,ordinal)=>({ordinal,content,hash:hash(content)}))});processed=true;break;
   }
   if(!processed){if(!docs.data.some(d=>d.status==='fetched'&&d.chunk_count>0))throw new CloudFailure('document');await commit(c,job.id,'ready',{});if(t.data.task_type==='prepare_run')await checkpoint(c,`${job.id}:complete`,true);}
  }else{
   const r=await db.from('source_records').select('enrichment_status').eq('id',job.source_record_id).single();if(r.error)throw Error();
   if(r.data.enrichment_status!=='completed')await analyzeRecord(c,job,'enrichment');
   else if(t.data.task_type!=='enrich_record')await analyzeRecord(c,job,'matching');
   if(t.data.task_type==='enrich_record'){await rpc(db,'cloud_finish',{...lease(c),p_state:'completed'});return {done:true,wait:0};}
  }
  await checkpoint(c,`retry:${currentJob??'task'}`,0);
  await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:1};
 }catch(error){
  if(error instanceof CloudYield){await rpc(db,'cloud_finish',{...lease(c),p_state:'pending'});return {done:false,wait:error.wait};}
  const failure=publicFailure(error);
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
