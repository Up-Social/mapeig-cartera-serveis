/* eslint-disable @typescript-eslint/no-explicit-any -- Database snapshot rows are checked at the pilot boundary and preserved without field loss. */
/** Approved isolated pilot. Never use a generic worker or load a remote target for writes. */
import {createClient} from '@supabase/supabase-js';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,open,rename,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createWorker} from 'tesseract.js';
import {PILOT_API,PILOT_PROJECT,PILOT_MODEL,assertPilotTarget,pilotRequest,pilotUsageCost,type PilotReceipt} from '../lib/convenis/pilot-budget';
import {processConveni,ConveniFailure} from '../lib/convenis/process';
import {recoverPdfText,preserveUnselectedPdfPages,EXTRACTION_VERSION} from '../lib/pipeline/readable-document';
import {archiveSource,archiveUnitSource} from '../lib/source-storage';
import {splitText,hash} from '../lib/pipeline/chunks';
import {documentQuality} from '../lib/evidence-eligibility';
import {providerRequest} from '../lib/cloud/provider';
import {lease,type Context} from '../lib/cloud/context';
const exec=promisify(execFile);
const base='docs/local/piloto-convenis-2026-10-18',root=`${base}/ejecucion`;
const status=JSON.parse(execFileSync('supabase',['status','--workdir','.cache/convenis-pilot-runtime','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
assertPilotTarget(status.API_URL,PILOT_PROJECT);
if(process.env.WORKFLOW_TEST_PROJECT)throw Error('Synthetic test environment cannot run this pilot');
const db=createClient(PILOT_API,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const manifest=JSON.parse(await readFile(`${base}/muestra-propuesta.json`,'utf8'));
const members=manifest.rows;
if(members.length!==24||manifest.budget_usd!==6||new Set(members.map((r:any)=>r.database_id)).size!==24)throw Error('Approved sample changed');
const identity=await db.from('pilot_runtime_identity').select('*').single();
if(identity.error||identity.data.project!==PILOT_PROJECT||JSON.stringify([...identity.data.sample].sort())!==JSON.stringify(members.map((r:any)=>r.database_id).sort()))throw Error('Pilot identity mismatch');
const catalog=await db.from('catalog_versions').select('id').eq('active',true).eq('validated',true).single();
if(catalog.error||catalog.data.id!==identity.data.catalog_id||catalog.data.id!=='pjc-557820-2164168')throw Error('Approved catalog changed');
await mkdir(root,{recursive:true});
const lock=await open(`${root}/executor.lock`,'wx');
async function save(name:string,data:unknown){const path=`${root}/${name}`,temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(data,null,2),{mode:0o600});await rename(temp,path);}
async function rpc(name:string,args:Record<string,unknown>){const r=await db.rpc(name,args);if(r.error)throw Error(`${name}: ${r.error.message}`);return r.data;}
let worker:Awaited<ReturnType<typeof createWorker>>|undefined;
async function extract(){
 const targetIndex=process.argv.indexOf('--document'),targetDoc=targetIndex<0?null:process.argv[targetIndex+1];
 const pagesIndex=process.argv.indexOf('--pages'),forcedPages=pagesIndex<0?[]:process.argv[pagesIndex+1].split(',').map(Number);
 const prepared=JSON.parse(await readFile(`${base}/documentos.json`,'utf8'));
 const result=[];
 for(const member of members.filter((r:any)=>r.expected_ai_calls===1)){
  const docs=await db.from('source_documents').select('*').eq('source_record_id',member.database_id).in('document_type',['agreement','annex']).order('id');if(docs.error)throw docs.error;
  for(const doc of docs.data){
   if(targetDoc&&doc.id!==targetDoc)continue;
   const cache=`${root}/extraction-${doc.id}.json`;
   try {const old=JSON.parse(await readFile(cache,'utf8'));if(old.complete&&!forcedPages.length){result.push(old);continue;}}catch{}
   const directory=await mkdtemp(join(tmpdir(),'convenis-pilot-ocr-'));
   try {
    let bytes:Buffer;
    if(doc.storage_path&&doc.storage_sha256){const d=await db.storage.from('cloud-documents').download(doc.storage_path);if(d.error)throw d.error;bytes=Buffer.from(await d.data.arrayBuffer());}
    else {const p=prepared.find((p:any)=>p.url===doc.url);if(!p)throw Error('Source missing from approved document set');bytes=await readFile(`${base}/${p.file}`);if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)throw Error('Prepared document changed');}
    await archiveSource(db,doc,{bytes,mimeType:'application/pdf'});
    const path=join(directory,'source.pdf');await writeFile(path,bytes);
    const info=await exec('pdfinfo',[path],{timeout:20_000});const pages=Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);if(!pages)throw Error('Page count missing');
    const raw=(await exec('pdftotext',['-layout',path,'-'],{timeout:30_000,maxBuffer:5*1024*1024})).stdout;
    const reading=forcedPages.length?preserveUnselectedPdfPages(raw,doc.extracted_text,forcedPages,pages):raw;
    const extraction=!forcedPages.length&&doc.extraction_version===EXTRACTION_VERSION&&doc.extracted_text&&doc.extraction_coverage?{text:doc.extracted_text,partial:doc.extraction_partial,method:doc.extraction_method,coverage:doc.extraction_coverage}:await recoverPdfText(reading,true,async page=>{
     console.log(`OCR ${member.official_id} · ${doc.document_type} · page ${page}/${pages}`);
     if(!worker){await mkdir('/tmp/convenis-pilot-ocr-cache',{recursive:true});worker=await createWorker(['cat','spa'],undefined,{cachePath:'/tmp/convenis-pilot-ocr-cache'});}
     const prefix=join(directory,'page');await exec('pdftoppm',['-png','-r',forcedPages.length?'400':'300','-f',String(page),'-l',String(page),'-singlefile',path,prefix],{timeout:120_000});
     return (await worker.recognize(`${prefix}.png`)).data.text;
    },pages,forcedPages);
    // Unselected pages retain their extraction provenance even though their
    // already recovered text is readable in the selective OCR input.
    if(forcedPages.length&&doc.extraction_coverage?.pages){
     extraction.coverage.pages=extraction.coverage.pages.map((page:any)=>forcedPages.includes(page.page)?page:(doc.extraction_coverage.pages.find((old:any)=>old.page===page.page)??page));
    }
    const quality=documentQuality(extraction.text,extraction.method,false);
    const dpiByPage=Object.fromEntries(extraction.coverage.pages.map((page:any)=>[page.page,forcedPages.length&&!forcedPages.includes(page.page)?(doc.extraction_coverage?.ocrDpiByPage?.[page.page]??doc.extraction_coverage?.ocrDpi??300):(forcedPages.length?400:300)]));
    const update=await db.from('source_documents').update({status:'fetched',http_status:200,extracted_text:extraction.text,text_length:extraction.text.length,extraction_method:extraction.method,extraction_version:EXTRACTION_VERSION,extraction_partial:extraction.partial,extraction_coverage:{...extraction.coverage,ocrEngine:'tesseract.js',ocrLanguages:['cat','spa'],ocrDpiByPage:dpiByPage},quality_flags:quality.qualityFlags,error_message:null,fetched_at:new Date().toISOString()}).eq('id',doc.id);if(update.error)throw update.error;
    await rpc('replace_document_chunks',{p_document:doc.id,p_chunks:splitText(extraction.text).map((content,ordinal)=>({ordinal,content,content_hash:hash(content)})),p_metadata:{text_preview:extraction.text.slice(0,600),extracted_text_hash:hash(extraction.text),quality_score:quality.qualityScore,quality_flags:quality.qualityFlags}});
    const record={id:doc.id,official_id:member.official_id,url:doc.url,pages,chars:extraction.text.length,method:extraction.method,complete:!extraction.partial,coverage:extraction.coverage};
    await save(`extraction-${doc.id}.json`,record);result.push(record);
    console.log(`EXTRACT ${member.official_id} · ${pages} pages · complete=${!extraction.partial}`);
   } catch(e){const record={id:doc.id,official_id:member.official_id,complete:false,error:e instanceof Error?e.message:String(e)};result.push(record);await save(`extraction-${doc.id}.json`,record);const r=await db.from('source_documents').update({status:'error',error_message:record.error}).eq('id',doc.id);if(r.error)throw r.error;console.log(`EXTRACT_BLOCKED ${member.official_id}: ${record.error}`);}
   finally{await rm(directory,{recursive:true,force:true});}
  }
 }
 await save(forcedPages.length?'targeted-extractions.json':'extractions.json',result);
}
async function jobs(){
 try{return JSON.parse(await readFile(`${root}/jobs.json`,'utf8'));}catch{}
 const run=await db.from('pipeline_runs').insert({status:'queued',stage:'preparation',selected_count:24,parameters:{purpose:'convenis_pilot',provider_budget_usd:6,model:PILOT_MODEL,auto_process:false,ocr_recovery:true,pilot:true}}).select('id').single();if(run.error)throw run.error;
 const created=[];
 for(const member of members){
  const old=await db.from('pipeline_jobs').select('id').eq('source_record_id',member.database_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();if(old.error)throw old.error;
  const j=await db.from('pipeline_jobs').insert({run_id:run.data.id,source_record_id:member.database_id,previous_job_id:old.data?.id??null,status:'selected',preparation_status:'ready'}).select('id').single();if(j.error)throw j.error;
  created.push({...member,jobId:j.data.id});
 }
 const task=await db.from('worker_tasks').insert({task_type:'process_run',run_id:run.data.id,executor:'vercel_workflow'}).select('id').single();if(task.error)throw task.error;
 const record={runId:run.data.id,taskId:task.data.id,members:created};await save('jobs.json',record);return record;
}
async function run(){
 if(process.env.OPENAI_MATCHING_MODEL!==PILOT_MODEL||!process.env.OPENAI_API_KEY)throw Error('Approved model/key unavailable');
 process.env.PIPELINE_PROVIDER='openai';
 const j=await jobs();let receipts:PilotReceipt[]=[];
 try{receipts=JSON.parse(await readFile(`${root}/receipts.json`,'utf8'));}catch{}
 if(receipts.some(r=>r.state==='sending'))throw Error('PILOT_PROVIDER_UNKNOWN');
 let outcomes:any[]=[];try{outcomes=JSON.parse(await readFile(`${root}/outcomes.json`,'utf8'));}catch{}
 const wave=process.argv[3];
 const repeatIndex=process.argv.indexOf('--repeat');
 const repeatIds=repeatIndex<0?[]:process.argv[repeatIndex+1].split(',');
 if(repeatIds.length>3||new Set(repeatIds).size!==repeatIds.length)throw Error('PILOT_REPEAT_LIMIT');
 j.repeatedIds??=[];j.repeatHistory??=[];
 for(const id of repeatIds){
  const member=j.members.find((m:any)=>m.pilot_id===id);
  if(!member||member.expected_ai_calls!==1||!receipts.some(r=>r.recordId===member.database_id&&r.state==='received'))throw Error('PILOT_REPEAT_NOT_AUTHORIZED');
  if(j.repeatedIds.includes(member.database_id))continue;
  if(j.repeatedIds.length>=3)throw Error('PILOT_REPEAT_LIMIT');
  const run=await db.from('pipeline_runs').insert({status:'queued',stage:'preparation',selected_count:1,parameters:{purpose:'convenis_pilot_repeat',provider_budget_usd:.30,auto_process:false,model:PILOT_MODEL,reason:'literal-span-citation-contract'}}).select('id').single();if(run.error)throw run.error;
  const job=await db.from('pipeline_jobs').insert({run_id:run.data.id,source_record_id:member.database_id,previous_job_id:member.jobId,status:'selected',preparation_status:'ready'}).select('id').single();if(job.error)throw job.error;
  const task=await db.from('worker_tasks').insert({task_type:'process_run',run_id:run.data.id,executor:'vercel_workflow'}).select('id').single();if(task.error)throw task.error;
  j.repeatHistory.push({recordId:member.database_id,previousJobId:member.jobId,jobId:job.data.id,runId:run.data.id,taskId:task.data.id});
  member.jobId=job.data.id;member.taskId=task.data.id;member.runId=run.data.id;j.repeatedIds.push(member.database_id);
  outcomes=outcomes.filter((o:any)=>o.recordId!==member.database_id);
 }
 if(repeatIds.length){await save('jobs.json',j);await save('outcomes.json',outcomes);}
 const selected=j.members.filter((m:any)=>!wave||m.wave.startsWith(wave));
 for(const member of selected){
  const previous=outcomes.find(o=>o.recordId===member.database_id);
  if(previous){if(process.argv.includes('--replay')&&previous.status==='blocked'&&previous.error?.includes('Invalid usage key'))outcomes=outcomes.filter(o=>o.recordId!==member.database_id);else continue;}
  const taskId=member.taskId??j.taskId;
  const owner=randomUUID(),generation=await rpc('cloud_claim',{p_task:taskId,p_owner:owner,p_version:'cloud-v1'});
  if(!generation)throw Error('Pilot task lease unavailable');
  const c:Context={db,owner,task:taskId,generation};
  let result:any;
  try{
   await processConveni(db,{id:member.jobId,source_record_id:member.database_id},async body=>{
    const requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const prior=receipts.find(r=>r.recordId===member.database_id&&r.requestHash===requestHash);
    if(prior?.state==='received'&&prior.response){
     await rpc('cloud_provider_usage',{...lease(c),p_key:`usage:${member.jobId}:conveni`,p_usage:prior.response.usage??{}});
     console.log(`REUSE ${member.official_id} · no new provider request`);return prior.response;
    }
    if(receipts.some(r=>r.recordId===member.database_id)&&!j.repeatedIds.includes(member.database_id))throw Error('PILOT_REQUEST_CHANGED');
    const checked=pilotRequest(body,member.database_id,members,receipts);
    const receipt:PilotReceipt={recordId:member.database_id,requestHash,reserved:checked.reserved,state:'sending'};receipts.push(receipt);await save('receipts.json',receipts);
    const raw=await providerRequest(c,`ai:${member.jobId}:conveni`,checked.request);
    receipt.response=raw; // Persist the response before checking usage or proposal validity.
    await save('receipts.json',receipts);
    receipt.actual=pilotUsageCost(raw.usage,checked.input);receipt.state='received';await save('receipts.json',receipts);
    await rpc('cloud_provider_usage',{...lease(c),p_key:`usage:${member.jobId}:conveni`,p_usage:raw.usage??{}});
    console.log(`AI ${member.official_id} · cost USD ${receipt.actual.toFixed(6)}`);
    return raw;
   });
   const a=await db.from('conveni_analyses').select('exclusion_reason,automatic').eq('job_id',member.jobId).single();if(a.error)throw a.error;
   if(member.expected_ai_calls===0&&!a.data.exclusion_reason)throw Error('Expected exclusion failed');
   const units=await db.from('conveni_unit_proposals').select('unit_id,data').eq('job_id',member.jobId);if(units.error)throw units.error;
   for(const u of units.data)await archiveUnitSource(db,member.database_id,u.unit_id);
   result={recordId:member.database_id,officialId:member.official_id,jobId:member.jobId,status:a.data.exclusion_reason?'excluded':'proposed',exclusion:a.data.exclusion_reason,units:units.data.length,blockers:units.data.flatMap((u:any)=>u.data.blockers)};
  }catch(e){
   result={recordId:member.database_id,officialId:member.official_id,jobId:member.jobId,status:'blocked',error:e instanceof Error?e.message:String(e),...(e instanceof ConveniFailure?{code:e.code,diagnostic:e.diagnostic,diagnostics:e.diagnostics}:{} )};
   const u=await db.from('pipeline_jobs').update({status:'error',error_message:result.error}).eq('id',member.jobId);if(u.error)throw u.error;
   const source=await db.from('source_records').update({processing_status:'error',updated_at:new Date().toISOString()}).eq('id',member.database_id);if(source.error)throw source.error;
  }
  outcomes.push(result);await save('outcomes.json',outcomes);console.log(`RESULT ${member.official_id} · ${result.status}${result.error?' · '+result.error:''}`);
  await rpc('cloud_finish',{...lease(c),p_state:'pending'});
  if(receipts.some(r=>r.state==='sending'))throw Error('PILOT_PROVIDER_UNKNOWN: stop all further calls');
 }
 for(const taskId of new Set<string>([j.taskId,...(j.repeatHistory??[]).map((r:any)=>r.taskId)])){
  const task=await db.from('worker_tasks').select('run_id,execution_state').eq('id',taskId).single();if(task.error)throw task.error;
  if(task.data.execution_state==='completed')continue;
  const remaining=await db.from('pipeline_jobs').select('id').eq('run_id',task.data.run_id).not('status','in','(needs_review,approved,corrected,rejected,insufficient_evidence,error)');if(remaining.error)throw remaining.error;
  if(!remaining.data.length){const owner=randomUUID(),generation=await rpc('cloud_claim',{p_task:taskId,p_owner:owner,p_version:'cloud-v1'});if(generation)await rpc('cloud_finish',{p_task:taskId,p_owner:owner,p_generation:generation,p_state:'completed'});}
 }
 console.log(JSON.stringify({outcomes:outcomes.length,calls:receipts.length,costUsd:receipts.reduce((n,r)=>n+(r.actual??r.reserved),0)}));
}
try {
 const mode=process.argv[2];
 if(mode==='extract')await extract();else if(mode==='run')await run();else throw Error('Use extract or run [A|B|C|D]');
}finally{
 if(worker)await worker.terminate();await lock.close();await rm(`${root}/executor.lock`,{force:true});
}
